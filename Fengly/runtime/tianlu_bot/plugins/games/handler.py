# -*- coding: utf-8 -*-
import re
import random
from nonebot import on_message
from nonebot.adapters.onebot.v11 import Bot, GroupMessageEvent, MessageSegment
from nonebot.exception import FinishedException, RejectedException
from nonebot.log import logger
from core.config import BOT_QQ, IGNORE_QQ, GROUP_IDS, is_enabled, get_group_ids
from core.utils import strip_mention
from .shop import get_shop, buy_item, sell_item
from .inventory import get_inventory
from .user import get_user_data, add_exp, add_coin, save_user_data
from .admin import is_admin, modify_data, modify_favor

# 预编译正则
_RE_BUY = re.compile(r"(?:买|购买)\s*(\S+)")
_RE_SELL = re.compile(r"卖\s*(\S+)")
_RE_MOD_DATA = re.compile(r"修改数据\s+@?(\S+)\s+(\S+)\s+(\d+)")
_RE_MOD_FAVOR = re.compile(r"改好感度\s+@?(\S+)\s+(\d+)")

games = on_message(priority=5, block=False)   # ★ 改 False


@games.handle()
async def handle_games(bot: Bot, event: GroupMessageEvent):
    user_id = str(event.user_id)
    if user_id in IGNORE_QQ:
        return
    # 群过滤
    if get_group_ids() and str(event.group_id) not in get_group_ids():
        return
    # 功能开关
    if not is_enabled("games"):
        return
    raw_msg = event.raw_message if hasattr(event, "raw_message") else str(event.message)

    if "@天禄" not in raw_msg and f"[CQ:at,qq={BOT_QQ}]" not in raw_msg:
        return

    plain = event.get_plaintext() if hasattr(event, "get_plaintext") else raw_msg
    cmd = strip_mention(plain)

    if not cmd:
        return

    try:
        if cmd == "商店":
            await games.finish(MessageSegment.at(user_id) + get_shop())
            return

        if cmd.startswith("买") or cmd.startswith("购买"):
            match = _RE_BUY.search(cmd)
            if match:
                await games.finish(MessageSegment.at(user_id) + buy_item(user_id, match.group(1)))
            return

        if cmd.startswith("卖"):
            match = _RE_SELL.search(cmd)
            if match:
                await games.finish(MessageSegment.at(user_id) + sell_item(user_id, match.group(1)))
            return

        if cmd == "背包":
            await games.finish(MessageSegment.at(user_id) + get_inventory(user_id))
            return

        if cmd == "签到" and is_enabled("sign"):
            import time as _time
            user = get_user_data(user_id)
            _today = _time.strftime("%Y-%m-%d")
            if user.get("sign_day") == _today:
                await games.finish(MessageSegment.at(user_id) + "（甩尾巴）今天已经签到过了！")
                return
            coin = random.randint(10, 30)
            exp = random.randint(5, 20)
            # 一次读-改-写，sign_day 与奖励同时落盘
            user["sign_day"] = _today
            user["coin"] = user.get("coin", 0) + coin
            user["exp"] = user.get("exp", 0) + exp
            while user["exp"] >= user["level"] * 100:
                user["exp"] -= user["level"] * 100
                user["level"] += 1
            from .user import save_user_data
            save_user_data(user_id, user)
            await games.finish(MessageSegment.at(user_id) + f"签到成功！+{coin}金币 +{exp}经验")
            return

        if cmd == "抽签" and is_enabled("lottery"):
            exp = random.randint(5, 30)
            add_exp(user_id, exp)
            fortune = random.choice(["大吉", "中吉", "小吉", "末吉"])
            await games.finish(MessageSegment.at(user_id) + f"🎋 {fortune}\n经验+{exp}")
            return

        if cmd == "我的信息":
            user = get_user_data(user_id)
            await games.finish(
                MessageSegment.at(user_id)
                + f"等级：{user['level']}\n经验：{user['exp']}/{user['level'] * 100}\n"
                  f"金币：{user['coin']}\n点券：{user.get('point', 0)}"
            )
            return

        if cmd.startswith("修改数据"):
            if not is_admin(user_id):
                return
            match = _RE_MOD_DATA.search(cmd)
            if match:
                await games.finish(MessageSegment.at(user_id) + modify_data(match.group(1), match.group(2), int(match.group(3))))
            return

        # ===== 上传的音频（工具箱上传 → 群里播放） =====
        if cmd == "音频列表":
            from pathlib import Path as _P
            _adir = _P(__file__).resolve().parents[2] / "data" / "audio"
            _names = [f.name for f in _adir.iterdir() if f.is_file()] if _adir.exists() else []
            if not _names:
                await games.finish(MessageSegment.at(user_id) + "（摊手）还没有上传音频，去控制台工具箱上传～")
            else:
                await games.finish(MessageSegment.at(user_id) + "🎵 音频列表：\n" + "\n".join("· " + n for n in _names))
            return

        if cmd.startswith("播放音频") or cmd.startswith("放音频"):
            _kw = cmd[4:].strip() if cmd.startswith("播放音频") else cmd[3:].strip()
            from pathlib import Path as _P
            _adir = _P(__file__).resolve().parents[2] / "data" / "audio"
            _target = None
            if _adir.exists():
                for _f in _adir.iterdir():
                    if _f.is_file() and (_f.stem == _kw or _kw in _f.name):
                        _target = _f
                        break
            if not _target:
                await games.finish(MessageSegment.at(user_id) + "（歪头）没找到音频「" + _kw + "」，发「音频列表」看看有哪些")
                return
            try:
                await games.finish(MessageSegment.at(user_id) + MessageSegment.record(file="file:///" + _target.as_posix()))
            except Exception as _e:
                await games.finish(MessageSegment.at(user_id) + "（叹气）发送失败：" + str(_e))
            return

        # ===== 引擎小游戏（games.json 数据驱动，30+ 个运气游戏） =====
        if " " in cmd:
            _head, _args = cmd.split(maxsplit=1)
        else:
            _head, _args = cmd, ""
        from . import engine
        _res = engine.play(user_id, _head, _args)
        if _res is not None:
            await games.finish(MessageSegment.at(user_id) + _res)
            return

        if cmd.startswith("改好感度"):
            if not is_admin(user_id):
                return
            match = _RE_MOD_FAVOR.search(cmd)
            if match:
                await games.finish(MessageSegment.at(user_id) + modify_favor(match.group(1), int(match.group(2))))
            return

    except (FinishedException, RejectedException):
        raise
    except Exception as e:
        logger.debug(f"[games] 未处理异常: {type(e).__name__}: {e}")