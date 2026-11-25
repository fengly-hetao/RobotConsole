# -*- coding: utf-8 -*-
"""
控制台发送通道
==============
给控制台提供一个本地 HTTP 接口，用机器人自己的 Bot 连接发消息。

为什么需要它：
  NapCat 的 OneBot HTTP Server（16200）在某些情况下会「启动了但没挂到 QQ 会话」，
  返回空 data。而 NoneBot 这边的 WebSocket 连接是实打实可用的，
  所以直接复用 bot 的发送能力最可靠。

接口（只监听 127.0.0.1，仅本机可调）：
  GET  /console/groups            → 群列表
  POST /console/send              → 发消息
        body: { "text": "...", "groups": ["123","456"] }  groups 为空 = 全部群
  GET  /console/login             → 当前登录的机器人账号

端口：读取环境变量 CONSOLE_API_PORT，默认 18081
安全：绑定 127.0.0.1；校验 X-Console-Token（取自 CONSOLE_API_TOKEN，默认 tianlu）
"""
import json
import os

from nonebot import get_bots, get_driver
from nonebot.adapters.onebot.v11 import Bot
from nonebot.log import logger

try:
    from starlette.requests import Request
except ImportError:
    from fastapi import Request

API_PORT = int(os.environ.get("CONSOLE_API_PORT", "18081"))
API_TOKEN = os.environ.get("CONSOLE_API_TOKEN", "tianlu")

registered = False


def _ok(data):
    return {"ok": True, "data": data}


def _err(msg, code=400):
    return {"ok": False, "error": str(msg), "code": code}


def _pick_bot():
    """取当前在线的 Bot（有多个时取第一个）"""
    bots = get_bots()
    if not bots:
        return None
    return next(iter(bots.values()))


async def _handle_request(request: "Request"):
    # 鉴权
    token = request.headers.get("x-console-token", "")
    if token != API_TOKEN:
        return _err("token 不正确", 401)

    path = request.url.path

    if path == "/console/ping":
        return _ok({"pong": True})

    if path == "/console/login":
        bot = _pick_bot()
        if not bot:
            return _err("机器人未连接", 503)
        try:
            info = await bot.call_api("get_login_info")
            return _ok({"qq": str(info.get("user_id", "")), "nickname": info.get("nickname", "")})
        except Exception as e:
            return _err(f"获取登录信息失败: {e}", 500)

    if path == "/console/groups":
        bot = _pick_bot()
        if not bot:
            return _err("机器人未连接", 503)
        try:
            groups = await bot.call_api("get_group_list")
            out = [
                {
                    "id": str(g.get("group_id", "")),
                    "name": g.get("group_name", ""),
                    "memberCount": int(g.get("member_count", 0) or 0),
                }
                for g in (groups or [])
            ]
            return _ok({"groups": out})
        except Exception as e:
            return _err(f"获取群列表失败: {e}", 500)

    if path == "/console/send" and request.method == "POST":
        bot = _pick_bot()
        if not bot:
            return _err("机器人未连接", 503)

        try:
            raw = await request.body()
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            return _err(f"请求体不是合法 JSON: {e}", 400)

        text = str(body.get("text", "")).strip()
        if not text:
            return _err("text 不能为空", 400)

        targets = [str(x) for x in (body.get("groups") or []) if str(x).strip()]

        # 没指定群 = 发给全部群
        if not targets:
            try:
                gl = await bot.call_api("get_group_list")
                targets = [str(g.get("group_id")) for g in (gl or []) if g.get("group_id")]
            except Exception as e:
                return _err(f"获取群列表失败: {e}", 500)

        if not targets:
            return _err("机器人当前不在任何群", 400)

        sent, failed = [], []
        for i, gid in enumerate(targets):
            try:
                await bot.send_group_msg(group_id=int(gid), message=text)
                sent.append(gid)
            except Exception as e:
                failed.append({"groupId": gid, "error": str(e)[:150]})
            # 间隔 300ms，避免触发限流
            if i < len(targets) - 1:
                import asyncio
                await asyncio.sleep(0.3)

        return _ok({"sent": sent, "failed": failed, "total": len(targets)})

    return _err("未知接口", 404)


@get_driver().on_startup
async def _start_console_api():
    """用 FastAPI 挂载到 nonebot 已有的 uvicorn 上"""
    global registered
    if registered:
        return
    try:
        from nonebot.drivers import Driver
        drv = get_driver()

        # NoneBot 的 FastAPI 驱动器（默认 ASGI 模式）
        app = getattr(drv, "server_app", None)
        if app is None:
            logger.warning("[console-api] 当前驱动器没有 server_app，控制台发送功能不可用")
            return

        app.add_api_route("/console/ping", _handle_request, methods=["GET"])
        app.add_api_route("/console/login", _handle_request, methods=["GET"])
        app.add_api_route("/console/groups", _handle_request, methods=["GET"])
        app.add_api_route("/console/send", _handle_request, methods=["POST"])
        registered = True
        logger.info(f"🖥 控制台发送通道已挂载（/console/*，与 bot 同端口）")
    except Exception as e:
        logger.warning(f"[console-api] 挂载失败: {type(e).__name__}: {e}")
