# -*- coding: utf-8 -*-
"""
歌词识别模块（热门歌词库版）
==========================

问题：之前用网易云「歌词搜索」在线查，曲库里什么歌都有，
      连「今天天气真不错」都能在冷门歌里找到，误触发率太高。

现在：只认热门歌。
  1. 启动时加载 hot_lyrics.json（各大榜单前 100 的热门歌 + 每首的热门句）
  2. 用户发的话只在热门库里比对
  3. 命中后去查那首歌的完整歌词，取「热门句的下一句」

这样：
  · 冷门歌不会触发
  · 日常用语基本不会触发（除非恰好是热门歌的高潮句）
  · 反应更快（本地比对为主）
"""

from __future__ import annotations

import os
import re
import json
import difflib

from nonebot.log import logger

from .netease import get_lyrics


# ==================== 路径 ====================

_HERE = os.path.dirname(os.path.abspath(__file__))
_HOT_FILE = os.path.join(_HERE, "hot_lyrics.json")


# ==================== 归一化 ====================

_TIMETAG = re.compile(r"\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]")
_META = re.compile(r"\[[a-zA-Z]+:[^\]]*\]")
_PUNCT = re.compile(r"[\s,，.。!！?？、；;：:\"'“”‘’()（）\[\]【】…~～\-—_/\\*#@&^%$]+")
_SKIP = re.compile(
    r"^(作词|作曲|编曲|制作人|监制|混音|母带|和声|录音|吉他|贝斯|鼓|"
    r"出品|发行|策划|统筹|录音室|混音室|OP|SP|词|曲)\s*[:：]",
    re.IGNORECASE,
)


def _norm(s: str) -> str:
    return _PUNCT.sub("", s or "").lower()


def _sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _parse_lines(lrc: str) -> list[str]:
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
        out.append(text)
    return out


# ==================== 日常用语黑名单 ====================

_CHAT_PATTERNS = [
    # 只拦「整句就是寒暄」的短消息，长句交给热门库判断，
    # 否则「我想要笑容永远挂在你的脸」这种歌词会被误拦。
    r"^(你|您|我)好(呀|啊|哇)?[!！。~～]*$",
    r"^(在吗|在不在|你在干嘛|你在干什么|你吃了吗|你吃了没|你干啥呢)[?？。~～]*$",
    r"^(早安|午安|晚安|拜拜|再见|早上好|晚上好)[!！。~～]*$",
    r"^(谢谢|多谢|感谢|不客气|对不起|抱歉|没事|没关系)[!！。~～]*$",
    r"^(怎么办|为什么|是不是|对不对|好不好|行不行|咋办|咋整)(啊|呢|呀|哦)?[?？。~～]*$",
    r"^(帮|请|麻烦|能不能|可以)(我|你)?(.{0,8})$",   # 请求类短句
    r"^(哈哈|嘿嘿|嘻嘻|呵呵|emmm|啊啊|哇哇|呜呜)[!！。~～哈嘻嘿呵啊哇呜]*$",
    r"^[\d\W_]+$",
]
_CHAT_RE = [re.compile(p) for p in _CHAT_PATTERNS]


# 群聊里学到的惯用语（由 tools/build_chat_phrases.py 生成）
# 这些是群友平时真的在说的话，永远不该被当成歌词。
_PHRASES_FILE = os.path.join(_HERE, "chat_phrases.json")
_group_phrases: set[str] = set()
_group_phrases_loaded = False


def _load_group_phrases() -> None:
    """加载群聊惯用语（启动时一次）。"""
    global _group_phrases, _group_phrases_loaded
    if _group_phrases_loaded:
        return
    _group_phrases_loaded = True
    try:
        with open(_PHRASES_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        logger.debug("[lyric] 群聊词库不存在，跳过")
        return
    except Exception as e:
        logger.warning(f"[lyric] 群聊词库读取失败: {type(e).__name__}: {e}")
        return

    # 只收「出现 2 次以上」或者「8 个字以上」的短语
    # —— 出现一次的多半是偶发内容，不一定是惯用语
    for item in data.get("phrases") or []:
        t = (item.get("t") or "").strip()
        c = item.get("c") or 0
        if not t:
            continue
        # 太短的不收（"666" "..." 这种没有区分度）
        if len(_norm(t)) < 3:
            continue
        if c >= 2 or len(_norm(t)) >= 8:
            _group_phrases.add(_norm(t))

    logger.info(f"[lyric] 群聊词库已加载：{len(_group_phrases)} 条惯用语")


def _is_group_phrase(text: str) -> bool:
    """这条消息是不是群友的惯用说法（不该当歌词）。"""
    _load_group_phrases()
    if not _group_phrases:
        return False
    n = _norm(text)
    if not n:
        return False
    # 完全相等 → 肯定是惯用语
    if n in _group_phrases:
        return True
    # 包含惯用语主体（用户发的内容里有惯用语，说明是日常聊天）
    for p in _group_phrases:
        if len(p) >= 6 and p in n:
            return True
    return False


def _looks_like_chat(text: str) -> bool:
    t = (text or "").strip()
    if any(r.search(t) for r in _CHAT_RE):
        return True
    if _is_group_phrase(t):
        return True
    return False


# ==================== 热门歌词库 ====================

class HotLibrary:
    """热门歌词库（启动时加载一次）。"""

    def __init__(self):
        self.loaded = False
        self.songs: list[dict] = []     # [{name, artists, boards, hot}]
        self._index: list[tuple[str, int, int]] = []   # (归一化热门句, 歌曲索引, 句索引)
        self.updated = ""

    def load(self) -> bool:
        if self.loaded:
            return True
        try:
            with open(_HOT_FILE, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            logger.warning(f"[lyric] 热门歌词库不存在: {_HOT_FILE}")
            return False
        except Exception as e:
            logger.error(f"[lyric] 热门歌词库读取失败: {type(e).__name__}: {e}")
            return False

        self.songs = data.get("songs") or []
        self.updated = data.get("updated") or ""

        # 建索引
        for si, s in enumerate(self.songs):
            for hi, line in enumerate(s.get("hot") or []):
                n = _norm(line)
                if len(n) >= 4:      # 太短的热门句不索引（误触发风险高）
                    self._index.append((n, si, hi))

        self.loaded = True
        logger.info(
            f"[lyric] 热门歌词库已加载：{len(self.songs)} 首歌，"
            f"{len(self._index)} 句热门歌词（更新于 {self.updated}）"
        )
        return True

    def match(self, query: str, threshold: float = 0.78) -> list[tuple[float, int, int]]:
        """
        在热门歌词库里找 query。
        返回 [(相似度, 歌曲索引, 热门句索引), ...]，按相似度降序。
        """
        qn = _norm(query)
        if not qn:
            return []
        out = []
        for n, si, hi in self._index:
            # 先做快速长度过滤：长度差太多的直接跳过
            if abs(len(n) - len(qn)) > max(len(qn), len(n)) * 0.6:
                continue
            sc = _sim(qn, n)
            if qn in n:
                sc = max(sc, 0.5 + len(qn) / len(n) * 0.45)
            elif n in qn:
                sc = max(sc, 0.5 + len(n) / len(qn) * 0.45)
            if sc >= threshold:
                out.append((sc, si, hi))
        out.sort(key=lambda x: x[0], reverse=True)
        return out


_lib = HotLibrary()


# ==================== 结果 ====================

class LyricHit:
    __slots__ = ("song_name", "artists", "matched_line", "next_line", "index", "score", "boards")

    def __init__(self, song_name, artists, matched_line, next_line, index, score, boards=None):
        self.song_name = song_name
        self.artists = artists
        self.matched_line = matched_line
        self.next_line = next_line
        self.index = index
        self.score = score
        self.boards = boards or []

    def __repr__(self):
        return f"<LyricHit 《{self.song_name}》 {self.score:.2f} → {self.next_line[:20]}>"


# ==================== 参数 ====================

MIN_QUERY_CHARS = 5          # 至少 5 个有效字（热门句都很短，5 字起步）
MATCH_THRESHOLD = 0.78       # 匹配门槛（热门库比对，可以比在线搜索低一些）
MAX_SEARCH_SONGS = 3         # 命中多个歌时，最多查几首完整歌词


# ==================== 主入口 ====================

async def detect_lyric(text: str) -> LyricHit | None:
    q = (text or "").strip()
    qn = _norm(q)

    if len(qn) < MIN_QUERY_CHARS:
        return None

    if _looks_like_chat(q):
        logger.debug(f"[lyric] 日常用语，跳过: {q[:20]}")
        return None

    if not _lib.load():
        return None

    # ① 先在热门库里找
    matches = _lib.match(q, MATCH_THRESHOLD)
    if not matches:
        return None

    # ② 去重：同一首歌只查一次
    seen_songs = set()
    tried = 0

    for sc, si, hi in matches:
        if si in seen_songs:
            continue
        seen_songs.add(si)
        tried += 1
        if tried > MAX_SEARCH_SONGS:
            break

        song = _lib.songs[si]
        hit_line = song["hot"][hi]

        # ③ 拉这首歌的完整歌词，找这句的下一句
        full_lines = []
        try:
            from .netease import search_song
            found = await search_song(song["name"], search_type=1, limit=3)
            target_id = None
            for f in found:
                if _norm(f["name"]) == _norm(song["name"]):
                    target_id = f["id"]
                    break
            if target_id is None and found:
                target_id = found[0]["id"]
            if target_id:
                pair = await get_lyrics(int(target_id))
                if pair:
                    full_lines = _parse_lines(pair[0])
        except Exception as e:
            logger.warning(f"[lyric] 拉完整歌词失败: {type(e).__name__}: {e}")

        next_line = ""
        if full_lines:
            # 在完整歌词里定位这句热门句
            hn = _norm(hit_line)
            pos = -1
            for i, ln in enumerate(full_lines):
                if _norm(ln) == hn:
                    pos = i
                    break
            if pos < 0:
                # 模糊找
                best_i, best_s = -1, 0.0
                for i, ln in enumerate(full_lines):
                    s2 = _sim(hn, _norm(ln))
                    if s2 > best_s:
                        best_s, best_i = s2, i
                if best_s >= 0.8:
                    pos = best_i
            if pos >= 0 and pos + 1 < len(full_lines):
                nxt = full_lines[pos + 1]
                if len(_norm(nxt)) >= 3:
                    next_line = nxt

        # 如果拿不到完整歌词，就用热门句列表里的下一句
        if not next_line and hi + 1 < len(song["hot"]):
            next_line = song["hot"][hi + 1]

        if not next_line:
            continue

        logger.info(
            f"[lyric] 命中《{song['name']}》- {song['artists']} "
            f"（{','.join(song.get('boards') or [])}）sim={sc:.2f} → {next_line[:30]}"
        )
        return LyricHit(
            song_name=song["name"],
            artists=song["artists"],
            matched_line=hit_line,
            next_line=next_line,
            index=hi,
            score=sc,
            boards=song.get("boards") or [],
        )

    return None


def format_reply(hit: LyricHit, *, with_title: bool = True) -> str:
    if with_title:
        return f"♪《{hit.song_name}》\n{hit.next_line}"
    return hit.next_line


def library_info() -> dict:
    """给设置页/诊断用。"""
    _lib.load()
    return {
        "loaded": _lib.loaded,
        "songs": len(_lib.songs),
        "lines": len(_lib._index),
        "updated": _lib.updated,
    }
