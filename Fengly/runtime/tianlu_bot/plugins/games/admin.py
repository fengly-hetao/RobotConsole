# -*- coding: utf-8 -*-
import json
from pathlib import Path
from core.config import OWNER_ID, DATA_DIR, PROJECT_ROOT

ADMIN_FILE = PROJECT_ROOT / "admin_whitelist.json"
FAVOR_FILE = PROJECT_ROOT / "favor.json"
USER_DATA_FILE = DATA_DIR / "user_data.json"


def _atomic_write(path: Path, data: dict):
    """原子写入：临时文件 + 替换"""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_admins():
    if ADMIN_FILE.exists():
        try:
            with open(ADMIN_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


_ADMINS = frozenset(q.strip() for q in (OWNER_ID or "").split(",") if q.strip())


def is_admin(user_id: str) -> bool:
    return user_id in _ADMINS or user_id in load_admins()


def modify_data(target: str, field: str, value: int) -> str:
    if field not in ["level", "exp", "coin", "point"]:
        return f"（歪头）字段只能是：level, exp, coin, point"

    data = {}
    if USER_DATA_FILE.exists():
        with open(USER_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

    if target not in data:
        data[target] = {"level": 1, "exp": 0, "coin": 100, "point": 0}

    data[target][field] = value
    _atomic_write(USER_DATA_FILE, data)

    return f"（点点头）已将 {target} 的 {field} 改为 {value}！"


def modify_favor(target: str, value: int) -> str:
    data = {}
    if FAVOR_FILE.exists():
        try:
            with open(FAVOR_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}

    data[target] = value
    _atomic_write(FAVOR_FILE, data)

    return f"（点点头）已将 {target} 的好感度改为 {value}！"
