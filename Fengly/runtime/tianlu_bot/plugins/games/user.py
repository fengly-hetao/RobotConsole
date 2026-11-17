# -*- coding: utf-8 -*-
import json
from pathlib import Path
from core.config import DATA_DIR

USER_DATA_FILE = DATA_DIR / "user_data.json"

NEW_USER = {"level": 1, "exp": 0, "coin": 100, "point": 0}


def load_json_file(path: Path, default):
    """安全读 JSON，损坏时返回默认值"""
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default


def atomic_write_json(path: Path, data):
    """公共原子写：临时文件 + 替换（全项目统一用这个）"""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def get_user_data(user_id: str) -> dict:
    data = load_json_file(USER_DATA_FILE, {})
    if user_id not in data:
        data[user_id] = dict(NEW_USER)
        atomic_write_json(USER_DATA_FILE, data)
    return data[user_id]


def save_user_data(user_id: str, user_data: dict):
    data = load_json_file(USER_DATA_FILE, {})
    data[user_id] = user_data
    atomic_write_json(USER_DATA_FILE, data)


def add_exp(user_id: str, amount: int):
    user = get_user_data(user_id)
    user["exp"] += amount
    leveled = False
    while user["exp"] >= user["level"] * 100:
        user["exp"] -= user["level"] * 100
        user["level"] += 1
        leveled = True
    save_user_data(user_id, user)
    return leveled


def add_coin(user_id: str, amount: int):
    user = get_user_data(user_id)
    user["coin"] += amount
    save_user_data(user_id, user)
