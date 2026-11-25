'use strict';
// 5 步 QQ 更新向导（主进程侧）
//
// 触发时机（由渲染层发起）：
//   ① 手机扫码登录失败
//   ② NapCat 启动失败 / 打不开 QQ
//   ③ 用户在设置里手动点「检查 QQ 更新」
//
// 5 步流程（每步都要用户点「确定」才继续）：
//   1. 确定更新吗？
//   2. 是否是 QQ 版本太低？
//   3. 是否登录不进去 QQ？
//   4. NapCat 已停止更新且删库，您已无法使用！
//   5. 真的想更新，但 NapCat 已停止维护 —— 我们不得已自研/改用社区方案

const path = require('path');
const fs = require('fs');

// 向导步骤定义（文案在主进程维护，渲染层只负责展示）
const WIZARD_STEPS = [
  {
    id: 'confirm',
    title: '检测到 QQ 可以更新',
    body: '当前 QQ 版本：{local}\n官网最新版本：{latest}（{updateDate}）\n\n是否要更新 QQ？',
    confirmText: '确定，我要更新',
    cancelText: '暂不更新'
  },
  {
    id: 'tooOld',
    title: '第 2 步 · 是否是 QQ 版本太低？',
    body: '很多登录失败都是因为 QQ 版本过低。\n\n你的协议端「{protocol}」需要：{expect}\n当前安装：{local}\n\n是版本太低导致的问题吗？',
    confirmText: '是的，版本太低',
    cancelText: '不是这个原因'
  },
  {
    id: 'cantLogin',
    title: '第 3 步 · 是否登录不进去 QQ？',
    body: '如果出现以下情况，基本可以确认：\n\n· 扫码后没反应 / 一直转圈\n· 提示「请下载最新版 QQ 后重新扫码」\n· 二维码不显示\n· 提示登录态失效、需要重新验证\n\n你遇到的是登录不进去 QQ 吗？',
    confirmText: '是的，登录不进去',
    cancelText: '能登录，只是别的问题'
  },
  {
    id: 'napcatDead',
    title: '第 4 步 · 重要提示',
    body: '⚠️ NapCat 已于 2026-11-14 停止更新并删除仓库。\n\n这意味着：\n· 官方不再提供任何下载\n· 不会再适配新版 QQ\n· 新版 QQ 发布后可能直接失效\n\n你确认继续吗？',
    confirmText: '我明白了，继续',
    cancelText: '取消'
  },
  {
    id: 'solution',
    title: '第 5 步 · 解决方案',
    body: '既然真的需要更新，但 NapCat 已停止维护……\n\n我们不得已只能：\n\n① 先用社区维护的 SnowCat（适配 QQ 9.9.37，V8 通道注入，防封更好）\n② 或继续用 NapCat 4.18.41 搭配 QQ 9.9.33（当前可用，但不再更新）\n\n选择你要走的路：',
    confirmText: '下载新版 QQ 并继续',
    cancelText: '先用着，不更新'
  }
];

// 下载 QQ 安装包到指定目录
async function downloadQQInstaller(options) {
  const https = require('https');
  const http = require('http');
  const { url, destDir, onProgress } = options || {};

  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: '下载地址无效' };
  }
  if (!destDir) return { ok: false, error: '缺少下载目录' };

  fs.mkdirSync(destDir, { recursive: true });

  const fileName = (() => {
    const bn = path.basename(String(url).split('?')[0]);
    return /\.exe$/i.test(bn) ? bn : ('QQ_installer_' + Date.now() + '.exe');
  })();
  const savePath = path.join(destDir, fileName);

  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 60000
    }, (res) => {
      // 跟随重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadQQInstaller(Object.assign({}, options, {
          url: new URL(res.headers.location, url).href
        })));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ ok: false, error: 'HTTP ' + res.statusCode });
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastReport = 0;
      const out = fs.createWriteStream(savePath);

      res.on('data', (chunk) => {
        received += chunk.length;
        out.write(chunk);
        const now = Date.now();
        if (onProgress && now - lastReport > 400) {
          lastReport = now;
          try { onProgress(received, total); } catch (e) {}
        }
      });

      res.on('end', () => {
        out.end(() => {
          if (total > 0 && received !== total) {
            resolve({ ok: false, error: '下载不完整（' + received + '/' + total + '）' });
          } else {
            resolve({ ok: true, path: savePath, size: received, name: fileName });
          }
        });
      });

      res.on('error', (e) => {
        try { out.end(); } catch (err) {}
        resolve({ ok: false, error: e.message });
      });
    });

    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, error: '超时' }); });
  });
}

module.exports = { WIZARD_STEPS, downloadQQInstaller };
