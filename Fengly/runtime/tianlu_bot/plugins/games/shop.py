# -*- coding: utf-8 -*-
import json
from core.config import DATA_DIR

INVENTORY_FILE = DATA_DIR / "inventory.json"
USER_DATA_FILE = DATA_DIR / "user_data.json"

SHOP_ITEMS = {
    "竹子": {"price": 10, "exp": 5, "sell": 8},
    "苹果": {"price": 15, "exp": 8, "sell": 12},
    "小鱼干": {"price": 20, "exp": 10, "sell": 17},
    "烤肉": {"price": 30, "exp": 15, "sell": 25},
    "蛋糕": {"price": 50, "exp": 25, "sell": 42},
    "仙丹": {"price": 100, "exp": 50, "sell": 85},
}

def get_shop() -> str:
    msg = "🍃 天禄小商店 🍃\n"
    for name, info in SHOP_ITEMS.items():
        msg += f"• {name}：{info['price']}金币（+{info['exp']}经验）\n"
    return msg

def buy_item(user_id: str, item_name: str) -> str:
    if item_name not in SHOP_ITEMS:
        return "（歪头）没有这种东西！"
    
    info = SHOP_ITEMS[item_name]
    data = {}
    from .user import load_json_file
    data = load_json_file(USER_DATA_FILE, {})
    
    if user_id not in data:
        data[user_id] = {"level": 1, "exp": 0, "coin": 100, "point": 0}
    
    if data[user_id].get("coin", 0) < info["price"]:
        return f"（撇嘴）金币不够！需要{info['price']}金币"
    
    data[user_id]["coin"] -= info["price"]
    _tmp = USER_DATA_FILE.with_suffix(".tmp")
    _tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    _tmp.replace(USER_DATA_FILE)
    
    inv = {}
    from .user import load_json_file
    inv = load_json_file(INVENTORY_FILE, {})
    
    inv.setdefault(user_id, {})
    inv[user_id][item_name] = inv[user_id].get(item_name, 0) + 1
    _tmp = INVENTORY_FILE.with_suffix(".tmp")
    _tmp.write_text(json.dumps(inv, ensure_ascii=False, indent=2), encoding="utf-8")
    _tmp.replace(INVENTORY_FILE)
    
    return f"（接过{item_name}）购买成功！还剩{data[user_id]['coin']}金币～"

def sell_item(user_id: str, item_name: str) -> str:
    inv = {}
    from .user import load_json_file
    inv = load_json_file(INVENTORY_FILE, {})
    
    if user_id not in inv or inv[user_id].get(item_name, 0) == 0:
        return f"（叹气）你没有{item_name}！"
    
    price = SHOP_ITEMS.get(item_name, {}).get("sell")
    if not price:
        return "（歪头）这个东西不能卖！"
    
    inv[user_id][item_name] -= 1
    if inv[user_id][item_name] == 0:
        del inv[user_id][item_name]
    _tmp = INVENTORY_FILE.with_suffix(".tmp")
    _tmp.write_text(json.dumps(inv, ensure_ascii=False, indent=2), encoding="utf-8")
    _tmp.replace(INVENTORY_FILE)
    
    data = {}
    from .user import load_json_file
    data = load_json_file(USER_DATA_FILE, {})
    data[user_id]["coin"] = data[user_id].get("coin", 0) + price
    _tmp = USER_DATA_FILE.with_suffix(".tmp")
    _tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    _tmp.replace(USER_DATA_FILE)
    
    return f"（卖掉{item_name}）获得{price}金币！"