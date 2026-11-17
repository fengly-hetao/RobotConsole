# -*- coding: utf-8 -*-
import json
import re
from pathlib import Path
from core.config import PROJECT_ROOT

CHARACTER_FILE = PROJECT_ROOT / "data" / "characters.json"

CHARACTERS = {
    "天禄": {"species": "貔貅", "desc": "蓝色的貔貅，傲娇可爱"},
    "辟邪": {"species": "貔貅", "desc": "红色的貔貅，沉稳睿智"},
    "四不像": {"species": "麋鹿", "desc": "鹿人店老板"},
}

_RE_QUERY = re.compile(r"(?:是谁|是哪个|什么角色)\s*(\S+)")

_characters_cache: dict = {}


def _load():
    global _characters_cache
    if CHARACTER_FILE.exists():
        try:
            with open(CHARACTER_FILE, "r", encoding="utf-8") as f:
                _characters_cache = json.load(f)
        except Exception:
            _characters_cache = {}


_load()


async def query_character(user_msg: str) -> str:
    match = _RE_QUERY.search(user_msg)
    if not match:
        return "（歪头）你想问谁？"

    name = match.group(1)

    if name in ("天禄", "皮皮", "我"):
        return "（用爪子指着自己）哼！就是本大爷！"

    if name in _characters_cache:
        info = _characters_cache[name]
        return f"（甩了甩尾巴）{name}啊，是个{info.get('species', '神兽')}，{info.get('desc', '')}"

    if name in CHARACTERS:
        info = CHARACTERS[name]
        return f"（甩了甩尾巴）{name}啊，是个{info['species']}，{info['desc']}"

    return f"（歪头）{name}？没听说过～"