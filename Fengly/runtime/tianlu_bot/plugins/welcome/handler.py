# -*- coding: utf-8 -*-
"""
入群欢迎
========
新人进群时自动发一段简短介绍 + 玩法引导。

设计原则：
  · 只发一次，不刷屏
  · 内容短，重点是「怎么用」而不是功能罗列
  · 可开关：FEATURE_WELCOME（默认开启）
  · 只在自己配置的群里生效（GROUP_ID 为空则不限制）

QQ 的入群事件：
  · group_increase  有人主动加群 / 被拉进来
  · group_decrease  有人退群 / 被踢（不发欢迎）
"""
from nonebot import on_notice
from nonebot.adapters.onebot.v11 import GroupIncreaseNoticeEvent, MessageSegment
from nonebot.log import logger

from core.config import BOT_QQ, get_group_ids, is_enabled

welcome = on_notice(priority=5, block=False)

# 欢迎语（短、说清怎么用）
_WELCOME_TEXT = (
    "👋 欢迎新朋友！\n"
    "\n"
    "我是这个群的 AI 机器人，可以陪聊、看图、唱歌、玩游戏。\n"
    "\n"
    "🎯 用法就一句：先 @我，再说指令\n"
    "   @我 菜单        ← 看全部功能（30 个小游戏都在这）\n"
    "   @我 签到        ← 每天领金币\n"
    "   @我 掷骰子      ← 随便玩一个\n"
    "   @我 <随便说>    ← AI 聊天\n"
    "\n"
    "新人建议先发「签到」攒金币，再玩老虎机 / 开宝箱～"
)


@welcome.handle()
async def handle_group_increase(event: GroupIncreaseNoticeEvent):
    # 功能开关
    if not is_enabled("welcome"):
        return

    # 群过滤：只在自己的群发
    if get_group_ids() and str(event.group_id) not in get_group_ids():
        return

    # 机器人自己被拉进群 → 发一个自我介绍（可选的额外引导）
    if str(event.user_id) == str(BOT_QQ):
        logger.info(f"[welcome] 机器人被拉进群 {event.group_id}")
        try:
            await welcome.finish(
                "大家好，我是 AI 机器人～\n"
                "用法：@我 菜单 看全部功能，@我 签到 领金币，@我 <随便说> 就能聊天。"
            )
        except Exception as e:
            logger.debug(f"[welcome] 机器人入群提示失败: {e}")
        return

    # 普通成员入群
    try:
        await welcome.finish(MessageSegment.at(str(event.user_id)) + "\n" + _WELCOME_TEXT)
        logger.info(f"[welcome] 已欢迎 {event.user_id} 加入 {event.group_id}")
    except Exception as e:
        logger.warning(f"[welcome] 欢迎发送失败: {type(e).__name__}: {e}")
