# -*- coding: utf-8 -*-
"""
天禄语音合成模块 —— MiniMax 云端音色克隆
"""
import hashlib
from pathlib import Path
from nonebot.log import logger
from core.config import (PROJECT_ROOT, MINIMAX_API_KEY, MINIMAX_VOICE_ID,
                          get_tts_model, get_tts_speed, get_tts_sample_rate,
                          ai_get_int, ai_get_float)
from core.http_client import get_http_client

TTS_CACHE_DIR = PROJECT_ROOT / "data" / "tts_cache"
TTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

_tts_cache: dict[str, Path] = {}
_TTS_CACHE_MAX = ai_get_int("TTS_CACHE_MAX", 200)

TTS_ENABLED = True

# ==================== 模型选择 ====================
# speech-2.8-hd    ：音质最高，3.5 元/万字符（约 1428 字/元）
# speech-2.8-turbo ：音质略降，2 元/万字符（约 2500 字/元），推荐
TTS_MODEL = get_tts_model()


async def synthesize(text: str) -> Path | None:
    """输入文本，返回语音文件路径；失败返回 None。"""
    if not text or not TTS_ENABLED or not MINIMAX_API_KEY:
        return None
    # 单次长度上限（防长文烧钱）
    _max_chars = ai_get_int("TTS_MAX_CHARS", 200)
    if len(text) > _max_chars:
        text = text[:_max_chars] + "…"

    key = text.strip()
    if key in _tts_cache:
        p = _tts_cache[key]
        if p.exists():
            return p

    try:
        audio_bytes = await _minimax_tts(key)
    except Exception as e:
        logger.info(f"[tts] 合成失败: {type(e).__name__}: {e}")
        return None

    if not audio_bytes:
        return None

    fname = hashlib.md5(key.encode("utf-8")).hexdigest() + ".wav"
    fpath = TTS_CACHE_DIR / fname
    fpath.write_bytes(audio_bytes)

    if len(_tts_cache) >= _TTS_CACHE_MAX:
        for old_key in list(_tts_cache.keys())[:_TTS_CACHE_MAX // 2]:
            _tts_cache.pop(old_key, None)
    _tts_cache[key] = fpath
    return fpath


async def _minimax_tts(text: str) -> bytes | None:
    """MiniMax 正式语音合成"""
    url = "https://api.minimax.cn/v1/t2a_v2"
    headers = {
        "Authorization": f"Bearer {MINIMAX_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": TTS_MODEL,
        "text": text,
        "voice_setting": {
            "voice_id": MINIMAX_VOICE_ID,
            "speed": get_tts_speed(),
        },
        "audio_setting": {
            "format": "wav",
            "sample_rate": get_tts_sample_rate(),
        },
    }
    client = get_http_client()
    resp = await client.post(url, json=payload, headers=headers, timeout=30.0)
    if resp.status_code != 200:
        logger.info(f"[tts] HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    data = resp.json()
    audio_hex = data.get("data", {}).get("audio")
    if not audio_hex:
        logger.info(f"[tts] 无音频返回: {data}")
        return None
    return bytes.fromhex(audio_hex)


def clear_cache():
    _tts_cache.clear()
    for f in TTS_CACHE_DIR.glob("*.wav"):
        try:
            f.unlink()
        except Exception:
            pass