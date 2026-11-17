# -*- coding: utf-8 -*-
"""
自动重启插件（仅 Windows）
每天凌晨 3:30 自动重启电脑，开关在 ai_data/00_features.env 的 FEATURE_AUTO_REBOOT
"""
import os
import asyncio
from datetime import datetime, timedelta
from nonebot import get_driver
from nonebot.log import logger
from core.config import is_enabled

REBOOT_HOUR = 3      # 重启小时
REBOOT_MINUTE = 30   # 重启分钟

driver = get_driver()


async def auto_reboot_task():
    """每天凌晨 3:30 执行重启（受功能开关控制）"""
    if not is_enabled("auto_reboot"):
        logger.info("🔄 自动重启未开启（FEATURE_AUTO_REBOOT=false），不执行")
        return
    while True:
        now = datetime.now()
        target = now.replace(hour=REBOOT_HOUR, minute=REBOOT_MINUTE, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        wait_seconds = (target - now).total_seconds()
        logger.info(f"⏰ 下次自动重启：{target.strftime('%Y-%m-%d %H:%M:%S')}")
        await asyncio.sleep(wait_seconds)
        logger.warning("🔄 到达重启时间，执行重启...")
        os.system("shutdown /r /t 0 /f")  # 仅 Windows


@driver.on_startup
async def start_reboot_task():
    asyncio.create_task(auto_reboot_task())
    logger.info("🔄 自动重启插件已加载")
