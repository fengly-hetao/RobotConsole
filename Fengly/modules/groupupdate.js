'use strict';
// 从 QQ 群文件读取 update.json（通过 NapCat 的 OneBot API）
// 依赖：机器人 QQ 已登录（NapCat 在线）
const http = require('http');

function onebotCall(action, params, host, port, token) {
  return new Promise((resolve) => {
    const body = JSON.stringify(params || {});
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request({
      host: host || '127.0.0.1',
      port: port || 16200,
      path: '/' + action,
      method: 'POST',
      headers,
      timeout: 15000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ ok: j.status === 'ok' || j.retcode === 0, data: j.data, raw: j });
        } catch (e) { resolve({ ok: false, error: 'JSON 解析失败' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '超时' }); });
    req.write(body);
    req.end();
  });
}

// 获取群文件列表（根目录）
async function listGroupFiles(groupId, opts = {}) {
  const r = await onebotCall('get_group_root_files', { group_id: Number(groupId) }, opts.host, opts.port, opts.token);
  if (!r.ok) return { ok: false, error: r.error || (r.raw && r.raw.wording) || 'NapCat 未响应' };
  const files = (r.data && r.data.files) || [];
  return { ok: true, files };
}

// 找群里最新的 update.json（按 upload_time 或 file_id 排序）
async function findLatestUpdateJson(groupId, opts = {}) {
  const r = await listGroupFiles(groupId, opts);
  if (!r.ok) return r;
  const candidates = r.files.filter(f => /^update\.json$/i.test(String(f.file_name || '')))
    .sort((a, b) => (b.upload_time || b.modify_time || 0) - (a.upload_time || a.modify_time || 0));
  if (!candidates.length) return { ok: false, error: '群里找不到 update.json' };
  return { ok: true, file: candidates[0], all: candidates };
}

// 拿群文件的下载直链
async function getGroupFileUrl(groupId, fileId, busid, opts = {}) {
  const r = await onebotCall('get_group_file_url', {
    group_id: Number(groupId),
    file_id: String(fileId),
    busid: Number(busid || 102)
  }, opts.host, opts.port, opts.token);
  if (!r.ok) return { ok: false, error: r.error || '取不到文件地址' };
  const url = (r.data && r.data.url) || '';
  if (!url) return { ok: false, error: '下载地址为空' };
  return { ok: true, url };
}

// 完整流程：读取群里的 update.json 内容并解析
async function fetchUpdateFromGroup(groupId, opts = {}) {
  const found = await findLatestUpdateJson(groupId, opts);
  if (!found.ok) return found;
  const f = found.file;
  const urlRes = await getGroupFileUrl(groupId, f.file_id, f.busid, opts);
  if (!urlRes.ok) return urlRes;
  // 下载内容
  try {
    const text = await new Promise((resolve, reject) => {
      const lib = require(urlRes.url.startsWith('https') ? 'https' : 'http');
      lib.get(urlRes.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
    const data = JSON.parse(text);
    return { ok: true, data, file: f };
  } catch (e) {
    return { ok: false, error: '下载/解析 update.json 失败: ' + e.message };
  }
}

module.exports = { onebotCall, listGroupFiles, findLatestUpdateJson, getGroupFileUrl, fetchUpdateFromGroup };
