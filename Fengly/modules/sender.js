'use strict';
// 主页「AI 发送」：控制台输入 → 机器人发到群
//
// 通道：bot 自己的 /console/* 接口（18080，与 nonebot 同端口）
//   为什么不用 NapCat 的 16200：实测 NapCat HTTP Server 会「启动了但没挂到 QQ 会话」，
//   返回空 data。而 bot 的 WebSocket 连接稳定，复用它的发送能力最可靠。
//
// 两种模式：
//   raw —— 原文发送
//   ai  —— 先让模型按机器人人格改写，再发送
// 两种范围：
//   指定群（可多选） / 全部群

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CONSOLE_TOKEN = 'tianlu';

// 调 bot 的控制台接口
function callConsole(port, apiPath, method = 'GET', body = null, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'X-Console-Token': CONSOLE_TOKEN };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      host: '127.0.0.1',
      port: port || 18080,
      path: apiPath,
      method,
      headers,
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const j = JSON.parse(text);
          if (j.ok) return resolve({ ok: true, data: j.data });
          return resolve({ ok: false, error: j.error || '接口返回失败', code: j.code });
        } catch (e) {
          return resolve({ ok: false, error: '返回不是 JSON（bot 可能没启动）: ' + text.slice(0, 100) });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: '连不上机器人（端口 ' + (port || 18080) + '）：' + e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, error: '机器人响应超时' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// 取机器人所在群列表 + 登录信息
async function getStatus(botPort) {
  const login = await callConsole(botPort, '/console/login');
  const groups = await callConsole(botPort, '/console/groups');
  return {
    ok: login.ok && groups.ok,
    botQq: login.ok ? login.data.qq : '',
    botNick: login.ok ? login.data.nickname : '',
    groups: groups.ok ? (groups.data.groups || []) : [],
    error: !login.ok ? login.error : (!groups.ok ? groups.error : '')
  };
}

// 读 .env 里的人格设定
function readPersona(runtimePath) {
  const out = { name: '天禄', persona: '', tone: '' };
  try {
    const p = path.join(runtimePath, 'tianlu_bot', '.env');
    const txt = fs.readFileSync(p, 'utf8');
    const grab = (k) => {
      const m = new RegExp('^\\s*' + k + '\\s*=\\s*(.*)$', 'm').exec(txt);
      return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    };
    out.name = grab('BOT_NAME') || grab('ROBOT_NAME') || '天禄';
    out.persona = grab('PERSONA') || grab('BOT_PERSONA') || grab('BOT_PROFILE') || '';
    out.tone = grab('BOT_TONE') || grab('PERSONA_TONE') || '';
  } catch (e) {}
  return out;
}

// 读模型配置
function readModelConfig(runtimePath) {
  const cfg = { provider: 'deepseek', apiKey: '', baseUrl: '', model: '' };
  try {
    const p = path.join(runtimePath, 'tianlu_bot', '.env');
    const txt = fs.readFileSync(p, 'utf8');
    const grab = (k) => {
      const m = new RegExp('^\\s*' + k + '\\s*=\\s*(.*)$', 'm').exec(txt);
      return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    };
    cfg.provider = grab('MODEL_PROVIDER') || 'deepseek';
    const preset = {
      deepseek: ['DEEPSEEK_API_KEY', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat'],
      zhipu: ['ZHIPU_API_KEY', 'https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-4-flash'],
      moonshot: ['MOONSHOT_API_KEY', 'https://api.moonshot.cn/v1/chat/completions', 'moonshot-v1-8k'],
      qwen: ['QWEN_API_KEY', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-turbo'],
      openai: ['OPENAI_API_KEY', 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini'],
      minimax: ['MINIMAX_API_KEY', '', '']
    };
    const p2 = preset[cfg.provider] || preset.deepseek;
    cfg.apiKey = grab(p2[0]) || grab('API_KEY') || '';
    cfg.baseUrl = grab('API_BASE') || grab('BASE_URL') || p2[1];
    cfg.model = grab('MODEL_NAME') || grab('MODEL') || p2[2];
  } catch (e) {}
  return cfg;
}

// 让模型按人格改写
async function rewriteAsBot(runtimePath, text, instruction) {
  const cfg = readModelConfig(runtimePath);
  const persona = readPersona(runtimePath);

  if (!cfg.apiKey) {
    return { ok: false, error: '没有配置模型 API Key（可在设置页配置，或改用「原文发送」）' };
  }
  if (!cfg.baseUrl) {
    return { ok: false, error: '当前模型不支持改写，请改用「原文发送」' };
  }

  const sys = [
    '你是 QQ 群机器人「' + persona.name + '」。',
    persona.persona ? '你的人格：' + persona.persona : '',
    persona.tone ? '你的语气：' + persona.tone : '',
    '',
    '任务：把用户给你的内容，用你自己的语气发到群里。',
    '要求：',
    '1. 原意不变，不增删事实',
    '2. 用你的人格语气表达，自然口语',
    '3. 长度与原文相当',
    '4. 只输出要发送的正文，不要引号、不要解释',
    instruction ? '5. 额外要求：' + instruction : ''
  ].filter((x) => x !== null).join('\n');

  const payload = JSON.stringify({
    model: cfg.model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: String(text) }
    ],
    temperature: 0.85,
    max_tokens: 800
  });

  return new Promise((resolve) => {
    let url;
    try { url = new URL(cfg.baseUrl); } catch (e) {
      return resolve({ ok: false, error: '接口地址不合法：' + cfg.baseUrl });
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          const j = JSON.parse(body);
          if (j.error) return resolve({ ok: false, error: (j.error.message || JSON.stringify(j.error)).slice(0, 200) });
          const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (!content) return resolve({ ok: false, error: '模型没有返回内容' });
          resolve({ ok: true, text: String(content).trim() });
        } catch (e) {
          resolve({ ok: false, error: '解析模型返回失败：' + body.slice(0, 150) });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, error: '模型调用超时' }); });
    req.write(payload);
    req.end();
  });
}

/**
 * 发送
 * @param {object} o
 * @param {string} o.runtimePath
 * @param {number} o.botPort        bot 端口（18080）
 * @param {string} o.text
 * @param {string[]} o.groups       目标群号；空数组 = 全部群
 * @param {boolean} o.ai            true=AI 改写
 * @param {string} [o.instruction]  额外改写要求
 */
async function send(o) {
  const { runtimePath, botPort, text, groups, ai, instruction } = o || {};
  const res = { ok: false, mode: ai ? 'ai' : 'raw', finalText: '', sent: [], failed: [], total: 0 };

  if (!text || !String(text).trim()) return Object.assign(res, { error: '内容不能为空' });

  // 1) 确认机器人在线
  const st = await getStatus(botPort);
  if (!st.botQq) {
    return Object.assign(res, { error: '机器人未连接：' + (st.error || '请先启动机器人') });
  }
  res.botQq = st.botQq;

  // 2) 决定最终文本
  let finalText = String(text).trim();
  if (ai) {
    const rw = await rewriteAsBot(runtimePath, finalText, instruction);
    if (!rw.ok) return Object.assign(res, { error: 'AI 改写失败：' + rw.error, phase: 'rewrite' });
    finalText = rw.text;
  }
  res.finalText = finalText;

  // 3) 发送
  const r = await callConsole(botPort, '/console/send', 'POST', {
    text: finalText,
    groups: (groups || []).map(String)
  }, 120000);

  if (!r.ok) return Object.assign(res, { error: r.error || '发送失败' });

  res.ok = true;
  res.sent = r.data.sent || [];
  res.failed = r.data.failed || [];
  res.total = r.data.total || res.sent.length;
  return res;
}

module.exports = { getStatus, send, rewriteAsBot, callConsole, readPersona, readModelConfig };
