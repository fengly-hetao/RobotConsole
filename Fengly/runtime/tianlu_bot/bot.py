# -*- coding: utf-8 -*-
"""
机器人 - 主入口
"""
import sys
from pathlib import Path

# 强制 UTF-8 输出，避免中文 Windows(GBK 控制台) 下 emoji 日志报 UnicodeEncodeError
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import nonebot
from nonebot.adapters.onebot.v11 import Adapter as OneBotAdapter
from nonebot.log import logger

BASE_DIR = Path(__file__).parent
plugins_dir = BASE_DIR / "plugins"

sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(plugins_dir))

nonebot.init()
driver = nonebot.get_driver()
driver.register_adapter(OneBotAdapter)

PLUGINS = [
    "core",
    "system",
    "games",
    "ai_chat",
    "monitor",
    "poke",
    "feedback",
]

for plugin in PLUGINS:
    try:
        ok = nonebot.load_plugin(plugin)
        if ok:
            logger.info(f"✅ 插件加载成功: {plugin}")
        else:
            logger.error(f"❌ 插件加载失败: {plugin}（load_plugin 返回 False）")
    except Exception as e:
        logger.error(f"❌ 插件加载异常: {plugin} - {e}")

_loaded_names = {p.name for p in nonebot.get_loaded_plugins()}
for plugin in PLUGINS:
    if plugin not in _loaded_names:
        logger.error(f"🚨 插件未真正加载: {plugin}")


@driver.on_startup
async def on_startup():
    logger.info("=" * 50)
    logger.info("🌟 AI机器人 启动完成！")
    logger.info("=" * 50)

    try:
        from core.config import MINIMAX_API_KEY
        if MINIMAX_API_KEY:
            from ai_chat.tts import synthesize
            await synthesize("你好")
            logger.info("🎙️ TTS 预热完成")
        else:
            logger.info("🎙️ TTS 预热跳过（未配置 MiniMax Key）")
    except Exception as e:
        logger.debug(f"TTS 预热跳过: {type(e).__name__}")


@driver.on_shutdown
async def on_shutdown():
    try:
        from core.http_client import close_http_client
        await close_http_client()
        logger.info("🔌 HTTP 连接池已关闭")
    except Exception as e:
        logger.error(f"关闭 HTTP client 失败: {e}")


if __name__ == "__main__":
    import os
    host = os.getenv("BOT_HOST", "127.0.0.1")
    port = int(os.getenv("BOT_PORT", "18080"))
    nonebot.run(host=host, port=port)