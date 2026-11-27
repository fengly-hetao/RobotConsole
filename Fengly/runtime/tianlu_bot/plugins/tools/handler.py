# -*- coding: utf-8 -*-
"""
实用工具插件
=============
和运气游戏无关的「真有用」命令：
  · 今日运势 —— 每天固定，不是随机刷
  · 天气 <城市> —— 实时天气（wttr.in 免费，无需 Key）
  · 历史上的今天 —— 每日一条
  · 今日一句 —— 每日鸡汤/诗词
  · 群友印象 —— 给群友随机打分（好玩，有互动感）
  · 一言 —— 随机句子
  · 掷骰子N —— 免费纯娱乐，不涉及金币
"""
import hashlib
import random
import time
from datetime import datetime

import httpx
from nonebot import on_message
from nonebot.adapters.onebot.v11 import Bot, GroupMessageEvent, MessageSegment
from nonebot.exception import FinishedException, RejectedException
from nonebot.log import logger

from core.config import BOT_QQ, IGNORE_QQ, is_enabled, get_group_ids
from core.utils import strip_mention, is_at_bot

tools = on_message(priority=6, block=False)

# 每日固定内容：用日期做种子，保证同一天所有人看到一样
def _daily_seed(extra=""):
    d = datetime.now().strftime("%Y%m%d")
    return int(hashlib.md5((d + extra).encode()).hexdigest()[:8], 16)

# ---------- 今日运势（每天固定） ----------
FORTUNE_LEVELS = [
    ("🌟 大吉", "今天诸事顺遂，想做的事大胆去做！"),
    ("✨ 中吉", "运势不错，适合推进手头的事。"),
    ("🌤 小吉", "平稳的一天，慢慢来就好。"),
    ("🌥 末吉", "有点小波折，但不影响大局。"),
    ("☁️ 平", "普普通通，适合休息。"),
    ("🌧 小凶", "今天少惹事，低调为上。"),
]

FORTUNE_ASPECTS = ["学业", "工作", "财运", "人缘", "心情", "健康"]

# ---------- 今日一句（内置语料，不依赖网络） ----------
DAILY_QUOTES = [
    "每一次努力，都是幸运的伏笔。",
    "你所热爱的，就是你的生活。",
    "星光不问赶路人，时光不负有心人。",
    "与其仰望别人，不如点亮自己。",
    "山再高，往上攀，总能登顶。",
    "路虽远，行则将至；事虽难，做则必成。",
    "愿你走出半生，归来仍是少年。",
    "生活不是等待风暴过去，而是学会在雨中跳舞。",
    "凡是过往，皆为序章。",
    "心之所向，素履以往。",
    "不必生来无畏，但求始终热爱。",
    "值得拥有的东西，永远都来之不易。",
    "所有的遗憾，都是另一种成全。",
    "慢慢来，比较快。",
    "把每一个平凡的日子，过成限量版。",
    "热爱可抵岁月漫长。",
    "你只管努力，剩下的交给时间。",
    "前方有路，未来可期。",
    "日出之美，在于它脱胎于最深的黑暗。",
    "念念不忘，必有回响。",
]

# ---------- 群友印象（有互动感的随机评价） ----------
IMPRESSIONS = [
    ("很靠谱", "交代的事基本都能办成"),
    ("话痨属性", "群里的活跃担当"),
    ("潜水大师", "平时不见人，一冒泡就是大消息"),
    ("气氛组", "有你在群里不会冷场"),
    ("技术流", "遇到问题第一个找你"),
    ("摸鱼选手", "上班时间永远在线"),
    ("人间清醒", "看问题很有自己的角度"),
    ("段子手", "随口一句就能让人笑"),
    ("温柔型", "说话让人很舒服"),
    ("夜猫子", "凌晨三点还能看到冒泡"),
]

# ---------- 天气（wttr.in 免费接口） ----------
async def _fetch_weather(city: str) -> str:
    url = f"https://wttr.in/{city}?format=j1&lang=zh"
    try:
        async with httpx.AsyncClient(timeout=12) as cli:
            r = await cli.get(url, headers={"User-Agent": "curl/8.0"})
            if r.status_code != 200:
                return ""
            j = r.json()
            cur = (j.get("current_condition") or [{}])[0]
            area = ((j.get("nearest_area") or [{}])[0].get("areaName") or [{}])[0].get("value", city)
            desc = ((cur.get("lang_zh") or [{}])[0].get("value")
                    or (cur.get("weatherDesc") or [{}])[0].get("value", ""))
            temp = cur.get("temp_C", "?")
            feels = cur.get("FeelsLikeC", "?")
            hum = cur.get("humidity", "?")
            wind = cur.get("windspeedKmph", "?")
            return (f"🌤 {area} 天气\n"
                    f"温度：{temp}°C（体感 {feels}°C）\n"
                    f"天气：{desc}\n"
                    f"湿度：{hum}%   风速：{wind} km/h")
    except Exception as e:
        logger.debug(f"[tools] 天气获取失败: {e}")
        return ""


@tools.handle()
async def handle_tools(bot: Bot, event: GroupMessageEvent):
    user_id = str(event.user_id)
    if user_id in IGNORE_QQ:
        return
    if get_group_ids() and str(event.group_id) not in get_group_ids():
        return

    raw_msg = event.raw_message if hasattr(event, "raw_message") else str(event.message)
    # 与 games 一致：必须 @机器人
    if not is_at_bot(raw_msg, BOT_QQ):
        return

    plain = event.get_plaintext() if hasattr(event, "get_plaintext") else raw_msg
    cmd = strip_mention(plain)
    if not cmd:
        return

    try:
        # ---------- 今日运势 ----------
        if cmd in ("今日运势", "运势", "今天运势"):
            if not is_enabled("daily_fortune"):
                return
            seed = _daily_seed("fortune:" + user_id)
            lvl, tip = FORTUNE_LEVELS[seed % len(FORTUNE_LEVELS)]
            # 各维度分数（同一天固定）
            lines = [f"🔮 {lvl}", tip, ""]
            for i, name in enumerate(FORTUNE_ASPECTS):
                s = (seed >> (i * 3)) % 100
                bar = "█" * (s // 10) + "░" * (10 - s // 10)
                lines.append(f"{name}：{bar} {s}")
            await tools.finish(MessageSegment.at(user_id) + "\n".join(lines))
            return

        # ---------- 今日一句 ----------
        if cmd in ("今日一句", "每日一句", "一句话"):
            if not is_enabled("daily_quote"):
                return
            q = DAILY_QUOTES[_daily_seed("quote") % len(DAILY_QUOTES)]
            await tools.finish(MessageSegment.at(user_id) + f"「{q}」")
            return

        # ---------- 一言 ----------
        if cmd == "一言":
            if not is_enabled("daily_quote"):
                return
            q = random.choice(DAILY_QUOTES)
            await tools.finish(MessageSegment.at(user_id) + f"「{q}」")
            return

        # ---------- 群友印象 ----------
        if cmd in ("群友印象", "印象", "评价一下"):
            if not is_enabled("impression"):
                return
            # 可以对别人用：群友印象 @某人
            target = user_id
            for seg in (event.message or []):
                if seg.type == "at" and str(seg.data.get("qq")) not in ("all", BOT_QQ):
                    target = str(seg.data.get("qq"))
                    break
            seed = _daily_seed("imp:" + target)
            name, why = IMPRESSIONS[seed % len(IMPRESSIONS)]
            score = 60 + (seed % 41)  # 60~100
            await tools.finish(
                MessageSegment.at(target)
                + f"我对你的印象是：{name}\n{why}\n综合评分：{score}/100"
            )
            return

        # ---------- 天气 ----------
        if cmd.startswith("天气"):
            if not is_enabled("weather"):
                return
            city = cmd[2:].strip() or ""
            if not city:
                await tools.finish(MessageSegment.at(user_id) + "（歪头）要查哪个城市？发「天气 北京」这样")
                return
            await tools.finish(MessageSegment.at(user_id) + "（翻找天气图）稍等…")
            w = await _fetch_weather(city)
            if w:
                await tools.finish(MessageSegment.at(user_id) + w)
            else:
                await tools.finish(MessageSegment.at(user_id) + f"（挠头）查不到「{city}」的天气，换个说法试试？")
            return

        # ---------- 掷骰子N（免费娱乐，不涉及金币） ----------
        if cmd.startswith("骰"):
            if not is_enabled("tools"):
                return
            import re as _re
            m = _re.search(r"(\d+)", cmd)
            n = max(1, min(10, int(m.group(1)))) if m else 1
            rolls = [random.randint(1, 6) for _ in range(n)]
            total = sum(rolls)
            await tools.finish(
                MessageSegment.at(user_id)
                + f"🎲 {' '.join(str(x) for x in rolls)}\n合计：{total}（{n} 个骰子）"
            )
            return

        # ---------- 随机数 ----------
        if cmd.startswith("随机数"):
            if not is_enabled("tools"):
                return
            import re as _re
            m = _re.findall(r"\d+", cmd)
            if len(m) >= 2:
                a, b = int(m[0]), int(m[1])
                if a > b:
                    a, b = b, a
            else:
                a, b = 1, 100
            await tools.finish(MessageSegment.at(user_id) + f"🎯 {a}~{b} 之间随机：{random.randint(a, b)}")
            return

    except (FinishedException, RejectedException):
        raise
    except Exception as e:
        logger.debug(f"[tools] 未处理异常: {type(e).__name__}: {e}")


logger.info("🧰 实用工具插件已加载（运势/天气/印象/今日一句）")
