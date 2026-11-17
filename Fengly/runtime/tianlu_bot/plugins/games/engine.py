# -*- coding: utf-8 -*-
"""
通用小游戏引擎
================
加游戏 = 在 games.json 里加一条 JSON，零代码。
引擎负责：指令匹配 / 开关检查 / 每日限额 / 冷却 / 经济结算 / 文案渲染。
games.json 带 mtime 热缓存：改完下一秒生效，不用重启。
"""
import json
import random
import time
from pathlib import Path

from core.config import ai_get_bool
from core.limits import use as limit_use, check as limit_check
from .user import get_user_data, save_user_data

GAMES_FILE = Path(__file__).parent / "games.json"

_mtime: float = 0.0
_games: list = []
_cool: dict = {}


def _ensure() -> list:
    """mtime 热加载 games.json"""
    global _mtime, _games
    try:
        mt = GAMES_FILE.stat().st_mtime
    except OSError:
        return _games
    if mt == _mtime:
        return _games
    try:
        data = json.loads(GAMES_FILE.read_text(encoding="utf-8"))
        _games = data if isinstance(data, list) else []
        _mtime = mt
    except Exception:
        pass
    return _games


def all_games() -> list:
    return _ensure()


def find_game(cmd: str):
    for g in _ensure():
        if g.get("cmd") == cmd:
            return g
    return None


def enabled(g: dict) -> bool:
    """分类总开关 + 单游戏开关（默认开，写了 false 才关）"""
    if not ai_get_bool("FEATURE_GAMES_" + str(g.get("category", "luck")).upper(), True):
        return False
    return ai_get_bool("FEATURE_GAME_" + str(g.get("id", "")).upper(), True)


def _pick_pool(pool):
    """按权重从奖池选一项：{name, min, max, w?}"""
    total = sum(p.get("w", 1) for p in pool)
    r = random.uniform(0, total)
    acc = 0
    for p in pool:
        acc += p.get("w", 1)
        if r <= acc:
            return p
    return pool[-1]


def _fmt(g, **kw):
    try:
        tpl = random.choice(g.get("templates", ["{result}"]))
        return tpl.format(**kw)
    except Exception:
        return str(kw.get("result", ""))


def play(user_id: str, cmd: str, args: str = "") -> str | None:
    """执行游戏，返回回复文本；不是游戏命令返回 None"""
    g = find_game(cmd)
    if g is None:
        return None
    gid = str(g.get("id", cmd))
    name = g.get("name", cmd)
    if not enabled(g):
        return f"（摊爪）「{name}」被关掉了，去控制台的「功能」页打开吧～"
    # 冷却
    now = time.time()
    cd = float(g.get("cooldown", 0))
    key = f"{user_id}:{gid}"
    if cd and now - _cool.get(key, 0) < cd:
        left = int(cd - (now - _cool.get(key, 0))) + 1
        return f"（按住你）{left} 秒后再来玩「{name}」～"
    # 每日限额
    dl = int(g.get("daily_limit", 0))
    if not limit_check(user_id, "game_" + gid, dl):
        return f"（摊爪）今天「{name}」玩够 {dl} 次啦，明天再来！"
    limit_use(user_id, "game_" + gid)
    _cool[key] = now
    # 经济：扣费
    cost = int(g.get("cost", 0))
    user = get_user_data(user_id)
    if cost and user.get("coin", 0) < cost:
        return f"（撇嘴）金币不够！「{name}」需要 {cost} 金币"
    user["coin"] = user.get("coin", 0) - cost

    kind = g.get("type", "pick")
    gain = 0
    extra = {}

    if kind == "dice":
        a, b = random.randint(1, 6), random.randint(1, 6)
        if a > b:
            result = "你赢了！"
            gain = int(g.get("win", cost * 2))
        elif a == b:
            result = "平局，退还本金"
            gain = cost
        else:
            result = "本座赢了～"
        extra = {"a": a, "b": b, "result": result}

    elif kind == "dice2":
        a = random.randint(2, 12)
        b = random.randint(2, 12)
        if a > b:
            result = "你赢了！"
            gain = int(g.get("win", cost * 2))
        elif a == b:
            result = "平局，退还本金"
            gain = cost
        else:
            result = "本座赢了～"
        extra = {"a": a, "b": b, "result": result}

    elif kind == "dice3":
        d = [random.randint(1, 6) for _ in range(3)]
        if d[0] == d[1] == d[2]:
            result = f"豹子 {d[0]}！大赚！"
            gain = int(g.get("win", cost * 20))
        else:
            result = "没有拼出豹子"
        extra = {"a": d[0], "b": d[1], "c": d[2], "result": result}

    elif kind == "coin":
        guess = args.strip()
        face = random.choice(["正", "反"])
        if guess and guess[0] in ("正", "反") and guess[0] == face[0]:
            result = "猜中啦！"
            gain = int(g.get("win", cost * 2))
        elif guess and guess[0] in ("正", "反"):
            result = "猜错了～"
        else:
            result = f"硬币落下：{face}面"
            gain = 0
        extra = {"a": face, "result": result}

    elif kind == "oddeven":
        guess = args.strip()
        n = random.randint(1, 6)
        actual = "单" if n % 2 else "双"
        if guess and guess[0] in "单双" and guess[0] == actual[0]:
            result = f"骰子 {n} 点（{actual}），猜中啦！"
            gain = int(g.get("win", cost * 2))
        elif guess and guess[0] in "单双":
            result = f"骰子 {n} 点（{actual}），猜错了～"
        else:
            result = f"骰子 {n} 点（{actual}）"
        extra = {"a": n, "b": actual, "result": result}

    elif kind == "slot":
        icons = g.get("icons", ["🍀", "🍎", "🍋", "💎", "7️⃣"])
        r = [random.choice(icons) for _ in range(3)]
        if r[0] == r[1] == r[2]:
            result = "三个一样！中大奖！"
            gain = int(g.get("win", cost * 10))
        elif r[0] == r[1] or r[1] == r[2]:
            result = "两个一样，小赚"
            gain = int(cost * 0.5)
        else:
            result = "没中～"
        extra = {"a": r[0], "b": r[1], "c": r[2], "result": result}

    elif kind == "wheel":
        p = _pick_pool(g.get("pool", [{"name": "谢谢参与", "min": 0, "max": 0}]))
        gain = random.randint(int(p.get("min", 0)), int(p.get("max", 0)))
        result = f"转盘停在「{p['name']}」"
        extra = {"item": p["name"], "result": result}

    elif kind == "pick":
        p = _pick_pool(g.get("pool", [{"name": "空气", "min": 0, "max": 0}]))
        gain = random.randint(int(p.get("min", 0)), int(p.get("max", 0)))
        result = f"获得了 {p['name']}！"
        extra = {"item": p["name"], "result": result}

    elif kind == "lootbox":
        tiers = g.get("tiers", [{"name": "普通", "chance": 70, "min": 1, "max": 5}])
        r = random.uniform(0, sum(t.get("chance", 10) for t in tiers))
        acc = 0
        t = tiers[-1]
        for tt in tiers:
            acc += tt.get("chance", 10)
            if r <= acc:
                t = tt
                break
        gain = random.randint(int(t.get("min", 0)), int(t.get("max", 0)))
        result = f"开出【{t['name']}】！"
        extra = {"item": t["name"], "result": result}

    elif kind == "rand":
        gain = random.randint(int(g.get("min", 0)), int(g.get("max", 10)))
        result = f"捡到 {gain} 金币！" if gain else "什么也没有～"
        extra = {"result": result}

    elif kind == "danger":
        cells = int(g.get("cells", 6))
        bad = random.randint(1, cells)
        pick_n = random.randint(1, cells)
        if pick_n == bad:
            result = "踩中地雷！血本无归～"
        else:
            result = "安全过关！"
            gain = int(g.get("win", cost * 2))
        extra = {"a": pick_n, "b": cells, "result": result}

    elif kind == "lucknum":
        n = random.randint(1, 100)
        if n >= int(g.get("win_at", 85)):
            result = f"幸运数字 {n}！中奖！"
            gain = int(g.get("win", cost * 5))
        else:
            result = f"数字 {n}，差一点～"
        extra = {"a": n, "result": result}

    else:
        gain = random.randint(0, int(g.get("max", 5)))
        result = f"获得 {gain} 金币！" if gain else "什么也没有～"
        extra = {"result": result}

    user["coin"] = user.get("coin", 0) + gain
    save_user_data(user_id, user)

    text = _fmt(g, name=name, gain=gain, **extra)
    if cost or gain:
        text += f"\n💰 花费 {cost} 金币" + (f"，获得 {gain} 金币" if gain else "") + f"，余额 {user['coin']}"
    return text
