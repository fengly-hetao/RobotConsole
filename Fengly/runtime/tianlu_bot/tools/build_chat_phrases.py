# -*- coding: utf-8 -*-
"""
从 QQ 聊天记录提取群聊惯用语
============================

用途：群友平时说的话，不该被歌词识别误判。这个脚本把聊天记录里
      反复出现的说法提取出来，写进 chat_phrases.json。

用法：
    python tools/build_chat_phrases.py
    python tools/build_chat_phrases.py --dir "D:\\QQ消息" --groups 1085078451,630060814
"""
import sys
import io
import os
import re
import json
import glob
import argparse
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

DEFAULT_DIR = r"D:\QQ消息"
DEFAULT_GROUPS = "1085078451,630060814"
BOT_ID = "3835760131"

_CQ = re.compile(r"\[CQ:[^\]]+\]")
_AT = re.compile(r"@\S+\s*")
_SPLIT = re.compile(r"[。！？!?…~～，,、；;\s]+")
_DATE = re.compile(r"^\[([\d\-: ]+)\] \[(\d+)\] (.+?)\((\d+)\): (.*)$")


def clean_text(t: str) -> str:
    t = _CQ.sub("", t or "")
    t = _AT.sub("", t)
    return t.strip()


def load_messages(root: str):
    """读 JSONL + 全局 log，返回 [{gid, uid, text}]。"""
    msgs = []

    # ① 聊天记录/*.json （每行一个 JSON）
    for f in glob.glob(os.path.join(root, "聊天记录", "*.json")):
        try:
            txt = open(f, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        n = 0
        for line in txt.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                it = json.loads(line)
            except Exception:
                continue
            if isinstance(it, dict):
                msgs.append({
                    "gid": str(it.get("group_id") or ""),
                    "uid": str(it.get("user_id") or ""),
                    "text": it.get("message") or it.get("raw_message") or "",
                })
                n += 1
        if n:
            print(f"    {os.path.basename(f)}: {n} 条")

    # ② 全局/*.log
    for f in glob.glob(os.path.join(root, "全局", "*.log")):
        try:
            lines = open(f, encoding="utf-8", errors="ignore").read().splitlines()
        except Exception:
            continue
        n = 0
        for ln in lines:
            m = _DATE.match(ln)
            if m:
                msgs.append({"gid": m.group(2), "uid": m.group(4), "text": m.group(5)})
                n += 1
        if n:
            print(f"    {os.path.basename(f)}: {n} 条")

    return msgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR, help="QQ 消息目录")
    ap.add_argument("--groups", default=DEFAULT_GROUPS, help="群号，逗号分隔")
    ap.add_argument("--bot-id", default=BOT_ID, help="机器人自己的 QQ")
    ap.add_argument("--out", default="", help="输出路径")
    args = ap.parse_args()

    groups = {g.strip() for g in args.groups.split(",") if g.strip()}

    if not os.path.isdir(args.dir):
        print(f"❌ 目录不存在: {args.dir}")
        return

    print(f"=== 读取 {args.dir} ===")
    msgs = load_messages(args.dir)
    print(f"  共 {len(msgs)} 条")

    in_group = [m for m in msgs if m["gid"] in groups]
    human = [
        m for m in in_group
        if m["uid"] != args.bot_id and clean_text(m["text"])
    ]
    print(f"  目标群: {len(in_group)} 条")
    print(f"  群友有效发言: {len(human)} 条")

    # 提取短语
    counts = Counter()
    for m in human:
        t = clean_text(m["text"])
        if not t or len(t) > 300:
            continue
        for p in _SPLIT.split(t):
            p = p.strip()
            if 2 <= len(p) <= 30:
                counts[p] += 1

    print(f"\n=== 提取完成：{len(counts)} 种短语 ===")
    for p, c in counts.most_common(20):
        print(f"  {c:3}  {p[:50]}")

    # 输出
    out_path = args.out or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "plugins", "ai_chat", "chat_phrases.json"
    )
    data = {
        "source": args.dir,
        "groups": sorted(groups),
        "total_msgs": len(human),
        "phrases": [{"t": p, "c": c} for p, c in counts.most_common(3000)],
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    print(f"\n✅ 已写入 {out_path}")
    print(f"   短语数: {len(data['phrases'])}")
    print(f"   大小: {os.path.getsize(out_path)/1024:.1f} KB")


if __name__ == "__main__":
    main()
