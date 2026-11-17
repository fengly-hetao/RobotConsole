# -*- coding: utf-8 -*-
"""
网易云音乐客户端（从零实现，cookie 登录）

- 搜索歌曲
- 获取播放直链（SVIP 优先无损 → 320k → 192k → 128k）
- 下载并转成 320k mp3（无损源用 ffmpeg 转码）
"""
import asyncio
import hashlib
import re
import shutil
from pathlib import Path

import httpx

MAX_SONG_BYTES = 30 * 1024 * 1024  # 单曲最大 30MB，防内存炸弹
from nonebot.log import logger

from core.config import PROJECT_ROOT, NETEASE_COOKIE

MUSIC_CACHE_DIR = PROJECT_ROOT / "data" / "music_cache"
MUSIC_CACHE_DIR.mkdir(parents=True, exist_ok=True)

_netease_client: httpx.AsyncClient | None = None


def _get_netease_client() -> httpx.AsyncClient:
    """网易云专用客户端：HTTP/1.1（http2 对网易接口易握手卡死），带超时。"""
    global _netease_client
    if _netease_client is None:
        _netease_client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=5.0),
            http2=False,
            follow_redirects=True,
        )
    return _netease_client

# 新版接口（2025 实测可用）：
#   搜索：cloudsearch/pc（旧 search/get/web 已停止更新，大量歌搜不到）
#   直链：interface v1 → 旧 player/url → outer/url 直链（三级回退）
_SEARCH_URL = "https://music.163.com/api/cloudsearch/pc"
_SEARCH_URL_OLD = "https://music.163.com/api/search/get/web"
_PLAYER_URL_V1 = "https://interface.music.163.com/api/song/enhance/player/url/v1"
_PLAYER_URL = "https://music.163.com/api/song/enhance/player/url"
_OUTER_URL = "https://music.163.com/song/media/outer/url"

# 码率档位：999000 无损 / 320k / 192k / 128k
_BR_LOSSLESS = 999000
_BR_MP3_320 = 320000
_BR_MP3_192 = 192000
_BR_MP3_128 = 128000

COOKIE_FILE = PROJECT_ROOT / "data" / "netease_cookie.txt"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://music.163.com/",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

_ILLEGAL_CHARS = re.compile(r'[\\/:*?"<>|]')


def get_cookie() -> str:
    """优先读运行时保存的 cookie 文件，其次回退到 .env 里的 NETEASE_COOKIE。

    用 utf-8-sig 读取 + 去空白：防 BOM/换行污染请求头（BOM 会导致所有接口 400/编码崩溃）。
    """
    try:
        if COOKIE_FILE.exists():
            v = COOKIE_FILE.read_text(encoding="utf-8-sig").strip()
            if v:
                return v
    except Exception:
        pass
    return (NETEASE_COOKIE or "").lstrip("\ufeff").strip()


def set_cookie(value: str) -> bool:
    """把新 cookie 写入 data/netease_cookie.txt，运行时即时生效，无需重启。"""
    try:
        COOKIE_FILE.parent.mkdir(parents=True, exist_ok=True)
        COOKIE_FILE.write_text(value.strip(), encoding="utf-8")
        logger.info("[netease] cookie 已更新")
        return True
    except Exception as e:
        logger.error(f"[netease] 保存 cookie 失败: {e}")
        return False


def _make_headers() -> dict:
    h = dict(_HEADERS)
    ck = get_cookie()
    if ck:
        h["Cookie"] = ck
    return h


def _safe_name(name: str) -> str:
    return _ILLEGAL_CHARS.sub(" ", name).strip() or "unknown"


# ==================== 搜索 ====================

async def search_song(name: str, search_type: int = 1, limit: int = 5) -> list[dict]:
    """搜索歌曲（search_type=1 歌名，=1006 歌词），返回 [{id, name, artists, album}]。

    优先用新版 cloudsearch/pc（曲库全），失败回退旧接口。
    """
    client = _get_netease_client()
    data = None
    # 1) 新版接口
    try:
        resp = await client.get(
            _SEARCH_URL,
            params={"s": name, "type": search_type, "limit": limit, "offset": 0, "total": "true"},
            headers=_make_headers(),
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error(f"[netease] cloudsearch 搜索失败: {type(e).__name__}: {e}")
        data = None
    # 2) 旧接口回退
    if not data:
        try:
            resp = await client.get(
                _SEARCH_URL_OLD,
                params={"s": name, "type": search_type, "limit": limit, "offset": 0},
                headers=_make_headers(),
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"[netease] 旧搜索接口也失败: {type(e).__name__}: {e}")
            return []

    songs = (data.get("result") or {}).get("songs") or []
    out = []
    for s in songs:
        # cloudsearch 用 ar/al 字段，旧接口用 artists/album，两种都兼容
        _artists = s.get("ar") or s.get("artists") or []
        artists = "/".join(a.get("name", "") for a in _artists if a.get("name"))
        album_obj = s.get("al") or s.get("album") or {}
        out.append({
            "id": s.get("id"),
            "name": s.get("name") or "",
            "artists": artists or "未知歌手",
            "album": album_obj.get("name") or "",
        })
    return out


# ==================== 播放直链 ====================

async def get_song_url(song_id: int, br: int) -> tuple[str, str] | None:
    """取某个码率下的播放直链，返回 (url, 格式)，失败返回 None。

    三级回退（新版直链拿不到时不会丢歌）：
      1) interface.music.163.com v1 接口（新版，曲库最全）
      2) 旧 player/url 接口
      3) outer/url 直链（最稳，永远有免费歌）
    """
    client = _get_netease_client()
    headers = _make_headers()
    # 码率 → 新版 level 参数映射
    level_map = {999000: "lossless", 320000: "exhigh", 192000: "higher", 128000: "standard"}
    level = level_map.get(br, "standard")

    # 1) 新版 v1 接口
    try:
        resp = await client.get(
            _PLAYER_URL_V1,
            params={"ids": f"[{song_id}]", "level": level, "encodeType": "mp3"},
            headers=headers,
            timeout=15.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            item = (data.get("data") or [{}])[0] if data else {}
            url = item.get("url")
            if url:
                fmt = (item.get("type") or "mp3").lower()
                if fmt not in ("mp3", "flac", "ape", "wav", "m4a"):
                    fmt = "mp3"
                return url, fmt
    except Exception as e:
        logger.error(f"[netease] v1 直链失败: {type(e).__name__}: {e}")

    # 2) 旧 player/url
    try:
        resp = await client.get(
            _PLAYER_URL,
            params={"ids": f"[{song_id}]", "br": br},
            headers=headers,
            timeout=15.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            item = (data.get("data") or [{}])[0]
            url = item.get("url")
            if url:
                fmt = (item.get("type") or "mp3").lower()
                if fmt not in ("mp3", "flac", "ape", "wav", "m4a"):
                    fmt = "mp3"
                return url, fmt
    except Exception as e:
        logger.error(f"[netease] 旧直链失败: {type(e).__name__}: {e}")

    # 3) outer/url 保底直链（跟随重定向拿到真实 mp3 地址）
    try:
        resp = await client.get(
            f"{_OUTER_URL}?id={song_id}.mp3",
            headers=headers,
            timeout=15.0,
        )
        if resp.status_code == 200:
            final = str(resp.url)
            if ".mp3" in final or final.startswith("http://m8") or "126.net" in final:
                return final, "mp3"
    except Exception as e:
        logger.error(f"[netease] outer/url 失败: {type(e).__name__}: {e}")

    return None


# ==================== 歌词 ====================

_LYRIC_URL = "https://music.163.com/api/song/lyric"
_LRC_TIME_RE = re.compile(r"\[\d+:\d+(?:\.\d+)?\]")


async def get_lyrics(song_id: int) -> tuple[str, str] | None:
    """获取歌曲歌词，返回 (纯文本, 原始LRC带时间戳)；失败返回 None。"""
    client = _get_netease_client()
    try:
        resp = await client.get(
            _LYRIC_URL,
            params={"id": song_id, "lv": 1, "kv": 1, "tv": -1},
            headers=_make_headers(),
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        raw_lrc = (data.get("lrc") or {}).get("lyric") or ""
        if not raw_lrc:
            return None
        lines = []
        for line in raw_lrc.splitlines():
            line = _LRC_TIME_RE.sub("", line).strip()
            if not line:
                continue
            if lines and lines[-1] == line:
                continue  # 去重（副歌重复只留一次）
            lines.append(line)
        plain = "\n".join(lines) or None
        if not plain:
            return None
        return plain, raw_lrc
    except Exception as e:
        logger.error(f"[netease] 获取歌词失败: {type(e).__name__}: {e}")
        return None


# ==================== ffmpeg ====================

def _find_ffmpeg() -> str | None:
    p = shutil.which("ffmpeg")
    if p:
        return p
    candidates = [
        Path(r"C:\ffmpeg\bin\ffmpeg.exe"),
        Path(r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"),
        Path(r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe"),
        Path.home() / "scoop" / "shims" / "ffmpeg.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return None


async def _convert_to_mp3(src: Path, dst: Path) -> bool:
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return False
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg, "-y", "-i", str(src), "-vn", "-b:a", "320k",
            "-map_metadata", "0", str(dst),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=300)
        return dst.exists() and dst.stat().st_size > 0
    except Exception as e:
        logger.error(f"[netease] ffmpeg 转码失败: {type(e).__name__}: {e}")
        return False


# ==================== 下载 ====================

async def download_song(name: str, is_lyrics: bool = False, want_dj: bool = False) -> tuple[Path, str, str] | None:
    """搜索并下载歌曲，返回 (mp3_path, title, artist)；失败返回 None。

    is_lyrics=True 按歌词搜；want_dj=True 搜索 DJ 版（歌名后追加 DJ）。
    """
    if is_lyrics:
        query = name
        search_type = 1006
    else:
        query = f"{name} DJ" if want_dj else name
        search_type = 1

    songs = await search_song(query, search_type)
    if not songs and is_lyrics:
        # 歌词搜索无结果时，退回按歌名搜
        songs = await search_song(name, 1)
    if not songs:
        logger.info(f"[netease] 未搜到: {name}")
        return None

    song = songs[0]
    song_id = song["id"]
    has_ffmpeg = _find_ffmpeg() is not None

    # 有 ffmpeg 才优先取无损源，否则直接取 320k mp3
    if has_ffmpeg:
        br_order = [_BR_LOSSLESS, _BR_MP3_320, _BR_MP3_192, _BR_MP3_128]
    else:
        br_order = [_BR_MP3_320, _BR_MP3_192, _BR_MP3_128]

    url = fmt = None
    for br in br_order:
        got = await get_song_url(song_id, br)
        if got:
            url, fmt = got
            break

    if not url:
        logger.info(f"[netease] 无可用直链: {song['name']}")
        return None

    client = _get_netease_client()
    try:
        resp = await client.get(
            url,
            headers={"Referer": "https://music.163.com/", "User-Agent": _HEADERS["User-Agent"]},
            timeout=120.0,
        )
        resp.raise_for_status()
        raw = resp.content[: MAX_SONG_BYTES]
    except Exception as e:
        logger.error(f"[netease] 下载失败: {type(e).__name__}: {e}")
        return None

    if len(raw) < 1024:
        logger.info(f"[netease] 下载内容过小，可能受限: {song['name']}")
        return None

    title = _safe_name(song["name"])
    artist = _safe_name(song["artists"])
    cache_key = hashlib.md5(str(song_id).encode("utf-8")).hexdigest()

    if fmt == "mp3":
        mp3_path = MUSIC_CACHE_DIR / f"{cache_key}.mp3"
        mp3_path.write_bytes(raw)
    else:
        # 无损源：有 ffmpeg 转 320k mp3，否则退回 320k mp3 源
        if has_ffmpeg:
            raw_path = MUSIC_CACHE_DIR / f"{cache_key}.{fmt}"
            raw_path.write_bytes(raw)
            mp3_path = MUSIC_CACHE_DIR / f"{cache_key}.mp3"
            if not await _convert_to_mp3(raw_path, mp3_path):
                mp3_path = raw_path
        else:
            got = await get_song_url(song_id, _BR_MP3_320)
            if got:
                url, fmt = got
                try:
                    resp = await client.get(
                        url,
                        headers={"Referer": "https://music.163.com/"},
                        timeout=120.0,
                    )
                    resp.raise_for_status()
                    mp3_path = MUSIC_CACHE_DIR / f"{cache_key}.mp3"
                    mp3_path.write_bytes(resp.content)
                except Exception:
                    return None
            else:
                return None

    if not mp3_path.exists() or mp3_path.stat().st_size < 1024:
        return None

    logger.info(f"[netease] 下载完成: {title} - {artist} ({mp3_path.stat().st_size} bytes)")
    return mp3_path, title, artist


# ==================== 语音裁剪 ====================

async def cut_for_voice(src: Path, max_seconds: int = 60) -> Path:
    """把音频裁成 QQ 语音可发的长度（上限 60 秒，转 24kHz 单声道），返回可发路径。"""
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return src
    dst = src.with_name(f"{src.stem}_voice{src.suffix}")
    if dst.exists() and dst.stat().st_size > 0:
        return dst
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg, "-y", "-i", str(src), "-t", str(max_seconds), "-vn",
            "-ar", "24000", "-ac", "1", "-b:a", "64k", str(dst),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=180)
        if dst.exists() and dst.stat().st_size > 0:
            return dst
    except Exception as e:
        logger.error(f"[netease] 语音裁剪失败: {type(e).__name__}: {e}")
    return src
