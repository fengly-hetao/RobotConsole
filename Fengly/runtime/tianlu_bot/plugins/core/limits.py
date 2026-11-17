# -*- coding: utf-8 -*-
"""
每日限额：按用户 + 类型 统计每天使用次数，防止群友刷爆 API 额度。
数据保存在 data/limits.json，每天自动重置。
"""
import json
from datetime import date
from pathlib import Path

from core.config import DATA_DIR

LIMITS_FILE = DATA_DIR / "limits.json"

_cache: dict | None = None
_cache_day: str | None = None


def _load() -> dict:
    global _cache, _cache_day
    today = date.today().isoformat()
    if _cache is not None and _cache_day == today:
        return _cache
    data = {}
    if LIMITS_FILE.exists():
        try:
            loaded = json.loads(LIMITS_FILE.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and loaded.get("_day") == today:
                data = loaded
        except Exception:
            data = {}
    if not data:
        data = {"_day": today}
    _cache = data
    _cache_day = today
    return _cache


def _save(data: dict):
    global _cache, _cache_day
    _cache = data
    _cache_day = date.today().isoformat()
    tmp = LIMITS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(LIMITS_FILE)  # 原子替换


def use(user_id: str, kind: str) -> int:
    """记录一次使用，返回今日已用次数。"""
    data = _load()
    key = f"{user_id}:{kind}"
    data[key] = data.get(key, 0) + 1
    _save(data)
    return data[key]


def used(user_id: str, kind: str) -> int:
    return _load().get(f"{user_id}:{kind}", 0)


def check(user_id: str, kind: str, limit: int) -> bool:
    """是否还能用（limit<=0 表示不限）。"""
    if limit <= 0:
        return True
    return used(user_id, kind) < limit
