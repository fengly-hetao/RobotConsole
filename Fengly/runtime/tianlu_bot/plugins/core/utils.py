# -*- coding: utf-8 -*-
"""通用工具函数。

设计原则：**绝不硬编码机器人昵称**。
用户随时可能改昵称（天禄 / 辟邪 / 或者别的），也随时可能换号。
所有「是否 @ 了机器人」的判断一律只看 BOT_QQ，与昵称无关。
"""
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from core.config import PROJECT_ROOT


# ==================== 时间工具 ====================

def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def day_offset(days: int = 0) -> str:
    return (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")


# ==================== @ 提及处理 ====================
#
# QQ 里「@机器人」在 raw_message 中可能出现四种形态：
#   1. [CQ:at,qq=3750509249]          标准 CQ 码
#   2. CQ:at,qq=3750509249 正文        get_plaintext() 化之后的纯文本
#   3. @昵称 正文                       某些适配器直接给纯文本
#   4. @昵称（AI） 正文                 带后缀的纯文本
#
# 历史 BUG：早期代码写死 `"@天禄" in raw_msg`，用户把昵称改成「辟邪」后，
# 所有指令都失效、机器人对 @ 毫无反应。这里彻底改成与昵称无关的实现。

_RE_CQ_AT = re.compile(r"\[CQ:at,qq=\d+\]\s*")
_RE_CQ_REPLY = re.compile(r"\[CQ:reply,id=\d+[^\]]*\]\s*")
_RE_CQ_AT_RAW = re.compile(r"CQ:at,qq=\d+\s*")
# 任意 @昵称（不含空格，最多 20 字符；含括号后缀也一起吃掉）
_RE_AT_ANY = re.compile(r"@[^\s@]{1,20}(?:[（(][^）)]{0,10}[)）])?\s*")
# 只用于从 raw_message 判断是否有 @（任意 QQ 号）
_RE_CQ_AT_ANY = re.compile(r"\[CQ:at,qq=\d+\]")


def is_at_bot(raw_msg: str, bot_qq: str = "") -> bool:
    """判断这条消息是否 @ 了机器人。

    优先级：
      1. 有 BOT_QQ 时，只认这个 QQ 号（最准确，不会误判 @ 别人）
      2. 没有 BOT_QQ 时，退化为「有任意 @」

    不看昵称 —— 昵称随时会变，QQ 号不会。
    """
    if not raw_msg:
        return False

    if bot_qq:
        if f"[CQ:at,qq={bot_qq}]" in raw_msg:
            return True
        if f"CQ:at,qq={bot_qq}" in raw_msg:
            return True
        # 配了 BOT_QQ 但消息里 @ 的是别人 → 明确不是 @ 机器人
        # （纯文本 @ 无法判断是谁，只能保守返回 False，由上层决定）
        if _RE_CQ_AT_ANY.search(raw_msg):
            return False

    # 没有任何 CQ 码时，看到 @ 就算（适配器已经过滤过群/私聊范围）
    if "@" in raw_msg:
        return True

    return False


def strip_mention(text: str) -> str:
    """剥掉所有 @ 提及和引用前缀，返回干净正文。

    不区分 @ 的是谁 —— 调用方（各插件）已经用 is_at_bot 判断过归属，
    这里只负责清洗文本。
    """
    if not text:
        return ""

    text = _RE_CQ_AT.sub("", text)
    text = _RE_CQ_REPLY.sub("", text)
    text = _RE_CQ_AT_RAW.sub("", text)
    text = _RE_AT_ANY.sub("", text)

    return text.strip()


def extract_command(raw_msg: str, bot_qq: str = "") -> str:
    """兼容旧调用：剥离 @ 与引用，返回干净正文。"""
    return strip_mention(raw_msg)


def extract_at(raw_msg: str) -> list:
    return re.findall(r"\[CQ:at,qq=(\d+)\]", raw_msg)


def extract_images(raw_msg: str) -> list:
    return re.findall(
        r"file=([^,\]]+\.(?:jpg|png|jpeg|gif|bmp|webp))",
        raw_msg, re.IGNORECASE,
    )


def extract_reply(raw_msg: str) -> Optional[str]:
    match = re.search(r"\[CQ:reply,id=(\d+)\]", raw_msg)
    return match.group(1) if match else None


def extract_quoted_text(raw_msg: str) -> str:
    match = re.search(r"\[CQ:reply,id=\d+\]\s*(.+?)(?=\[CQ:|$)", raw_msg)
    return match.group(1).strip() if match else ""


# ==================== 文本工具 ====================

def truncate(text: str, limit: int = 100, suffix: str = "…") -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + suffix


def safe_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", str(name or "")).strip() or "unnamed"


def ensure_dir(p) -> Path:
    path = Path(p)
    path.mkdir(parents=True, exist_ok=True)
    return path


# ==================== JSON / 时间 / 中文工具（从旧版保留）====================

def load_json(path: Path, default: Any = None) -> Any:
    if default is None:
        default = {}
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError, OSError):
        return default



def save_json(path: Path, data: Any) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except (IOError, OSError, TypeError):
        return False



def safe_update_json(path: Path, key: str, value: Any) -> bool:
    data = load_json(path)
    data[key] = value
    return save_json(path, data)



def get_today() -> str:
    return datetime.now().strftime("%Y-%m-%d")



def get_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")



def get_weekday() -> str:
    weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    return weekdays[datetime.now().weekday()]



def format_duration(seconds: float) -> str:
    days = int(seconds // 86400)
    hours = int((seconds % 86400) // 3600)
    minutes = int((seconds % 3600) // 60)
    if days > 0:
        return f"{days}天 {hours}小时 {minutes}分钟"
    elif hours > 0:
        return f"{hours}小时 {minutes}分钟"
    return f"{minutes}分钟"



def is_today(date_str: str) -> bool:
    return date_str == get_today()



def truncate_text(text: str, max_len: int = 500, suffix: str = "...") -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + suffix



def is_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))



def extract_chinese(text: str) -> str:
    return ''.join(re.findall(r"[\u4e00-\u9fff]", text))



def migrate_json_to_sqlite():
    pass


