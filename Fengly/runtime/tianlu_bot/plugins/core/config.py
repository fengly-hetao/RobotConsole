# -*- coding: utf-8 -*-
"""
全局配置读取
- .env 由 NoneBot 自动加载（API 密钥、账号）
- ai_data/*.env 由本模块手动加载（对话/游戏/戳一戳等全部参数）
"""
import os
from pathlib import Path
from nonebot import get_driver

# ==================== 路径 ====================
# config.py 位于 plugins/core/ 下，向上三层才是项目根 tianlu_bot
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
AI_DATA_DIR = PROJECT_ROOT / "ai_data"


# ==================== 加载 ai_data/*.env（mtime 热缓存，改完立即生效）====================
_file_cache: dict[str, tuple] = {}


def _read_env_file(env_file) -> dict:
    """单文件读取，带 mtime 缓存：文件没变就直接用缓存，变了才重读。"""
    key = str(env_file)
    try:
        mtime = env_file.stat().st_mtime
    except OSError:
        return {}
    cached = _file_cache.get(key)
    if cached and cached[0] == mtime:
        return cached[1]
    values: dict = {}
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
    except Exception:
        values = {}
    _file_cache[key] = (mtime, values)
    return values


def _all_ai_data() -> dict:
    """合并 ai_data 目录全部 .env（字母序，后读覆盖先读）；每调用只 stat 6 个小文件，开销≈0。"""
    out: dict = {}
    if AI_DATA_DIR.exists():
        for env_file in sorted(AI_DATA_DIR.glob("*.env")):
            out.update(_read_env_file(env_file))
    return out


def ai_get(key: str, default: str) -> str:
    return _all_ai_data().get(key, default)


def ai_get_int(key: str, default: int) -> int:
    try:
        return int(float(_all_ai_data().get(key, "")))
    except (ValueError, TypeError):
        return default


def ai_get_float(key: str, default: float) -> float:
    try:
        return float(_all_ai_data().get(key, ""))
    except (ValueError, TypeError):
        return default


def ai_get_bool(key: str, default: bool) -> bool:
    v = _all_ai_data().get(key, "").lower()
    if v in ("true", "1", "yes"):
        return True
    if v in ("false", "0", "no"):
        return False
    return default


# ==================== 读取 .env ====================
class Config:
    def __init__(self):
        driver = get_driver()
        cfg = driver.config

        # DeepSeek
        self.DEEPSEEK_API_KEY = getattr(cfg, "deepseek_api_key", "")
        self.DEEPSEEK_BASE_URL = getattr(cfg, "deepseek_base_url", "https://api.deepseek.com")
        self.DEEPSEEK_MODEL = getattr(cfg, "deepseek_model", "deepseek-chat")

        # 智谱
        self.ZHIPU_API_KEY = getattr(cfg, "zhipu_api_key", "")

        # 当前使用的模型 provider
        self.MODEL_PROVIDER = getattr(cfg, "model_provider", "deepseek")

        # 自定义模型（通用 OpenAI 兼容，可填任意 base_url/model/key）
        self.CUSTOM_API_KEY = getattr(cfg, "custom_api_key", "")
        self.CUSTOM_BASE_URL = getattr(cfg, "custom_base_url", "")
        self.CUSTOM_MODEL = getattr(cfg, "custom_model", "")

        # MiniMax
        self.MINIMAX_API_KEY = getattr(cfg, "minimax_api_key", "")
        self.MINIMAX_VOICE_ID = getattr(cfg, "minimax_voice_id", "tianlu_bot")

        # 网易云（cookie 登录，SVIP 高音质）
        self.NETEASE_COOKIE = getattr(cfg, "netease_cookie", "")

        # 管理员 / 机器人（强制 str：NoneBot 2.5 pydantic 会把纯数字转成 int，导致 str 比较失效）
        self.OWNER_ID = str(getattr(cfg, "owner_id", "") or "")
        self.BOT_QQ = str(getattr(cfg, "bot_qq", "") or "")
        self.GROUP_ID = str(getattr(cfg, "group_id", "") or "")

        # 反馈群：反馈转发与群内反馈收集都在这个群
        self.FEEDBACK_GROUP_ID = str(getattr(cfg, "feedback_group_id", "10955121023") or "")

        # 屏蔽的 QQ 号（其他 AI/机器人，避免互聊循环）
        self.IGNORE_QQ = str(getattr(cfg, "ignore_qq", "") or "")

        # 图片
        self.SAVE_IMAGES = str(getattr(cfg, "save_images", "false")).lower() == "true"

        # 运行环境
        self.ENVIRONMENT = getattr(cfg, "environment", "dev")
        self.DRIVER = getattr(cfg, "driver", "~fastapi")


_config = Config()

# ==================== 模块级导出 ====================
DEEPSEEK_API_KEY = _config.DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL = _config.DEEPSEEK_BASE_URL
DEEPSEEK_MODEL = _config.DEEPSEEK_MODEL

ZHIPU_API_KEY = _config.ZHIPU_API_KEY

MODEL_PROVIDER = _config.MODEL_PROVIDER
CUSTOM_API_KEY = _config.CUSTOM_API_KEY
CUSTOM_BASE_URL = _config.CUSTOM_BASE_URL
CUSTOM_MODEL = _config.CUSTOM_MODEL

MINIMAX_API_KEY = _config.MINIMAX_API_KEY
MINIMAX_VOICE_ID = _config.MINIMAX_VOICE_ID

NETEASE_COOKIE = _config.NETEASE_COOKIE

OWNER_ID = _config.OWNER_ID
BOT_QQ = _config.BOT_QQ
GROUP_ID = _config.GROUP_ID
FEEDBACK_GROUP_ID = _config.FEEDBACK_GROUP_ID

IGNORE_QQ = frozenset(q.strip() for q in _config.IGNORE_QQ.split(",") if q.strip())

# 允许工作的群（热读：每次消息都重新读 .env，改完立即生效）
def get_group_ids() -> frozenset:
    try:
        cfg = get_driver().config
        raw = getattr(cfg, "group_id", "") or ""
    except Exception:
        raw = ""
    # 强制转字符串：NoneBot 2.5 的 pydantic 会把 .env 里纯数字的 GROUP_ID 解析成 int，
    # 导致 .split() 报错（'int' object has no attribute 'split'）
    raw = str(raw)
    return frozenset(q.strip() for q in raw.split(",") if q.strip())


GROUP_IDS = get_group_ids()

# ==================== 多模型统一入口 ====================
# 模型注册表：所有模型都用 OpenAI 兼容的 /chat/completions 接口
# provider -> (默认 base_url, 默认 model)
MODEL_REGISTRY = {
    "deepseek": ("https://api.deepseek.com", "deepseek-chat"),
    "zhipu": ("https://open.bigmodel.cn/api/paas/v4", "glm-4-flash"),
    "qwen": ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
    "kimi": ("https://api.moonshot.cn/v1", "moonshot-v1-8k"),
    "doubao": ("https://ark.cn-beijing.volces.com/api/v3", "doubao-1-5-pro-32k-250115"),
    "hunyuan": ("https://api.hunyuan.cloud.tencent.com/v1", "hunyuan-lite"),
    "spark": ("https://spark-api-open.xf-yun.com/v1", "generalv3.5"),
    "ernie": ("https://qianfan.baidubce.com/v2", "ernie-4.0-8k"),
    "baichuan": ("https://api.baichuan-ai.com/v1", "Baichuan4"),
    "minimax-chat": ("https://api.minimax.chat/v1", "abab6.5s-chat"),
    "yi": ("https://api.lingyiwanwu.com/v1", "yi-lightning"),
    "stepfun": ("https://api.stepfun.com/v1", "step-1-8k"),
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini"),
    "groq": ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
    "mistral": ("https://api.mistral.ai/v1", "mistral-small-latest"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"),
    "ollama": ("http://127.0.0.1:11434/v1", "qwen2.5:7b"),
    "lmstudio": ("http://127.0.0.1:1234/v1", "local-model"),
}

# 模型显示名（给设置页用）
MODEL_NAMES = {
    "deepseek": "DeepSeek",
    "zhipu": "智谱 GLM",
    "qwen": "通义千问 Qwen",
    "kimi": "Kimi 月之暗面",
    "doubao": "豆包 Doubao",
    "hunyuan": "腾讯混元 Hunyuan",
    "spark": "讯飞星火 Spark",
    "ernie": "百度文心 ERNIE",
    "baichuan": "百川 Baichuan",
    "minimax-chat": "MiniMax 对话",
    "yi": "零一万物 Yi",
    "stepfun": "阶跃星辰 StepFun",
    "openai": "OpenAI GPT",
    "groq": "Groq",
    "mistral": "Mistral",
    "gemini": "Google Gemini",
    "ollama": "Ollama（本地）",
    "lmstudio": "LM Studio（本地）",
}


def get_model_config() -> dict:
    """根据 MODEL_PROVIDER 返回当前的 base_url、model、api_key（热读，改完立即生效）。"""
    try:
        cfg = get_driver().config
        provider = str(getattr(cfg, "model_provider", "deepseek") or "deepseek").lower().strip()
    except Exception:
        provider = "deepseek"

    # 自定义模型（通用 OpenAI 兼容）
    if provider == "custom":
        return {
            "api_key": getattr(cfg, "custom_api_key", ""),
            "base_url": getattr(cfg, "custom_base_url", "").rstrip("/") or "https://api.openai.com/v1",
            "model": getattr(cfg, "custom_model", "") or "gpt-4o-mini",
        }

    # 从注册表取默认 base_url / model，用 {provider} 大写前缀读 .env 覆盖
    def envget(suffix, default=""):
        # {provider}_api_key / {provider}_base_url / {provider}_model
        attr = f"{provider}_{suffix}".lower()
        v = getattr(cfg, attr, "")
        return v if v else default

    base_default, model_default = MODEL_REGISTRY.get(provider, ("https://api.deepseek.com", "deepseek-chat"))
    api_key = envget("api_key", "")
    base_url = envget("base_url", base_default)
    model = envget("model", model_default)

    # 本地模型（Ollama/LM Studio）不需要 key
    if provider in ("ollama", "lmstudio") and not api_key:
        api_key = "local"

    return {"api_key": api_key, "base_url": base_url, "model": model}

SAVE_IMAGES = _config.SAVE_IMAGES

ENVIRONMENT = _config.ENVIRONMENT
DRIVER = _config.DRIVER

# 机器人端口（GUI 改端口会同步写入 .env，这里读它）
BOT_PORT = int(os.getenv("BOT_PORT", "8080"))
BOT_HOST = os.getenv("BOT_HOST", "127.0.0.1")


# ==================== 功能开关（ai_data/00_features.env，单一真相源）====================
def is_enabled(name: str) -> bool:
    """功能开关：FEATURE_XXX=true/false，默认关（安全第一）"""
    return ai_get_bool(f"FEATURE_{name.upper()}", False)


# ==================== 游戏命令黑名单（按启用的功能动态生成）====================
def get_game_commands() -> frozenset:
    cmds = {"商店", "买", "背包", "卖", "我的信息", "叫我", "我是谁"}
    if is_enabled("sign"):
        cmds.add("签到")
    if is_enabled("lottery"):
        cmds.add("抽签")
    # handler.env 里用户额外指定的命令（追加）
    for x in ai_get("GAME_COMMANDS", "").split(","):
        x = x.strip()
        if x:
            cmds.add(x)
    # 引擎小游戏命令（只登记启用的，关掉立即从黑名单剔除）
    try:
        from games import engine
        for g in engine.all_games():
            if engine.enabled(g):
                cmd = g.get("cmd", "")
                if cmd:
                    cmds.add(cmd)
    except Exception:
        pass
    return frozenset(cmds)


# ==================== 私聊白名单（来自 ai_data/handler.env）====================
def get_private_whitelist() -> frozenset:
    """私聊白名单：只有这些 QQ 号能私聊机器人。空 = 禁止所有私聊。"""
    raw = ai_get("PRIVATE_WHITELIST", "")
    return frozenset(q.strip() for q in raw.split(",") if q.strip())


# ==================== 配置读取（来自 ai_data）====================
def get_max_history() -> int:
    """历史记录保留条数（user + assistant 各算 1 条）"""
    return ai_get_int("MAX_HISTORY", 20)


def get_cooldown() -> int:
    """同一用户两次对话的最小间隔秒数"""
    return ai_get_int("COOLDOWN_SECONDS", 5)


def get_max_favor() -> int:
    """好感度上限"""
    return ai_get_int("MAX_FAVOR", 100)


def get_fortune_refresh() -> int:
    """运势刷新间隔（秒）"""
    return ai_get_int("FORTUNE_REFRESH", 86400)


def get_max_reply_length() -> int:
    """回复最大字数，超过截断"""
    return ai_get_int("MAX_REPLY_LENGTH", 200)


def get_max_tokens() -> int:
    """单次生成 token 上限"""
    return ai_get_int("MAX_TOKENS", 350)


def get_temperature() -> float:
    """随机性 0~2"""
    return ai_get_float("TEMPERATURE", 0.85)


def get_split_chars() -> str:
    """流式回复分句标点"""
    return ai_get("SPLIT_CHARS", "。！？!?")


def get_min_send_len() -> int:
    """流式回复首段最短长度"""
    return ai_get_int("MIN_SEND_LEN", 4)


def get_voice_prob() -> float:
    """语音回复概率 0~1"""
    return ai_get_float("VOICE_RANDOM_PROB", 0.3)


def get_tts_model() -> str:
    return ai_get("TTS_MODEL", "speech-2.8-turbo")


def get_tts_speed() -> float:
    return ai_get_float("TTS_SPEED", 1.0)


def get_tts_sample_rate() -> int:
    return ai_get_int("TTS_SAMPLE_RATE", 32000)


def get_actions() -> list:
    """动作词库（说话时括号里的动作）"""
    return [x.strip() for x in ai_get("ACTIONS", "甩尾巴,翻白眼,歪头,抱胸,撇嘴").split(",") if x.strip()]


# ==================== 每日限额（防止被刷爆）====================
def get_daily_ai_limit() -> int:
    """每用户每天 AI 对话次数上限，0 = 不限"""
    return ai_get_int("DAILY_AI_LIMIT", 200)


def get_daily_tts_limit() -> int:
    """每用户每天语音合成次数上限，0 = 不限"""
    return ai_get_int("DAILY_TTS_LIMIT", 30)


def get_daily_song_limit() -> int:
    """每用户每天点歌次数上限，0 = 不限"""
    return ai_get_int("DAILY_SONG_LIMIT", 20)
