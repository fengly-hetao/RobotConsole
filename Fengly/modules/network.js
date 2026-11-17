'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findFfmpeg(runtimePath) {
  // PATH
  try {
    const out = execSync('where ffmpeg 2>&1', { encoding: 'utf8', windowsHide: true });
    const line = out.split('\n')[0].trim();
    if (line && fs.existsSync(line)) return line;
  } catch (e) {}
  // runtime/tools/ffmpeg/bin
  if (runtimePath) {
    const p = path.join(runtimePath, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
    if (fs.existsSync(p)) return p;
  }
  // 系统常见位置
  const sys = 'C:\\ffmpeg\\bin\\ffmpeg.exe';
  if (fs.existsSync(sys)) return sys;
  return null;
}

// 读取当前网络配置（读取真实配置值，不再强制覆盖）
function readNetworkConfig(runtimePath) {
  const cfg = { webuiPort: 8899, webuiHost: '127.0.0.1', botPort: 18080, botHost: '127.0.0.1', wsUrl: '', proxy: '' };
  try {
    const webui = JSON.parse(fs.readFileSync(path.join(runtimePath, 'napcat', 'config', 'webui.json'), 'utf8'));
    const p = parseInt(webui && webui.port, 10);
    if (Number.isFinite(p) && p > 0) cfg.webuiPort = p;
    cfg.webuiHost = (webui && webui.host) || '127.0.0.1';
  } catch (e) {}
  try {
    const onebot = JSON.parse(fs.readFileSync(path.join(runtimePath, 'napcat', 'config', 'onebot11.json'), 'utf8'));
    const clients = (onebot.network && onebot.network.websocketClients) || [];
    if (clients[0] && clients[0].url) {
      cfg.wsUrl = clients[0].url;
      const m = clients[0].url.match(/ws:\/\/([^:]+):(\d+)/);
      if (m) { cfg.botHost = m[1]; cfg.botPort = parseInt(m[2], 10); }
    }
  } catch (e) {}
  return cfg;
}

// 应用网络配置（自动配置好 WebUI 端口 + 反向 ws 连接 + 代理）
// cfg.webuiPort / cfg.botPort 由调用方通过 ports.findFreePort 探测后传入，这里不再写死。
function applyNetworkConfig(runtimePath, cfg) {
  const results = [];
  const webuiPort = parseInt(cfg && cfg.webuiPort, 10) || 8899;
  const webuiHost = '127.0.0.1';
  const webuiPath = path.join(runtimePath, 'napcat', 'config', 'webui.json');
  try {
    // 读原文件保留其他字段（主题/accessControl 等），只更新 host/port/token
    let webui = { host: webuiHost, port: webuiPort, token: 'tianlu' };
    try {
      const old = JSON.parse(fs.readFileSync(webuiPath, 'utf8'));
      webui = { ...old, host: webuiHost, port: webuiPort, token: 'tianlu' };
    } catch (e) {
      // 文件不存在或损坏，用最小默认
    }
    fs.writeFileSync(webuiPath + '.tmp', JSON.stringify(webui, null, 4), 'utf8');
    try { fs.renameSync(webuiPath + '.tmp', webuiPath); } catch (e) { fs.copyFileSync(webuiPath + '.tmp', webuiPath); }
    results.push({ name: 'WebUI 端口', ok: true, detail: `${webuiHost}:${webuiPort}` });
  } catch (e) { results.push({ name: 'WebUI 端口', ok: false, detail: e.message }); }

  const botPort = parseInt(cfg && cfg.botPort, 10) || 18080;
  const botHost = cfg && cfg.botHost ? cfg.botHost : '127.0.0.1';
  let onebotPath = path.join(runtimePath, 'napcat', 'config', 'onebot11.json');
  try {
    // 改反向 WS：同时同步「无后缀」的 onebot11.json 和「带 QQ 账号后缀」的 onebot11_<uin>.json
    // （NapCat 4.18 MoC 多账号模式：QQ 登录后实际生效的是带 uin 后缀的配置）
    const configDir = path.join(runtimePath, 'napcat', 'config');
    const url = `ws://${botHost}:${botPort}/onebot/v11/ws`;
    let onebotFiles = [];
    try {
      onebotFiles = fs.readdirSync(configDir).filter(f => /^onebot11(_\d+)?\.json$/.test(f));
    } catch (e) { onebotFiles = []; }
    if (!onebotFiles.length) onebotFiles = ['onebot11.json'];

    let synced = 0;
    for (const fname of onebotFiles) {
      const onebotPath = path.join(configDir, fname);
      let onebot;
      try { onebot = JSON.parse(fs.readFileSync(onebotPath, 'utf8')); }
      catch (e) { onebot = { network: { websocketClients: [] } }; }
      if (!onebot.network) onebot.network = {};
      if (!onebot.network.websocketClients) onebot.network.websocketClients = [];
      if (!onebot.network.websocketClients[0]) {
        onebot.network.websocketClients[0] = { enable: true, name: 'tianlu-bot', url, messagePostFormat: 'string' };
      }
      onebot.network.websocketClients[0].url = url;
      onebot.network.websocketClients[0].enable = true;
      // messagePostFormat 必须为 'string'（NoneBot OneBot V11 适配器 2.x 期望 CQ 码字符串；
      // 'array' 会导致消息内容解析为空，机器人收到消息但回复不了）
      onebot.network.websocketClients[0].messagePostFormat = 'string';

      // 同时配置 HTTP API Server：程序里「Q群更新」（读群文件 update.json）
      // 以及群文件列表等主动查询，都要通过 HTTP POST 调 OneBot API。
      // 只监听 127.0.0.1，不对外暴露。
      const apiPort = parseInt(cfg.napcatApiPort, 10) || 16200;
      if (!Array.isArray(onebot.network.httpServers)) onebot.network.httpServers = [];
      if (!onebot.network.httpServers[0]) onebot.network.httpServers[0] = {};
      const hs = onebot.network.httpServers[0];
      hs.enable = true;
      hs.name = hs.name || 'http-api';
      hs.host = '127.0.0.1';
      hs.port = apiPort;
      hs.token = hs.token || '';
      hs.enableCors = true;
      hs.messagePostFormat = 'string';

      fs.writeFileSync(onebotPath + '.tmp', JSON.stringify(onebot, null, 4), 'utf8');
      try { fs.renameSync(onebotPath + '.tmp', onebotPath); } catch (e) { fs.copyFileSync(onebotPath + '.tmp', onebotPath); }
      synced++;
    }
    results.push({ name: '反向 WebSocket', ok: true, detail: `${url}（同步 ${synced} 个配置）` });
    results.push({ name: 'OneBot HTTP API', ok: true, detail: `127.0.0.1:${parseInt(cfg.napcatApiPort, 10) || 16200}（Q群更新用）` });
  } catch (e) { results.push({ name: '反向 WebSocket', ok: false, detail: e.message }); }

  // 机器人端口写回 .env（GUI 改端口同步生效，闭环）
  try {
    const envfileMod = require('./envfile');
    const envPath = path.join(runtimePath, 'tianlu_bot', '.env');
    envfileMod.updateEnv(envPath, { BOT_PORT: String(botPort), BOT_HOST: botHost });
    results.push({ name: '机器人端口同步', ok: true, detail: `${botHost}:${botPort}` });
  } catch (e) { results.push({ name: '机器人端口同步', ok: false, detail: e.message }); }

  // 代理（写入 napcat 配置；本地应用不做防火墙放行）
  try {
    if (cfg.proxy) {
      const napcatPath = path.join(runtimePath, 'napcat', 'config', 'napcat.json');
      const nc = JSON.parse(fs.readFileSync(napcatPath, 'utf8'));
      nc.proxy = cfg.proxy;
      fs.writeFileSync(napcatPath + '.tmp', JSON.stringify(nc, null, 2), 'utf8');
      try { fs.renameSync(napcatPath + '.tmp', napcatPath); } catch (e) { fs.copyFileSync(napcatPath + '.tmp', napcatPath); }
      results.push({ name: '代理', ok: true, detail: cfg.proxy });
    }
  } catch (e) { results.push({ name: '代理', ok: false, detail: e.message }); }

  // 配置同步到所有 NapCat 版本目录（兼容 config 与 napcat/config 两种布局）
  try {
    const versRoot = path.join(runtimePath, 'napcat-versions');
    if (fs.existsSync(versRoot)) {
      for (const v of fs.readdirSync(versRoot)) {
        for (const sub of ['config', path.join('napcat', 'config')]) {
          const vcfg = path.join(versRoot, v, sub);
          if (!fs.existsSync(vcfg)) continue;
          try {
            fs.copyFileSync(webuiPath, path.join(vcfg, 'webui.json'));
            fs.copyFileSync(onebotPath, path.join(vcfg, 'onebot11.json'));
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  return results;
}

module.exports = { findFfmpeg, readNetworkConfig, applyNetworkConfig };
