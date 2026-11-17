'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEPS = [
  'nonebot2', 'nonebot-adapter-onebot', 'nonebot-plugin-apscheduler',
  'httpx', 'pydantic', 'fastapi', 'uvicorn', 'websockets',
  'psutil', 'Pillow', 'zhipuai', 'requests', 'python-dotenv'
];

function runStream(cmd, args, opts, onLog) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const emit = (d) => { const s = d.toString('utf8'); out += s; onLog && onLog(s); };
    child.stdout.on('data', emit);
    child.stderr.on('data', emit);
    child.on('error', (e) => { onLog && onLog(`[error] ${e.message}\n`); resolve({ code: -1, out }); });
    child.on('exit', (code) => resolve({ code, out }));
  });
}

function detectPython() {
  const candidates = [];
  const add = (p) => p && candidates.push(p);
  // 常见安装路径（Python3 后面直接接版本号，如 Python310）
  for (const v of ['313', '312', '311', '310', '39', '38']) {
    add(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', `Python${v}`, 'python.exe'));
    add(path.join(process.env.ProgramFiles || '', 'Python', `Python${v}`, 'python.exe'));
  }
  add('C:\\Python310\\python.exe');
  add('C:\\Python311\\python.exe');
  add('C:\\Python312\\python.exe');
  add('E:\\python\\Python310\\python.exe');

  for (const p of candidates) {
    if (fs.existsSync(p)) return { path: p, version: '3.x', source: 'path' };
  }
  // 尝试 PATH 里的 python
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      const out = execSync(`${cmd} --version 2>&1`, { encoding: 'utf8', windowsHide: true });
      const m = out.match(/(\d+\.\d+)/);
      if (m && parseFloat(m[1]) >= 3.9) {
        let real = cmd;
        if (cmd === 'py') { try { real = execSync('py -c "import sys;print(sys.executable)"', { encoding: 'utf8', windowsHide: true }).trim(); } catch (e) {} }
        return { path: real, version: m[1], source: 'PATH' };
      }
    } catch (e) {}
  }
  return null;
}

function bundledPythonInstaller(runtimePath) {
  return path.join(runtimePath, 'tools', 'python-3.10.11-amd64.exe');
}

// 自动安装 Python（静默）并安装依赖
async function setupPython(runtimePath, onLog) {
  onLog && onLog('[1/3] 检测 Python 环境...\n');
  let py = detectPython();
  if (!py) {
    const installer = bundledPythonInstaller(runtimePath);
    if (!fs.existsSync(installer)) {
      onLog && onLog('[错误] 未找到内置 Python 安装器，请联网后重试或手动安装 Python 3.10+\n');
      return { ok: false, path: null };
    }
    onLog && onLog('[2/3] 未检测到 Python，正在静默安装内置 Python 3.10.11（约 1-3 分钟）...\n');
    await runStream(installer, ['/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0', 'Include_launcher=1'], {}, onLog);
    py = detectPython();
    if (!py) {
      onLog && onLog('[错误] 安装后仍未检测到 Python，请手动安装并勾选 Add to PATH\n');
      return { ok: false, path: null };
    }
  }
  const python = py.path;
  onLog && onLog(`[OK] 使用 Python: ${python}\n`);
  onLog && onLog('[2/3] 升级 pip...\n');
  await runStream(python, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], {}, onLog);
  onLog && onLog('[3/3] 安装机器人依赖 (nonebot2/httpx/psutil/...)...\n');
  const r = await runStream(python, ['-m', 'pip', 'install', ...DEPS], {}, onLog);
  onLog && onLog(r.code === 0 ? '[完成] Python 环境与依赖安装完成\n' : `[警告] 依赖安装结束，退出码 ${r.code}\n`);
  return { ok: r.code === 0, path: python, version: py.version };
}

module.exports = { detectPython, setupPython, DEPS };
