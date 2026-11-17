# -*- coding: utf-8 -*-
import json
from core.config import DATA_DIR

INVENTORY_FILE = DATA_DIR / "inventory.json"

def get_inventory(user_id: str) -> str:
    from .user import load_json_file
    inv = load_json_file(INVENTORY_FILE, {})
    
    items = inv.get(user_id, {})
    if not items:
        return "（摊手）背包空空如也！"
    
    msg = "🎒 背包 🎒\n"
    for name, count in items.items():
        msg += f"• {name} x{count}\n"
    return msg