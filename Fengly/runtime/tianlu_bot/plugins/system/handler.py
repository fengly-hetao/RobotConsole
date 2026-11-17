# -*- coding: utf-8 -*-
import asyncio
import psutil
import time
import platform
import socket
import subprocess
import re
from datetime import datetime
from nonebot import on_message
from nonebot.adapters.onebot.v11 import GroupMessageEvent, MessageSegment
from nonebot.exception import FinishedException, RejectedException
from nonebot.log import logger
from core.config import OWNER_ID, GROUP_IDS, is_enabled, get_group_ids

system = on_message(priority=3, block=False)

# 管理员 QQ 列表（OWNER_ID 可逗号分隔多个）
_ADMINS = frozenset(q.strip() for q in (OWNER_ID or "").split(",") if q.strip())


@system.handle()
async def handle_system(event: GroupMessageEvent):
    raw_msg = event.raw_message if hasattr(event, "raw_message") else str(event.message)
    user_id = str(event.user_id)

    # 不是 # 开头的直接放行给后面的 matcher
    if not raw_msg.startswith("#"):
        return
    # 群过滤
    if get_group_ids() and str(event.group_id) not in get_group_ids():
        return
    if not is_enabled("system_commands"):
        return
    # 鉴权：只有管理员（OWNER_ID）能查询主机信息
    if user_id not in _ADMINS:
        await system.finish(MessageSegment.at(user_id) + "（抱胸）这些命令只有管理员能用！")
        return
    if raw_msg == "#napcat":
        return

    cmd = raw_msg.strip().lower()

    try:
        # ===== 帮助 =====
        if cmd == "#help":
            await system.finish(MessageSegment.at(user_id) + """📟 可用指令：
#sysinfo - 系统信息
#cpu - CPU使用率
#memory - 内存使用
#disk - 磁盘使用
#uptime - 运行时间
#ip - IP地址
#time - 当前时间
#ping - 延迟测试
#date - 当前日期
#botinfo - 机器人信息""")
            return

        # ===== 系统信息 =====
        if cmd == "#sysinfo":
            cpu = await asyncio.to_thread(psutil.cpu_percent, 0.3)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage("/")
            boot = datetime.fromtimestamp(psutil.boot_time()).strftime("%Y年%m月%d日 %H:%M:%S")
            await system.finish(
                MessageSegment.at(user_id)
                + f"📊 系统信息\n开机：{boot}\nCPU：{cpu}%\n"
                  f"内存：{mem.used // 1024 // 1024}MB / {mem.total // 1024 // 1024}MB\n"
                  f"磁盘：{disk.used // 1024 // 1024}MB / {disk.total // 1024 // 1024}MB"
            )
            return

        # ===== CPU =====
        if cmd == "#cpu":
            cpu = await asyncio.to_thread(psutil.cpu_percent, 0.3)
            await system.finish(
                MessageSegment.at(user_id)
                + f"📈 CPU使用率：{cpu}%\n"
                  f"核心数：{psutil.cpu_count()}核"
            )
            return

        # ===== 内存 =====
        if cmd == "#memory":
            mem = psutil.virtual_memory()
            await system.finish(
                MessageSegment.at(user_id)
                + f"💾 内存：{mem.used // 1024 // 1024}MB / {mem.total // 1024 // 1024}MB ({mem.percent}%)"
            )
            return

        # ===== 磁盘 =====
        if cmd == "#disk":
            disk = psutil.disk_usage("/")
            await system.finish(
                MessageSegment.at(user_id)
                + f"💿 磁盘：{disk.used // 1024 // 1024}MB / {disk.total // 1024 // 1024}MB ({disk.percent}%)"
            )
            return

        # ===== 运行时间 =====
        if cmd == "#uptime":
            uptime = time.time() - psutil.boot_time()
            boot = datetime.fromtimestamp(psutil.boot_time())
            days = int(uptime // 86400)
            hours = int((uptime % 86400) // 3600)
            minutes = int((uptime % 3600) // 60)
            await system.finish(
                MessageSegment.at(user_id)
                + f"⏱️ 运行时间\n开机：{boot.strftime('%Y年%m月%d日 %H:%M:%S')}\n"
                  f"已运行：{days}天 {hours}小时 {minutes}分钟"
            )
            return

        # ===== IP =====
        if cmd == "#ip":
            ip = "获取失败"
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                try:
                    s.connect(("8.8.8.8", 80))
                    ip = s.getsockname()[0]
                finally:
                    s.close()
            except OSError:
                pass
            await system.finish(
                MessageSegment.at(user_id)
                + f"🌐 主机名：{socket.gethostname()}\n内网IP：{ip}"
            )
            return

        # ===== 时间 =====
        if cmd == "#time":
            await system.finish(
                MessageSegment.at(user_id)
                + f"🕐 当前时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            )
            return

        # ===== 日期 =====
        if cmd == "#date":
            await system.finish(
                MessageSegment.at(user_id)
                + f"📅 当前日期：{datetime.now().strftime('%Y年%m月%d日')}"
            )
            return

        # ===== 延迟测试 =====
        if cmd == "#ping":
            param = "-n" if platform.system().lower() == "windows" else "-c"
            reply = "🏓 ping 无结果"
            try:
                out = await asyncio.to_thread(
                    subprocess.check_output,
                    ["ping", param, "1", "api.deepseek.com"],
                    timeout=5, stderr=subprocess.DEVNULL,
                )
                out = out.decode("gbk", errors="ignore")
                m = re.search(r"(?:时间|time)[=<]\s*(\d+)\s*ms", out)
                reply = f"🏓 延迟：{m.group(1)}ms" if m else "🏓 ping 成功，但没解析到延迟"
            except subprocess.TimeoutExpired:
                reply = "❌ ping 超时"
            except Exception:
                reply = "❌ ping 失败"
            await system.finish(MessageSegment.at(user_id) + reply)
            return

        # ===== 机器人信息 =====
        if cmd == "#botinfo":
            try:
                from pathlib import Path as _P
                _ver = _P(__file__).resolve().parents[3] / "VERSION"
                _v = _ver.read_text(encoding="utf-8").strip() if _ver.exists() else "1.1.0"
            except Exception:
                _v = "1.1.0"
            await system.finish(
                MessageSegment.at(user_id)
                + f"🤖 机器人 v{_v}\nNoneBot2 + OneBot V11\n模型：DeepSeek"
            )
            return

    except (FinishedException, RejectedException):
        raise
    except Exception as e:
        logger.debug(f"[system] 未处理异常: {type(e).__name__}: {e}")