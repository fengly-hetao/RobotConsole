# -*- coding: utf-8 -*-
import json
from pathlib import Path
from core.config import PROJECT_ROOT, get_max_favor

FAVOR_FILE = PROJECT_ROOT / "favor.json"

_favor_cache: dict[str, int] = {}


def _load():
    global _favor_cache
    if FAVOR_FILE.exists():
        try:
            with open(FAVOR_FILE, "r", encoding="utf-8") as f:
                _favor_cache = json.load(f)
        except Exception:
            _favor_cache = {}


_load()


def _flush_now():
    # 原子写入 + 立即落盘，防强杀丢数据
    tmp = FAVOR_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(_favor_cache, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(FAVOR_FILE)


def get_favor(user_id: str) -> int:
    return _favor_cache.get(user_id, 0)


def add_favor(user_id: str, amount: int) -> int:
    max_favor = get_max_favor()
    new_val = min(max_favor, _favor_cache.get(user_id, 0) + amount)
    _favor_cache[user_id] = new_val
    _flush_now()
    return new_val
