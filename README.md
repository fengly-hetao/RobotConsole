# 机器人控制台 · Fengly

> 一站式 QQ 机器人管理客户端 —— 把 NapCat（QQ 协议端）+ NoneBot2（机器人框架）+ AI 对话打包成一个双击就能用的 Windows 桌面应用。

![version](https://img.shields.io/badge/version-1.9.0-blue)
![electron](https://img.shields.io/badge/Electron-28.3.3-47848F)
![nonebot](https://img.shields.io/badge/NoneBot2-2.5.0-red)

---

## 这是什么

传统搭建 QQ 机器人要装 Python、配虚拟环境、拉 NapCat、写配置文件、开好几个终端……**这个项目把这些全部收进一个界面**：

- 双击启动，自动准备运行时
- 一键拉起 NapCat + 机器人
- 网页控制台内嵌（不用切浏览器）
- 模型/人格/功能开关全部可视化配置
- 内置更新检查（支持 GitHub / QQ 群文件 / 网盘）

---

## 功能

| 模块 | 说明 |
|------|------|
| **AI 对话** | 20+ 模型提供商：DeepSeek、智谱 GLM、通义千问、Kimi、豆包、混元、星火、文心、百川、MiniMax、Yi、StepFun、OpenAI、Groq、Mistral、Gemini、Ollama、LM Studio、自定义 OpenAI 兼容接口 |
| **识图** | 智谱 `glm-4v-flash` 识别图片内容（独立于对话模型，可选配） |
| **语音** | MiniMax TTS 文字转语音 + 声音克隆 |
| **人格系统** | 名字 / 性格 / 口头禅 / 爱好 可视化配置，AI 辅助生成提示词 |
| **点歌** | 网易云音乐搜索播放，内置 ffmpeg 转码 |
| **小游戏** | 签到、抽签、运势、成语接龙、商店、背包 |
| **消息记录** | 群聊历史永久保留，按天分文件 |
| **一人一档** | 群成员好感度、生日、互动统计 |
| **多群支持** | 逗号分隔配置多个群号 |
| **更新分发** | GitHub 仓库 / QQ 群文件 / 123 网盘 三种更新源，自动回退 |
| **环境诊断** | 一键检查运行时/端口/进程/配置，出错直接告诉你原因 |

---

## 技术栈

```
Electron 28.3.3        桌面外壳（主进程 = Node.js）
├─ NapCat 4.18.41      QQ 协议端（DLL 注入 QQ 客户端）
├─ NoneBot2 2.5.0      机器人框架（Python）
│   └─ OneBot V11      反向 WebSocket 连接
├─ QQ 9.9.33           被注入的 QQ 客户端（独立环境，不影响你电脑上的 QQ）
└─ Renderer           原生 HTML/CSS/JS（无框架，含 Monaco + xterm.js）
```

通信链路：

```
QQ 客户端 ←(Hook DLL)← NapCat ←(反向WS:18080)→ NoneBot2
                            ↖(HTTP API:16200)↙ 程序主动查群文件
```

---

## 目录结构

```
Fengly/
├── main.js                  Electron 主进程（窗口/IPC/进程管理/更新）
├── preload.js               安全桥（contextBridge 暴露 API）
├── electron-builder.yml     打包配置
├── build/                   图标、NSIS 安装器脚本
├── modules/                 主进程模块
│   ├── procman.js           进程管理（启动/停止 NapCat 与机器人）
│   ├── ports.js             端口探测（自动避开系统保留端口）
│   ├── killer.js            启动前清理残留进程
│   ├── network.js           网络配置（反向WS + HTTP API + 端口）
│   ├── runtime.js           运行时解压/修复
│   ├── updater.js           更新检查（GitHub/网盘/群文件）
│   ├── groupupdate.js       从 QQ 群文件读 update.json
│   ├── standalone.js        独立启动器（脱离界面单独启组件）
│   ├── python.js            Python 环境检测与自动安装
│   ├── usage.js             各大模型余额查询
│   ├── store.js             配置存储
│   └── ...
├── renderer/                前端界面
│   ├── app.js               主逻辑
│   ├── i18n.js              中英双语
│   ├── styles.css
│   └── vendor/              Monaco 编辑器 + xterm.js
├── scripts/afterPack.js     打包后置处理
├── tools/                   诊断/卸载/启动脚本
└── runtime/
    ├── VERSION              运行时版本号
    └── tianlu_bot/          Python 机器人本体
        ├── bot.py
        ├── plugins/
        │   ├── core/        配置与模型注册表
        │   ├── ai_chat/     AI 对话 + 识图 + TTS
        │   ├── games/       小游戏
        │   ├── monitor/     消息记录
        │   ├── poke/        戳一戳互动
        │   └── system/      系统命令
        └── .env.example     配置模板
```

> ⚠️ **本仓库不包含第三方二进制**：QQ 客户端、NapCat 框架、ffmpeg、Python 运行时。
> 这些需要自行准备，见下方「准备运行时」。

---

## 快速开始

### 1. 准备环境

```bash
# Node.js 18+ 与 pnpm
npm i -g pnpm

# 安装依赖
pnpm install
```

### 2. 准备运行时（关键）

`runtime/` 目录里需要放入三个组件（本项目不提供，请从官方获取）：

```
runtime/
├── napcat/        NapCat 框架（含 NapCatWinBootMain.exe、napcat.mjs、Hook DLL）
├── qq/            独立 QQ 环境（QQ 9.9.33 + versions/）
└── tools/ffmpeg/  可选，点歌转码用
```

**获取方式**：
- NapCat：<https://github.com/NapNeko/NapCatQQ/releases>
- QQ：官方安装包解包后的 `QQ.exe` + `versions/` 目录

> 本项目已适配 NapCat 4.18.41 + QQ 9.9.33。更高版本的 NapCat 可能与低版本 QQ 不兼容（实测 4.18.42 配 9.9.33 无法启动）。

### 3. 配置

```bash
cd runtime/tianlu_bot
cp .env.example .env
```

编辑 `.env`，**至少**填这几项：

```ini
# 机器人自己的 QQ 号
BOT_QQ=你的机器人QQ

# 你的 QQ 号（主人，拥有最高权限命令）
OWNER_ID=你的QQ

# 要服务的群（多个用英文逗号）
GROUP_ID=群号1,群号2

# 反馈群（可选）
FEEDBACK_GROUP_ID=

# 对话模型（选一个填 key）
MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxxxxx

# 识图（可选，智谱）
ZHIPU_API_KEY=

# 语音（可选，MiniMax）
MINIMAX_API_KEY=
```

### 4. 启动

```bash
# 开发模式（直接跑源码）
pnpm start
```

或者用绿色启动脚本：双击 `启动机器人控制台.bat`。

---

## 打包

```bash
# Windows 安装包（NSIS）
pnpm run build
```

产物在 `dist/` 下。

> 若要代码签名，设置环境变量 `CSC_LINK`（pfx 路径）和 `CSC_KEY_PASSWORD`。
> ⚠️ 不要把 `.pfx` 私钥提交到仓库！

---

## 更新分发

支持三种更新源，在设置页「更新源」里填任意一种：

### 方式 A：GitHub（推荐开源项目用）

设置页填仓库地址：
```
https://github.com/你的用户名/仓库名
```

然后在仓库**根目录**放 `update.json`：

```json
{
  "version": "1.9.1",
  "url": "https://github.com/user/repo/releases/download/v1.9.1/Setup.exe",
  "notes": "修复 xxx；新增 yyy",
  "force": false
}
```

程序会自动尝试 5 个镜像（官方 raw、gh-proxy、ghproxy、jsDelivr×2），**国内用户不需要挂代理**。

### 方式 B：QQ 群文件（国内最稳）

把 `update.json` 发到群文件，设置页填群号即可。需要机器人在线。

### 方式 C：网盘直链

填 `update.json` 的完整地址或所在目录。

优先级：**QQ 群 > 其他源**（群更新失败才回退）。

---

## 常见问题

<details>
<summary><b>启动后白屏</b></summary>

通常是 GPU 进程崩溃（虚拟显卡、远程桌面、向日葵等环境）。

程序已内置软件渲染兜底（`--disable-gpu --use-angle=swiftshader`）。若仍白屏：

1. 确认 `resources/app/main.js` 顶部有 GPU 禁用代码块
2. 确认用 `启动机器人控制台.bat` 启动（传 `app` 目录参数），而不是直接双击 electron.exe
</details>

<details>
<summary><b>NapCat 启动失败 / 网页控制台 127.0.0.1 拒绝连接</b></summary>

按顺序检查：

1. **端口被系统保留** → 跑 `诊断.bat` 看「端口排除范围」，程序会自动顺延，但配置可能不同步
2. **`runtime/napcat/node_modules` 缺失** → NapCat 核心无法加载，表现为没有 `NapCat.Core Version` 日志
3. **残留 QQ 进程占着登录态** → 程序启动时会自动清理
4. **路径含中文/空格/括号** → NapCat 注入 QQ 对路径极敏感，务必放纯英文路径（如 `E:\RobotConsole`）
</details>

<details>
<summary><b>机器人不回消息</b></summary>

1. `.env` 里 `GROUP_ID` 是否包含该群
2. `messagePostFormat` 必须是 `string`（不是 `array`）
3. 查 `logs/` 下最新日志
4. `FEATURE_AI_CHAT=true` 是否开启
</details>

<details>
<summary><b>消息页/语音页/音乐页一直是空的</b></summary>

功能开关默认关闭。去「工具箱」页打开，或直接在 `.env` 里写：

```ini
FEATURE_MONITOR=true    # 消息记录
FEATURE_TTS=true        # 语音（需 MiniMax Key）
FEATURE_SONG=true       # 点歌（需网易云 cookie）
```
</details>

<details>
<summary><b>QQ 密码自动登录失败</b></summary>

腾讯对人机验证越来越严，密码登录经常要求验证码/滑块。程序会：

1. 先试快速登录（登录态）
2. 再试密码登录
3. 都失败 → 回退二维码登录

**账号被限制时请先在手机 QQ 上解除安全风险**，再扫码登录。

账密配置方式：设置页填写，或写进 `settings.json` 的 `napcatAccount` / `napcatPasswordMd5`
（MD5 是小写 32 位十六进制，注意这是凭据等价物，不要外传）。
</details>

---

## 免责声明

- 本项目仅供学习交流，请勿用于商业用途或违反腾讯服务条款的场景
- QQ 协议端（NapCat）属于第三方逆向工程，使用风险自负
- 请遵守所在地区的法律法规，不要用本工具发送违法或骚扰内容

---

## 许可

[MIT](LICENSE)

---

## 致谢

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) — QQ 协议端
- [NoneBot2](https://github.com/nonebot/nonebot2) — 机器人框架
- [Monaco Editor](https://github.com/microsoft/monaco-editor) / [xterm.js](https://github.com/xtermjs/xterm.js) — 内置编辑器与终端

---

## 作者

**臻煞** · [爱发电](https://ifdian.net/a/fengly)
