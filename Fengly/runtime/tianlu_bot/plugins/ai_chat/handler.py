# -*- coding: utf-8 -*-
import re
import json
import asyncio
import random
import httpx
import tempfile
from pathlib import Path
from nonebot import on_message
from nonebot.rule import Rule
from nonebot.adapters.onebot.v11 import (
    Bot, GroupMessageEvent, PrivateMessageEvent, MessageSegment,
)
from nonebot.exception import FinishedException, RejectedException
from nonebot.log import logger
from core.config import BOT_QQ, DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, IGNORE_QQ, GROUP_IDS, is_enabled, get_game_commands, get_group_ids
from core.http_client import get_http_client
from core.utils import strip_mention, is_at_bot
from .prompt import build_prompt
from .history import get_history, update_history
from .cooldown import check_cooldown
from .favor import get_favor, add_favor
from .fortune import get_fortune
from .idiom import idiom_chain
from .character import query_character
from .vision import extract_images, describe_image
from .tts import synthesize
from .netease import download_song, set_cookie, cut_for_voice, get_lyrics, search_song
from core.config import (get_private_whitelist, get_daily_ai_limit, get_daily_tts_limit, get_daily_song_limit,
                          get_max_reply_length, get_max_tokens, get_temperature, ai_get_float, ai_get_int,
                          get_split_chars, get_min_send_len, get_voice_prob, ai_get, GROUP_IDS)
from core.limits import use as limit_use, check as limit_check

# ==================== 预编译正则 ====================
_RE_REPLY_ID = re.compile(r"\[CQ:reply,id=(\d+)")
_ACTION_RE = re.compile(r"[（(][^）)]*[）)]")

# ==================== 私聊白名单 ====================

# ==================== 游戏命令黑名单 ====================


def is_game_command(msg: str) -> bool:
    """判断是否游戏/系统命令。

    只有两种情况算：
      1. 整句完全等于命令（如「签到」「我的信息」）
      2. 第一个词完全等于命令，且后面是**参数**（如「猜大小 大」「买 苹果」）

    历史 BUG：之前无条件取第一个词比对，聊天里碰巧以命令开头就会误判。
    现在要求「第一个词之后的内容不能还是普通句子」——用长度和字集做约束。
    """
    cmds = get_game_commands()
    m = (msg or "").strip().rstrip("。！？!?~～")
    if not m:
        return False

    # 整句匹配
    if m in cmds:
        return True

    # 第一个词匹配
    parts = m.split(maxsplit=1)
    head = parts[0]
    if head not in cmds:
        return False

    # 没有参数：已经是整句匹配过了，走到这说明不匹配
    if len(parts) < 2:
        return False

    args = parts[1].strip()
    if not args:
        return True

    # 有参数时，参数必须「短且不像一句话」：
    # 比如「猜大小 大」「掷硬币 正」「买 苹果」→ 算
    # 但「猜大小 我觉得今天天气不错」→ 不算，交给 AI 聊天
    if len(args) > 8:
        return False
    if any(ch in args for ch in "，。！？；,;!?"):
        return False
    return True


# ==================== 限制配置 ====================
MAX_REPLY_LENGTH = get_max_reply_length()
MAX_TOKENS = get_max_tokens()
TEMPERATURE = get_temperature()
FREQUENCY_PENALTY = ai_get_float("FREQUENCY_PENALTY", 0.3)
PRESENCE_PENALTY = ai_get_float("PRESENCE_PENALTY", 0.3)

_SPLIT_CHARS = get_split_chars()
_MIN_SEND_LEN = get_min_send_len()


# ==================== 事件类型规则 ====================
async def _is_group(event) -> bool:
    return isinstance(event, GroupMessageEvent)


async def _is_private(event) -> bool:
    return isinstance(event, PrivateMessageEvent)


# ==================== 去动作（语音用） ====================
def _strip_actions(text: str) -> str:
    cleaned = _ACTION_RE.sub("", text).strip()
    return cleaned or text


# ==================== 流式请求 ====================
async def _stream_request(user_id: str, user_msg: str):
    favor = get_favor(user_id)
    prompt = build_prompt(favor)
    history = get_history(user_id)

    messages = [{"role": "system", "content": prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_msg})

    # 多模型统一入口：根据 MODEL_PROVIDER 热读当前模型配置
    from core.config import get_model_config
    mc = get_model_config()
    api_key = mc["api_key"]
    base_url = mc["base_url"]
    model = mc["model"]
    if not api_key:
        logger.error("[ai_chat] 当前模型未配置 API 密钥")
        return

    logger.info(f"[ai_chat] 调用 API model={model} base={base_url}")

    client = get_http_client()
    async with client.stream(
        "POST",
        f"{base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "messages": messages,
            "max_tokens": MAX_TOKENS,
            "temperature": TEMPERATURE,
            "frequency_penalty": FREQUENCY_PENALTY,
            "presence_penalty": PRESENCE_PENALTY,
            "stream": True,
        },
        timeout=httpx.Timeout(60.0, connect=3.0),
    ) as resp:
        logger.info(f"[ai_chat] API 状态码: {resp.status_code}")
        if resp.status_code != 200:
            body = await resp.aread()
            logger.error(f"[ai_chat] API 错误体: {body[:500]!r}")
            return
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                break
            try:
                delta = json.loads(data)["choices"][0]["delta"]
                piece = delta.get("content")
            except (json.JSONDecodeError, KeyError, IndexError):
                continue
            if piece:
                yield piece


# ==================== 流式发送 ====================
async def _stream_reply(bot: Bot, event, user_id: str, user_msg: str, group: bool, no_at: bool = False):
    # 每日 AI 对话限额
    _ai_lim = get_daily_ai_limit()
    if not limit_check(user_id, "ai", _ai_lim):
        msg = "（摊爪）今天的AI聊天次数用完啦，明天再来找我玩吧！"
        if group and not no_at:
            await bot.send(event, MessageSegment.at(user_id) + msg)
        else:
            await bot.send(event, msg)
        return
    limit_use(user_id, "ai")
    at_prefix = "" if no_at else (MessageSegment.at(user_id) if group else "")
    buffer: list[str] = []
    full_chunks: list[str] = []
    sent_any = False

    # 保活：随机延迟 0.5~2s，模拟真人回复节奏，降低被风控概率
    try:
        await asyncio.sleep(random.uniform(0.5, 2.0))
    except Exception:
        pass

    try:
        async for piece in _stream_request(user_id, user_msg):
            buffer.append(piece)
            full_chunks.append(piece)
            joined = "".join(buffer)

            if any(c in joined for c in _SPLIT_CHARS) and len(joined) >= _MIN_SEND_LEN:
                text = joined
                if not sent_any:
                    await bot.send(event, at_prefix + text)
                    sent_any = True
                else:
                    await bot.send(event, text)
                buffer.clear()

        if buffer:
            text = "".join(buffer)
            if not sent_any:
                await bot.send(event, at_prefix + text)
            else:
                await bot.send(event, text)
            sent_any = True

        full_reply = "".join(full_chunks).strip()

        if not sent_any:
            fallback = "（歪头）嗯？你说啥？本座没听清～"
            await bot.send(event, at_prefix + fallback)
            full_reply = fallback

        if len(full_reply) > MAX_REPLY_LENGTH:
            full_reply = full_reply[:MAX_REPLY_LENGTH]

        update_history(user_id, user_msg, full_reply)
        add_favor(user_id, 1)

    except (FinishedException, RejectedException):
        raise
    except httpx.TimeoutException:
        logger.error("[ai_chat] API 超时")
        if not sent_any:
            try:
                await bot.send(event, at_prefix + "（甩尾巴）本座卡住了，再试一次！")
            except Exception:
                pass
    except Exception as e:
        logger.error(f"[ai_chat] 流式异常: {type(e).__name__}: {e}", exc_info=True)
        if not sent_any:
            try:
                await bot.send(event, at_prefix + "（挠头）出错了…")
            except Exception:
                pass


# ==================== 语音直读（不走 AI） ====================
def _extract_voice_text(user_msg: str) -> str | None:
    """
    只有「说 」开头（说 + 空格）才触发语音直读。
    """
    if user_msg.startswith("说 "):
        return user_msg[2:].strip()
    return None


# ==================== 点歌 ====================
_SING_RE = re.compile(r"^(?:唱|点歌|播放|来一首)\s*(.+)$")


def _extract_song_name(user_msg: str) -> tuple[str, bool, bool, bool, bool] | None:
    """解析点歌指令，返回 (搜索词, 语音, DJ, 按歌词搜, 获取歌词)。"""
    m = _SING_RE.match(user_msg)
    if not m:
        return None
    rest = m.group(1).strip()

    # 语音后缀
    is_voice = False
    for suffix in ("发语音", "语音"):
        if rest.endswith(suffix):
            is_voice = True
            rest = rest[: -len(suffix)].rstrip()
            break

    # 歌词后缀（获取歌词）
    get_lyrics = False
    if rest.endswith("歌词"):
        get_lyrics = True
        rest = rest[:-2].rstrip()

    # DJ 后缀
    want_dj = False
    for suffix in ("DJ版", "dj版", "DJ", "dj"):
        if rest.endswith(suffix):
            want_dj = True
            rest = rest[: -len(suffix)].rstrip()
            break

    # 歌词前缀（按歌词搜歌，支持 歌词：、歌词:、歌词空格 三种写法）
    is_lyrics = False
    for prefix in ("歌词：", "歌词:", "歌词 "):
        if rest.startswith(prefix):
            is_lyrics = True
            rest = rest[len(prefix):].strip()
            break

    name = rest.strip("《》〈〉【】[]（）() 　")
    if len(name) < 2:
        return None
    return name, is_voice, want_dj, is_lyrics, get_lyrics


async def _handle_sing(bot: Bot, event, user_id: str, song_name: str, want_voice: bool, want_dj: bool, is_lyrics: bool, group: bool):
    # 每日点歌限额
    _song_lim = get_daily_song_limit()
    if not limit_check(user_id, "song", _song_lim):
        msg = "（摊爪）今天的点歌次数用完啦！"
        if group:
            await bot.send(event, MessageSegment.at(user_id) + msg)
        else:
            await bot.send(event, msg)
        return
    limit_use(user_id, "song")
    at_prefix = MessageSegment.at(user_id) if group else ""
    try:
        result = await asyncio.wait_for(
            download_song(song_name, is_lyrics=is_lyrics, want_dj=want_dj),
            timeout=120,
        )
    except asyncio.TimeoutError:
        logger.error(f"[song] 点歌超时: {song_name}")
        result = None
    except Exception as e:
        logger.error(f"[song] 点歌异常: {type(e).__name__}: {e}", exc_info=True)
        result = None

    if not result:
        await ai.finish(at_prefix + f"（叹气）本座没找到《{song_name}》，换个歌名试试？")
        return

    mp3_path, title, artist = result
    try:
        if want_voice:
            # 语音模式：切成 60 秒直接播放
            voice_path = await cut_for_voice(mp3_path)
            await bot.send(event, MessageSegment.record(file=f"file:///{voice_path.as_posix()}"))
            await ai.finish(at_prefix + f"🎵 《{title}》- {artist}")
        else:
            # 文件模式：发完整 mp3 文件
            file_name = f"{title} - {artist}.mp3"
            if group:
                await bot.call_api(
                    "upload_group_file",
                    group_id=event.group_id,
                    file=str(mp3_path),
                    name=file_name,
                )
            else:
                await bot.call_api(
                    "upload_private_file",
                    user_id=event.user_id,
                    file=str(mp3_path),
                    name=file_name,
                )
            await ai.finish(at_prefix + f"🎵 已发文件：《{title}》- {artist}")
    except (FinishedException, RejectedException):
        raise
    except Exception as e:
        logger.error(f"[song] 发送失败: {type(e).__name__}: {e}", exc_info=True)
        await ai.finish(at_prefix + "（炸毛）发不出去，本座再想想办法…")


# ==================== 获取歌词 ====================
MAX_LYRICS_LEN = 1500


async def _handle_lyrics(bot: Bot, event, user_id: str, song_name: str, group: bool):
    at_prefix = MessageSegment.at(user_id) if group else ""
    try:
        songs = await asyncio.wait_for(search_song(song_name), timeout=30)
    except Exception as e:
        logger.error(f"[song] 搜歌词异常: {type(e).__name__}: {e}", exc_info=True)
        songs = []

    if not songs:
        await ai.finish(at_prefix + f"（叹气）本座没找到《{song_name}》…")
        return

    song = songs[0]
    try:
        result = await asyncio.wait_for(get_lyrics(song["id"]), timeout=30)
    except Exception as e:
        logger.error(f"[song] 取歌词异常: {type(e).__name__}: {e}", exc_info=True)
        result = None

    if not result:
        await ai.finish(at_prefix + f"（挠头）《{song['name']}》没找到歌词…")
        return

    plain, raw_lrc = result

    # 保存 .lrc 文件（带时间戳，供音乐播放器/卡拉OK用）
    lrc_path = None
    try:
        safe_name = re.sub(r'[\\/:*?"<>|]', "_", song["name"])
        lrc_dir = Path(tempfile.gettempdir()) / "tianlu_lyrics"
        lrc_dir.mkdir(parents=True, exist_ok=True)
        lrc_path = lrc_dir / f"{safe_name}.lrc"
        lrc_path.write_text(raw_lrc, encoding="utf-8")
    except Exception as e:
        logger.error(f"[song] 写 lrc 失败: {type(e).__name__}: {e}")

    text = f"🎵 《{song['name']}》- {song['artists']}\n\n{plain}"
    if len(text) > MAX_LYRICS_LEN:
        text = text[:MAX_LYRICS_LEN] + "\n…（歌词太长已截断）"

    # 发 .lrc 文件
    sent_file = False
    if lrc_path and lrc_path.exists():
        try:
            if group:
                await bot.call_api(
                    "upload_group_file",
                    group_id=event.group_id,
                    file=str(lrc_path),
                    name=f"{song['name']}.lrc",
                )
            else:
                await bot.call_api(
                    "upload_private_file",
                    user_id=event.user_id,
                    file=str(lrc_path),
                    name=f"{song['name']}.lrc",
                )
            sent_file = True
        except Exception as e:
            logger.error(f"[song] 发 lrc 失败: {type(e).__name__}: {e}")

    await ai.finish(at_prefix + text + ("\n\n📄 已发 .lrc 歌词文件" if sent_file else ""))


# ==================== 功能菜单 ====================
_MENU_TEXT = """📋 天禄功能清单

💬 AI 聊天：@天禄 <随便说>
🎤 语音直读：@天禄 说 <内容>
🎵 点歌：@天禄 唱 《歌名》
🎵 点歌语音：@天禄 唱 《歌名》 语音
🎵 DJ 版：@天禄 唱 《歌名》 DJ
🔍 歌词搜歌：@天禄 唱 歌词 <一句歌词>
📜 歌词获取：@天禄 唱 《歌名》 歌词
🎮 游戏：商店 / 买 / 背包 / 签到 / 抽签 / 我的信息
✨ 快捷：摸头 / 运势 / 接龙 / 是谁
🔧 系统：#help / #sysinfo / #cpu / #内存
🔐 私聊：设置cookie <你的网易云cookie>
"""

_MENU_KEYWORDS = ("功能", "菜单", "帮助", "指令", "功能菜单")


# ==================== 私聊设置 cookie ====================
_COOKIE_RE = re.compile(
    r"^(?:设置\s*cookie|更新\s*cookie|#\s*cookie|#\s*设置\s*cookie|setcookie)\s*[:：]?\s*(.*)$",
    re.IGNORECASE,
)


def _extract_cookie_cmd(user_msg: str) -> str | None:
    m = _COOKIE_RE.match(user_msg.strip())
    if not m:
        return None
    return m.group(1).strip()


# ==================== 快捷指令 ====================
async def _handle_quick_cmd(user_id: str, user_msg: str) -> str | None:
    """快捷指令。

    历史 BUG：这里原来用 `"运势" in user_msg` 这种子串匹配，
    结果「今天运势怎么样」「你知道这是谁的吗」这种正常聊天也会被拦截，
    机器人突然答非所问。现改为「整句等于关键词」或「关键词在最前面」才触发。
    """
    m = user_msg.strip()

    def _hit(*kw: str) -> bool:
        # 整句就是关键词，或者以关键词开头（允许后面跟少量补充）
        return any(m == k or m.startswith(k) for k in kw)

    if _hit("摸头", "摸摸头"):
        favor = add_favor(user_id, 3)
        return f"（耳朵竖起）哼！好感度 +3（当前{favor}）"
    if _hit("运势", "今日运势"):
        return f"（掐指一算）{get_fortune(user_id)}" if is_enabled("fortune") else "（摊爪）运势功能已关闭"
    if _hit("接龙", "成语接龙"):
        return await idiom_chain(user_msg) if is_enabled("idiom") else "（摊爪）成语接龙已关闭"
    if _hit("是谁", "什么角色", "我是谁"):
        return await query_character(user_msg)
    return None


# ==================== 从消息段数组/字符串抽图 ====================
def _extract_images_from_segments(message) -> list[str]:
    urls = []
    if isinstance(message, list):
        for seg in message:
            if not isinstance(seg, dict):
                continue
            if seg.get("type") != "image":
                continue
            data = seg.get("data") or {}
            url = data.get("url")
            if url:
                urls.append(url)
        return urls
    if isinstance(message, str):
        return extract_images(message)
    return urls


# ==================== 引用消息图片抓取 ====================
async def _get_quoted_images(bot: Bot, raw_msg: str) -> list[str]:
    m = _RE_REPLY_ID.search(raw_msg)
    if not m:
        return []
    reply_id = m.group(1)
    try:
        info = await bot.get_msg(message_id=int(reply_id))
        message = info.get("message", "")
        return _extract_images_from_segments(message)
    except Exception as e:
        logger.error(f"[ai_chat] 拉取引用消息失败: {e}", exc_info=True)
        return []


# ==================== 图片识别辅助 ====================
async def _attach_image_context(bot: Bot, raw_msg: str, user_msg: str) -> str:
    urls = extract_images(raw_msg)
    quoted_urls = await _get_quoted_images(bot, raw_msg)

    all_urls = []
    seen = set()
    for u in urls + quoted_urls:
        if u not in seen:
            seen.add(u)
            all_urls.append(u)

    if not all_urls:
        return user_msg

    descs = []
    for u in all_urls[:2]:
        d = await describe_image(u) if is_enabled("vision") else None
        if d:
            descs.append(d)

    if descs:
        img_ctx = "；".join(descs)
        user_msg = f"[用户发了一张图，内容是：{img_ctx}] {user_msg}".strip()

    return user_msg


# ==================== 群聊 ====================
ai = on_message(priority=10, block=False, rule=Rule(_is_group))


@ai.handle()
async def handle_ai(bot: Bot, event: GroupMessageEvent):
    user_id = str(event.user_id)
    if user_id in IGNORE_QQ:
        return
    # 群过滤：只在自己配置的群里工作（GROUP_ID 为空则不限）
    if get_group_ids() and str(event.group_id) not in get_group_ids():
        return
    # 功能总开关
    if not is_enabled("ai_chat"):
        return

    raw_msg = event.raw_message if hasattr(event, "raw_message") else str(event.message)

    if not is_at_bot(raw_msg, BOT_QQ):
        return

    plain = event.get_plaintext() if hasattr(event, "get_plaintext") else raw_msg
    user_msg = strip_mention(plain)

    # ==================== 功能菜单 ====================
    if user_msg in _MENU_KEYWORDS:
        await ai.finish(MessageSegment.at(user_id) + _MENU_TEXT)
        return

    # ==================== 语音直读（说 + 空格，必定语音） ====================
    voice_text = _extract_voice_text(user_msg)
    if voice_text:
        if not is_enabled("tts"):
            await ai.finish(MessageSegment.at(user_id) + "（摊爪）语音功能已关闭，用文字吧！")
            return
        _tts_lim = get_daily_tts_limit()
        if not limit_check(user_id, "tts", _tts_lim):
            await ai.finish(MessageSegment.at(user_id) + "（摊爪）今天的语音次数用完啦！")
            return
        limit_use(user_id, "tts")
        audio_path = await synthesize(voice_text)
        if audio_path:
            await ai.finish(
                MessageSegment.record(file=f"file:///{audio_path.as_posix()}")
            )
        else:
            await ai.finish(MessageSegment.at(user_id) + "（撇嘴）本座嗓子哑了，说不出来…")
        return

    # ==================== 点歌（唱/点歌 + 歌名 → 下载发送） ====================
    parsed = _extract_song_name(user_msg) if is_enabled("song") else None
    if parsed:
        song_name, want_voice, want_dj, is_lyrics, get_lyrics = parsed
        if get_lyrics:
            await _handle_lyrics(bot, event, user_id, song_name, group=True)
        else:
            await _handle_sing(bot, event, user_id, song_name, want_voice, want_dj, is_lyrics, group=True)
        return

    # ==================== 自由聊天模式开关 ====================
    # 开（FEATURE_FREE_CHAT=1）：@ 机器人就能自由聊天
    # 关（默认）：群里不闲聊，只响应上面的功能命令（菜单/语音/点歌）
    # 想聊天请私聊（白名单内）
    if not is_enabled("free_chat"):
        return

    # ==================== 普通 AI 对话（只回文字） ====================
    user_msg = await _attach_image_context(bot, raw_msg, user_msg)

    if not user_msg:
        await ai.finish(MessageSegment.at(user_id) + "（歪头）你@我干嘛？")
        return

    if check_cooldown(user_id):
        await ai.finish(MessageSegment.at(user_id) + "（甩尾巴）急什么！让本座缓5秒！")
        return

    if is_game_command(user_msg):
        return

    quick = await _handle_quick_cmd(user_id, user_msg)
    if quick is not None:
        await ai.finish(MessageSegment.at(user_id) + quick)
        return

    await _stream_reply(bot, event, user_id, user_msg, group=True)


# ==================== 随机搭话模式 ====================
# 开关：FEATURE_RANDOM_TALK（依赖 FEATURE_FREE_CHAT 同时开启）
# 参数：ai_chat.env 里 RANDOM_TALK_PROB（概率 0~1）、RANDOM_TALK_COOLDOWN（群冷却秒）
# 行为：群友没 @ 机器人时，机器人以设定概率随机插话（不 @，模拟真人闲聊）
_random_talk = on_message(priority=11, block=False, rule=Rule(_is_group))
_random_talk_last: dict = {}  # group_id -> 上次搭话时间戳


@_random_talk.handle()
async def handle_random_talk(bot: Bot, event: GroupMessageEvent):
    if not is_enabled("random_talk"):
        return
    if not is_enabled("free_chat"):
        return
    user_id = str(event.user_id)
    if user_id == BOT_QQ or user_id in IGNORE_QQ:
        return
    if get_group_ids() and str(event.group_id) not in get_group_ids():
        return
    # 反馈群不搭话（保持信息纯净）
    try:
        from core.config import FEEDBACK_GROUP_ID
        if str(event.group_id) == str(FEEDBACK_GROUP_ID):
            return
    except Exception:
        pass
    raw_msg = event.raw_message if hasattr(event, "raw_message") else str(event.message)
    # @ 过的消息交给正常对话流程，不重复插话
    if is_at_bot(raw_msg, BOT_QQ):
        return
    plain = event.get_plaintext() if hasattr(event, "get_plaintext") else raw_msg
    user_msg = strip_mention(plain).strip()
    # 太短的、命令类的、CQ 代码的不搭话
    if len(user_msg) < 4:
        return
    if user_msg.startswith(("#", "/", "！", "!")):
        return
    if is_game_command(user_msg):
        return
    if "[CQ:" in raw_msg and not plain.strip():
        return
    # 概率判定
    prob = ai_get_float("RANDOM_TALK_PROB", 0.03)
    if random.random() >= prob:
        return
    # 群冷却：避免刷屏
    cooldown = ai_get_int("RANDOM_TALK_COOLDOWN", 120)
    now = asyncio.get_event_loop().time()
    gid = str(event.group_id)
    if gid in _random_talk_last and (now - _random_talk_last[gid]) < cooldown:
        return
    _random_talk_last[gid] = now
    logger.info(f"[ai_chat] 随机搭话触发 group={gid} msg={user_msg[:30]}")
    await _stream_reply(bot, event, user_id, user_msg, group=True, no_at=True)


# ==================== 私聊 ====================
private = on_message(priority=10, block=False, rule=Rule(_is_private))


@private.handle()
async def handle_private(bot: Bot, event: PrivateMessageEvent):
    user_id = str(event.user_id)
    if user_id in IGNORE_QQ:
        return

    if user_id not in get_private_whitelist():
        return

    raw_msg = event.raw_message if hasattr(event, "raw_message") else str(event.message)
    plain = event.get_plaintext() if hasattr(event, "get_plaintext") else raw_msg
    user_msg = strip_mention(plain)

    # ==================== 功能菜单 ====================
    if user_msg in _MENU_KEYWORDS:
        await private.finish(_MENU_TEXT)
        return

    # ==================== 设置网易云 cookie（仅私聊白名单） ====================
    cookie_val = _extract_cookie_cmd(user_msg)
    if cookie_val is not None:
        if cookie_val:
            ok = set_cookie(cookie_val)
            if ok:
                await private.finish("✅ 网易云 cookie 已保存并即时生效，可以点歌啦～")
            else:
                await private.finish("❌ 保存失败，请检查服务器文件权限。")
        else:
            await private.finish("用法：设置cookie <粘贴你的cookie>")
        return

    # ==================== 语音直读（说 + 空格，必定语音） ====================
    voice_text = _extract_voice_text(user_msg)
    if voice_text:
        if not is_enabled("tts"):
            await ai.finish(MessageSegment.at(user_id) + "（摊爪）语音功能已关闭，用文字吧！")
            return
        _tts_lim = get_daily_tts_limit()
        if not limit_check(user_id, "tts", _tts_lim):
            await ai.finish(MessageSegment.at(user_id) + "（摊爪）今天的语音次数用完啦！")
            return
        limit_use(user_id, "tts")
        audio_path = await synthesize(voice_text)
        if audio_path:
            await private.finish(
                MessageSegment.record(file=f"file:///{audio_path.as_posix()}")
            )
        else:
            await private.finish("（撇嘴）本座嗓子哑了，说不出来…")
        return

    # ==================== 点歌（唱/点歌 + 歌名 → 下载发送） ====================
    if is_enabled("song"):
        parsed = _extract_song_name(user_msg)
    else:
        parsed = None
    if parsed:
        song_name, want_voice, want_dj, is_lyrics, get_lyrics = parsed
        if get_lyrics:
            await _handle_lyrics(bot, event, user_id, song_name, group=False)
        else:
            await _handle_sing(bot, event, user_id, song_name, want_voice, want_dj, is_lyrics, group=False)
        return

    # ==================== 普通 AI 对话（只回文字） ====================
    user_msg = await _attach_image_context(bot, raw_msg, user_msg)

    if not user_msg:
        return

    if check_cooldown(user_id):
        await private.finish("（甩尾巴）急什么！让本座缓5秒！")
        return

    if is_game_command(user_msg):
        return

    quick = await _handle_quick_cmd(user_id, user_msg)
    if quick is not None:
        await private.finish(quick)
        return

    await _stream_reply(bot, event, user_id, user_msg, group=False)