# -*- coding: utf-8 -*-
import random
import json
from datetime import datetime
from pathlib import Path
from core.config import PROJECT_ROOT, ai_get

FORTUNE_FILE = PROJECT_ROOT / "fortune.json"


def _fortunes() -> list:
    raw = ai_get("LOTTERY_FORTUNES", "大吉,中吉,小吉,末吉")
    return [x.strip() for x in raw.split(",") if x.strip()] or ["大吉", "中吉", "小吉", "末吉"]


_cache: dict[str, str] = {}
_loaded = False


def _ensure_loaded():
    global _loaded, _cache
    if _loaded:
        return
    try:
        if FORTUNE_FILE.exists():
            with open(FORTUNE_FILE, "r", encoding="utf-8") as f:
                _cache = json.load(f)
    except Exception:
        _cache = {}
    _loaded = True


def _save():
    tmp = FORTUNE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(_cache, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(FORTUNE_FILE)


def get_fortune(user_id: str) -> str:
    _ensure_loaded()
    today = datetime.now().strftime("%Y-%m-%d")
    key = f"{user_id}_{today}"
    val = _cache.get(key)
    if val is None:
        val = random.choice(_fortunes())
        _cache[key] = val
        try:
            _save()
        except Exception:
            pass
    return val
