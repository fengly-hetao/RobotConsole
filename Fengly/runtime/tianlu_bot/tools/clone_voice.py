# -*- coding: utf-8 -*-
"""
MiniMax 语音克隆（命令行版，供控制台一键调用）
用法: python clone_voice.py --main <基准音频> [--ref <示例音频>] [--text <示例文本>] [--voice-id <音色ID>]
输出: JSON {ok, voice_id / error}
"""
import sys
import os
import json
from pathlib import Path

try:
    import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "缺少 requests 库"}, ensure_ascii=False))
    sys.exit(0)


def load_env(path):
    vals = {}
    try:
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip()
    except Exception:
        pass
    return vals


def main():
    args = {}
    i = 1
    while i < len(sys.argv):
        if sys.argv[i].startswith("--"):
            key = sys.argv[i][2:]
            val = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
            args[key] = val
            i += 2
        else:
            i += 1

    # .env 在 tools 的上一级上一级 = tianlu_bot/.env
    env = load_env(Path(__file__).resolve().parents[2] / ".env")
    api_key = env.get("MINIMAX_API_KEY", "")
    if not api_key:
        print(json.dumps({"ok": False, "error": "请先在设置里填写 MiniMax API 密钥"}, ensure_ascii=False))
        return

    main_audio = args.get("main", "")
    ref_audio = args.get("ref", "")
    prompt_text = args.get("text", "")
    voice_id = args.get("voice-id", "tianlu_bot")

    if not main_audio or not os.path.exists(main_audio):
        print(json.dumps({"ok": False, "error": "基准音频文件不存在"}, ensure_ascii=False))
        return

    headers = {"Authorization": "Bearer " + api_key}

    # 1) 上传基准音频（10秒~5分钟）
    try:
        with open(main_audio, "rb") as f:
            r = requests.post(
                "https://api.minimax.cn/v1/files/upload",
                headers=headers,
                data={"purpose": "voice_clone"},
                files=[("file", (os.path.basename(main_audio), f))],
                timeout=180,
            )
        d = r.json()
        main_id = d["file"]["file_id"]
    except Exception as e:
        print(json.dumps({"ok": False, "error": "上传基准音频失败：" + str(e)}, ensure_ascii=False))
        return

    # 2) 示例音频（≤8秒，可选）
    ref_id = ""
    if ref_audio and os.path.exists(ref_audio):
        try:
            with open(ref_audio, "rb") as f:
                r = requests.post(
                    "https://api.minimax.cn/v1/files/upload",
                    headers=headers,
                    data={"purpose": "prompt_audio"},
                    files=[("file", (os.path.basename(ref_audio), f))],
                    timeout=180,
                )
            ref_id = r.json()["file"]["file_id"]
        except Exception as e:
            print(json.dumps({"ok": False, "error": "上传示例音频失败：" + str(e)}, ensure_ascii=False))
            return

    # 3) 克隆音色
    payload = {
        "file_id": main_id,
        "voice_id": voice_id,
        "text": "你好，我是你的专属语音。",
        "model": "speech-2.8-hd",
    }
    if ref_id:
        payload["clone_prompt"] = {"prompt_audio": ref_id, "prompt_text": prompt_text or "示例音频内容"}

    try:
        r = requests.post(
            "https://api.minimax.cn/v1/voice_clone",
            headers={**headers, "Content-Type": "application/json"},
            json=payload,
            timeout=300,
        )
        body = r.json()
        base = body.get("base_resp", {})
        if r.status_code == 200 and base.get("status_code", -1) == 0:
            print(json.dumps({"ok": True, "voice_id": voice_id, "detail": json.dumps(body, ensure_ascii=False)[:400]}, ensure_ascii=False))
        else:
            print(json.dumps({"ok": False, "error": "克隆失败 HTTP " + str(r.status_code) + ": " + json.dumps(body, ensure_ascii=False)[:300]}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": "克隆失败：" + str(e)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
