# -*- coding: utf-8 -*-
import time
from core.config import get_cooldown

_cooldown: dict[str, float] = {}
_cooldown_time: float = float(get_cooldown())
_last_clean: float = time.monotonic()
_CLEAN_INTERVAL: float = 3600.0


def check_cooldown(user_id: str) -> bool:
    """检查冷却，返回 True 表示在冷却中"""
    global _last_clean
    now = time.monotonic()

    # 定期清理，防内存泄漏
    if now - _last_clean > _CLEAN_INTERVAL:
        cutoff = now - _cooldown_time * 10
        for k in [k for k, v in _cooldown.items() if v < cutoff]:
            _cooldown.pop(k, None)
        _last_clean = now

    last = _cooldown.get(user_id)
    if last is not None and now - last < _cooldown_time:
        return True
    _cooldown[user_id] = now
    return False


