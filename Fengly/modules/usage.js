'use strict';
// API 用量/余额查询模块：实时查询各大模型的余额
const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function fetchJson(url, options = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const headers = {
      'User-Agent': UA,
      'Accept': 'application/json',
      ...(options.headers || {})
    };
    const req = lib.request(url, { method: options.method || 'GET', headers, timeout: 20000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: body.slice(0, 300) });
        }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: '超时' }); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// DeepSeek 余额
async function queryDeepSeek(apiKey) {
  if (!apiKey) return { ok: false, error: '未配置密钥' };
  const r = await fetchJson('https://api.deepseek.com/user/balance', {
    headers: { 'Authorization': 'Bearer ' + apiKey }
  });
  if (r.status !== 200 || !r.data) return { ok: false, error: r.raw || ('HTTP ' + r.status) };
  const infos = r.data.balance_infos || [];
  const total = infos.reduce((s, i) => s + (parseFloat(i.total_balance) || 0), 0);
  const used = infos.reduce((s, i) => s + (parseFloat(i.topped_up_balance) || 0) - (parseFloat(i.total_balance) || 0), 0);
  // 换算：DeepSeek 余额单位是元，1 元 ≈ 1M tokens（大致，取决于模型）
  return {
    ok: true,
    balance: total,
    currency: r.data.is_available ? 'CNY' : 'CNY',
    detail: infos.map(i => ({ currency: i.currency, balance: i.total_balance }))
  };
}

// 智谱余额
async function queryZhipu(apiKey) {
  if (!apiKey) return { ok: false, error: '未配置密钥' };
  // 智谱余额查询接口（从控制台财务页挖出的真实接口，官方文档未列）
  // GET https://www.bigmodel.cn/api/biz/account/query-customer-account-report
  const r = await fetchJson('https://www.bigmodel.cn/api/biz/account/query-customer-account-report', {
    headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' }
  });
  if (r.status !== 200 || !r.data) return { ok: false, error: r.raw || ('HTTP ' + r.status) };
  // 智谱返回格式：{ data: { balance, availableBalance, ... } } 或 { code, data }
  const d = r.data.data || r.data;
  if (d && typeof d === 'object') {
    const available = parseFloat(d.availableBalance) || parseFloat(d.balance) || 0;
    return {
      ok: true,
      balance: available,
      currency: 'CNY',
      detail: [{
        currency: 'CNY',
        balance: available,
        recharge: d.rechargeAmount,
        give: d.giveAmount,
        spent: d.totalSpendAmount,
        frozen: d.frozenBalance
      }]
    };
  }
  // 旧格式兼容：balance_infos 数组
  const infos = r.data.balance_infos || [];
  const total = infos.reduce((s, i) => s + (parseFloat(i.total_balance) || 0), 0);
  return { ok: true, balance: total, currency: 'CNY', detail: infos.map(i => ({ currency: i.currency, balance: i.balance })) };
}

// MiniMax 余额（接口较特殊，返回可用性提示）
async function queryMiniMax(apiKey) {
  if (!apiKey) return { ok: false, error: '未配置密钥' };
  return { ok: false, error: 'MiniMax 余额需登录网页查看', unsupported: true };
}

// 统一查询入口
async function queryUsage(kind, apiKey) {
  switch (kind) {
    case 'deepseek': return await queryDeepSeek(apiKey);
    case 'zhipu': return await queryZhipu(apiKey);
    case 'minimax': return await queryMiniMax(apiKey);
    default: return { ok: false, error: '未知模型' };
  }
}

module.exports = { queryUsage, queryDeepSeek, queryZhipu, queryMiniMax };
