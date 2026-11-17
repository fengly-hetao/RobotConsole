# 更新日志

## [1.9.0] — 2026-11-17

首个开源版本。汇总此前所有修复。

### ✨ 新增

- **GitHub 更新源**：设置页填仓库地址即可，自动尝试 5 个镜像（官方 raw / gh-proxy / ghproxy / jsDelivr / fastly），国内无需挂代理
- **多源更新回退**：QQ 群文件 → GitHub/网盘，前者失败自动切后者
- **独立识图 Key 配置**：设置页新增「🖼 识图 API Key（智谱 GLM-4V）」，独立于对话模型，选 DeepSeek 也能配智谱识图
- **功能开关自动初始化**：首次启动自动往 `.env` 补齐 `FEATURE_*` 默认值（此前全是关闭状态，导致消息/语音/音乐页面全空）
- **NapCat HTTP API 自动配置**：`onebot11.json` 自动写入 `httpServers`（端口 16200），Q 群更新功能由此可用
- **运行时完整性校验**：启动时检查 5 个关键文件，缺失自动从内置运行时补齐
- **环境诊断工具**：`诊断.bat` 一键检查版本/运行时/进程/端口/配置/Python
- **彻底卸载工具**：`卸载.bat` 清理进程 + 注册表 + 快捷方式，可选删除程序目录与用户数据
- **独立启动器**：`napcat.bat` / `bot.bat` 可脱离主界面单独启动组件

### 🐛 修复

**启动类**
- 修 NapCat 启动失败：`runtime/napcat/node_modules` 缺失导致核心无法加载（表现为无 `NapCat.Core Version` 日志、WebUI 起不来）
- 修 `getBundledPath()` 误用 `node.exe` 作判断依据，导致运行时永远补不全
- 修运行时完整性判断太弱（只看目录存在），复制中断后永久残缺
- 修 `fs.cpSync` 复制 1GB+ 目录静默失败（只复制 625MB/1574MB），改用 robocopy
- 修进程清理误杀：此前会杀掉**所有** `electron.exe`（包括用户的 VS Code、Discord 等），改为只清理程序自身目录
- 修 `napcat.bat` 与 `bot.bat` 互相误杀（`RobotConsole` 目录名含 "bot" 导致正则误匹配）
- 修 killer 只清程序目录、漏掉 `%APPDATA%` 下的运行时，导致残留 QQ 堵住登录态
- 修 PowerShell 脚本经命令行传参时中文路径乱码，改用临时 `.ps1` 文件

**端口类**
- 修端口被 Windows 保留导致绑定失败（EACCES/10013）：新增 `ports.js` 真实 bind 探测，冲突自动顺延并回写配置
- 修 WebUI 端口 6099 落在系统排除段 6002-6101
- 修 bot 端口 8080 落在系统排除段 8070-8169

**消息/功能类**
- 修消息不记录：`monitor` 插件依赖 `FEATURE_MONITOR`，此前 `.env` 从未配置过任何 `FEATURE_*`
- 修 Q 群更新错误被完全吞掉，界面只显示"无更新"
- 修界面不显示更新检查的 error
- 修 `GROUP_ID` 被 pydantic 转成 int 导致 `'int' object has no attribute 'split'`
- 修 4 个 handler 文件缺少 `get_group_ids` 导入
- 修 `messagePostFormat` 为 `array` 导致消息内容解析为空

**其他**
- 修白屏：`signAndEditExecutable` 的 rcedit 改动破坏 exe 渲染；`--use-angle=swiftshader-webgl` 为错误值
- 修智谱余额查询 404（接口已迁移到 `/api/biz/account/query-customer-account-report`）
- 修快捷方式缺少 `Arguments` 参数，双击启动命中白屏
- 修 bat 脚本在含括号路径（如 `新建文件夹 (2)`）下语法报错闪退

### 🔒 安全

- 移除代码中硬编码的 QQ 号与密码 MD5，改为从 `settings.json` 读取（凭证不进版本库）
- `.env` 改为 `.env.example` 模板，所有 Key/QQ/群号留空
- 清理 150+ 个开发调试脚本（含硬编码路径与个人信息）与 1.8GB 旧打包产物

### ⚠️ 已知限制

- 依赖 NapCat 4.18.41 + QQ 9.9.33；更高版 NapCat 与该 QQ 版本不兼容
- QQ 密码登录常被腾讯要求人机验证，无法绕过；账号被限制时需在手机 QQ 解除
- 程序路径含中文/空格/括号时 NapCat 可能注入失败（已内置警告与自动迁移提示）
- 部分模型（MiniMax 等）余额无公开查询接口

---

## 更早版本

1.0.0 – 1.8.14 为内部迭代版本，未公开。
