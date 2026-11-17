# -*- coding: utf-8 -*-
import asyncio
import base64

MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 单图最大 8MB
import re
import io
from nonebot.log import logger
from core.config import ZHIPU_API_KEY
from core.http_client import get_http_client

ZHIPU_VISION_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
ZHIPU_VISION_MODEL = "glm-4v-flash"

_URL = re.compile(r"url=([^,\]]+)")


def extract_images(raw_msg: str) -> list[str]:
    urls = []
    for m in re.finditer(r"\[CQ:image,([^\]]+)\]", raw_msg):
        attrs = m.group(1)
        um = _URL.search(attrs)
        if um:
            urls.append(um.group(1))
    return urls


def _gif_first_and_last_frame(data: bytes):
    try:
        from PIL import Image, ImageChops
    except ImportError:
        logger.warning("[vision] PIL 未安装")
        return data, None, False
    try:
        img = Image.open(io.BytesIO(data))
        n_frames = getattr(img, "n_frames", 1)
        img.seek(0)
        first = img.convert("RGBA")
        if n_frames <= 1:
            buf = io.BytesIO()
            first.save(buf, format="PNG")
            return buf.getvalue(), None, False
        img.seek(n_frames - 1)
        last = img.convert("RGBA")
        is_same = ImageChops.difference(first, last).getbbox() is None
        first_buf = io.BytesIO()
        first.save(first_buf, format="PNG")
        if is_same:
            return first_buf.getvalue(), None, False
        last_buf = io.BytesIO()
        last.save(last_buf, format="PNG")
        return first_buf.getvalue(), last_buf.getvalue(), True
    except Exception as e:
        logger.warning(f"[vision] GIF 处理失败: {e}")
        return data, None, False


async def _call_zhipu_vision(img_b64: str, extra_text: str = "") -> str:
    if not ZHIPU_API_KEY:
        logger.warning("[vision] ZHIPU_API_KEY 未配置")
        return ""
    prompt = "用一句话简短描述这张图片的内容，不要解释，不超过50字。"
    if extra_text:
        prompt = extra_text + " " + prompt
    try:
        client = get_http_client()
        resp = await client.post(
            ZHIPU_VISION_URL,
            headers={
                "Authorization": f"Bearer {ZHIPU_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": ZHIPU_VISION_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": img_b64}},
                        {"type": "text", "text": prompt},
                    ],
                }],
                "max_tokens": 100,
                "temperature": 0.3,
            },
            timeout=15.0,
        )
        if resp.status_code != 200:
            logger.error(f"[vision] 智谱 API 错误 {resp.status_code}: {resp.text[:300]}")
            return ""
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.error(f"[vision] 调用智谱失败: {e}", exc_info=True)
        return ""


async def describe_image(image_url: str) -> str:
    if not ZHIPU_API_KEY:
        return ""
    # 腾讯返回的图片 URL 里可能带 &amp;，要先还原成 &
    image_url = image_url.replace("&amp;", "&")
    try:
        client = get_http_client()
        resp = await client.get(image_url, timeout=10.0)
        resp.raise_for_status()
        raw = resp.content[:MAX_IMAGE_BYTES]
    except Exception as e:
        logger.error(f"[vision] 下载图片失败: {e}")
        return ""

    url_lower = image_url.lower().split("?")[0]
    if url_lower.endswith(".gif"):
        first_png, last_png, is_animated = await asyncio.to_thread(_gif_first_and_last_frame, raw)
        if is_animated and last_png is not None:
            logger.info("[vision] GIF 检测为动图，识别第一帧")
            img_b64 = base64.b64encode(first_png).decode("ascii")
            desc = await _call_zhipu_vision(img_b64, extra_text="这是一个动图的第一帧。")
            return f"（动图）{desc}" if desc else ""
        else:
            logger.info("[vision] GIF 检测为静态图")
            img_b64 = base64.b64encode(first_png).decode("ascii")
            return await _call_zhipu_vision(img_b64)

    img_b64 = base64.b64encode(raw).decode("ascii")
    desc = await _call_zhipu_vision(img_b64)
    if desc:
        logger.info(f"[vision] 识别结果: {desc}")
    return desc