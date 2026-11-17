# -*- coding: utf-8 -*-
from pathlib import Path
from datetime import datetime
from nonebot import on_message
from nonebot.adapters.onebot.v11 import GroupMessageEvent
from nonebot.log import logger
from core.config import PROJECT_ROOT, BOT_QQ, FEEDBACK_GROUP_ID, is_enabled

monitor = on_message(priority=99, block=False)

# QQ 历史消息永久保留：按天一个文件，不自动删除
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
