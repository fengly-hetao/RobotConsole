# -*- coding: utf-8 -*-
"""
生成热门歌词库（含个人收藏）
==========================

数据来源：
  1. 网易云各大榜单前 100（热歌/飙升/新歌/原创/说唱/电音）
  2. 个人收藏（我喜欢的音乐 + 自建歌单）

输出：plugins/ai_chat/hot_lyrics.json

用法：
    python tools/build_hot_lyrics.py              # 只抓榜单
    python tools/build_hot_lyrics.py --with-fav   # 榜单 + 收藏
"""
import sys
import io
import os
import re
import json
import time
import asyncio
import argparse
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import httpx

HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Referer": "https://music.163.com/",
}

# 要抓的榜单
BOARDS = [
    ("热歌榜", 3778678),
    ("飙升榜", 19723756),
    ("新歌榜", 3779629),
    ("原创榜", 2884035),
    ("云音乐说唱榜", 991319590),
    ("云音乐电音榜", 1978921795),
]

TOP_N = 100

_TIMETAG = re.compile(r"\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]")
_META = re.compile(r"\[[a-zA-Z]+:[^\]]*\]")
_SKIP = re.compile(
    r"^(作词|作曲|编曲|制作人|监制|混音|母带|和声|录音|吉他|贝斯|鼓|"
    r"出品|发行|策划|统筹|录音室|混音室|OP|SP|词|曲|Beat说明|伴奏)\s*[:：]",
    re.IGNORECASE,
)
_PUNCT = re.compile(r"[\s,，.。!！?？、；;：:\"'“”‘’()（）\[\]【】…~～\-—_/\\*#@&^%$]+")


def norm(s):
    return _PUNCT.sub("", s or "").lower()


def parse_lines(lrc):
    out = []
    for raw in (lrc or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if _META.match(line) and not _TIMETAG.search(line):
            continue
        text = _TIMETAG.sub("", line).strip()
        if not text or _SKIP.match(text) or re.fullmatch(r"[\W_]+", text):
            continue
        # 过滤掉明显不是歌词的行
        if re.search(r"(伴奏|demo|流程|留言|关注|评论|下载|免费|FREE|Type beat|prod\.?by)", text, re.I):
            continue
        out.append(text)
    return out


def extract_hot(lines, top_k=4):
    """提取热门句：重复最多的（副歌），没重复就取中间段。"""
    if not lines:
        return []

    counts = Counter()
    first_pos = {}
    normalized = []
    for i, ln in enumerate(lines):
        n = norm(ln)
        if not n or len(n) < 4:
            continue
        counts[n] += 1
        if n not in first_pos:
            first_pos[n] = i
        normalized.append((i, ln, n))

    if not normalized:
        return []

    repeated = [n for n, c in counts.items() if c >= 2]

    if repeated:
        picked = sorted(repeated, key=lambda n: (-counts[n], first_pos[n]))[:top_k]
    else:
        mid = len(normalized) // 2
        start = max(0, mid - top_k // 2)
        picked = [n for _, _, n in normalized[start:start + top_k]]

    out = []
    seen = set()
    for n in picked:
        if n in seen:
            continue
        seen.add(n)
        for _, ln, nn in normalized:
            if nn == n:
                out.append(ln)
                break
    return out


async def fetch_board(client, name, pid):
    try:
        r = await client.get(
            "https://music.163.com/api/playlist/detail",
            params={"id": pid},
            headers=HEADERS_BASE,
            timeout=25.0,
        )
        d = r.json()
    except Exception as e:
        print(f"  [{name}] 获取失败: {type(e).__name__}: {e}")
        return []

    tracks = (d.get("result") or {}).get("tracks") or []
    out = []
    for t in tracks[:TOP_N]:
        out.append({
            "id": t.get("id"),
            "name": t.get("name") or "",
            "artists": "/".join(a.get("name", "") for a in (t.get("artists") or [])),
            "board": name,
        })
    print(f"  [{name}] {len(out)} 首")
    return out


async def fetch_playlist(client, name, pid, cookie):
    """取歌单全部歌曲。"""
    headers = dict(HEADERS_BASE)
    if cookie:
        headers["Cookie"] = cookie
    try:
        r = await client.get(
            "https://music.163.com/api/v6/playlist/detail",
            params={"id": pid, "n": 2000, "s": 8},
            headers=headers,
            timeout=25.0,
        )
        d = r.json()
    except Exception as e:
        print(f"  [{name}] 获取失败: {type(e).__name__}: {e}")
        return []

    pl = d.get("playlist") or {}
    tracks = pl.get("tracks") or []
    out = []
    for t in tracks:
        ar = t.get("ar") or t.get("artists") or []
        out.append({
            "id": t.get("id"),
            "name": t.get("name") or "",
            "artists": "/".join(a.get("name", "") for a in ar),
            "board": name,
        })
    print(f"  [{name}] {len(out)} 首（歌单共 {pl.get('trackCount')} 首）")
    return out


async def fetch_lyric(client, song_id, cookie=""):
    headers = dict(HEADERS_BASE)
    if cookie:
        headers["Cookie"] = cookie
    try:
        r = await client.get(
            "https://music.163.com/api/song/lyric",
            params={"id": song_id, "lv": -1, "kv": -1, "tv": -1},
            headers=headers,
            timeout=20.0,
        )
        d = r.json()
        return (d.get("lrc") or {}).get("lyric") or ""
    except Exception:
        return ""


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-fav", action="store_true", help="同时抓个人收藏")
    ap.add_argument("--cookie", default="", help="网易云 Cookie（含 MUSIC_U）")
    ap.add_argument("--fav-ids", default="18002702823,18170739202",
                    help="收藏歌单 ID，逗号分隔")
    args = ap.parse_args()

    cookie = args.cookie or os.environ.get("NETEASE_COOKIE", "")

    print("=== 1. 抓取榜单 ===")
    all_songs = []
    seen_ids = set()

    async with httpx.AsyncClient() as client:
        for name, pid in BOARDS:
            songs = await fetch_board(client, name, pid)
            for s in songs:
                if s["id"] and s["id"] not in seen_ids:
                    seen_ids.add(s["id"])
                    all_songs.append(s)

        if args.with_fav:
            print("\n=== 2. 抓取个人收藏 ===")
            if not cookie:
                print("  ⚠️ 没有 Cookie，跳过收藏（用 --cookie 或环境变量 NETEASE_COOKIE）")
            else:
                for fid in args.fav_ids.split(","):
                    fid = fid.strip()
                    if not fid:
                        continue
                    songs = await fetch_playlist(client, f"收藏{fid}", int(fid), cookie)
                    for s in songs:
                        if s["id"] and s["id"] not in seen_ids:
                            seen_ids.add(s["id"])
                            all_songs.append(s)
                        elif s["id"] in seen_ids:
                            # 已在榜单里，补个收藏标记
                            for exist in all_songs:
                                if exist["id"] == s["id"]:
                                    exist["board"] = exist["board"] + "/收藏"
                                    break

    print(f"\n  去重后共 {len(all_songs)} 首")

    print("\n=== 3. 抓歌词并提取热门句 ===")
    result = []
    ok = 0
    async with httpx.AsyncClient() as client:
        for i, s in enumerate(all_songs):
            lrc = await fetch_lyric(client, s["id"], cookie)
            lines = parse_lines(lrc)
            if len(lines) < 8:
                continue
            hot = extract_hot(lines, top_k=4)
            if not hot:
                continue
            result.append({
                "name": s["name"],
                "artists": s["artists"],
                "boards": [s["board"]],
                "hot": hot,
            })
            ok += 1
            if (i + 1) % 50 == 0:
                print(f"  进度 {i+1}/{len(all_songs)}  成功 {ok}")
            await asyncio.sleep(0.1)

    # 合并同名歌
    merged = {}
    for r in result:
        key = (r["name"], r["artists"])
        if key in merged:
            for b in r["boards"]:
                if b not in merged[key]["boards"]:
                    merged[key]["boards"].append(b)
        else:
            merged[key] = r

    final = list(merged.values())
    # 排序：上多个榜 / 在收藏里的优先
    def rank(x):
        boards = x["boards"]
        return (-len(boards), 0 if any("收藏" in b for b in boards) else 1, x["name"])
    final.sort(key=rank)

    print(f"\n=== 4. 结果 ===")
    print(f"  歌曲总数: {len(final)}")
    print(f"  热门句总数: {sum(len(x['hot']) for x in final)}")
    fav_count = sum(1 for x in final if any("收藏" in b for b in x["boards"]))
    print(f"  其中收藏歌曲: {fav_count}")

    _here = os.path.dirname(os.path.abspath(__file__))
    _bot_root = os.path.dirname(_here)
    out_path = os.path.join(_bot_root, "plugins", "ai_chat", "hot_lyrics.json")

    data = {
        "updated": time.strftime("%Y-%m-%d"),
        "count": len(final),
        "with_fav": args.with_fav,
        "songs": final,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    print(f"\n✅ 已写入 {out_path}")
    print(f"   大小: {os.path.getsize(out_path)/1024:.1f} KB")


if __name__ == "__main__":
    asyncio.run(main())
