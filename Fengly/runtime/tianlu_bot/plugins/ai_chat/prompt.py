# -*- coding: utf-8 -*-
import json
from nonebot.log import logger
from pathlib import Path
from datetime import datetime
from core.config import PROJECT_ROOT

PERSONALITY_FILE = PROJECT_ROOT / "data" / "qq.json"


def load_personality() -> dict:
    if PERSONALITY_FILE.exists():
        try:
            with open(PERSONALITY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"❌ 加载人格配置失败: {e}")
    return {}


_PERSONALITY = load_personality()
_SYSTEM_PROMPT = _PERSONALITY.get("system_prompt", "") or (
    "你是《有兽焉》里的天禄，蓝色貔貅。傲娇嘴硬心软爱吐槽。"
    "说话前先用（）写动作再说话。"
)

_ACTIONS = _PERSONALITY.get("actions", [
    "甩尾巴", "翻白眼", "打哈欠", "竖起耳朵", "歪头", "嚼着零食",
    "用爪子戳屏幕", "抖毛", "伸懒腰", "抱胸", "撇嘴", "叹气",
])

_WEEKDAYS = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")


def get_favor_level(favor: int) -> str:
    if favor < 0:
        return "💢 讨厌"
    if favor < 10:
        return "😐 普通"
    if favor < 30:
        return "🙂 顺眼"
    if favor < 60:
        return "😊 朋友"
    if favor < 100:
        return "💕 好朋友"
    return "💖 最喜欢"


# 缓存时间字符串，每分钟刷新一次
_prompt_cache: dict[int, str] = {}
_prompt_cache_ts: float = 0.0
_CACHE_TTL = 60.0


def build_prompt(favor: int = 0) -> str:
    """system prompt 极简化，prefill 省 60%"""
    global _prompt_cache_ts
    import time
    now = time.monotonic()
    if now - _prompt_cache_ts > _CACHE_TTL:
        _prompt_cache.clear()
        _prompt_cache_ts = now

    cached = _prompt_cache.get(favor)
    if cached is not None:
        return cached

    now_dt = datetime.now()
    result = (
        f"{_SYSTEM_PROMPT}\n"
        f"时间:{now_dt:%m-%d %H:%M} 好感:{favor}({get_favor_level(favor)})\n"
        f"要求:括号动作开头,80-150字,不分段,不重复用户话,傲娇可爱,超200字截断。"
    )
    _prompt_cache[favor] = result
    return result