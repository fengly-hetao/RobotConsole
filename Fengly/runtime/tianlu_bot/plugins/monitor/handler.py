# -*- coding: utf-8 -*-
from pathlib import Path
from datetime import datetime
from nonebot import on_message
from nonebot.adapters.onebot.v11 import GroupMessageEvent
from nonebot.log import logger
from core.config import PROJECT_ROOT, BOT_QQ, FEEDBACK_GROUP_ID, is_enabled

monitor = on_message(priority=99, block=False)

# QQ 历史消息永久保留：按天一个文件，不自动删除
# 存储位置可通过 .env 的 MESSAGE_DIR 自定义（留空 = 默认 runtime/tianlu_bot/logs/messages）
def _resolve_msg_dir() -> Path:
    import os as _os
    raw = (_os.environ.get("MESSAGE_DIR") or "").strip().strip('"').strip("'")
    if not raw:
        return PROJECT_ROOT / "logs" / "messages"
    p = Path(raw)
    # 相对路径按项目根解析，绝对路径直接用
    if not p.is_absolute():
        p = PROJECT_ROOT / p
    return p


MSG_LOG_DIR = _resolve_msg_dir()
try:
    MSG_LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"📁 消息记录目录: {MSG_LOG_DIR}")
except Exception as _e:
    logger.warning(f"⚠️ 消息目录创建失败（{MSG_LOG_DIR}），回退到默认目录: {_e}")
    MSG_LOG_DIR = PROJECT_ROOT / "logs" / "messages"
    MSG_LOG_DIR.mkdir(parents=True, exist_ok=True)


@monitor.handle()
async def handle_monitor(event: GroupMessageEvent):
    user_id = str(event.user_id)
    raw_msg = event.raw_message if hasattr(event, "raw_message") else str(event.message)
    plain = event.get_plaintext() if hasattr(event, "get_plaintext") else raw_msg

    if user_id == BOT_QQ:
        return
    if plain.startswith("#"):
        return
    if not is_enabled("monitor"):
        return
    # 反馈群的消息一律不进历史记录（用户要求：消息页不显示该群）
    if str(event.group_id) == str(FEEDBACK_GROUP_ID):
        return

    now = datetime.now()
    log_file = MSG_LOG_DIR / f"{now.strftime('%Y-%m-%d')}.log"
    line = f"[{now.strftime('%H:%M:%S')}] {user_id}: {plain[:200]}\n"
    try:
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


logger.info("📊 监控插件已加载（QQ历史消息永久保留）")
