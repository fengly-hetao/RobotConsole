# -*- coding: utf-8 -*-
import re
import random
from core.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from core.http_client import get_http_client
from core.logger import logger

IDIOM_LIBRARY = {
    "一": ["一心一意", "一马当先", "一鸣惊人", "一帆风顺", "一见如故", "一诺千金", "一视同仁"],
    "二": ["二话不说", "二龙戏珠"],
    "三": ["三心二意", "三言两语", "三生有幸", "三顾茅庐"],
    "四": ["四面八方", "四通八达", "四海为家", "四平八稳"],
    "五": ["五光十色", "五湖四海", "五颜六色", "五脏六腑"],
    "六": ["六神无主", "六亲不认"],
    "七": ["七上八下", "七嘴八舌", "七手八脚"],
    "八": ["八仙过海", "八面玲珑", "八面威风"],
    "九": ["九牛一毛", "九死一生"],
    "十": ["十全十美", "十万火急", "十拿九稳"],
    "百": ["百发百中", "百战百胜", "百花齐放", "百感交集"],
    "千": ["千军万马", "千变万化", "千言万语", "千辛万苦"],
    "万": ["万无一失", "万事如意", "万紫千红"],
    "心": ["心想事成", "心旷神怡", "心花怒放", "心满意足"],
    "人": ["人山人海", "人声鼎沸", "人杰地灵"],
    "马": ["马到成功", "马不停蹄"],
    "龙": ["龙飞凤舞", "龙马精神"],
    "风": ["风调雨顺", "风平浪静"],
    "花": ["花好月圆", "花枝招展"],
}

_RE_CHAIN = re.compile(r"接龙\s*(\S+)")
_RE_IDIOM = re.compile(r"([\u4e00-\u9fff]{4})")


async def idiom_chain(user_msg: str) -> str:
    match = _RE_CHAIN.search(user_msg)
    if not match:
        return "（歪头）格式：接龙 成语"

    last_word = match.group(1).strip()
    if len(last_word) < 2:
        return "（歪头）至少输入两个字！"

    last_char = last_word[-1]
    candidates = IDIOM_LIBRARY.get(last_char, [])
    candidates = [c for c in candidates if c != last_word]

    if candidates:
        return f"（眼睛一亮）{random.choice(candidates)}！"

    # 本地没有，AI 兜底（限时 8s）
    try:
        client = get_http_client()
        resp = await client.post(
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": DEEPSEEK_MODEL,
                "messages": [
                    {"role": "system", "content": "只回复四字成语，不要解释。"},
                    {"role": "user", "content": f"以「{last_char}」开头的四字成语，除了「{last_word}」"},
                ],
                "max_tokens": 30,
                "temperature": 0.7,
            },
            timeout=8.0,
        )
        if resp.status_code == 200:
            reply = resp.json()["choices"][0]["message"]["content"].strip()
            m = _RE_IDIOM.search(reply)
            if m:
                return f"（眼睛一亮）{m.group(1)}！"
    except Exception as e:
        logger.error(f"成语接龙AI失败: {e}")

    return "（挠头）接不上来啦，换个试试？"