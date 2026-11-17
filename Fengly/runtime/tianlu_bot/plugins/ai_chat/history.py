# -*- coding: utf-8 -*-
import asyncio
import json
from pathlib import Path
from core.config import DATA_DIR, get_max_history

_MAX_HISTORY = get_max_history()
_MAX_USERS = 300
_HISTORY_FILE = DATA_DIR / "chat_history.json"
_history: dict[str, list] = {}
_dirty = False
_flush_task: asyncio.Task | None = None


def _load():
    global _history
    try:
        if _HISTORY_FILE.exists():
            data = json.loads(_HISTORY_FILE.read_text(encoding="utf-8"))
            _history = {k: [m for m in v[-_MAX_HISTORY:]] for k, v in list(data.items())[-_MAX_USERS:]}
    except Exception:
        _history = {}


_load()


def _flush_now():
    global _dirty
    if not _dirty:
        return
    try:
        tmp = _HISTORY_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(_history, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_HISTORY_FILE)
        _dirty = False
    except Exception:
        pass


def _schedule_flush():
    # 延迟 4 秒合并写，减少 I/O
    global _flush_task
    if _flush_task and not _flush_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
        _flush_task = loop.create_task(_flush_after())
    except RuntimeError:
        _flush_now()


async def _flush_after():
    await asyncio.sleep(4)
    _flush_now()


def get_history(user_id: str):
    return _history.get(user_id, [])


def update_history(user_id: str, user_msg: str, reply: str):
    global _dirty
    h = _history.get(user_id)
    if h is None:
        if len(_history) >= _MAX_USERS:
            _history.pop(next(iter(_history)), None)
        h = []
        _history[user_id] = h
    h.append({"role": "user", "content": user_msg})
    h.append({"role": "assistant", "content": reply})
    if len(h) > _MAX_HISTORY:
        del h[: len(h) - _MAX_HISTORY]
    _dirty = True
    _schedule_flush()


def clear_history(user_id: str):
    global _dirty
    if user_id in _history:
        del _history[user_id]
        _dirty = True
        _schedule_flush()


def set_max_history(limit: int):
    global _MAX_HISTORY
    _MAX_HISTORY = limit
