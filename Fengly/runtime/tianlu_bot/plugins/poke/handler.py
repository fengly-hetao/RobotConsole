# -*- coding: utf-8 -*-
from nonebot import on_notice
from nonebot.adapters.onebot.v11 import (
    Bot, PokeNotifyEvent, GroupMessageEvent, MessageSegment,
)
from nonebot.log import logger
from core.config import get_group_ids

poke = on_notice(priority=5, block=True)


@poke.handle()
async def handle_poke(bot: Bot, event: PokeNotifyEvent):
    # 只处理被戳的对象是机器人自己的情况
    if event.target_id != event.self_id:
        return

    user_id = str(event.user_id)
    # 群过滤
    if get_group_ids() and str(getattr(event, "group_id", "")) not in get_group_ids():
        return
    if not is_enabled("poke"):
        return
    logger.info(f"[poke] 被戳 user={user_id}")

    # 群里 @对方，私聊不 @
    if isinstance(event, GroupMessageEvent):
        msg = MessageSegment.at(user_id) + "（甩尾巴）戳我干嘛！"
    else:
        msg = "（甩尾巴）戳我干嘛！"

    await poke.finish(msg)