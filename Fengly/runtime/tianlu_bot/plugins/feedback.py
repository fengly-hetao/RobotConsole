# -*- coding: utf-8 -*-
"""
反馈中心（群聊版）：
1. 控制台提交的反馈 → 机器人自动发到反馈群
2. 反馈群里 @机器人 反馈/建议/问题 xxx → 记入反馈墙（未解决）
3. 管理员 @机器人 说「处理完了」→ 最新一条未解决标记为已解决
4. 反馈墙（控制台消息页）统一读取 feedback_store.json
"""
import asyncio
import json
from datetime import datetime
from pathlib import Path
from nonebot import get_driver, get_bot, on_message
from nonebot.adapters.onebot.v11 import GroupMessageEvent, MessageSegment
from nonebot.log import logger
from nonebot.rule import Rule
from core.config import PROJECT_ROOT, OWNER_ID, BOT_QQ, FEEDBACK_GROUP_ID

STORE_FILE = PROJECT_ROOT / "data" / "feedback_store.json"

driver = get_driver()


# ---------- 存储工具 ----------
def load_store() -> list:
    try:
        if STORE_FILE.exists():
            data = json.loads(STORE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return []


def save_store(data: list):
    try:
        STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STORE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"[feedback] 保存失败: {e}")


def append_entry(source: str, ftype: str, text: str, qq: str) -> dict:
    data = load_store()
    entry = {
        "id": len(data) + 1,
        "time": int(datetime.now().timestamp() * 1000),
        "source": source,           # console | group
        "type": ftype,
        "text": text[:500],
        "qq": qq,
        "status": "open",           # open=未解决 done=已解决
        "posted": True,             # 群内反馈无需再转发；控制台反馈默认 False
    }
    data.insert(0, entry)
    save_store(data)
    return entry


# ---------- 群内反馈收集 / 管理员处理 ----------
def feedback_group_rule():
    def _check(event: GroupMessageEvent) -> bool:
        return str(event.group_id) == str(FEEDBACK_GROUP_ID)
    return Rule(_check)


feedback_msg = on_message(rule=feedback_group_rule(), priority=5, block=False)

# 私聊反馈：任何人私聊机器人说「反馈 xxx」都能收到
feedback_private = on_message(priority=6, block=False)


@feedback_private.handle()
async def handle_private_feedback(bot, event):
    """私聊反馈 —— 不依赖任何群，谁都能用"""
    from nonebot.adapters.onebot.v11 import PrivateMessageEvent
    if not isinstance(event, PrivateMessageEvent):
        return
    user_id = str(event.user_id)
    if user_id == BOT_QQ:
        return

    plain = event.get_plaintext().strip() if hasattr(event, "get_plaintext") else str(event.message).strip()
    if not plain:
        return

    # 只认带关键词的消息，避免把普通聊天当成反馈
    kws = ("反馈", "建议", "问题", "bug", "Bug", "报错")
    hit = next((k for k in kws if k in plain), None)
    if not hit:
        return

    content = plain
    idx = content.find(hit)
    if idx >= 0:
        content = content[idx + len(hit):].lstrip(":：,， ")
    if not content:
        await feedback_private.finish("📮 收到！请把具体内容写在「反馈」后面，例如：反馈 群消息不回复")
        return

    entry = append_entry("private", "建议", content, user_id)

    # 如果是群主自己发的，不用再转发，直接确认
    if user_id == OWNER_ID:
        await feedback_private.finish(f"📮 已记录 #{entry['id']}（你自己发的，不用转发）")
        return

    # 其他人：转发给群主
    try:
        bot2 = get_bot()
        await bot2.send_private_msg(
            user_id=int(OWNER_ID),
            message=f"📮 新反馈 #{entry['id']}（私聊 · QQ {user_id}）\n{content}"
        )
        entry["posted"] = True
        data = load_store()
        for it in data:
            if it.get("id") == entry["id"]:
                it["posted"] = True
        save_store(data)
    except Exception as e:
        logger.warning(f"[feedback] 私聊转发失败: {e}")

    await feedback_private.finish(f"📮 反馈已收到，编号 #{entry['id']}，感谢！")


@feedback_msg.handle()
async def handle_feedback_msg(event: GroupMessageEvent):
    plain = event.get_plaintext().strip() if hasattr(event, "get_plaintext") else str(event.message).strip()
    user_id = str(event.user_id)

    # 管理员说「处理完了」→ 最新未解决 → 已解决
    if user_id == OWNER_ID and any(k in plain for k in ("处理完了", "已处理", "处理完成", "已解决", "解决了")):
        data = load_store()
        done = None
        for item in data:
            if item.get("status") == "open":
                done = item
                break
        if done:
            done["status"] = "done"
            done["doneTime"] = int(datetime.now().timestamp() * 1000)
            save_store(data)
            await feedback_msg.finish(f"✅ 反馈 #{done.get('id')} 已标记为「已解决」")
        await feedback_msg.finish("🎉 当前没有未解决的反馈了")

    # 群友反馈：@机器人 + 关键词
    if user_id == BOT_QQ:
        return
    for kw in ("反馈", "建议", "问题", "bug", "Bug"):
        if kw in plain:
            content = plain
            for k in ("反馈", "建议", "问题", "bug", "Bug"):
                idx = content.find(k)
                if idx >= 0:
                    content = content[idx + len(k):].lstrip(":：,， ")
                    break
            if content:
                entry = append_entry("group", "建议", content, user_id)
                await feedback_msg.finish(f"📮 反馈已记录！编号 #{entry['id']}（未解决）")
    return


# ---------- 控制台反馈转发到群 / 私聊 ----------
async def _deliver_feedback(bot, item) -> bool:
    """把一条反馈送到可见的地方：优先群，群不可用则私聊群主。返回是否送达"""
    text = f"📮 新反馈 #{item.get('id')}（{item.get('type')} · QQ {item.get('qq', '匿名')}）\n{item.get('text', '')}"

    # 方式 1：反馈群（首选，群里有记录方便回看）
    if FEEDBACK_GROUP_ID:
        try:
            await bot.send_group_msg(group_id=int(FEEDBACK_GROUP_ID), message=text)
            logger.info(f"[feedback] 反馈 #{item.get('id')} 已转发到反馈群")
            return True
        except Exception as e:
            # 常见原因：机器人不在该群 / 该群限制发言。静默降级到私聊
            logger.debug(f"[feedback] 转发到群失败（将改用私聊）: {e}")

    # 方式 2：私聊群主（不依赖机器人是否在群里）
    if OWNER_ID:
        try:
            await bot.send_private_msg(user_id=int(OWNER_ID), message=text)
            logger.info(f"[feedback] 反馈 #{item.get('id')} 已私聊发送给群主")
            return True
        except Exception as e:
            logger.warning(f"[feedback] 私聊群主也失败: {e}")

    return False


async def relay_console_feedback():
    try:
        data = load_store()
        changed = False
        bot = get_bot()
        for item in data:
            if item.get("source") == "console" and not item.get("posted"):
                ok = await _deliver_feedback(bot, item)
                if ok:
                    item["posted"] = True
                    changed = True
                else:
                    # 都送不出去，保留 posted=False，下次循环再试
                    logger.debug(f"[feedback] 反馈 #{item.get('id')} 暂未送达，稍后重试")
                    break
        if changed:
            save_store(data)
    except Exception as e:
        logger.debug(f"[feedback] 转发循环异常: {e}")


@driver.on_startup
async def feedback_tasks():
    async def loop():
        await asyncio.sleep(15)  # 等连接建立
        await relay_console_feedback()
        while True:
            await asyncio.sleep(60)
            await relay_console_feedback()

    asyncio.create_task(loop())
    logger.info("📮 反馈中心已加载（反馈群：" + str(FEEDBACK_GROUP_ID) + "）")
