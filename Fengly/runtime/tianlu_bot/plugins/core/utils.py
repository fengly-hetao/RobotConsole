# -*- coding: utf-8 -*-
"""
通用工具函数
"""
import json
import re
import time
from pathlib import Path
from typing import Any, Optional
from datetime import datetime


# ==================== JSON 文件操作 ====================

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


# ==================== 消息解析 ====================

# 机器人昵称「天禄」，群里显示名可能是「天禄(AI)」/「天禄（AI）」
_RE_CQ_AT = re.compile(r"\[CQ:at,qq=\d+\]\s*")
_RE_CQ_REPLY = re.compile(r"\[CQ:reply,id=\d+[^\]]*\]\s*")
_RE_AT_NAME = re.compile(r"@\s*天禄\s*(?:[（(]\s*AI\s*[)）]?)?\s*")


def strip_mention(text: str) -> str:
    """剥掉 @机器人 的提及（CQ 码 + 纯文本两种形态），返回干净正文。

    兼容机器人昵称带后缀的情况，例如「@天禄(AI)」「@天禄（AI）」。
    """
    if not text:
        return ""
    text = _RE_CQ_AT.sub("", text)
    text = _RE_CQ_REPLY.sub("", text)
    text = _RE_AT_NAME.sub("", text)
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


# ==================== 时间工具 ====================

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


# ==================== 文本处理 ====================

def truncate_text(text: str, max_len: int = 500, suffix: str = "...") -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + suffix


def is_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def extract_chinese(text: str) -> str:
    return ''.join(re.findall(r"[\u4e00-\u9fff]", text))


# ==================== 防重复 ====================

class DuplicateChecker:
    def __init__(self, interval: float = 3.0):
        self.interval = interval
        self._records = {}

    def check(self, key: str) -> bool:
        now = time.time()
        if key in self._records and now - self._records[key] < self.interval:
            return True
        self._records[key] = now
        return False

    def clear(self):
        self._records.clear()


# ==================== 用户信息 ====================

async def get_user_name(bot, user_id: str, group_id: int) -> str:
    try:
        info = await bot.get_group_member_info(
            group_id=group_id, user_id=int(user_id)
        )
        return info.get("card") or info.get("nickname") or str(user_id)
    except Exception:
        return str(user_id)


# ==================== 数据迁移工具 ====================

def migrate_json_to_sqlite():
    pass