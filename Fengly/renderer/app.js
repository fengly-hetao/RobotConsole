'use strict';
const bridge = window.api;

/* ============ SVG 图标 ============ */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>',
  webui: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3M12 15h6"/></svg>',
  resources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2L4 14l2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.06-.33.1-.66.1-1z"/></svg>',
  about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 12v4"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.8 2.8 0 0 1 5.6 0c0 2.8-2.8 2.4-2.8 4"/><path d="M12 17h.01"/></svg>'
};

const NAV = [
  { id: 'home', icon: 'home' },        // 首页：一键启动 + 状态总览
  { id: 'webui', icon: 'webui' },      // 网页控制台：NapCat WebUI
  { id: 'plugins', icon: 'config' },   // 插件：NoneBot + NapCat 插件管理
  { id: 'messages', icon: 'about' },   // 消息：聊天记录 + 语音 + 音乐
  { id: 'persona', icon: 'about' },    // 人格：名字/性格/口头禅
  { id: 'toolbox', icon: 'code' },     // 工具：配置/代码/备份/点歌
  { id: 'settings', icon: 'settings' } // 设置：模型/网络/更新/关于
];

const QUOTES = [
  '每一次努力，都是幸运的伏笔。',
  '你所热爱的，就是你的生活。',
  '星光不问赶路人，时光不负有心人。',
  '与其仰望别人，不如点亮自己。',
  '山再高，往上攀，总能登顶。',
  '坚持不是胜利，放弃才是失败。',
  '路虽远，行则将至；事虽难，做则必成。',
  '今天也要元气满满哦！'
];
let quoteTimer = null;
function applyWallpaper(notifyError) {
  const img = new Image();
  img.onload = () => {
    document.body.classList.add('has-wallpaper');
    document.body.style.backgroundImage = "url('/wallpaper.jpg?t=" + Date.now() + "')";
    applyWallStyle();
    try { bridge.setSetting('wpDebug', 'loaded:' + img.naturalWidth + 'x' + img.naturalHeight); } catch (e) {}
  };
  img.onerror = () => {
    document.body.classList.remove('has-wallpaper');
    try { bridge.setSetting('wpDebug', 'error:' + Date.now()); } catch (e) {}
    // 只在用户主动选图失败时提示；启动时无壁纸保持安静（纯色）
    if (notifyError && !state.wallpaperNotified) {
      state.wallpaperNotified = true;
      setTimeout(() => toast(t('settings.wallpaper.badFormat'), 'err'), 1200);
    }
  };
  try { bridge.setSetting('wpDebug', 'start:' + Date.now()); } catch (e) {}
  img.src = '/wallpaper.jpg?t=' + Date.now();
}
function applyWallStyle() {
  const op = Number(state.settings.wallOpacity !== undefined ? state.settings.wallOpacity : 0.45);
  const blur = Number(state.settings.wallBlur || 0);
  const r = document.documentElement;
  r.style.setProperty('--wall-alpha', Math.max(0.2, Math.min(0.95, op)).toString());
  r.style.setProperty('--wall-blur', blur + 'px');
}
function initUpdater() {
  bridge.onUpdateStatus((st) => {
    state.updateInfo = st;
    const banner = document.getElementById('update-banner');
    // 无更新但检查出错：手动检查时告知原因（自动检查不打扰）
    if (st && !st.hasUpdate && st.error && st.manual) {
      toast('更新检查失败：' + st.error, 'err');
      if (banner) banner.classList.add('hidden');
      return;
    }
    if (!banner) return;
    if (st && st.hasUpdate && st.latest) {
      // 用户点过「稍后」的版本不再重复弹
      if (state.dismissedVersion === st.latest) return;
      document.getElementById('update-version').textContent = 'v' + st.latest;
      const notesEl = document.getElementById('update-notes');
      if (notesEl) notesEl.textContent = st.notes || '';
      const urlOk = st.url && /^https?:\/\//i.test(st.url) && !st.url.includes('你的下载链接');
      const goBtn = document.getElementById('btn-update-go');
      if (goBtn) goBtn.style.display = urlOk ? '' : 'none';
      const pageBtn = document.getElementById('btn-update-page');
      if (pageBtn) pageBtn.style.display = urlOk ? 'none' : '';
      // 下载按钮绑定
      if (goBtn && urlOk) {
        goBtn.onclick = async () => {
          goBtn.disabled = true;
          goBtn.textContent = t('update.downloading');
          const prog = document.getElementById('update-progress');
          if (prog) prog.classList.remove('hidden');
          const r = await bridge.downloadUpdate(st.url);
          if (r && r.ok) {
            toast(t('update.downloadedStart'), 'ok');
          } else {
            toast('❌ ' + ((r && r.error) || '下载失败'), 'err');
            goBtn.disabled = false;
            goBtn.textContent = t('update.go');
          }
        };
      }
      if (pageBtn) pageBtn.onclick = () => bridge.openUpdatePage(st.url || 'https://www.123pan.com');
      banner.classList.remove('hidden');
      toast('🎉 ' + t('update.found') + ' v' + st.latest, 'ok');
    } else if (st && st.checking === false && st.manual) {
      toast(t('update.none'), 'ok');
    }
  });
  // 下载进度
  bridge.onUpdateProgress((p) => {
    const bar = document.getElementById('update-bar');
    const txt = document.getElementById('update-progress-text');
    if (bar) bar.style.width = (p.percent || 0) + '%';
    if (txt) txt.textContent = p.text || '';
    if (p.stage === 'ready') {
      const goBtn = document.getElementById('btn-update-go');
      if (goBtn) goBtn.textContent = t('update.installing');
    }
  });
}
function startQuotes() {
  const el = document.getElementById('quote-text');
  if (!el) return;
  // 低配机性能优化：只改文字，不做 opacity/transform 动画（避免每 8 秒强制重排）
  let i = Math.floor(Math.random() * QUOTES.length);
  el.textContent = QUOTES[i % QUOTES.length];
  const show = () => {
    i++;
    el.textContent = QUOTES[i % QUOTES.length];
  };
  if (quoteTimer) clearInterval(quoteTimer);
  quoteTimer = setInterval(show, 15000);
}

const state = {
  settings: null,
  currentPage: '',          // 当前页面（避免同页重复渲染）
  pluginTab: 'nonebot',     // 插件页当前标签
  pluginsData: null,        // 插件列表缓存
  tbEditor: null,          // 工具箱代码编辑器实例
  tbCurrentFile: '',      // 工具箱当前编辑的文件
  appInfo: null,
  runtimePath: '',
  health: null,
  proc: { napcat: { running: false }, bot: { running: false } },
  monaco: null,
  monacoReady: false,
  editor: null,
  currentCodeFile: null,
  term: null,
  termFit: null,
  termSession: null,
  logs: '',
  napLogs: '',
  botLogs: '',
  napTerm: null,
  botTerm: null,
  napFit: null,
  botFit: null,
  configFiles: []
};

/* ============ 工具 ============ */
function h(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function toast(msg, type = 'ok') {
  const root = document.getElementById('toast-root');
  const node = h(`<div class="toast ${type}"><span>${type === 'ok' ? '✅' : '⚠️'}</span><span></span></div>`);
  node.lastElementChild.textContent = msg;
  root.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .3s'; setTimeout(() => node.remove(), 320); }, 2800);
}
function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}
function formatNumber(n) {
  // 千分位，例如 1234567 -> 1,234,567
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtUptime(s) {
  s = Math.floor(s); const d = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); const mm = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${hh}h` : `${hh}h ${mm}m`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function copyText(text) { navigator.clipboard && navigator.clipboard.writeText(text); }

/* ============ 设置应用 ============ */
function applySettings(s) {
  if (!s) return;
  const theme = s.theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s.theme;
  document.documentElement.setAttribute('data-theme', theme || 'dark');
  document.documentElement.style.setProperty('--accent', s.accentColor || '#5BE7FF');
  const accent = s.accentColor || '#5BE7FF';
  const [r, g, b] = hexToRgb(accent);
  document.documentElement.style.setProperty('--accent-2', `hsl(${hue(r,g,b)}, 80%, 60%)`);
  if (s.animations === false) document.body.classList.add('no-anim'); else document.body.classList.remove('no-anim');
  // 软件渲染（虚拟显卡环境）下强制低性能模式：禁用 backdrop-filter/阴影/滤镜/动画等昂贵特效，避免点快了卡顿
  document.body.classList.add('low-perf');
  const fm = { 'default': 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif', '雅黑': '"Microsoft YaHei", sans-serif', '等线': 'DengXian, sans-serif', '宋体': 'SimSun, serif', '楷体': 'KaiTi, serif', '仿宋': 'FangSong, serif', '幼圆': 'YouYuan, sans-serif', '黑体': 'SimHei, sans-serif' };
  document.body.style.fontFamily = fm[s.fontFamily] || fm['default'];
  document.body.style.fontSize = (s.fontSize || 14) + 'px';
  setLang(s.language || 'zh');
}
function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const v = parseInt(m, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function hue(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 340;
  let hh; const d = mx - mn;
  if (mx === r) hh = ((g - b) / d + 6) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
  return Math.round(hh * 60);
}

/* ============ 导航 ============ */
function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  NAV.forEach(n => {
    const btn = h(`<button class="nav-item" data-page="${n.id}"><span class="ic">${ICONS[n.icon]}</span><span data-i18n="nav.${n.id}"></span></button>`);
    btn.addEventListener('click', () => navigate(n.id));
    nav.appendChild(btn);
  });
  setLang(state.settings.language || 'zh');
}
function navigate(page) {
  // 同一页面重复点击直接返回，避免无谓重渲染
  const cur = document.getElementById('page-' + page);
  if (state.currentPage === page && cur && cur.classList.contains('active')) return;
  state.currentPage = page;

  // 高亮与可见性切换（同步、极快）——保证点击立即有反馈
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  if (cur) cur.classList.add('active');

  // 渲染推迟到下一帧：先让高亮画出来，再做重活，点击就不会"顿一下"
  requestAnimationFrame(() => {
    try {
      const fn = PAGE_RENDERERS[page];
      if (fn) fn();
    } catch (e) { console.error('[nav] render ' + page + ' failed', e); }
  });
}

// 页面 → 渲染函数映射（新增页面只需在这里加一行）
const PAGE_RENDERERS = {
  home: () => renderHome(),
  webui: () => renderWebui(),
  messages: () => renderMessages(),
  toolbox: () => renderToolbox(),
  plugins: () => renderPlugins(),
  persona: () => renderPersona(),
  settings: () => renderSettings()
};

/* ============ 首页 ============ */
async function renderHome() {
  const el = document.getElementById('page-home');
  if (el.dataset.ready) { refreshProc(); return; }
  if (!state.sysinfo) { try { state.sysinfo = await bridge.sysInfo(); } catch (e) {} }
  el.innerHTML = `    <div class="home-top-row">
      <div class="card home-mini-card" style="flex:1;min-width:260px">
        <h3>🖥 <span data-i18n="resources.title"></span></h3>
        <div class="res-cards" id="res-cards"></div>
      </div>
      <div class="card home-mini-card" style="flex:1;min-width:260px">
        <h3>📊 <span data-i18n="home.usage"></span> <button class="btn sm ghost" id="btn-usage-refresh-home" style="float:right">🔄</button></h3>
        <div class="usage-tabs" id="usage-tabs-home">
          <button class="usage-tab active" data-model="deepseek">DeepSeek</button>
          <button class="usage-tab" data-model="zhipu">智谱</button>
          <button class="usage-tab" data-model="minimax">MiniMax</button>
        </div>
        <div class="usage-content" id="usage-content-home"><span class="hint" data-i18n="home.usage.loading"></span></div>
      </div>
    </div>
    <div class="card home-launch">
      <div class="oneclick-btn" id="btn-oneclick-home"></div>
      <div class="home-status-row">
        <span class="badge stopped" id="badge-napcat" data-i18n="home.stopped"></span>
        <span class="badge stopped" id="badge-bot" data-i18n="home.stopped"></span>
      </div>
    </div>
    <div class="update-banner hidden" id="update-banner">
      <div style="flex:1;min-width:0">
        <div>🎉 <span data-i18n="update.found"></span> <b id="update-version"></b></div>
        <div id="update-notes" style="font-size:12px;opacity:.75;margin-top:4px"></div>
      </div>
      <span class="btn-row" style="margin:0;flex-shrink:0">
        <button class="btn primary sm" id="btn-update-go" data-i18n="update.go"></button>
        <button class="btn sm ghost" id="btn-update-close" data-i18n="update.later"></button>
      </span>
    </div>
    <div class="home-log-row">
      <div class="card home-log-col" style="flex:1">
        <h3><span class="dot on" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:6px"></span>NapCat <span data-i18n="home.log"></span> <button class="btn sm ghost" id="btn-log-clear-napcat" style="float:right" data-i18n="home.log.clear"></button></h3>
        <div class="log-box light" id="log-box-napcat"></div>
      </div>
      <div class="card home-log-col" style="flex:1">
        <h3><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:6px"></span>Bot <span data-i18n="home.log"></span> <button class="btn sm ghost" id="btn-log-clear-bot" style="float:right" data-i18n="home.log.clear"></button></h3>
        <div class="log-box light" id="log-box-bot"></div>
      </div>
    </div>`;
  setLang(state.settings.language || 'zh');

  // 一键启动大圆圈：点击切换（文字用 CSS 伪元素或内嵌，居中）
  const oneBtn = document.getElementById('btn-oneclick-home');
  oneBtn.innerHTML = '<span class="oneclick-label">▶<br><small>一键启动</small></span>';
  oneBtn.onclick = () => toggleOneclick();
  oneBtn.title = t('home.onekey.hint');

  document.getElementById('btn-log-clear-napcat').onclick = () => clearNapLog();
  document.getElementById('btn-log-clear-bot').onclick = () => clearBotLog();
  document.getElementById('log-box-napcat').innerHTML = state.napLogs ? esc(state.napLogs).replace(/\n/g, '<br>') : '';
  document.getElementById('log-box-bot').innerHTML = state.botLogs ? esc(state.botLogs).replace(/\n/g, '<br>') : '';

  // 系统资源渲染
  renderHomeResources();
  // 用量渲染
  initHomeUsage();

  await Promise.all([refreshProc()]);
}

function renderHomeResources() {
  const box = document.getElementById('res-cards');
  if (!box) return;
  const s = state.sysinfo;
  if (!s) { box.innerHTML = '<span class="hint">' + t('resources.loading') + '</span>'; return; }
  const cards = [
    { label: 'CPU', val: s.cpu.usage.toFixed(0) + '%', pct: s.cpu.usage },
    { label: t('resources.memory'), val: s.memory.usage.toFixed(0) + '%', pct: s.memory.usage },
    { label: t('resources.disk'), val: s.disk.usage.toFixed(0) + '%', pct: s.disk.usage }
  ];
  box.innerHTML = cards.map(c => `
    <div class="res-chip">
      <span class="res-chip-label">${esc(c.label)}</span>
      <span class="res-chip-val">${esc(c.val)}</span>
      <div class="res-bar"><div style="width:${Math.min(100, c.pct)}%"></div></div>
    </div>`).join('');
}

function initHomeUsage() {
  let model = 'deepseek';
  const box = document.getElementById('usage-content-home');
  const setModel = async (m) => {
    model = m;
    document.querySelectorAll('#usage-tabs-home .usage-tab').forEach(t => t.classList.toggle('active', t.dataset.model === m));
    box.innerHTML = '<span class="hint">' + t('home.usage.loading') + '…</span>';
    const r = await bridge.queryUsage(m);
    if (!r) { box.innerHTML = '<span class="hint">❌</span>'; return; }
    if (r.unsupported) { box.innerHTML = `<span class="usage-note">MiniMax 余额需网页查看</span>`; return; }
    if (!r.ok) { box.innerHTML = `<span class="usage-note">${esc(r.error || '未配置密钥')}</span>`; return; }
    const bal = typeof r.balance === 'number' ? r.balance.toFixed(2) : r.balance;
    box.innerHTML = `<span class="usage-big">¥ ${esc(bal)}</span>`;
  };
  document.querySelectorAll('#usage-tabs-home .usage-tab').forEach(t => t.onclick = () => setModel(t.dataset.model));
  document.getElementById('btn-usage-refresh-home').onclick = () => setModel(model);
  setModel('deepseek');
}

function clearNapLog() {
  state.napLogs = '';
  const b = document.getElementById('log-box-napcat');
  if (b) b.innerHTML = '';
}
function clearBotLog() {
  state.botLogs = '';
  const b = document.getElementById('log-box-bot');
  if (b) b.innerHTML = '';
}

function toggleOneclick() {
  const anyRun = (state.proc && state.proc.napcat && state.proc.napcat.running) || (state.proc && state.proc.bot && state.proc.bot.running);
  if (anyRun) {
    bridge.stopNapcat(); bridge.stopBot();
  } else {
    bridge.startNapcat(state.settings.memory).then(() => setTimeout(() => bridge.startBot({}), 1500));
  }
}

async function loadHealth() {
  try {
    state.health = await bridge.healthCheck();
    const list = document.getElementById('health-list');
    if (!list) return;
    const okCount = state.health.items.filter(i => i.ok).length;
    list.innerHTML = state.health.items.map(i => `
      <div class="health-item ${i.ok ? 'ok' : 'bad'}">
        <span class="h-icon">${i.ok ? '✔' : '✘'}</span>
        <span class="h-name">${esc(i.name)}</span>
        <span class="h-detail" title="${esc(i.detail)}">${esc(i.detail)}</span>
      </div>`).join('');
  } catch (e) { console.error(e); }
}

async function refreshProc() {
  state.proc = await bridge.procStatus();
  updateProcUI();
}
function updateProcUI() {
  for (const k of ['napcat', 'bot']) {
    const badge = document.getElementById('badge-' + k);
    const pid = document.getElementById('pid-' + k);
    if (!badge) continue;
    const run = state.proc[k] && state.proc[k].running;
    badge.textContent = run ? t('home.running') : t('home.stopped');
    badge.className = 'badge ' + (run ? 'running' : 'stopped');
    if (pid) pid.textContent = run ? `${t('home.pid')}: ${state.proc[k].pid}` : '';
  }
  // 更新 pid-info 汇总
  const pidInfo = document.getElementById('pid-info');
  if (pidInfo) {
    const n = state.proc.napcat && state.proc.napcat.running ? 'NapCat PID ' + state.proc.napcat.pid : '';
    const b = state.proc.bot && state.proc.bot.running ? 'Bot PID ' + state.proc.bot.pid : '';
    pidInfo.textContent = [n, b].filter(Boolean).join(' · ') || t('home.allStopped');
  }
  const anyRun = state.proc.napcat.running || state.proc.bot.running;
  const dot = document.querySelector('#global-status .dot') || document.querySelector('.status-pill .dot');
  const pill = document.getElementById('global-status');
  if (pill) pill.innerHTML = `<span class="dot ${anyRun ? 'on' : ''}"></span> ${anyRun ? t('status.connected') : t('status.disconnected')}`;
}

function appendLog(kind, data) {
  state.logs += data;
  // 写入对应终端标签
  if (kind === 'napcat') {
    state.napLogs += data;
    if (state.napTerm) state.napTerm.write(data);
    if (state.napLogs.length > 400000) state.napLogs = state.napLogs.slice(-200000);
    const box = document.getElementById('log-box-napcat');
    if (box) {
      appendLogToBox(box, data, false);
    }
  } else if (kind === 'bot') {
    state.botLogs += data;
    if (state.botTerm) state.botTerm.write(data);
    if (state.botLogs.length > 400000) state.botLogs = state.botLogs.slice(-200000);
    const box = document.getElementById('log-box-bot');
    if (box) {
      appendLogToBox(box, data, true);
    }
  }
}

// 追加日志到指定框（节流：避免高频刷 DOM 导致卡顿）
function appendLogToBox(box, data, isBot) {
  const line = esc(data).replace(/\n/g, '<br>');
  box.insertAdjacentHTML('beforeend', `<span class="${isBot ? 'ok' : ''}">${line}</span>`);
  // 限制 DOM 节点数量，超过就整体重写（避免无限堆 DOM 卡死低配机）
  if (box.childElementCount > 2000) {
    box.innerHTML = box.innerHTML.slice(-100000);
  }
  // 用 requestAnimationFrame 延迟滚动，避免高频 scrollTop 写入卡顿
  if (!box._rafPending) {
    box._rafPending = true;
    requestAnimationFrame(() => {
      box.scrollTop = box.scrollHeight;
      box._rafPending = false;
    });
  }
}

/* ============ WebUI ============ */
async function renderWebui() {
  const el = document.getElementById('page-webui');
  if (el.dataset.ready) return;
  const net = await bridge.readNetwork();
  const token = await getWebuiToken();
  // NapCat WebUI 官方支持 ?token= 参数自动登录，免去手动输入
  const base = `http://${net.webuiHost || '127.0.0.1'}:${net.webuiPort}/webui`;
  const loginUrl = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  el.innerHTML = `    <div class="webui-bar">
      <span class="token-box">🔑 <span data-i18n="webui.token"></span> <code id="webui-token">${esc(token || '—')}</code></span>
      <button class="btn sm" id="btn-copy-token" data-i18n="webui.copyToken"></button>
      <button class="btn sm" id="btn-open-webui" data-i18n="webui.open"></button>
      <button class="btn sm" id="btn-reload-webui" data-i18n="common.refresh"></button>
      <span style="color:var(--text-faint);font-size:12px" id="webui-url"></span>
    </div>
    <p class="hint" data-i18n="webui.hint"></p>
    <webview class="webui-frame" id="webview" src="${loginUrl}"></webview>
    <div id="webui-offline" style="display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:360px;padding:28px;text-align:center;border:1px dashed var(--border);border-radius:12px;background:var(--bg-2)">
      <div style="font-size:15px;font-weight:600">NapCat 没有在运行，所以网页控制台连不上</div>
      <div style="font-size:12.5px;color:var(--text-faint);word-break:break-all;max-width:640px" id="webui-offline-detail"></div>
      <div class="btn-row" style="justify-content:center;margin-top:4px">
        <button class="btn primary" id="btn-start-napcat-now">启动 NapCat</button>
        <button class="btn" id="btn-retry-webui">重新连接</button>
      </div>
      <div style="font-size:12px;color:var(--text-faint);max-width:640px;line-height:1.7">
        如果一直起不来，可以用绿色版目录里的 <code>napcat.bat</code> 单独启动 NapCat（窗口里会显示具体原因）。
      </div>
    </div>`;
  setLang(state.settings.language || 'zh');
  document.getElementById('webui-url').textContent = base;
  document.getElementById('btn-copy-token').onclick = () => { copyText(token || ''); toast(t('webui.copied')); };
  document.getElementById('btn-open-webui').onclick = async () => {
    // NapCat 没运行就打开浏览器必然 ERR_CONNECTION_REFUSED：
    // 先确认状态，没起来就先拉起，等 WebUI 真正可访问再打开。
    const openDirect = () => openLinkSafe(loginUrl);
    try {
      const st = await bridge.procStatus();
      if (st && st.napcat && st.napcat.running) { openDirect(); return; }
    } catch (e) { openDirect(); return; }

    toast('NapCat 未运行，正在启动…');
    try { await bridge.startNapcat(state.settings.memory); } catch (e) {}
    let tries = 0;
    const tick = async () => {
      tries++;
      try {
        await fetch(base, { mode: 'no-cors', cache: 'no-store' });
        toast('NapCat 已就绪，正在打开网页控制台');
        openDirect();
        return;
      } catch (e) {
        if (tries < 45) { setTimeout(tick, 1000); return; }
        toast('NapCat 启动超时，请用绿色版目录里的 napcat.bat 查看具体原因', 'err');
      }
    };
    setTimeout(tick, 3000);
  };
  document.getElementById('btn-reload-webui').onclick = () => { try { document.getElementById('webview').reload(); } catch (e) {} };
  el.dataset.ready = '1';
  // NapCat 未运行时 webview 会显示 ERR_CONNECTION_REFUSED；改成友好提示 + 一键启动
  try {
    const wvEl = document.getElementById('webview');
    const offlineBox = document.getElementById('webui-offline');
    const detailEl = document.getElementById('webui-offline-detail');
    const showOffline = (desc) => {
      if (!offlineBox) return;
      offlineBox.style.display = 'flex';
      if (wvEl) wvEl.style.display = 'none';
      if (detailEl) detailEl.textContent = (loginUrl || '') + '  →  ' + desc;
    };
    const showWebview = () => {
      if (!offlineBox) return;
      offlineBox.style.display = 'none';
      if (wvEl) wvEl.style.display = '';
    };
    if (wvEl) {
      wvEl.addEventListener('did-fail-load', (ev) => {
        if (!ev || ev.errorCode === -3 || ev.isMainFrame === false) return; // -3 = 主动取消
        showOffline(ev.errorDescription || ('错误码 ' + ev.errorCode));
      });
      wvEl.addEventListener('did-finish-load', () => { showWebview(); });
    }
    const btnStart = document.getElementById('btn-start-napcat-now');
    if (btnStart) {
      btnStart.onclick = async () => {
        btnStart.disabled = true;
        btnStart.textContent = '正在启动…';
        try { await bridge.startNapcat(state.settings.memory); } catch (e) {}
        let tries = 0;
        const tick = async () => {
          tries++;
          try {
            await fetch(base, { mode: 'no-cors', cache: 'no-store' });
            showWebview();
            try { wvEl.reload(); } catch (e) {}
            btnStart.disabled = false;
            btnStart.textContent = '启动 NapCat';
            return;
          } catch (e) {
            if (tries < 45) { setTimeout(tick, 1000); return; }
            btnStart.disabled = false;
            btnStart.textContent = '再试一次';
            if (detailEl) detailEl.textContent = '启动后仍连不上，请用绿色版目录里的 napcat.bat 查看详细日志。';
          }
        };
        setTimeout(tick, 3000);
      };
    }
    const btnRetry = document.getElementById('btn-retry-webui');
    if (btnRetry) {
      btnRetry.onclick = () => {
        showWebview();
        try { wvEl.reload(); } catch (e) {}
      };
    }
  } catch (e) {}
  // 自动治愈登录缓存：落到登录页 → 清掉旧凭证 → 用 token 重新自动登录（只做一次）
  try {
    const wv = document.getElementById('webview');
    let healed = false;
    wv.addEventListener('did-finish-load', async () => {
      if (healed) return;
      try {
        const href = await wv.executeJavaScript('location.href');
        if (String(href).includes('web_login')) {
          healed = true;
          await wv.executeJavaScript('localStorage.clear()');
          wv.setAttribute('src', loginUrl);
        }
      } catch (e) {}
    });
  } catch (e) {}
  // NapCat 没启动？自动拉起，起来了再刷新网页
  try {
    const st = await bridge.procStatus();
    const napRunning = !!(st && st.napcat && st.napcat.running);
    if (!napRunning) {
      toast(t('webui.autostart'));
      bridge.startNapcat(state.settings.memory);
      // 轮询等待 WebUI 起来（最长 40 秒）
      let tries = 0;
      const poll = async () => {
        tries++;
        try {
          const resp = await fetch(base, { mode: 'no-cors', cache: 'no-store' });
          try { document.getElementById('webview').reload(); } catch (e) {}
        } catch (e) {
          if (tries < 40) setTimeout(poll, 1000);
        }
      };
      setTimeout(poll, 4000);
    }
  } catch (e) {}
}
async function getWebuiToken() {
  try {
    const txt = await bridge.readFile('napcat/config/webui.json');
    const o = JSON.parse(txt); return o.token || '';
  } catch (e) { return ''; }
}


async function openLinkSafe(url) {
  const r = await bridge.openExternal(url);
  if (r && r.ok === false) { toast(r.error || '打不开浏览器链接', 'err'); }
}
/* ============ 配置文件 ============ */
async function renderConfig() {
  const el = document.getElementById('page-config');
  if (!el.dataset.ready) {
    el.innerHTML = `      <div class="config-layout">
        <div class="card file-list" id="config-file-list"></div>
        <div class="card" style="display:flex;flex-direction:column">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <strong id="config-current" style="font-size:13px"></strong>
            <span><button class="btn sm" id="btn-env-add" data-i18n="config.addKey"></button>
            <button class="btn sm primary" id="btn-env-save" data-i18n="config.save"></button></span>
          </div>
          <div id="config-editor" style="flex:1;overflow:auto"></div>
        </div>
      </div>`;
    setLang(state.settings.language || 'zh');
    el.dataset.ready = '1';
  }
  await loadConfigFiles();
}

const CONFIG_PRESETS = [
  { path: 'tianlu_bot/.env', label: '主配置 · API密钥/QQ号/群号' },
  { path: 'tianlu_bot/data/qq.json', label: '人格文件 · 名字与人设' },
  { path: 'tianlu_bot/ai_data/ai_chat.env', label: 'AI对话 · 回复/语音/动作词' },
  { path: 'tianlu_bot/ai_data/core.env', label: '核心 · 冷却/日志/HTTP' },
  { path: 'tianlu_bot/ai_data/handler.env', label: '消息处理 · 白名单/分句' },
  { path: 'tianlu_bot/ai_data/games.env', label: '游戏 · 商店/升级/签到' },
  { path: 'tianlu_bot/ai_data/poke.env', label: '戳一戳回复' },
  { path: 'napcat/config/napcat.json', label: 'NapCat · 主配置' },
  { path: 'napcat/config/onebot11.json', label: 'NapCat · OneBot 网络' },
  { path: 'napcat/config/webui.json', label: 'NapCat · 网页端口/主题' }
];

async function loadConfigFiles() {
  state.configFiles = CONFIG_PRESETS;
  const list = document.getElementById('config-file-list');
  list.innerHTML = state.configFiles.map((f, i) => `
    <div class="file-item ${i === 0 ? 'active' : ''}" data-i="${i}" title="${esc(f.path)}">
      <span class="f-ic">${f.path.includes('.env') ? '🌿' : (f.path.includes('qq.json') ? '🎭' : '🧾')}</span>
      <span><b>${esc(f.label)}</b><br><small style="opacity:.65">${esc(f.path)}</small></span>
    </div>`).join('');
  list.querySelectorAll('.file-item').forEach(item => item.onclick = () => {
    list.querySelectorAll('.file-item').forEach(x => x.classList.remove('active'));
    item.classList.add('active');
    loadConfigEditor(parseInt(item.dataset.i, 10));
  });
  loadConfigEditor(0);
}

async function loadConfigEditor(i) {
  const f = state.configFiles[i].path;
  const label = state.configFiles[i].label;
  const host = document.getElementById('config-editor');
  const cur = document.getElementById('config-current');
  cur.textContent = label + '（' + f + '）';
  document.getElementById('btn-env-add').style.display = f.includes('.env') ? '' : 'none';

  if (f.includes('.env') || f.endsWith('.prod')) {
    const lines = await bridge.readEnv(f);
    host.innerHTML = '<div class="env-editor" id="env-rows"></div>';
    const rows = document.getElementById('env-rows');
    lines.forEach((l, idx) => {
      if (l.type === 'comment' || l.type === 'empty') {
        rows.appendChild(h(`<div class="env-row comment">${esc(l.raw || '')}</div>`));
      } else if (l.type === 'key') {
        rows.appendChild(h(`<div class="env-row" data-k="${esc(l.key)}"><input class="env-key" value="${esc(l.key)}" ${l.key.startsWith('#') ? 'disabled' : ''}><input class="env-val" value="${esc(l.value)}"><button class="del" title="delete">✕</button></div>`));
      } else {
        rows.appendChild(h(`<div class="env-row comment">${esc(l.raw || '')}</div>`));
      }
    });
    rows.querySelectorAll('.del').forEach(d => d.onclick = () => d.parentElement.remove());
    document.getElementById('btn-env-add').onclick = () => {
      rows.appendChild(h(`<div class="env-row"><input class="env-key" placeholder="${t('config.key')}"><input class="env-val" placeholder="${t('config.value')}"><button class="del">✕</button></div>`));
      rows.lastElementChild.querySelector('.del').onclick = () => rows.lastElementChild.remove();
    };
    document.getElementById('btn-env-save').onclick = async () => {
      const entries = {};
      rows.querySelectorAll('.env-row[data-k], .env-row:not(.comment)').forEach(r => {
        const k = r.querySelector('.env-key').value.trim();
        const v = r.querySelector('.env-val').value;
        if (k) entries[k] = v;
      });
      await bridge.writeEnv(f, entries);
      toast(t('config.saved'));
    };
  } else {
    const text = await bridge.readFile(f);
    host.innerHTML = `<div class="code-editor-host" id="json-editor" style="min-height:460px"></div>`;
    ensureMonaco(() => {
      if (state.editor) state.editor.dispose();
      state.editor = monaco.editor.create(document.getElementById('json-editor'), { value: text, language: 'json', theme: document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 13 });
      document.getElementById('btn-env-save').onclick = async () => { await bridge.writeFile(f, state.editor.getValue()); toast(t('config.saved')); };
      document.getElementById('btn-env-add').onclick = () => {};
    });
  }
}

/* ============ 代码编辑器 ============ */
async function renderCode() {
  const el = document.getElementById('page-code');
  if (!el.dataset.ready) {
    el.innerHTML = `      <div class="code-toolbar">
        <button class="btn sm" id="btn-code-open" data-i18n="code.open"></button>
        <button class="btn sm primary" id="btn-code-save" data-i18n="code.save"></button>
        <button class="btn sm" id="btn-code-undo" data-i18n="code.undo"></button>
        <button class="btn sm" id="btn-code-redo" data-i18n="code.redo"></button>
        <span style="width:1px;height:20px;background:var(--border)"></span>
        <button class="btn sm" id="btn-code-export" data-i18n="code.export"></button>
        <button class="btn sm" id="btn-code-import" data-i18n="code.import"></button>
        <button class="btn sm danger" id="btn-code-restore" data-i18n="code.restore"></button>
        <button class="btn sm" id="btn-code-ai" data-i18n="code.ai"></button>
        <span class="code-path" id="code-path" data-i18n="code.select"></span>
      </div>
      <div class="code-layout">
        <div class="card file-list" id="code-file-tree"></div>
        <div class="card" style="display:flex;flex-direction:column">
          <div class="code-editor-host" id="code-editor" style="flex:1;min-height:500px"></div>
        </div>
      </div>`;
    setLang(state.settings.language || 'zh');
    el.dataset.ready = '1';
    ensureMonaco(() => {
      state.editor = monaco.editor.create(document.getElementById('code-editor'), { value: '', language: 'javascript', theme: document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 13 });
      document.getElementById('btn-code-save').onclick = saveCodeFile;
      document.getElementById('btn-code-undo').onclick = () => state.editor.trigger('undo', 'undo');
      document.getElementById('btn-code-redo').onclick = () => state.editor.trigger('redo', 'redo');
      document.getElementById('btn-code-export').onclick = async () => { const r = await bridge.exportCode(); r.ok ? toast('代码已导出：' + (r.path || '')) : (r.canceled || toast('导出失败：' + (r.error || ''), 'err')); };
      document.getElementById('btn-code-import').onclick = async () => { const r = await bridge.importCode(); r.ok ? toast('代码已导入，原代码备份在 backups 目录') : (r.canceled || toast('导入失败：' + (r.error || ''), 'err')); };
      document.getElementById('btn-code-restore').onclick = async () => { const r = await bridge.restoreCode(); r.ok ? toast('已恢复默认代码') : toast('恢复失败：' + (r.error || ''), 'err'); };
      document.getElementById('btn-code-ai').onclick = () => openAiCodeModal();
    });
    document.getElementById('btn-code-open').onclick = async () => {
      const f = await bridge.pickFile();
      if (f && f.path) { state.currentCodeFile = f.path; state.editor.setValue(f.content); document.getElementById('code-path').textContent = f.path; }
    };
  }
  await loadCodeTree();
}

async function loadCodeTree() {
  const tree = document.getElementById('code-file-tree');
  if (!tree) return;
  tree.style.maxHeight = 'calc(100vh - 180px)';
  tree.style.overflowY = 'auto';
  const files = await bridge.listRuntimeFiles('');
  // 只看代码：说明书/日志/缓存/工具等一律排除
  const CODE_EXT = ['.py', '.js', '.mjs', '.cjs', '.ts', '.json', '.yml', '.yaml', '.env', '.toml', '.ini', '.css', '.html', '.bat', '.sh'];
  const SKIP_DIR = new Set(['说明书', '更新说明', '速查错误报告', 'logs', 'cache', 'backups', 'tools', 'static', 'node_modules', '__pycache__', '.git', 'assets', 'images']);
  const roots = files.filter(f => f.type === 'dir' && (f.name === 'tianlu_bot' || f.name === 'napcat'));
  const isSkipPath = (p) => p.split('/').some(seg => SKIP_DIR.has(seg));
  const childrenOf = (p) => files.filter(f => f.path.startsWith(p + '/') && f.path.split('/').length === p.split('/').length + 1);

  // 顶部：常用配置快捷区（配置文件编辑器合并到这里）
  let html = `<div class="file-item dir-toggle" data-path=""><span class="f-ic">📁</span> <b>⚙️ 常用配置</b></div>`;
  CONFIG_PRESETS.forEach((f, i) => {
    html += `<div class="file-item child-code cfg-shortcut" style="padding-left:18px" data-cfg="${esc(f.path)}" title="${esc(f.path)}"><span class="f-ic">${f.path.includes('.env') ? '🌿' : '🎭'}</span> ${esc(f.label)}</div>`;
  });
  html += `<div class="file-item dir-toggle" data-path=""><span class="f-ic">📁</span> 📂 代码文件</div>`;

  const renderDir = (d, depth) => {
    const kids = childrenOf(d.path).filter(k =>
      isSkipPath(k.path) ? false : (k.type === 'dir' ? true : CODE_EXT.some(e => k.name.toLowerCase().endsWith(e)))
    );
    const pad = depth * 16;
    html += `<div class="file-item dir-toggle" data-dir="${esc(d.path)}" style="padding-left:${pad}px"><span class="f-ic">📁</span> ${esc(d.name)}</div>`;
    for (const k of kids) {
      if (k.type === 'dir') renderDir(k, depth + 1);
      else html += `<div class="file-item child-code" style="padding-left:${pad + 18}px" data-file="${esc(k.path)}"><span class="f-ic">📄</span> ${esc(k.name)}</div>`;
    }
  };
  for (const r of roots) renderDir(r, 0);
  tree.innerHTML = html;
  // 常用配置：点击直接打开编辑
  tree.querySelectorAll('.cfg-shortcut').forEach(n => n.onclick = () => openCodeFile(n.dataset.cfg));
  tree.querySelectorAll('[data-file]').forEach(n => n.onclick = () => openCodeFile(n.dataset.file));
  tree.querySelectorAll('[data-path=""]').forEach(n => n.onclick = () => bridge.openRuntimeFolder());
}

async function openCodeFile(rel) {
  const content = await bridge.readFile(rel);
  state.currentCodeFile = rel;
  const lang = rel.endsWith('.py') ? 'python' : rel.endsWith('.json') ? 'json' : rel.endsWith('.js') || rel.endsWith('.mjs') ? 'javascript' : rel.endsWith('.bat') || rel.endsWith('.sh') ? 'shell' : rel.endsWith('.env') ? 'ini' : 'plaintext';
  monaco.editor.setModelLanguage(state.editor.getModel(), lang);
  state.editor.setValue(content);
  document.getElementById('code-path').textContent = rel;
}
async function saveCodeFile() {
  if (!state.currentCodeFile) return toast(t('code.select'), 'err');
  const isExternal = state.currentCodeFile.includes(':\\') || state.currentCodeFile.startsWith('/');
  const r = isExternal
    ? await bridge.writePickedFile(state.currentCodeFile, state.editor.getValue())
    : await bridge.writeFile(state.currentCodeFile, state.editor.getValue());
  if (r && r.ok === false) { toast(r.error || 'save failed', 'err'); return; }
  toast(t('code.saved'));
}

/* ============ Monaco 加载 ============ */
function ensureMonaco(cb) {
  if (state.monacoReady) { cb(); return; }
  if (window.monaco) { state.monacoReady = true; cb(); return; }
  self.MonacoEnvironment = { getWorkerUrl: () => 'vendor/monaco/min/vs/base/worker/workerMain.js' };
  require.config({ paths: { vs: 'vendor/monaco/min/vs' } });
  require(['vs/editor/editor.main'], () => { state.monacoReady = true; cb(); });
}

/* ============ 终端 ============ */
async function initTerminal() {
  const el = document.getElementById('page-terminal');
  if (!el.dataset.ready) {
    el.innerHTML = `      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn sm term-tab active" data-tab="shell" data-i18n="terminal.tabShell"></button>
        <button class="btn sm term-tab" data-tab="napcat" data-i18n="terminal.tabNapcat"></button>
        <button class="btn sm term-tab" data-tab="bot" data-i18n="terminal.tabBot"></button>
        <span style="flex:1"></span>
        <button class="btn sm" id="btn-term-new" data-i18n="terminal.new"></button>
        <button class="btn sm danger" id="btn-term-kill" data-i18n="terminal.kill"></button>
      </div>
      <div class="terminal-host">
        <div id="term-shell" style="width:100%;height:100%"></div>
        <div id="term-napcat" style="width:100%;height:100%;display:none"></div>
        <div id="term-bot" style="width:100%;height:100%;display:none"></div>
      </div>`;
    setLang(state.settings.language || 'zh');
    document.getElementById('btn-term-new').onclick = newTermSession;
    document.getElementById('btn-term-kill').onclick = async () => { if (state.termSession) { await bridge.termKill(state.termSession); state.termSession = null; } };
    document.querySelectorAll('.term-tab').forEach(t => { t.onclick = () => switchTermTab(t.dataset.tab); });
  document.querySelector('.terminal-host').addEventListener('click', () => { if (state.term) state.term.focus(); });
    el.dataset.ready = '1';
  }
  if (state.term) return;
  const mk = (elId, opts) => {
    const t = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'Consolas, monospace', theme: { background: '#05060a' }, scrollback: 8000, ...opts });
    const fit = new FitAddon.FitAddon();
    t.loadAddon(fit);
    t.open(document.getElementById(elId));
    return { t, fit };
  };
  const shell = mk('term-shell', {});
  shell.t.onData(d => {
    // 本地回显：打字立即显示（cmd 已用 /q 关闭自身回显，不会重复）
    state.term.write(d);
    if (state.termSession) bridge.termWrite(state.termSession, d);
  });
  state.term = shell.t; state.termFit = shell.fit;
  const nap = mk('term-napcat', { disableStdin: true });
  const bot = mk('term-bot', { disableStdin: true });
  state.napTerm = nap.t; state.napFit = nap.fit;
  state.botTerm = bot.t; state.botFit = bot.fit;
  nap.t.write('\x1b[33m[只读日志] 这是 NapCat 的运行日志，输入命令请切到「命令行」标签页\x1b[0m\n\n');
  bot.t.write('\x1b[33m[只读日志] 这是机器人的运行日志，输入命令请切到「命令行」标签页\x1b[0m\n\n');
  if (state.napLogs) nap.t.write(state.napLogs);
  if (state.botLogs) bot.t.write(state.botLogs);
  shell.fit.fit();
  window.addEventListener('resize', () => { state.termFit && state.termFit.fit(); });
  await newTermSession();
}
function switchTermTab(tab) {
  document.querySelectorAll('.term-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['shell', 'napcat', 'bot'].forEach(t => {
    const d = document.getElementById('term-' + t);
    if (d) d.style.display = t === tab ? '' : 'none';
  });
  const map = { shell: state.termFit, napcat: state.napFit, bot: state.botFit };
  setTimeout(() => { map[tab] && map[tab].fit(); }, 60);
}

async function newTermSession() {
  if (state.termSession) bridge.termKill(state.termSession);
  state.termSession = await bridge.termCreate();
  if (state.termPreData) { state.term.write(state.termPreData); state.termPreData = ''; }
  state.term && state.term.write('\x1b[32m[命令行终端]\x1b[0m 输入命令后回车，例如：python --version, dir, pip list\n\n');
  state.termFit && state.termFit.fit();
  state.term && state.term.focus();
}

/* ============ 系统资源 ============ */
async function renderResources() {
  if (!state.sysinfo) state.sysinfo = await bridge.sysInfo();
  const el = document.getElementById('page-resources');
  if (!el.dataset.ready) {
    el.innerHTML = `      <div class="grid grid-4" id="res-metrics"></div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card" style="margin-bottom:14px">
          <h3>🐧 <span>QQ 版本与更新</span></h3>
          <p class="hint">检查本地 QQ 版本是否需要更新。NapCat 需要特定 QQ 版本，版本不匹配会导致扫码失败或启动不了。</p>
          <div id="qq-version-info" style="margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--bg-2);font-size:13px">
            <div style="opacity:.7">点「检查版本」获取信息</div>
          </div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn sm primary" id="btn-qq-check">🔄 检查 QQ 版本</button>
            <button class="btn sm" id="btn-qq-wizard">🧭 打开更新向导</button>
          </div>
        </div>
        <div class="card"><h3>🖥 <span data-i18n="resources.os"></span></h3><table class="resource-table" id="res-os"></table></div>
        <div class="card"><h3>🌐 <span data-i18n="resources.interfaces"></span></h3><table class="resource-table" id="res-net"></table></div>
      </div>`;
    setLang(state.settings.language || 'zh');
    el.dataset.ready = '1';
  }
  updateResources();
}
function updateResources(d) {
  if (!document.getElementById('res-metrics')) return;
  if (d) state.sysinfo = d;
  const s = state.sysinfo;
  if (!s) return;
  document.getElementById('res-metrics').innerHTML = `
    <div class="card metric"><span class="m-label">${t('resources.cpu')}</span><span class="m-value">${s.cpu.usage.toFixed(0)}%</span><div class="gauge"><div style="width:${s.cpu.usage}%"></div></div><span class="m-sub">${esc(s.cpu.model)} · ${s.cpu.cores} ${t('resources.cores')}</span></div>
    <div class="card metric"><span class="m-label">${t('resources.memory')}</span><span class="m-value">${s.memory.usage.toFixed(0)}%</span><div class="gauge"><div style="width:${s.memory.usage}%"></div></div><span class="m-sub">${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}</span></div>
    <div class="card metric"><span class="m-label">${t('resources.disk')}</span><span class="m-value">${s.disk.usage.toFixed(0)}%</span><div class="gauge"><div style="width:${s.disk.usage}%"></div></div><span class="m-sub">${fmtBytes(s.disk.free)} free / ${fmtBytes(s.disk.total)}</span></div>
    <div class="card metric"><span class="m-label">${t('resources.network')}</span><span class="m-value">${fmtBytes(s.network.rx + s.network.tx)}</span><div class="gauge"><div style="width:40%"></div></div><span class="m-sub">${t('resources.rx')} ${fmtBytes(s.network.rx)} · ${t('resources.tx')} ${fmtBytes(s.network.tx)}</span></div>`;
  document.getElementById('res-os').innerHTML = `
    <tr><th>${t('resources.os')}</th><td>${esc(s.os.platform)} ${esc(s.os.release)}</td></tr>
    <tr><th>${t('resources.hostname')}</th><td>${esc(s.os.hostname)}</td></tr>
    <tr><th>${t('resources.uptime')}</th><td>${fmtUptime(s.os.uptime)}</td></tr>
    <tr><th>CPU</th><td>${esc(s.cpu.model)}</td></tr>`;
  document.getElementById('res-net').innerHTML = s.interfaces.map(i => `<tr><th>${esc(i.name)}</th><td>${esc(i.address)}</td></tr>`).join('') || `<tr><td>${t('common.none')}</td></tr>`;
}

/* ============ 设置 ============ */
async function renderSettings() {
  const el = document.getElementById('page-settings');
  const s = state.settings;
  let envVals = {};
  try { const lines = await bridge.readEnv('tianlu_bot/.env'); lines.forEach(l => { if (l.type === 'key') envVals[l.key] = l.value; }); } catch (e) {}
  const py = await bridge.detectPython();
  el.innerHTML = `    <div class="card usage-panel" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <h3 style="margin:0">📊 <span data-i18n="settings.usage.title"></span></h3>
        <button class="btn sm ghost" id="btn-usage-refresh" data-i18n="settings.usage.refresh"></button>
      </div>
      <div class="usage-tabs" id="usage-tabs">
        <button class="usage-tab active" data-model="deepseek">DeepSeek</button>
        <button class="usage-tab" data-model="zhipu">智谱 Zhipu</button>
        <button class="usage-tab" data-model="minimax">MiniMax</button>
      </div>
      <div class="usage-content" id="usage-content">
        <p class="hint" data-i18n="settings.usage.loading"></p>
      </div>
    </div>
    <div class="settings-save-bar">
      <button class="btn primary" id="btn-save-all-settings">💾 保存全部设置</button>
      <button class="btn" id="btn-save-restart-bot">🔄 保存并重启机器人</button>
      <span class="hint" id="settings-save-status"></span>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h3>🎨 <span data-i18n="settings.general"></span></h3>
        <div class="field"><label data-i18n="settings.language"></label>
          <select id="set-lang">
            <option value="zh" ${s.language === 'zh' ? 'selected' : ''}>中文 (简体)</option>
            <option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option>
          </select></div>
        <div class="field"><label data-i18n="settings.font"></label>
          <select id="set-font">
            <option value="default"  data-i18n="settings.font.default"></option>
            <option value="雅黑" data-i18n="settings.font.yahei"></option>
            <option value="等线" data-i18n="settings.font.dengxian"></option>
            <option value="宋体" data-i18n="settings.font.song"></option>
            <option value="楷体" data-i18n="settings.font.kai"></option>
            <option value="仿宋" data-i18n="settings.font.fangsong"></option>
            <option value="幼圆" data-i18n="settings.font.youyuan"></option>
            <option value="黑体" data-i18n="settings.font.hei"></option>
          </select></div>
        <div class="field"><label data-i18n="settings.fontSize"></label>
          <input type="range" id="set-fontsize" min="12" max="20" value="14" style="width:100%">
          <small id="fontsize-val">14px</small>
        </div>
        <div class="field"><label data-i18n="settings.theme"></label>
          <select id="set-theme">
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''} data-i18n="settings.theme.dark"></option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''} data-i18n="settings.theme.light"></option>
            <option value="auto" ${s.theme === 'auto' ? 'selected' : ''} data-i18n="settings.theme.auto"></option>
          </select></div>
        <div class="field"><label data-i18n="settings.accent"></label><input type="color" id="set-accent" value="${s.accentColor}"></div>
        <div class="field"><label><input type="checkbox" id="set-anim" ${s.animations !== false ? 'checked' : ''}> <span data-i18n="settings.animations"></span></label></div>
        <div class="field"><label data-i18n="settings.autoStart"></label>
          <label style="display:block;margin-top:4px"><input type="checkbox" id="set-autostart-napcat" ${s.autoStart.napcat ? 'checked' : ''}> <span data-i18n="settings.autoStart.napcat"></span></label>
          <label style="display:block;margin-top:4px"><input type="checkbox" id="set-autostart-bot" ${s.autoStart.bot ? 'checked' : ''}> <span data-i18n="settings.autoStart.bot"></span></label></div>
      </div>
      <div class="card">
        <h3>🖼 <span data-i18n="settings.wallpaper"></span></h3>
        <div class="field">
          <div class="btn-row"><button class="btn sm" id="btn-wall-pick" data-i18n="settings.wallpaper.pick"></button><button class="btn sm ghost" id="btn-wall-clear" data-i18n="settings.wallpaper.clear"></button></div>
        </div>
        <div class="field"><label data-i18n="settings.wallpaper.opacity"></label>
          <input type="range" id="wall-opacity" min="20" max="95" value="55" style="width:100%">
          <small id="wall-opacity-val">55%</small>
        </div>
        <div class="field"><label data-i18n="settings.wallpaper.blur"></label>
          <input type="range" id="wall-blur" min="0" max="16" value="0" style="width:100%">
          <small id="wall-blur-val">0px</small>
        </div>
      </div>
      <div class="card">
        <h3>🔑 <span data-i18n="settings.api"></span></h3>
        <p class="hint" data-i18n="settings.bridge.hint"></p>
        <div class="field" style="padding:10px;border:1px solid var(--accent);border-radius:10px;background:color-mix(in srgb, var(--accent) 8%, transparent)">
          <label data-i18n="settings.modelProvider"></label>
          <select id="set-provider">
            <option value="deepseek" ${envVals.MODEL_PROVIDER === 'deepseek' || !envVals.MODEL_PROVIDER ? 'selected' : ''}>DeepSeek（默认）</option>
            <option value="zhipu" ${envVals.MODEL_PROVIDER === 'zhipu' ? 'selected' : ''}>智谱 GLM</option>
            <option value="qwen" ${envVals.MODEL_PROVIDER === 'qwen' ? 'selected' : ''}>通义千问 Qwen</option>
            <option value="kimi" ${envVals.MODEL_PROVIDER === 'kimi' ? 'selected' : ''}>Kimi 月之暗面</option>
            <option value="doubao" ${envVals.MODEL_PROVIDER === 'doubao' ? 'selected' : ''}>豆包 Doubao</option>
            <option value="hunyuan" ${envVals.MODEL_PROVIDER === 'hunyuan' ? 'selected' : ''}>腾讯混元 Hunyuan</option>
            <option value="spark" ${envVals.MODEL_PROVIDER === 'spark' ? 'selected' : ''}>讯飞星火 Spark</option>
            <option value="ernie" ${envVals.MODEL_PROVIDER === 'ernie' ? 'selected' : ''}>百度文心 ERNIE</option>
            <option value="baichuan" ${envVals.MODEL_PROVIDER === 'baichuan' ? 'selected' : ''}>百川 Baichuan</option>
            <option value="minimax-chat" ${envVals.MODEL_PROVIDER === 'minimax-chat' ? 'selected' : ''}>MiniMax 对话</option>
            <option value="yi" ${envVals.MODEL_PROVIDER === 'yi' ? 'selected' : ''}>零一万物 Yi</option>
            <option value="stepfun" ${envVals.MODEL_PROVIDER === 'stepfun' ? 'selected' : ''}>阶跃星辰 StepFun</option>
            <option value="openai" ${envVals.MODEL_PROVIDER === 'openai' ? 'selected' : ''}>OpenAI GPT</option>
            <option value="groq" ${envVals.MODEL_PROVIDER === 'groq' ? 'selected' : ''}>Groq</option>
            <option value="mistral" ${envVals.MODEL_PROVIDER === 'mistral' ? 'selected' : ''}>Mistral</option>
            <option value="gemini" ${envVals.MODEL_PROVIDER === 'gemini' ? 'selected' : ''}>Google Gemini</option>
            <option value="ollama" ${envVals.MODEL_PROVIDER === 'ollama' ? 'selected' : ''}>Ollama（本地）</option>
            <option value="lmstudio" ${envVals.MODEL_PROVIDER === 'lmstudio' ? 'selected' : ''}>LM Studio（本地）</option>
            <option value="custom" ${envVals.MODEL_PROVIDER === 'custom' ? 'selected' : ''}>自定义（OpenAI 兼容）</option>
          </select>
          <p class="hint" data-i18n="settings.modelProvider.hint"></p>
        </div>
        <div class="field" id="current-model-key-field">
          <label id="current-model-key-label">API Key</label>
          <input type="password" id="set-current-key" placeholder="当前模型的 API Key">
        </div>
        <div class="field" id="custom-model-fields" style="display:none">
          <label>自定义 · Base URL</label>
          <input type="text" id="set-custom-url" placeholder="https://api.xxx.com/v1">
          <label style="margin-top:8px">自定义 · 模型名</label>
          <input type="text" id="set-custom-model" placeholder="model-name">
        </div>
        <div class="field" style="padding:10px;border:1px solid var(--border);border-radius:10px;background:color-mix(in srgb, var(--accent) 5%, transparent)">
          <label>🖼 识图 API Key（智谱 GLM-4V）</label>
          <input type="password" id="set-zhipu-vision" value="${esc(envVals.ZHIPU_API_KEY || '')}" placeholder="识别图片专用，和上面的对话模型互不影响">
          <p class="hint">客户/群里发图片时，用智谱 <code>glm-4v-flash</code> 识别图片内容。这一项<span style="color:var(--accent)">独立于对话模型</span>：上面选 DeepSeek 也能配智谱识图。留空则关闭识图。</p>
          <div class="btn-row" style="margin-top:6px">
            <span style="font-size:12px;color:var(--text-faint)">获取：</span>
            <button class="btn-link" id="btn-open-zhipu">open.bigmodel.cn → API 密钥</button>
          </div>
        </div>
        <div class="field"><label data-i18n="settings.minimaxKey"></label><input type="password" id="set-minimax" value="${esc(envVals.MINIMAX_API_KEY || '')}" placeholder="语音用（可选）"></div>
        <div class="field"><label data-i18n="settings.minimaxVoice"></label><input type="text" id="set-voice" value="${esc(envVals.MINIMAX_VOICE_ID || '')}"></div>
        <div class="field"><label data-i18n="settings.owner"></label><input type="text" id="set-owner" value="${esc(envVals.OWNER_ID || '')}"></div>
        <div class="field"><label data-i18n="settings.botqq"></label><input type="text" id="set-botqq" value="${esc(envVals.BOT_QQ || '')}"></div>
        <div class="field"><label data-i18n="settings.group"></label><input type="text" id="set-group" value="${esc(envVals.GROUP_ID || '')}"></div>
      </div>
      <div class="card">
        <h3>🧠 <span data-i18n="settings.memory"></span></h3>
        <div class="field"><label data-i18n="settings.nodeMem"></label><input type="number" id="set-nodeMem" value="${s.memory.nodeMaxOldSpace}" min="256" step="256"></div>
        <h3 style="margin-top:16px">🐍 <span data-i18n="settings.python"></span></h3>
        <div class="field"><label data-i18n="settings.pythonPath"></label><input type="text" id="set-py" value="${esc(s.bot.pythonPath || (py && py.path) || '')}" placeholder="python"></div>
        <p class="hint" id="py-status">${py ? '✅ ' + py.path : '⚠️ ' + t('common.none')}</p>
        <div class="btn-row">
          <button class="btn sm" id="btn-py-detect" data-i18n="settings.python.detect"></button>
          <button class="btn sm primary" id="btn-py-setup" data-i18n="settings.python.setup"></button>
        </div>
      </div>
      <div class="card">
        <h3>🛡 <span data-i18n="settings.security"></span></h3>
        <p class="hint" data-i18n="settings.security.hint"></p>
        <div id="sec-status" class="health-list"></div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn sm primary" id="btn-sec-apply" data-i18n="settings.security.apply"></button>
          <button class="btn sm ghost" id="btn-sec-refresh" data-i18n="feedback.refresh"></button>
        </div>
      </div>
      <div class="card">
        <h3>🌐 <span data-i18n="settings.network"></span></h3>
        <div class="field"><label data-i18n="settings.webuiPort"></label><input type="number" id="set-webuiPort" value="${s.webui.port}"></div>
        <div class="field"><label data-i18n="settings.botPort"></label><input type="number" id="set-botPort" value="${s.bot.port}"></div>
        <div class="field"><label data-i18n="settings.proxy"></label><input type="text" id="set-proxy" value="${esc(s.network.proxy || '')}" placeholder="http://127.0.0.1:7890"></div>
        <div class="field"><label><input type="checkbox" id="set-net-auto" ${s.network.autoConfig ? 'checked' : ''}> <span data-i18n="settings.network.auto"></span></label></div>
        <div class="btn-row">
          <button class="btn sm primary" id="btn-net-apply" data-i18n="settings.apply"></button>
          <button class="btn sm danger" id="btn-reset" data-i18n="settings.reset"></button>
        </div>
        <div class="field" style="margin-top:12px"><label>📢 更新群号（推荐）</label>
          <input type="text" id="set-update-group" value="${esc(s.updateGroupId || '')}" placeholder="例如 1095121023">
          <p class="hint">把 update.json 发到该群文件，程序自动读取最新版本（机器人需在线）</p>
        </div>
        <div class="field" style="margin-top:12px"><label data-i18n="update.source"></label>
          <input type="text" id="set-update-url" value="${esc(s.updateUrl || '')}" placeholder="https://github.com/你的用户名/仓库">
          <p class="hint">可以填 <b>GitHub 仓库地址</b>（如 <code>https://github.com/user/repo</code>，自动在仓库根目录找 update.json，并自动尝试国内镜像 —— <b>不用挂代理/节点</b>）、update.json 直链、或放 update.json 的目录。</p>
          <p class="hint" data-i18n="update.sourceHint"></p>
          <div class="btn-row"><button class="btn sm" id="btn-check-update" data-i18n="update.check"></button></div>
        </div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>🧑‍💻 <span data-i18n="settings.developer"></span></h3>
        <p class="hint" data-i18n="settings.developer.hint"></p>
        <div class="btn-row">
          <button class="btn primary" id="btn-open-code">📝 <span data-i18n="settings.developer.openCode"></span></button>
          <button class="btn" id="btn-open-terminal">⌨️ <span data-i18n="settings.developer.openTerminal"></span></button>
        </div>
      </div>
      <div class="card">
        <h3>💖 <span data-i18n="settings.donate"></span></h3>
        <p class="hint" data-i18n="settings.donate.hint"></p>
        <div class="btn-row">
          <button class="btn primary" id="btn-donate">❤️ <span data-i18n="settings.donate.go"></span></button>
        </div>
      </div>
    </div>`;
  setLang(state.settings.language || 'zh');
  const _wo = document.getElementById('wall-opacity');
  const _wb = document.getElementById('wall-blur');
  if (_wo) { _wo.value = Math.round((s.wallOpacity !== undefined ? s.wallOpacity : 0.55) * 100); document.getElementById('wall-opacity-val').textContent = _wo.value + '%'; }
  if (_wb) { _wb.value = s.wallBlur || 0; document.getElementById('wall-blur-val').textContent = _wb.value + 'px'; }
  const _ft = document.getElementById('set-font');
  const _fs = document.getElementById('set-fontsize');
  if (_ft) { _ft.value = s.fontFamily || 'default'; }
  if (_fs) { _fs.value = s.fontSize || 14; document.getElementById('fontsize-val').textContent = _fs.value + 'px'; }

  // ===== 安全白名单 =====
  const renderSec = async () => {
    const st = await bridge.secStatus();
    const box = document.getElementById('sec-status');
    if (!box) return;
    const avNames = (st.avs || []).join('、');
    let html = '';
    html += '<div class="health-item ' + (st.defenderOk ? 'ok' : 'warn') + '"><span class="h-icon">' + (st.defenderOk ? '✅' : '⚠️') + '</span><span class="h-name">Windows Defender 白名单：' + (st.defenderOk ? '已排除 ' + st.covered.length + ' 个目录' : '未完全排除（' + st.covered.length + '/' + st.total + '）') + '</span></div>';
    html += '<div class="health-item ' + (avNames ? 'warn' : 'ok') + '"><span class="h-icon">' + (avNames ? '🛡' : '✅') + '</span><span class="h-name">' + (avNames ? '检测到第三方杀毒：' + avNames + '（点下方按钮自动尝试，或手动加信任）' : '未检测到第三方杀毒软件') + '</span></div>';
    box.innerHTML = html;
  };
  renderSec();
  document.getElementById('btn-sec-apply').onclick = async () => {
    toast('正在申请系统白名单（会弹 UAC 授权窗口，请点「是」）…');
    const r = await bridge.secWhitelist();
    if (r && r.ok) { toast('✅ 已加入系统白名单', 'ok'); }
    else { toast('❌ ' + (r && r.error ? r.error : '加入失败，请检查是否点了「是」'), 'err'); }
    renderSec();
  };
  document.getElementById('btn-sec-refresh').onclick = () => renderSec();

  // ===== 用量面板 =====
  let currentUsageModel = 'deepseek';
  const usageModels = { deepseek: 'DeepSeek', zhipu: '智谱', minimax: 'MiniMax' };
  const usageContent = document.getElementById('usage-content');
  const renderUsage = async (model) => {
    if (!usageContent) return;
    usageContent.innerHTML = '<p class="hint">⏳ ' + t('settings.usage.loading') + ' ' + usageModels[model] + '…</p>';
    const r = await bridge.queryUsage(model);
    if (!r) { usageContent.innerHTML = '<p class="hint">❌ 查询失败</p>'; return; }
    if (r.unsupported) {
      usageContent.innerHTML = `<div class="usage-row"><div class="usage-label">${usageModels[model]}</div><div class="usage-val">—</div><div class="usage-note">MiniMax 余额需登录网页查看</div><button class="btn sm ghost" data-url="https://platform.minimaxi.com/user-center/basic-information/balance">查看余额</button></div>`;
      document.querySelectorAll('#usage-content button[data-url]').forEach(b => b.onclick = () => openLinkSafe(b.dataset.url));
      return;
    }
    if (!r.ok) {
      usageContent.innerHTML = `<div class="usage-row"><div class="usage-label">${usageModels[model]}</div><div class="usage-val">❌</div><div class="usage-note">${esc(r.error || '查询失败')}</div></div>`;
      return;
    }
    // 显示余额（元）
    const bal = typeof r.balance === 'number' ? r.balance.toFixed(2) : r.balance;
    // 估算 token：1元 ≈ 1M tokens（粗略）
    const estTokens = typeof r.balance === 'number' && r.balance > 0 ? (r.balance * 1000000).toFixed(0) : '—';
    usageContent.innerHTML = `
      <div class="usage-row">
        <div class="usage-label">${usageModels[model]} · 余额</div>
        <div class="usage-val">¥ ${esc(bal)}</div>
        <div class="usage-note">≈ ${esc(estTokens === '—' ? '—' : formatNumber(estTokens))} tokens</div>
      </div>`;
  };
  const switchUsage = (model) => {
    currentUsageModel = model;
    document.querySelectorAll('.usage-tab').forEach(t => t.classList.toggle('active', t.dataset.model === model));
    renderUsage(model);
  };
  document.querySelectorAll('.usage-tab').forEach(t => {
    t.onclick = () => switchUsage(t.dataset.model);
  });
  document.getElementById('btn-usage-refresh').onclick = () => renderUsage(currentUsageModel);
  renderUsage('deepseek');

  // ===== 模型切换动态逻辑：切换 provider 显示对应密钥框 =====
  const providerNames = {
    deepseek: 'DeepSeek', zhipu: '智谱 GLM', qwen: '通义千问', kimi: 'Kimi',
    doubao: '豆包', hunyuan: '腾讯混元', spark: '讯飞星火', ernie: '百度文心',
    baichuan: '百川', 'minimax-chat': 'MiniMax 对话', yi: '零一万物', stepfun: '阶跃星辰',
    openai: 'OpenAI', groq: 'Groq', mistral: 'Mistral', gemini: 'Gemini',
    ollama: 'Ollama', lmstudio: 'LM Studio', custom: '自定义'
  };
  // provider -> .env 里的 key 前缀（映射到 envVals 的键）
  const providerKeyMap = {
    deepseek: 'DEEPSEEK_API_KEY', zhipu: 'ZHIPU_API_KEY', qwen: 'QWEN_API_KEY', kimi: 'KIMI_API_KEY',
    doubao: 'DOUBAO_API_KEY', hunyuan: 'HUNYUAN_API_KEY', spark: 'SPARK_API_KEY', ernie: 'ERNIE_API_KEY',
    baichuan: 'BAICHUAN_API_KEY', 'minimax-chat': 'MINIMAX_CHAT_API_KEY', yi: 'YI_API_KEY', stepfun: 'STEPFUN_API_KEY',
    openai: 'OPENAI_API_KEY', groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY', gemini: 'GEMINI_API_KEY',
    ollama: '', lmstudio: '', custom: 'CUSTOM_API_KEY'
  };
  const updateProviderUI = () => {
    const p = document.getElementById('set-provider').value;
    const label = document.getElementById('current-model-key-label');
    const keyInput = document.getElementById('set-current-key');
    const customFields = document.getElementById('custom-model-fields');
    if (label) label.textContent = (providerNames[p] || p) + ' API Key';
    // 加载该 provider 已保存的 key
    const envKey = providerKeyMap[p];
    if (keyInput) keyInput.value = envKey && envVals[envKey] ? envVals[envKey] : '';
    // 本地模型（ollama/lmstudio）不需要 key，隐藏 key 框
    if (p === 'ollama' || p === 'lmstudio') {
      document.getElementById('current-model-key-field').style.display = 'none';
    } else {
      document.getElementById('current-model-key-field').style.display = '';
    }
    // 自定义模型显示 base_url + model 输入
    if (p === 'custom') {
      customFields.style.display = '';
      document.getElementById('set-custom-url').value = envVals.CUSTOM_BASE_URL || '';
      document.getElementById('set-custom-model').value = envVals.CUSTOM_MODEL || '';
    } else {
      customFields.style.display = 'none';
    }
  };
  document.getElementById('set-provider').onchange = updateProviderUI;
  updateProviderUI();
  // 识图 Key 获取入口
  try {
    const vz = document.getElementById('btn-open-zhipu');
    if (vz) vz.onclick = () => openLinkSafe('https://open.bigmodel.cn/usercenter/apikeys');
  } catch (e) {}

  document.getElementById('btn-py-detect').onclick = async () => { const p = await bridge.detectPython(); document.getElementById('set-py').value = p ? p.path : ''; document.getElementById('py-status').textContent = p ? '✅ ' + p.path : '⚠️ 未检测到'; };
  document.querySelectorAll('button[data-url]').forEach(b => { b.onclick = () => openLinkSafe(b.dataset.url); });
  document.getElementById('btn-py-setup').onclick = () => { toast(t('home.setup.python') + '…'); bridge.setupPython().then(r => { toast(r.ok ? 'Python OK' : 'Python 配置完成（有警告）', r.ok ? 'ok' : 'err'); renderSettings(); }); };
  // QQ 版本检查按钮
  const qqCheckBtn = document.getElementById('btn-qq-check');
  if (qqCheckBtn) {
    qqCheckBtn.onclick = async () => {
      const box = document.getElementById('qq-version-info');
      if (box) box.innerHTML = '<span style="opacity:.7">正在检查…</span>';
      qqCheckBtn.disabled = true;
      const r = await bridge.qqCheck({ protocol: 'NapCat 4.18.41' });
      qqCheckBtn.disabled = false;
      if (!r || !r.ok) {
        if (box) box.innerHTML = '<span style="color:var(--err)">检查失败：' + esc((r && r.error) || '未知错误') + '</span>';
        return;
      }
      const local = (r.local && r.local.version) || '未知';
      const compat = r.compat || {};
      const statusColor = r.needUpdate ? 'var(--warn, #f5b942)' : 'var(--ok, #6fdd8f)';
      const statusText = r.needUpdate ? ('有新版 ' + r.latest + '，建议更新') : '已是最新版本';
      if (box) box.innerHTML =
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>当前版本</span><b>' + esc(local) + '</b></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>官网最新</span><b>' + esc(r.latest || '未知') + '</b>' + (r.updateDate ? ' <small style=\"opacity:.6\">(' + esc(r.updateDate) + ')</small>' : '') + '</div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>状态</span><b style=\"color:' + statusColor + '\">' + esc(statusText) + '</b></div>' +
        '<div style="display:flex;justify-content:space-between"><span>协议端兼容</span><b style=\"color:' + (compat.ok ? 'var(--ok,#6fdd8f)' : 'var(--err)') + '\">' + (compat.ok ? '兼容' : '不兼容') + '</b></div>' +
        (compat.note ? '<div style=\"opacity:.6;font-size:11.5px;margin-top:6px\">' + esc(compat.note) + '</div>' : '');
      state.qqCheckResult = r;
    };
  }
  const qqWizBtn = document.getElementById('btn-qq-wizard');
  if (qqWizBtn) qqWizBtn.onclick = () => openQQWizard('manual');
  document.getElementById('btn-net-apply').onclick = async () => {
    const cfg = { webuiPort: +document.getElementById('set-webuiPort').value, botPort: +document.getElementById('set-botPort').value, webuiHost: '127.0.0.1', botHost: '127.0.0.1', proxy: document.getElementById('set-proxy').value };
    const results = await bridge.applyNetwork(cfg);
    toast(t('settings.applied'));
    console.log(results);
  };
  document.getElementById('btn-reset').onclick = async () => { await bridge.resetSettings(); state.settings = await bridge.getSettings(); renderSettings(); };
  // 开发者选项 + 爱发电
  const btnOpenCode = document.getElementById('btn-open-code');
  if (btnOpenCode) btnOpenCode.onclick = () => navigate('code');
  const btnOpenTerminal = document.getElementById('btn-open-terminal');
  if (btnOpenTerminal) btnOpenTerminal.onclick = () => navigate('code');
  const btnDonate = document.getElementById('btn-donate');
  if (btnDonate) btnDonate.onclick = () => openLinkSafe('https://ifdian.net/a/fengly');
  document.getElementById('btn-wall-pick').onclick = async () => {
    const r = await bridge.pickImage();
    if (r && r.ok) { toast(t('settings.wallpaper.done')); applyWallpaper(true); }
    else if (r && r.error) { toast(t('settings.wallpaper.fail') + r.error, 'err'); }
  };
  document.getElementById('wall-opacity').oninput = () => {
    const el = document.getElementById('wall-opacity');
    const v = +el.value / 100;
    document.getElementById('wall-opacity-val').textContent = el.value + '%';
    state.settings.wallOpacity = v;
    bridge.setSetting('wallOpacity', v);
    applyWallStyle();
  };
  document.getElementById('wall-blur').oninput = () => {
    const el = document.getElementById('wall-blur');
    const v = +el.value;
    document.getElementById('wall-blur-val').textContent = v + 'px';
    state.settings.wallBlur = v;
    bridge.setSetting('wallBlur', v);
    applyWallStyle();
  };
  if (_ft) _ft.onchange = () => { const v = _ft.value; state.settings.fontFamily = v; bridge.setSetting('fontFamily', v); applySettings(state.settings); };
  if (_fs) _fs.oninput = () => { const v = +_fs.value; document.getElementById('fontsize-val').textContent = v + 'px'; state.settings.fontSize = v; bridge.setSetting('fontSize', v); applySettings(state.settings); };
  document.getElementById('btn-wall-clear').onclick = async () => {
    await bridge.clearWallpaper();
    document.body.classList.remove('has-wallpaper');
    document.body.style.backgroundImage = '';
    toast(t('settings.wallpaper.cleared'));
  };
  document.getElementById('btn-check-update').onclick = async () => {
    await bridge.setSettings({
      updateUrl: document.getElementById('set-update-url').value.trim(),
      updateGroupId: document.getElementById('set-update-group').value.trim()
    });
    toast(t('update.checking'));
    const r = await bridge.checkUpdate();
    if (r && r.hasUpdate) toast(t('update.found') + ' v' + r.latest + (r.source === 'qqgroup' ? '（来自群文件）' : ''), 'ok');
    else if (r && r.error) toast(t('update.fail') + r.error, 'err');
    else toast(t('update.none'), 'ok');
  };

  const saveGen = async () => {
    const s2 = {
      language: document.getElementById('set-lang').value,
      fontFamily: document.getElementById('set-font') ? document.getElementById('set-font').value : 'default',
      fontSize: document.getElementById('set-fontsize') ? +document.getElementById('set-fontsize').value : 14,
      theme: document.getElementById('set-theme').value,
      accentColor: document.getElementById('set-accent').value,
      animations: document.getElementById('set-anim').checked,
      updateUrl: document.getElementById('set-update-url').value.trim(),
      updateGroupId: document.getElementById('set-update-group') ? document.getElementById('set-update-group').value.trim() : '',
      memory: { nodeMaxOldSpace: +document.getElementById('set-nodeMem').value || 2048 },
      bot: { pythonPath: document.getElementById('set-py').value },
      webui: { port: +document.getElementById('set-webuiPort').value || 8899 },
      botPort: undefined,
      autoStart: { napcat: document.getElementById('set-autostart-napcat').checked, bot: document.getElementById('set-autostart-bot').checked }
    };
    // 写入 .env：只写当前选中模型的 key（用前缀映射），其它模型的 key 保留不动
    const curProvider = document.getElementById('set-provider').value;
    const providerKeyMap2 = {
      deepseek: 'DEEPSEEK_API_KEY', zhipu: 'ZHIPU_API_KEY', qwen: 'QWEN_API_KEY', kimi: 'KIMI_API_KEY',
      doubao: 'DOUBAO_API_KEY', hunyuan: 'HUNYUAN_API_KEY', spark: 'SPARK_API_KEY', ernie: 'ERNIE_API_KEY',
      baichuan: 'BAICHUAN_API_KEY', 'minimax-chat': 'MINIMAX_CHAT_API_KEY', yi: 'YI_API_KEY', stepfun: 'STEPFUN_API_KEY',
      openai: 'OPENAI_API_KEY', groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY', gemini: 'GEMINI_API_KEY',
      ollama: '', lmstudio: '', custom: 'CUSTOM_API_KEY'
    };
    const env = {
      MODEL_PROVIDER: curProvider,
      MINIMAX_API_KEY: document.getElementById('set-minimax').value,
      MINIMAX_VOICE_ID: document.getElementById('set-voice').value,
      OWNER_ID: document.getElementById('set-owner').value,
      BOT_QQ: document.getElementById('set-botqq').value,
      GROUP_ID: document.getElementById('set-group').value
    };
    // 识图专用 Key（智谱 GLM-4V）—— 独立于对话模型，选 DeepSeek 也能配
    const visionKeyEl = document.getElementById('set-zhipu-vision');
    const visionKey = visionKeyEl ? visionKeyEl.value.trim() : '';
    if (visionKey) env.ZHIPU_API_KEY = visionKey;

    // 当前模型的 key 写入对应键
    const curKeyEnv = providerKeyMap2[curProvider];
    if (curKeyEnv) {
      const curKey = document.getElementById('set-current-key').value.trim();
      if (curKeyEnv === 'ZHIPU_API_KEY') {
        // 智谱既做对话又做识图，共用一个变量：任一非空即生效
        env.ZHIPU_API_KEY = curKey || env.ZHIPU_API_KEY || '';
      } else {
        env[curKeyEnv] = curKey;
      }
    }
    // 自定义模型额外写 base_url / model
    if (curProvider === 'custom') {
      env.CUSTOM_BASE_URL = document.getElementById('set-custom-url').value;
      env.CUSTOM_MODEL = document.getElementById('set-custom-model').value;
    }
    await bridge.writeEnv('tianlu_bot/.env', env);
    const netObj = { webuiPort: +document.getElementById('set-webuiPort').value || 8899, botPort: +document.getElementById('set-botPort').value || 18080, proxy: document.getElementById('set-proxy').value };
    s2.bot.port = netObj.botPort;
    state.settings = await bridge.setSettings(s2);
    await bridge.setSettings({ network: { proxy: netObj.proxy } });
    applySettings(state.settings);
    // 自定义图片（用户放在 assets/ 下，缺省自动回退默认样式）
    const _logo = new Image();
    _logo.onload = () => { const d = document.getElementById('logo-dot'); if (d) d.innerHTML = '<img src="assets/logo.png" style="width:100%;height:100%;object-fit:contain;border-radius:12px">'; };
    _logo.src = 'assets/logo.png';
    const _bg = new Image();
    _bg.onload = () => { document.body.style.backgroundImage = "url('assets/background.jpg')"; document.body.style.backgroundSize = 'cover'; document.body.style.backgroundPosition = 'center'; };
    _bg.src = 'assets/background.jpg';
    renderNav();
    toast('已保存');
  };
  ['set-lang', 'set-theme', 'set-font', 'set-accent', 'set-anim', 'set-nodeMem', 'set-py', 'set-webuiPort', 'set-botPort', 'set-proxy', 'set-autostart-napcat', 'set-autostart-bot', 'set-update-url', 'set-update-group'].forEach(id => {
    const n = document.getElementById(id);
    if (n) n.addEventListener('change', saveGen);
  });
  // API 配置元素也触发保存（模型选择/密钥/账号等）
  ['set-provider', 'set-current-key', 'set-minimax', 'set-voice', 'set-owner', 'set-botqq', 'set-group', 'set-custom-url', 'set-custom-model'].forEach(id => {
    const n = document.getElementById(id);
    if (n) n.addEventListener('change', saveGen);
  });

  // 保存全部设置按钮
  const btnSaveAll = document.getElementById('btn-save-all-settings');
  if (btnSaveAll) btnSaveAll.onclick = async () => {
    const status = document.getElementById('settings-save-status');
    if (status) status.textContent = '⏳ 保存中…';
    await saveGen();
    if (status) status.textContent = '✅ 已保存';
    setTimeout(() => { if (status) status.textContent = ''; }, 2500);
  };

  // 保存并重启机器人按钮
  const btnSaveRestart = document.getElementById('btn-save-restart-bot');
  if (btnSaveRestart) btnSaveRestart.onclick = async () => {
    const status = document.getElementById('settings-save-status');
    if (status) status.textContent = '⏳ 保存并重启机器人…';
    await saveGen();
    // 重启 bot（先停再启）
    toast('正在重启机器人…');
    await bridge.stopBot();
    await new Promise(r => setTimeout(r, 2000));
    await bridge.startBot({});
    if (status) status.textContent = '✅ 已保存并重启机器人';
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
  };
}




/* ============ 功能开关 ============ */
// 通用功能开关渲染（供工具箱页调用，整合原「功能」页）
async function renderFeatureSwitches(containerId) {
  const host = document.getElementById(containerId);
  if (!host) return;
  const FEATURES_DEF = [
    { g: 'chat', key: 'FEATURE_AI_CHAT', label: t('features.aiChat'), need: '' },
    { g: 'chat', key: 'FEATURE_TTS', label: t('features.tts'), need: 'MINIMAX_API_KEY' },
    { g: 'chat', key: 'FEATURE_VISION', label: t('features.vision'), need: 'ZHIPU_API_KEY' },
    { g: 'game', key: 'FEATURE_GAMES', label: t('features.games'), need: '' },
    { g: 'game', key: 'FEATURE_SIGN', label: t('features.sign'), need: '' },
    { g: 'game', key: 'FEATURE_LOTTERY', label: t('features.lottery'), need: '' },
    { g: 'game', key: 'FEATURE_FORTUNE', label: t('features.fortune'), need: '' },
    { g: 'game', key: 'FEATURE_IDIOM', label: t('features.idiom'), need: '' },
    { g: 'media', key: 'FEATURE_SONG', label: t('features.song'), need: '' },
    { g: 'admin', key: 'FEATURE_SYSTEM_COMMANDS', label: t('features.sysCmd'), need: '' },
    { g: 'admin', key: 'FEATURE_MONITOR', label: t('features.monitor'), need: '' },
    { g: 'admin', key: 'FEATURE_AUTO_REBOOT', label: t('features.autoReboot'), need: '' },
    { g: 'interact', key: 'FEATURE_POKE', label: t('features.poke'), need: '' },
    { g: 'chat', key: 'FEATURE_FREE_CHAT', label: t('features.freeChat') || '自由聊天', need: '' },
    { g: 'chat', key: 'FEATURE_RANDOM_TALK', label: t('features.randomTalk') || '随机搭话', need: '' }
  ];
  const GROUPS = [['chat', t('features.group.chat')], ['game', t('features.group.game')], ['media', t('features.group.media')], ['admin', t('features.group.admin')], ['interact', t('features.group.interact')]];
  let cur = {};
  try {
    const lines = await bridge.readEnv('tianlu_bot/ai_data/00_features.env');
    lines.forEach(l => { if (l.type === 'key') cur[l.key] = String(l.value).toLowerCase() === 'true'; });
  } catch (e) {}
  let envVals = {};
  try {
    const l2 = await bridge.readEnv('tianlu_bot/.env');
    l2.forEach(l => { if (l.type === 'key') envVals[l.key] = l.value; });
  } catch (e) {}

  host.innerHTML = '<div class="grid grid-2">' + GROUPS.map(([gk, gname]) => {
    const items = FEATURES_DEF.filter(f => f.g === gk);
    if (!items.length) return '';
    const rows = items.map(f => {
      const missing = f.need && !envVals[f.need];
      const checked = cur[f.key] !== false;
      const dis = missing ? 'disabled' : '';
      const note = missing ? '<div class="hint" style="color:var(--warn)">' + t('features.needKey') + '</div>' : '';
      return '<label class="feature-row">' +
        '<input type="checkbox" data-fk="' + f.key + '" ' + (checked ? 'checked' : '') + ' ' + dis + '>' +
        '<span>' + esc(f.label) + '</span>' + note + '</label>';
    }).join('');
    return '<div class="card"><h3>' + esc(gname) + '</h3>' + rows + '</div>';
  }).join('') + '</div>';

  host.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = async () => {
      const k = cb.dataset.fk;
      await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', { [k]: cb.checked ? 'true' : 'false' });
      toast(t('features.saved') + k);
    };
  });
}

async function renderFeatures() {
  const el = document.getElementById('page-features');
  if (!el.dataset.ready) {
    el.innerHTML = `      <div class="card" style="margin-bottom:14px">
        <h3>⚙️ <span data-i18n="features.hint"></span></h3>
        <p class="hint" data-i18n="features.hint2"></p>
      </div>
      <div class="grid grid-2" id="features-groups"></div>
      <div class="card" style="margin-top:16px"><h3>🎮 <span data-i18n="features.games.title"></span></h3><div id="game-section"></div></div>`;
    setLang(state.settings.language || 'zh');
    el.dataset.ready = '1';
  }
  const FEATURES_DEF = [
    { g: 'chat', key: 'FEATURE_AI_CHAT', label: t('features.aiChat'), need: '' },
    { g: 'chat', key: 'FEATURE_TTS', label: t('features.tts'), need: 'MINIMAX_API_KEY' },
    { g: 'chat', key: 'FEATURE_VISION', label: t('features.vision'), need: 'ZHIPU_API_KEY' },
    { g: 'game', key: 'FEATURE_GAMES', label: t('features.games'), need: '' },
    { g: 'game', key: 'FEATURE_SIGN', label: t('features.sign'), need: '' },
    { g: 'game', key: 'FEATURE_LOTTERY', label: t('features.lottery'), need: '' },
    { g: 'game', key: 'FEATURE_FORTUNE', label: t('features.fortune'), need: '' },
    { g: 'game', key: 'FEATURE_IDIOM', label: t('features.idiom'), need: '' },
    { g: 'media', key: 'FEATURE_SONG', label: t('features.song'), need: '' },
    { g: 'admin', key: 'FEATURE_SYSTEM_COMMANDS', label: t('features.sysCmd'), need: '' },
    { g: 'admin', key: 'FEATURE_MONITOR', label: t('features.monitor'), need: '' },
    { g: 'admin', key: 'FEATURE_AUTO_REBOOT', label: t('features.autoReboot'), need: '' },
    { g: 'interact', key: 'FEATURE_POKE', label: t('features.poke'), need: '' }
  ];
  const GROUPS = [['chat', t('features.group.chat')], ['game', t('features.group.game')], ['media', t('features.group.media')], ['admin', t('features.group.admin')], ['interact', t('features.group.interact')]];
  const groups = document.getElementById('features-groups');
  let cur = {};
  try {
    const lines = await bridge.readEnv('tianlu_bot/ai_data/00_features.env');
    lines.forEach(l => { if (l.type === 'key') cur[l.key] = String(l.value).toLowerCase() === 'true'; });
  } catch (e) {}
  let envVals = {};
  try {
    const l2 = await bridge.readEnv('tianlu_bot/.env');
    l2.forEach(l => { if (l.type === 'key') envVals[l.key] = l.value; });
  } catch (e) {}

  groups.innerHTML = GROUPS.map(([gk, gname]) => {
    const items = FEATURES_DEF.filter(f => f.g === gk);
    const rows = items.map(f => {
      const missing = f.need && !envVals[f.need];
      const checked = cur[f.key] !== false;
      const dis = missing ? 'disabled' : '';
      const note = missing ? '<div class="hint" style="color:var(--warn)">' + t('features.needKey') + '</div>' : '';
      return '<label class="feature-row">' +
        '<input type="checkbox" data-fk="' + f.key + '" ' + (checked ? 'checked' : '') + ' ' + dis + '>' +
        '<span>' + esc(f.label) + '</span>' + note + '</label>';
    }).join('');
    return '<div class="card"><h3>' + esc(gname) + '</h3>' + rows + '</div>';
  }).join('');

  groups.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = async () => {
      const k = cb.dataset.fk;
      await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', { [k]: cb.checked ? 'true' : 'false' });
      toast(t('features.saved') + k);
    };
  });

  // ===== 小游戏区（games.json 数据驱动）=====
  const gameWrap = document.getElementById('game-section');
  let games = [];
  try { games = await bridge.gamesList(); } catch (e) {}
  if (gameWrap && games.length) {
    let gcur = {};
    try {
      const l3 = await bridge.readEnv('tianlu_bot/ai_data/00_features.env');
      l3.forEach(l => { if (l.type === 'key') gcur[l.key] = String(l.value).toLowerCase() === 'true'; });
    } catch (e) {}
    const cats = [...new Set(games.map(g => g.category))];
    const catName = { luck: t('features.games.luck'), pvp: t('features.games.pvp'), quiz: t('features.games.quiz'), sim: t('features.games.sim'), social: t('features.games.social'), tool: t('features.games.tool') };
    const renderGameList = (filter) => {
      const rows = games.filter(g => !filter || g.name.includes(filter) || (g.desc || '').includes(filter) || g.cmd.includes(filter));
      gameWrap.innerHTML = '<div class="btn-row" style="margin:8px 0"><input type="text" id="game-search" placeholder="' + t('features.games.search') + '" style="flex:1;min-width:160px">' +
        '<button class="btn sm" id="game-all-on">' + t('features.games.allOn') + '</button>' +
        '<button class="btn sm" id="game-all-off">' + t('features.games.allOff') + '</button></div>' +
        '<div class="grid grid-2">' + cats.map(c => {
          const ck = 'FEATURE_GAMES_' + c.toUpperCase();
          const cOn = gcur[ck] !== false;
          const list = games.filter(g => g.category === c).map(g => {
            const k = 'FEATURE_GAME_' + g.id.toUpperCase();
            const on = gcur[k] !== false;
            const costTag = g.cost ? ('<small style="opacity:.6"> ' + g.cost + '💰</small>') : '<small style="color:var(--ok)"> 免费</small>';
            return '<label class="feature-row" style="padding:5px 8px"><input type="checkbox" data-gk="' + k + '" data-cat="' + c + '" ' + (on ? 'checked' : '') + '><span>' + esc(g.name) + costTag + '<br><small style="opacity:.65">' + esc(g.desc || g.cmd) + '</small></span></label>';
          }).join('');
          return '<div class="card"><h3>' + esc(catName[c] || c) + ' <label style="font-weight:400"><input type="checkbox" data-ck="' + ck + '" ' + (cOn ? 'checked' : '') + '> <small>' + t('features.games.catSwitch') + '</small></label></h3>' + list + '</div>';
        }).join('') + '</div>';
      const search = document.getElementById('game-search');
      search.oninput = () => { const f = search.value.trim(); const rw = gameWrap.querySelectorAll('[data-gk]'); rw.forEach(r => { const t = r.textContent; r.style.display = (!f || t.includes(f)) ? '' : 'none'; }); };
      document.getElementById('game-all-on').onclick = async () => { const batch = {}; games.forEach(g => { batch['FEATURE_GAME_' + g.id.toUpperCase()] = 'true'; batch['FEATURE_GAMES_' + g.category.toUpperCase()] = 'true'; }); await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', batch); toast(t('features.saved')); renderFeatures(); };
      document.getElementById('game-all-off').onclick = async () => { const batch = {}; games.forEach(g => { batch['FEATURE_GAME_' + g.id.toUpperCase()] = 'false'; }); await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', batch); toast(t('features.saved')); renderFeatures(); };
      gameWrap.querySelectorAll('input[data-gk]').forEach(cb => {
        cb.onchange = async () => { const k = cb.dataset.gk; gcur[k] = cb.checked; await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', { [k]: cb.checked ? 'true' : 'false' }); toast(t('features.saved') + k); };
      });
      gameWrap.querySelectorAll('input[data-ck]').forEach(cb => {
        cb.onchange = async () => { const ck = cb.dataset.ck; await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', { [ck]: cb.checked ? 'true' : 'false' }); toast(t('features.saved') + ck); };
      });
    };
    renderGameList('');
  }
}


/* ============ 消息（三栏） ============ */
async function renderMessages() {
  const el = document.getElementById('page-messages');
  if (!el.dataset.ready) {
    el.innerHTML = '<div class="grid grid-3">' +
      '<div class="card"><h3>💬 <span data-i18n="msg.history"></span></h3><div id="msg-file-list" style="max-height:52vh;overflow-y:auto"></div><pre id="msg-content" style="max-height:26vh;overflow-y:auto;background:rgba(0,0,0,.05);border-radius:8px;padding:8px;font-size:12px;margin-top:8px;user-select:text"></pre></div>' +
      '<div class="card"><h3>🗣 <span data-i18n="toolbox.tts.title"></span></h3><div id="msg-tts-list" style="max-height:78vh;overflow-y:auto"></div></div>' +
      '<div class="card"><h3>🎧 <span data-i18n="toolbox.music.title"></span></h3><div id="msg-music-list" style="max-height:78vh;overflow-y:auto"></div></div>' +
    '</div>';
    setLang(state.settings.language || 'zh');
    el.dataset.ready = '1';
  }
  const renderMediaInto = async (elId, kind, fetchFn) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const items = await fetchFn();
    if (!items.length) { el.innerHTML = '<p class="hint" data-i18n="msg.empty"></p>'; setLang(state.settings.language || 'zh'); return; }
    el.innerHTML = items.map(f =>
      '<div style="padding:6px 0;border-bottom:1px dashed var(--border)">' + esc(f.name) +
      ' <small style="opacity:.6">' + (f.size / 1024).toFixed(0) + 'KB</small><br>' +
      '<audio controls preload="none" style="width:100%;height:32px;margin-top:4px" src="/media/' + kind + '/' + encodeURIComponent(f.name) + '"></audio></div>'
    ).join('');
  };
  renderMediaInto('msg-tts-list', 'tts', () => bridge.listTtsAudio());
  renderMediaInto('msg-music-list', 'music', () => bridge.listMusicAudio());
  // 历史消息文件列表
  const fl = document.getElementById('msg-file-list');
  const files = await bridge.msgList();
  if (!files.length) { fl.innerHTML = '<p class="hint" data-i18n="msg.empty"></p>'; }
  else {
    fl.innerHTML = files.map(f => {
      const d = new Date(f.mtime);
      const pad = (n) => String(n).padStart(2, '0');
      return '<div class="bk-file" data-msg="' + esc(f.name) + '">📄 ' + esc(f.name) + ' <small style="opacity:.55">' + (f.size / 1024).toFixed(0) + 'KB</small></div>';
    }).join('');
    fl.querySelectorAll('[data-msg]').forEach(b => {
      b.onclick = async () => {
        const content = await bridge.msgRead(b.dataset.msg);
        const pre = document.getElementById('msg-content');
        if (pre) pre.textContent = content || '（空）';
      };
    });
  }
  setLang(state.settings.language || 'zh');
}
/* ============ 备份中心 ============ */
async function renderBackup() {
  const el = document.getElementById('page-backup');
  if (!el.dataset.ready) {
    el.innerHTML = '<div class="card" style="margin-bottom:14px"><h3>🗂 <span data-i18n="backup.title"></span></h3><p class="hint" data-i18n="backup.hint"></p></div>' +
      '<div class="grid grid-2"><div class="card"><h3>📦 <span data-i18n="backup.list"></span></h3><div id="backup-list"></div></div>' +
      '<div class="card"><h3>📄 <span data-i18n="backup.preview"></span></h3><div id="backup-preview"></div></div></div>';
    setLang(state.settings.language || 'zh');
    el.dataset.ready = '1';
  }
  const listEl = document.getElementById('backup-list');
  const preEl = document.getElementById('backup-preview');
  const backups = await bridge.backupList();
  if (!backups.length) {
    listEl.innerHTML = '<p class="hint" data-i18n="backup.empty"></p>';
    preEl.innerHTML = '<p class="hint" data-i18n="backup.pick"></p>';
    setLang(state.settings.language || 'zh');
    return;
  }
  listEl.innerHTML = backups.map(b => {
    const d = new Date(b.time);
    const pad = (n) => String(n).padStart(2, '0');
    const fsList = b.files.map(f => '<div class="bk-file" data-id="' + b.id + '" data-file="' + esc(f) + '">📄 ' + esc(f) + '</div>').join('');
    return '<div class="bk-group"><b>🕓 ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</b><div style="margin:6px 0 10px 12px">' + (fsList || '<small style="opacity:.6">无文件</small>') + '</div></div>';
  }).join('');
  preEl.innerHTML = '<p class="hint" data-i18n="backup.pick"></p>';
  setLang(state.settings.language || 'zh');
  listEl.querySelectorAll('.bk-file').forEach(f => {
    f.onclick = async () => {
      const content = await bridge.backupRead(f.dataset.id, f.dataset.file);
      preEl.innerHTML = '<div class="field"><label>' + esc(f.dataset.file) + '</label><textarea id="bk-content" rows="16" style="font-family:Consolas,monospace;font-size:12px">' + esc(content) + '</textarea></div>' +
        '<div class="btn-row"><button class="btn primary sm" id="bk-apply" data-i18n="backup.apply"></button></div>' +
        '<p class="hint" data-i18n="backup.applyHint"></p>';
      setLang(state.settings.language || 'zh');
      document.getElementById('bk-apply').onclick = async () => {
        const r = await bridge.backupApply(f.dataset.id, f.dataset.file);
        r.ok ? toast(t('backup.applied') + ' ' + f.dataset.file) : toast(r.error || 'fail', 'err');
      };
    };
  });
}

/* ============ 意见反馈墙 ============ */
async function renderFeedback() {
  const el = document.getElementById('page-feedback');
  if (!el.dataset.ready) {
    el.innerHTML = '<div class="grid grid-2"><div class="card"><h3>💬 <span data-i18n="feedback.write"></span></h3>' +
      '<div class="field"><label data-i18n="feedback.type"></label><select id="fb-type"><option value="建议" data-i18n="feedback.type.advice"></option><option value="吐槽" data-i18n="feedback.type.rant"></option><option value="BUG" data-i18n="feedback.type.bug"></option><option value="其他" data-i18n="feedback.type.other"></option></select></div>' +
      '<div class="field"><label data-i18n="feedback.qq"></label><input type="text" id="fb-qq" placeholder="选填，方便联系你"></div>' +
      '<div class="field"><label data-i18n="feedback.text"></label><textarea id="fb-text" rows="6"></textarea></div>' +
      '<div class="btn-row"><button class="btn primary" id="fb-submit" data-i18n="feedback.submit"></button></div>' +
      '<p class="hint" data-i18n="feedback.hint"></p></div>' +
      '<div class="card"><h3>🧱 <span data-i18n="feedback.wall"></span> <span class="btn-row" style="float:right"><button class="btn sm" id="fb-refresh" data-i18n="feedback.refresh"></button><button class="btn sm ghost" id="fb-copy" data-i18n="feedback.copy"></button></span></h3>' +
      '<div id="fb-wall" style="max-height:62vh;overflow-y:auto"></div></div></div>';
    setLang(state.settings.language || 'zh');
    el.dataset.ready = '1';
    document.getElementById('fb-submit').onclick = async () => {
      const text = document.getElementById('fb-text').value.trim();
      if (!text) { toast(t('feedback.empty'), 'err'); return; }
      const r = await bridge.feedbackSubmit({ type: document.getElementById('fb-type').value, text, qq: document.getElementById('fb-qq').value.trim() });
      if (r.ok) { document.getElementById('fb-text').value = ''; document.getElementById('fb-qq').value = ''; renderWall(r.list); toast(t('feedback.saved')); }
    };
    document.getElementById('fb-copy').onclick = async () => {
      const list = await bridge.feedbackList();
      const txt = list.map(f => '#' + f.id + ' [' + (f.status === 'done' ? '已解决' : '未解决') + ']（' + f.type + '）' + (f.qq ? 'QQ:' + f.qq + ' ' : '') + f.text).join('\n');
      try { await navigator.clipboard.writeText(txt); toast(t('feedback.copied')); } catch (e) { toast(t('feedback.copyFail'), 'err'); }
    };
    document.getElementById('fb-refresh').onclick = async () => {
      renderWall(await bridge.feedbackList());
      toast(t('feedback.refreshed'));
    };
  }
  const list = await bridge.feedbackList();
  renderWall(list);
}
function renderWall(list) {
  const w = document.getElementById('fb-wall');
  if (!w) return;
  if (!list.length) { w.innerHTML = '<p class="hint" data-i18n="feedback.none"></p>'; setLang(state.settings.language || 'zh'); return; }
  w.innerHTML = list.map(f => {
    const d = new Date(f.time);
    const pad = (n) => String(n).padStart(2, '0');
    const typeIco = { '建议': '💡', '吐槽': '😤', 'BUG': '🐛', '其他': '📝' }[f.type] || '📝';
    const done = f.status === 'done';
    const srcChip = f.source === 'group' ? '<span class="fb-chip src">👥 群聊</span>' : '<span class="fb-chip src">🖥 控制台</span>';
    const stChip = done ? '<span class="fb-chip done">✅ 已解决</span>' : '<span class="fb-chip open">🔴 未解决</span>';
    const fixBtn = !done ? '<button class="btn sm primary fb-fix-btn" data-fid="' + esc(String(f.id)) + '" style="float:right">🔧 一键修复</button>' : '';
    return '<div class="fb-item" data-fb="' + esc(String(f.id)) + '" style="' + (done ? 'opacity:.65' : '') + '">' + fixBtn + '<b>#' + esc(String(f.id || '')) + ' ' + typeIco + ' ' + esc(f.type) + '</b> ' + srcChip + ' ' + stChip + '<small style="opacity:.55;margin-left:6px">' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + (f.qq ? ' · QQ ' + esc(f.qq) : '') + '</small><div style="margin-top:4px">' + esc(f.text) + '</div></div>';
  }).join('');
  // 一键修复：跑修复 → 成功后标该条已解决
  w.querySelectorAll('.fb-fix-btn').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(t('feedback.fixConfirm'))) return;
      const id = b.dataset.fid;
      b.textContent = '⏳ 修复中…'; b.disabled = true;
      const r = await bridge.repairCode();
      if (r) {
        const rm = await bridge.markFeedbackDone(id);
        renderWall(rm && rm.ok ? rm.store : await bridge.feedbackList());
        if (r.fixed.length) toast('已修复 ' + r.fixed.length + ' 处，该反馈标记为已解决', 'ok');
        else toast(t('feedback.fixDone'));
      } else { b.textContent = '🔧 一键修复'; b.disabled = false; toast('修复失败', 'err'); }
    };
  });
}
/* ============ 工具箱 ============ */
async function renderToolbox() {
  const el = document.getElementById('page-toolbox');
  if (!el.dataset.ready) {
    // 子标签：常用工具 / 代码编辑 / 反馈
    el.innerHTML = `
      <div class="tab-bar" id="tb-tabs" style="margin-bottom:16px">
        <button class="tab-btn active" data-tbtab="main">🧰 常用工具</button>
        <button class="tab-btn" data-tbtab="code">📝 代码编辑</button>
        <button class="tab-btn" data-tbtab="feedback">💬 反馈</button>
        <button class="tab-btn" data-tbtab="commands">📋 命令速查</button>
      </div>
      <div class="tb-panel" id="tb-panel-main">
      <div class="card" style="margin-bottom:16px">
        <h3>⚙️ <span data-i18n="features.hint"></span> <small style="opacity:.6;font-weight:400" data-i18n="features.hint2"></small></h3>
        <div id="tb-feature-switches"></div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <h3>📦 <span data-i18n="toolbox.code.title"></span></h3>
          <p class="hint" data-i18n="toolbox.code.hint"></p>
          <div class="btn-row">
            <button class="btn primary" id="tb-export" data-i18n="toolbox.code.export"></button>
            <button class="btn" id="tb-import" data-i18n="toolbox.code.import"></button>
            <button class="btn danger" id="tb-restore" data-i18n="toolbox.code.restore"></button>
          </div>
          <div class="btn-row" style="margin-top:8px">
            <button class="btn primary" id="tb-repair" data-i18n="toolbox.code.repair"></button>
          </div>
          <div id="tb-repair-report" style="margin-top:10px"></div>
          <p class="hint" style="margin-top:12px" data-i18n="toolbox.code.hint2"></p>
        </div>
        <div class="card">
          <h3>🎵 <span data-i18n="toolbox.cookie.title"></span></h3>
          <p class="hint" data-i18n="toolbox.cookie.hint"></p>
          <textarea id="tb-cookie" rows="3" placeholder="MUSIC_U=xxx; __csrf=xxx..."></textarea>
          <div class="btn-row">
            <button class="btn primary" id="tb-cookie-save" data-i18n="toolbox.cookie.save"></button>
          </div>
          <p class="hint" data-i18n="toolbox.cookie.hint2"></p>
        </div>
        <div class="card">
          <h3>🎧 <span data-i18n="toolbox.downloader.title"></span></h3>
          <p class="hint" data-i18n="toolbox.downloader.hint"></p>
          <div class="btn-row">
            <button class="btn primary" id="tb-downloader-open" data-i18n="toolbox.downloader.open"></button>
          </div>
          <p class="hint" data-i18n="toolbox.downloader.hint2"></p>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>🎮 <span data-i18n="toolbox.games.title"></span> <small style="opacity:.6;font-weight:400" data-i18n="toolbox.games.hint"></small>
        <button class="btn sm ghost" id="btn-game-cmds" style="float:right" data-i18n="toolbox.games.cmds"></button></h3>
        <div id="tb-games"></div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>🎤 <span data-i18n="toolbox.clone.title"></span></h3>
        <p class="hint" data-i18n="toolbox.clone.hint"></p>
        <div class="btn-row">
          <button class="btn primary" id="btn-clone-wizard" data-i18n="toolbox.clone.wizard"></button>
        </div>
        <div id="clone-config-area" style="display:none;margin-top:12px">
          <div class="btn-row">
            <button class="btn sm" id="btn-clone-main" data-i18n="toolbox.clone.main"></button>
            <button class="btn sm ghost" id="btn-clone-ref" data-i18n="toolbox.clone.ref"></button>
          </div>
          <p class="hint" id="clone-files"></p>
          <div class="field" style="margin-top:6px"><label data-i18n="toolbox.clone.text"></label><input type="text" id="clone-text" placeholder=""></div>
          <div class="field"><label data-i18n="toolbox.clone.voiceId"></label><input type="text" id="clone-voice-id" value="tianlu_bot"></div>
          <div class="btn-row"><button class="btn primary sm" id="btn-clone-go" data-i18n="toolbox.clone.go"></button></div>
          <p class="hint" id="clone-status"></p>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3>🎵 <span data-i18n="toolbox.audio.title"></span></h3>
        <p class="hint" data-i18n="toolbox.audio.hint"></p>
        <div class="btn-row"><button class="btn sm primary" id="btn-audio-upload" data-i18n="toolbox.audio.upload"></button></div>
        <div id="tb-audio-list"></div>
        </div>
      </div><!-- /tb-panel-main -->

      <div class="tb-panel" id="tb-panel-code" style="display:none">
        <div class="card">
          <h3>📝 代码编辑器</h3>
          <p class="hint">直接编辑机器人的配置和插件代码。改完保存后重启机器人生效。</p>
          <div class="config-layout" style="margin-top:12px">
            <div class="card file-list" id="tb-code-file-list"></div>
            <div class="card" style="display:flex;flex-direction:column;min-height:420px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <strong id="tb-code-current" style="font-size:13px"></strong>
                <button class="btn sm primary" id="tb-code-save">保存</button>
              </div>
              <div id="tb-code-editor" style="flex:1;overflow:auto"></div>
            </div>
          </div>
        </div>
      </div><!-- /tb-panel-code -->

      <div class="tb-panel" id="tb-panel-feedback" style="display:none">
        <div class="card">
          <h3>💬 反馈</h3>
          <p class="hint">提交问题或建议，作者会收到通知。</p>
          <div id="tb-feedback-body" style="margin-top:12px"></div>
        </div>
      </div><!-- /tb-panel-feedback -->

      <div class="tb-panel" id="tb-panel-commands" style="display:none">
        <div class="card">
          <h3>📋 命令速查</h3>
          <p class="hint">机器人能听懂的所有命令。在群里发消息时先 @机器人，再跟上命令即可。</p>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn primary sm" id="tb-cmd-copyall">📄 复制全部（发群里用）</button>
            <button class="btn sm" id="tb-cmd-refresh">🔄 刷新</button>
          </div>
          <div style="margin-top:14px;padding:10px 14px;border-radius:10px;background:var(--bg-2);font-size:13px;line-height:1.8">
            <b>用法示例：</b><br>
            <code>@机器人 掷骰子</code><br>
            <code>@机器人 签到</code><br>
            <code>@机器人 猜大小 大</code> ← 带参数的命令，参数跟在后面
          </div>
        </div>
        <div id="tb-cmd-body"></div>
      </div><!-- /tb-panel-commands -->`;
    // 子标签切换
    const tbTabs = document.getElementById('tb-tabs');
    if (tbTabs) {
      tbTabs.querySelectorAll('[data-tbtab]').forEach(btn => {
        btn.onclick = () => {
          const tab = btn.dataset.tbtab;
          tbTabs.querySelectorAll('[data-tbtab]').forEach(b => b.classList.toggle('active', b === btn));
          ['main', 'code', 'feedback', 'commands'].forEach(t => {
            const panel = document.getElementById('tb-panel-' + t);
            if (panel) panel.style.display = (t === tab) ? '' : 'none';
          });
          // 首次切到某个面板时才渲染，避免无谓开销
          if (tab === 'code' && !state.tbCodeReady) { state.tbCodeReady = true; initToolboxCode(); }
          if (tab === 'feedback' && !state.tbFbReady) { state.tbFbReady = true; initToolboxFeedback(); }
          if (tab === 'commands' && !state.tbCmdReady) { state.tbCmdReady = true; initToolboxCommands(); }
        };
      });
    }
    setLang(state.settings.language || 'zh');
    document.getElementById('tb-export').onclick = async () => { const r = await bridge.exportCode(); r.ok ? toast(t('toolbox.code.ok') + (r.path || '')) : (r.canceled || toast(t('toolbox.code.fail') + (r.error || ''), 'err')); };
    document.getElementById('tb-import').onclick = async () => { const r = await bridge.importCode(); r.ok ? toast(t('toolbox.code.importOk')) : (r.canceled || toast(t('toolbox.code.fail') + (r.error || ''), 'err')); };
    const rpBtn = document.getElementById('tb-repair');
  const rpBox = document.getElementById('tb-repair-report');
  if (rpBtn) rpBtn.onclick = async () => {
    rpBtn.disabled = true;
    if (rpBox) rpBox.innerHTML = '<p class="hint">⏳ 正在体检并修复…（自动备份 → 检查 → 修复）</p>';
    const r = await bridge.repairCode();
    rpBtn.disabled = false;
    if (!r) { if (rpBox) rpBox.innerHTML = '<p class="hint">❌ 修复失败（IPC 错误）</p>'; return; }
    let html = '<p class="hint">📦 备份：' + esc(r.backup || '无') + ' | 检查 ' + r.checked + ' 项</p>';
    if (r.fixed.length) html += r.fixed.map(x => '<p class="hint" style="color:#6fdd8f">✅ ' + esc(x) + '</p>').join('');
    else html += '<p class="hint" style="color:#6fdd8f">✅ 全部正常，无需修复</p>';
    if (r.failed.length) html += r.failed.map(x => '<p class="hint" style="color:#ff7a7a">⚠️ ' + esc(x) + '</p>').join('');
    if (rpBox) rpBox.innerHTML = html;
    toast(r.fixed.length ? '已修复 ' + r.fixed.length + ' 处' : '检查完成，一切正常', r.fixed.length ? 'ok' : '');
  };

  document.getElementById('tb-restore').onclick = async () => { const r = await bridge.restoreCode(); r.ok ? toast(t('toolbox.code.restoreOk')) : toast(t('toolbox.code.fail') + (r.error || ''), 'err'); };
    document.getElementById('tb-cookie-save').onclick = async () => {
      const c = document.getElementById('tb-cookie').value.trim();
      if (!c) { toast(t('toolbox.cookie.empty'), 'err'); return; }
      const r = await bridge.saveCookie(c);
      r.ok ? toast(t('toolbox.cookie.saved')) : toast(t('toolbox.code.fail') + (r.error || ''), 'err');
    };
    document.getElementById('tb-downloader-open').onclick = async () => {
      const r = await bridge.launchTool('netease-downloader');
      if (r && r.ok) toast(t('toolbox.downloader.launched'));
      else toast('❌ ' + ((r && r.error) || t('toolbox.downloader.fail')), 'err');
    };
    el.dataset.ready = '1';
    // 渲染功能开关（整合自原「功能」页）
    renderFeatureSwitches('tb-feature-switches');
  }
  const btnCmds = document.getElementById('btn-game-cmds');
  if (btnCmds) {
    btnCmds.onclick = () => {
      bridge.gamesList().then(gs => {
        let modal = document.getElementById('game-cmds-modal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'game-cmds-modal';
          modal.className = 'modal-mask';
          document.body.appendChild(modal);
        }
        modal.innerHTML =
          '<div class="modal-box" style="max-height:80vh;overflow-y:auto"><h3>📜 ' + t('toolbox.games.cmdsTitle') + '</h3>' +
          '<div style="column-count:2;column-gap:18px;font-size:13px">' + gs.map(g =>
            '<div style="break-inside:avoid;margin-bottom:8px"><b>' + esc(g.name) + '</b> <small style="opacity:.7">· 指令：' + esc(g.cmd) + (g.cost ? '（' + g.cost + '金币）' : '') + '</small><br><small style="opacity:.55">' + esc(g.desc || '') + '</small></div>'
          ).join('') + '</div>' +
          '<div class="btn-row" style="margin-top:12px"><button class="btn primary sm" id="game-cmds-close">' + t('common.cancel') + '</button></div></div>';
        modal.style.display = 'flex';
        document.getElementById('game-cmds-close').onclick = () => { modal.style.display = 'none'; };
      });
    };
  }

  // ===== 语音克隆（分步向导 + 一键配置） =====
  // 分步引导：点「开始向导」先看教程，看完才能进入配置区
  const cloneWizardSteps = [
    { title: '什么是语音克隆？', content: '语音克隆就是让机器人「学会你的声音」。你给它一段你说话的录音，它就能用你的声音来说话、唱歌、回复消息。', important: false },
    { title: '准备基准音频（最重要）', content: '你需要准备一段「干净、清晰」的你的声音录音，时长建议 5~30 秒。要求：只有你一个人的声音、没有背景音乐和杂音、说话清楚、普通话或你常用的语言。', important: true },
    { title: '准备示例音频（可选）', content: '示例音频是「你想让机器人模仿的说话风格/语气」的参考，也可以不填，只填基准音频就行。', important: false },
    { title: '选择文件格式', content: '支持 .mp3、.wav、.m4a、.mkv 等常见音频/视频格式。如果选视频文件（如 .mkv），程序会自动提取里面的声音。', important: false },
    { title: '填写文字和音色 ID', content: '「文本」是测试用的句子（让机器人先说这句话验证效果）。「音色 ID」保持默认即可，也可以自己在 MiniMax 平台创建。', important: false },
    { title: '开始克隆', content: '都填好后点「开始克隆」，等待几秒钟，机器人就会用你的声音说话了。现在可以进入配置了！', important: false }
  ];
  const btnCloneWizard = document.getElementById('btn-clone-wizard');
  if (btnCloneWizard) btnCloneWizard.onclick = () => {
    // 创建分步向导 modal
    let modal = document.getElementById('clone-wizard-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'clone-wizard-modal';
      modal.className = 'modal-mask';
      document.body.appendChild(modal);
    }
    let step = 0;
    const renderWizardStep = () => {
      const st = cloneWizardSteps[step];
      const isLast = step === cloneWizardSteps.length - 1;
      const importantTag = st.important ? '<span style="color:#ff3b3b;font-weight:700;float:right;font-size:14px">【特别重要】</span>' : '';
      modal.innerHTML = `
        <div class="modal-box" style="max-width:560px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="margin:0">🎤 ${esc(t('toolbox.clone.title'))} · 教程第 ${step + 1}/${cloneWizardSteps.length} 步</h3>
            ${importantTag}
          </div>
          <div class="clone-progress" style="height:6px;background:var(--bg-3);border-radius:3px;overflow:hidden;margin-bottom:16px">
            <div style="height:100%;width:${((step + 1) / cloneWizardSteps.length) * 100}%;background:var(--accent);transition:width .3s"></div>
          </div>
          <h4 style="margin:0 0 8px;font-size:16px">${esc(st.title)}</h4>
          <p style="font-size:14px;line-height:1.7;color:var(--text);margin:0 0 20px">${esc(st.content)}</p>
          <div class="btn-row" style="justify-content:flex-end;margin-top:0">
            ${step > 0 ? '<button class="btn" id="clone-wizard-prev">上一步</button>' : ''}
            <button class="btn primary" id="clone-wizard-next">${isLast ? '进入配置' : '下一步'}</button>
          </div>
        </div>`;
      modal.style.display = 'flex';
      const prevBtn = document.getElementById('clone-wizard-prev');
      if (prevBtn) prevBtn.onclick = () => { step--; renderWizardStep(); };
      document.getElementById('clone-wizard-next').onclick = () => {
        if (isLast) {
          // 看完教程，展开配置区
          const area = document.getElementById('clone-config-area');
          if (area) area.style.display = '';
          modal.style.display = 'none';
          toast('✅ 教程完成，请开始配置');
        } else {
          step++;
          renderWizardStep();
        }
      };
    };
    renderWizardStep();
  };

  const btnCM = document.getElementById('btn-clone-main');
  const btnCR = document.getElementById('btn-clone-ref');
  const filesHint = document.getElementById('clone-files');
  const updCloneFiles = () => { if (filesHint) filesHint.textContent = '基准音频: ' + (state.cloneMain || '未选') + ' | 示例音频: ' + (state.cloneRef || '未选'); };
  if (btnCM) btnCM.onclick = async () => { const r = await bridge.pickAudio(); if (r.ok) { state.cloneMain = r.path; updCloneFiles(); } };
  if (btnCR) btnCR.onclick = async () => { const r = await bridge.pickAudio(); if (r.ok) { state.cloneRef = r.path; updCloneFiles(); } };
  updCloneFiles();
  const btnCG = document.getElementById('btn-clone-go');
  if (btnCG) btnCG.onclick = async () => {
    if (!state.cloneMain) { toast(t('toolbox.clone.needMain'), 'err'); return; }
    const st = document.getElementById('clone-status');
    btnCG.disabled = true;
    st.textContent = '⏳ ' + t('toolbox.clone.working');
    const r = await bridge.cloneVoice({
      main: state.cloneMain,
      ref: state.cloneRef || '',
      text: document.getElementById('clone-text').value.trim(),
      voiceId: document.getElementById('clone-voice-id').value.trim() || 'tianlu_bot'
    });
    btnCG.disabled = false;
    if (r.ok) { st.textContent = '✅ ' + t('toolbox.clone.done') + r.voiceId; toast(t('toolbox.clone.done') + r.voiceId); }
    else { st.textContent = '❌ ' + (r.error || 'fail'); toast(r.error || 'fail', 'err'); }
  };

  // ===== 生成语音 / 网易云试听 =====
  const renderMediaList = async (elId, kind, fetchFn) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const items = await fetchFn();
    if (!items.length) { el.innerHTML = '<p class="hint">暂无文件</p>'; return; }
    el.innerHTML = items.map(f =>
      '<div style="padding:6px 0;border-bottom:1px dashed var(--border)">' + esc(f.name) +
      ' <small style="opacity:.6">' + (f.size / 1024).toFixed(0) + 'KB</small><br>' +
      '<audio controls preload="none" style="width:100%;height:32px;margin-top:4px" src="/media/' + kind + '/' + encodeURIComponent(f.name) + '"></audio></div>'
    ).join('');
  };

  // ===== 音频上传 =====
  const btnUp = document.getElementById('btn-audio-upload');
  if (btnUp) {
    btnUp.onclick = async () => {
      const r = await bridge.audioUpload();
      if (r.ok) { toast(t('toolbox.audio.ok') + (r.copied || []).join(', ')); renderAudioList(); }
      else if (!r.canceled) toast(t('toolbox.audio.fail') + (r.error || ''), 'err');
    };
  }
  renderAudioList();
  // ===== 娱乐区：小游戏安装管理（打勾=安装，立即生效） =====
  const gameWrap = document.getElementById('tb-games');
  if (gameWrap) {
    let games = [];
    try { games = await bridge.gamesList(); } catch (e) {}
    let gcur = {};
    try {
      const l3 = await bridge.readEnv('tianlu_bot/ai_data/00_features.env');
      l3.forEach(l => { if (l.type === 'key') gcur[l.key] = String(l.value).toLowerCase() === 'true'; });
    } catch (e) {}
    const renderGames = () => {
      gameWrap.innerHTML = '<div class="btn-row" style="margin-bottom:8px"><input type="text" id="tb-game-search" placeholder="' + t('features.games.search') + '" style="flex:1">' +
        '<button class="btn sm" id="tb-all-on">' + t('features.games.allOn') + '</button>' +
        '<button class="btn sm" id="tb-all-off">' + t('features.games.allOff') + '</button></div>' +
        '<div class="grid grid-3">' + games.map(g => {
          const k = 'FEATURE_GAME_' + g.id.toUpperCase();
          const on = gcur[k] !== false;
          const costTag = g.cost ? ('<small style="opacity:.6"> ' + g.cost + '💰</small>') : '<small style="color:var(--ok)"> 免费</small>';
          return '<label class="feature-row" style="padding:5px 8px"><input type="checkbox" data-tgk="' + k + '" ' + (on ? 'checked' : '') + '><span>' + esc(g.name) + costTag + '<br><small style="opacity:.65">' + esc(g.desc || '') + '</small></span></label>';
        }).join('') + '</div>';
      document.getElementById('tb-game-search').oninput = () => { const f = document.getElementById('tb-game-search').value.trim(); gameWrap.querySelectorAll('[data-tgk]').forEach(r => { r.style.display = (!f || r.textContent.includes(f)) ? '' : 'none'; }); };
      document.getElementById('tb-all-on').onclick = async () => { const batch = {}; games.forEach(g => batch['FEATURE_GAME_' + g.id.toUpperCase()] = 'true'); await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', batch); toast(t('features.saved')); };
      document.getElementById('tb-all-off').onclick = async () => { const batch = {}; games.forEach(g => batch['FEATURE_GAME_' + g.id.toUpperCase()] = 'false'); await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', batch); toast(t('features.saved')); };
      gameWrap.querySelectorAll('input[data-tgk]').forEach(cb => {
        cb.onchange = async () => { const k = cb.dataset.tgk; await bridge.writeEnv('tianlu_bot/ai_data/00_features.env', { [k]: cb.checked ? 'true' : 'false' }); toast(t('features.saved') + k); };
      });
    };
    renderGames();
  }
}

async function renderAudioList() {
  const list = document.getElementById('tb-audio-list');
  if (!list) return;
  const items = await bridge.audioList();
  if (!items.length) { list.innerHTML = '<p class="hint" data-i18n="toolbox.audio.empty"></p>'; setLang(state.settings.language || 'zh'); return; }
  list.innerHTML = items.map(f =>
    '<div style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;font-size:13px">🎵 ' + esc(f.name) +
    ' <small style="opacity:.6">' + (f.size / 1024).toFixed(0) + 'KB</small>' +
    '<span style="flex:1"></span><button class="btn sm danger" data-del="' + esc(f.name) + '">' + t('toolbox.audio.del') + '</button></div>'
  ).join('');
  setLang(state.settings.language || 'zh');
  list.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => { const r = await bridge.audioDelete(b.dataset.del); if (r.ok) renderAudioList(); };
  });
}


/* ============ 工具箱 · 代码编辑面板 ============ */
async function initToolboxCode() {
  const list = document.getElementById('tb-code-file-list');
  const editor = document.getElementById('tb-code-editor');
  const cur = document.getElementById('tb-code-current');
  if (!list || !editor) { console.warn('[tb-code] 面板节点缺失'); return; }

  list.innerHTML = '<p class="hint" style="padding:8px">正在读取…</p>';
  let files = [];
  try {
    const r = await bridge.listRuntimeFiles('tianlu_bot');
    files = Array.isArray(r) ? r : (r && r.files) || [];
  } catch (e) { console.error('[tb-code] 列文件失败', e); }

  const names = files.map(f => (typeof f === 'string' ? f : (f && (f.name || f.file || f.path)) || '')).filter(Boolean);
  const editable = names.filter(n => /\.(py|env|json|toml|txt|md|cfg|ini|yaml|yml)$/i.test(n));

  if (!editable.length) {
    list.innerHTML = '<p class="hint" style="padding:8px">没有可编辑的文件</p>';
    return;
  }

  list.innerHTML = editable.map(n => '<div class="bk-file" data-file="' + esc(n) + '">📄 ' + esc(n) + '</div>').join('');

  const openFile = (name) => {
    list.querySelectorAll('[data-file]').forEach(b => b.classList.toggle('active', b.dataset.file === name));
    if (cur) cur.textContent = name;
    state.tbCurrentFile = name;

    bridge.readFile('tianlu_bot/' + name).then((content) => {
      content = content || '';
      const lang = /\.py$/i.test(name) ? 'python'
        : /\.json$/i.test(name) ? 'json'
        : /\.(yml|yaml)$/i.test(name) ? 'yaml'
        : /\.md$/i.test(name) ? 'markdown'
        : 'plaintext';

      ensureMonaco(() => {
        if (!state.tbEditor) {
          editor.innerHTML = '';
          state.tbEditor = monaco.editor.create(editor, {
            value: content, language: lang, theme: 'vs-dark',
            automaticLayout: true, fontSize: 13, minimap: { enabled: false },
            scrollBeyondLastLine: false
          });
        } else {
          const model = state.tbEditor.getModel();
          if (model) {
            monaco.editor.setModelLanguage(model, lang);
            model.setValue(content);
          }
        }
        // ★ 关键：面板创建时父容器可能尺寸为 0，Monaco 会塌陷成 5x5。
        //   这里强制重新测量一次，并延迟再补一次（等布局稳定）。
        state.tbEditor.layout();
        setTimeout(() => { try { state.tbEditor.layout(); } catch (e) {} }, 60);
        setTimeout(() => { try { state.tbEditor.layout(); } catch (e) {} }, 300);
      });
    }).catch((e) => {
      editor.innerHTML = '<p class="hint" style="padding:8px;color:var(--err)">读取失败：' + esc(e.message) + '</p>';
    });
  };

  list.querySelectorAll('[data-file]').forEach(b => { b.onclick = () => openFile(b.dataset.file); });
  openFile(editable[0]);

  const saveBtn = document.getElementById('tb-code-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const name = state.tbCurrentFile;
      if (!name) { toast('请先选择文件', 'err'); return; }
      if (!state.tbEditor) { toast('编辑器还没准备好', 'err'); return; }
      const val = state.tbEditor.getValue();
      try {
        const r = await bridge.writeFile('tianlu_bot/' + name, val);
        if (r && r.ok !== false) toast('已保存 ' + name, 'ok');
        else toast('保存失败：' + ((r && r.error) || '未知错误'), 'err');
      } catch (e) { toast('保存失败：' + e.message, 'err'); }
    };
  }
}
/* ============ 工具箱 · 命令速查面板 ============ */
async function initToolboxCommands() {
  const body = document.getElementById('tb-cmd-body');
  if (!body) return;

  body.innerHTML = '<p class="hint" style="padding:10px">正在加载命令列表…</p>';

  const r = await bridge.commandsList();
  if (!r || !r.ok) {
    body.innerHTML = '<div class="card"><p style="color:var(--err)">加载失败：' + esc((r && r.error) || '未知错误') + '</p></div>';
    return;
  }

  const list = r.list || [];
  const groups = {};
  for (const it of list) {
    const g = it.group || '其他';
    if (!groups[g]) groups[g] = [];
    groups[g].push(it);
  }

  const order = ['基础', '实用工具', '游戏', '音频', '其他'];
  let html = '';
  for (const gname of order) {
    const items = groups[gname];
    if (!items || !items.length) continue;
    html += `
      <div class="card" style="margin-bottom:12px">
        <h3>${esc(gname)}${gname === '游戏' ? '（' + items.length + ' 个）' : ''}</h3>
        <div class="cmd-grid">
          ${items.map(it => {
            const cost = it.cost ? `<span class="cmd-cost">${it.cost} 金币${it.win ? ' · 赢 ' + it.win : ''}</span>` : '';
            const param = it.needParam ? `<span class="cmd-param">参数：${esc(it.needParam)}</span>` : '';
            return `
              <div class="cmd-item" data-cmd="${esc(it.cmd)}">
                <div class="cmd-line">
                  <code class="cmd-code">@机器人 ${esc(it.cmd)}</code>
                  <button class="btn-link cmd-copy" data-copy="${esc(it.cmd)}">复制</button>
                </div>
                <div class="cmd-desc">${esc(it.desc || '')}</div>
                ${(param || cost) ? `<div class="cmd-meta">${param}${cost}</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }
  body.innerHTML = html || '<div class="card"><p class="hint">没有找到命令</p></div>';

  // 单条复制
  body.querySelectorAll('.cmd-copy').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      copyText('@机器人 ' + btn.dataset.copy);
      toast('已复制命令', 'ok');
    };
  });

  // 复制全部
  const copyAll = document.getElementById('tb-cmd-copyall');
  if (copyAll) {
    copyAll.onclick = async () => {
      const t = await bridge.commandsText();
      if (t && t.ok) {
        copyText(t.text);
        toast('完整命令表已复制，可直接发群里', 'ok');
      } else {
        toast('生成失败', 'err');
      }
    };
  }

  // 刷新
  const refresh = document.getElementById('tb-cmd-refresh');
  if (refresh) {
    refresh.onclick = async () => {
      state.tbCmdReady = false;
      await initToolboxCommands();
    };
  }
}
/* ============ 工具箱 · 反馈面板 ============ */
async function initToolboxFeedback() {
  const box = document.getElementById('tb-feedback-body');
  if (!box) { console.warn('[tb-fb] 面板节点缺失'); return; }

  box.innerHTML = `
    <div class="field">
      <label>问题类型</label>
      <select id="tb-fb-type">
        <option value="bug">🐛 功能异常</option>
        <option value="suggest">💡 功能建议</option>
        <option value="other">❓ 其他</option>
      </select>
    </div>
    <div class="field" style="margin-top:10px">
      <label>详细描述</label>
      <textarea id="tb-fb-text" rows="6" placeholder="请描述遇到的问题或你的建议…" style="width:100%;resize:vertical"></textarea>
    </div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn primary" id="tb-fb-submit">提交反馈</button>
    </div>
    <div id="tb-fb-log" style="margin-top:12px"></div>`;

  const btn = document.getElementById('tb-fb-submit');
  const log = document.getElementById('tb-fb-log');
  btn.onclick = async () => {
    const type = document.getElementById('tb-fb-type').value;
    const text = document.getElementById('tb-fb-text').value.trim();
    if (!text) { toast('请填写描述', 'err'); return; }
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const r = await bridge.feedbackSubmit({ type, text });
      if (r && r.ok) {
        toast('反馈已提交', 'ok');
        document.getElementById('tb-fb-text').value = '';
        log.innerHTML = '';
      } else {
        log.innerHTML = '<p style="color:var(--err)">提交失败：' + esc((r && r.error) || '未知错误') + '</p>';
      }
    } catch (e) {
      log.innerHTML = '<p style="color:var(--err)">提交失败：' + esc(e.message) + '</p>';
    }
    btn.disabled = false; btn.textContent = '提交反馈';
  };
}

/* ============ QQ 更新向导（5 步） ============ */
// 触发场景：扫码登录失败 / NapCat 打不开 QQ / 设置里手动检查
// 每步都要用户点「确定」才继续，最后一步真的下载 QQ 安装包
const qqWizardState = {
  open: false,
  step: 0,
  data: null,      // qq:check 的返回
  steps: [],       // 步骤定义
  downloading: false
};

async function openQQWizard(reason) {
  if (qqWizardState.open) return;

  // 1) 拉取检测结果
  const r = await bridge.qqCheck({ protocol: 'NapCat 4.18.41' });
  if (!r || !r.ok) { toast('QQ 版本检测失败：' + ((r && r.error) || '未知错误'), 'err'); return; }

  // 2) 拉取步骤定义
  const ws = await bridge.qqWizardSteps();
  if (!ws || !ws.ok) { toast('加载向导失败', 'err'); return; }

  qqWizardState.open = true;
  qqWizardState.step = 0;
  qqWizardState.data = r;
  qqWizardState.steps = ws.steps;
  qqWizardState.reason = reason || '';

  renderQQWizard();
}

function closeQQWizard() {
  qqWizardState.open = false;
  const el = document.getElementById('qq-wizard-mask');
  if (el) el.remove();
}

function renderQQWizard() {
  let mask = document.getElementById('qq-wizard-mask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'qq-wizard-mask';
    mask.className = 'qq-wiz-mask';
    document.body.appendChild(mask);
  }

  const st = qqWizardState;
  const total = st.steps.length;
  const cur = st.steps[st.step];
  if (!cur) { closeQQWizard(); return; }

  const d = st.data || {};
  const local = (d.local && d.local.version) || '未知';
  const latest = d.latest || '未知';
  const updateDate = d.updateDate || '';
  const compat = d.compat || {};

  // 文案替换
  const fill = (s) => String(s || '')
    .replace(/\{local\}/g, local)
    .replace(/\{latest\}/g, latest)
    .replace(/\{updateDate\}/g, updateDate)
    .replace(/\{protocol\}/g, d.protocol || 'NapCat')
    .replace(/\{expect\}/g, (compat.expect || []).join(' / ') || '未知');

  const isLast = st.step === total - 1;
  const progress = Math.round(((st.step + 1) / total) * 100);

  mask.innerHTML = `
    <div class="qq-wiz-box">
      <div class="qq-wiz-head">
        <span class="qq-wiz-step">第 ${st.step + 1} / ${total} 步</span>
        <button class="qq-wiz-close" id="qq-wiz-x">✕</button>
      </div>
      <div class="qq-wiz-progress"><div style="width:${progress}%"></div></div>
      <h3 class="qq-wiz-title">${esc(cur.title)}</h3>
      ${st.step === 0 ? `
        <div class="qq-wiz-versions">
          <div class="qq-vrow"><span>当前版本</span><b>${esc(local)}</b></div>
          <div class="qq-vrow"><span>最新版本</span><b class="qq-new">${esc(latest)}</b>${updateDate ? `<small>（${esc(updateDate)} 发布）</small>` : ''}</div>
        </div>` : ''}
      <div class="qq-wiz-body">${esc(fill(cur.body)).replace(/\n/g, '<br>')}</div>
      ${st.step === total - 1 ? `
        <div id="qq-dl-area" style="margin-top:14px"></div>` : ''}
      <div class="qq-wiz-actions">
        <button class="btn" id="qq-wiz-cancel">${esc(cur.cancelText || '取消')}</button>
        <button class="btn primary" id="qq-wiz-ok">${esc(cur.confirmText || '确定')}</button>
      </div>
    </div>`;

  document.getElementById('qq-wiz-x').onclick = closeQQWizard;
  document.getElementById('qq-wiz-cancel').onclick = closeQQWizard;

  const okBtn = document.getElementById('qq-wiz-ok');
  okBtn.onclick = async () => {
    if (isLast) {
      await doQQDownloadAndInstall();
    } else {
      qqWizardState.step++;
      renderQQWizard();
    }
  };
}

async function doQQDownloadAndInstall() {
  const st = qqWizardState;
  const area = document.getElementById('qq-dl-area');
  const okBtn = document.getElementById('qq-wiz-ok');
  if (st.downloading) return;

  const url = (st.data && st.data.downloadUrl) || '';
  if (!url) {
    if (area) area.innerHTML = '<p style="color:var(--err)">拿不到官方下载地址，正在为你打开官网…</p>';
    await bridge.qqOpenDownloadPage();
    return;
  }

  st.downloading = true;
  okBtn.disabled = true;
  okBtn.textContent = '下载中…';

  // 监听进度
  let unsub = null;
  try {
    unsub = bridge.onQQDownloadProgress((p) => {
      if (!area) return;
      const got = p.got || 0, total = p.total || 0;
      const pct = total > 0 ? Math.min(99, Math.round(got / total * 100)) : 0;
      area.innerHTML = `
        <div style="font-size:13px;margin-bottom:6px">正在下载 QQ 安装包… ${pct}%</div>
        <div class="qq-dl-bar"><div style="width:${pct}%"></div></div>
        <div style="font-size:11.5px;opacity:.6;margin-top:4px">${(got/1048576).toFixed(1)} / ${total ? (total/1048576).toFixed(1) : '?'} MB</div>`;
    });
  } catch (e) {}

  const r = await bridge.qqDownloadInstaller(url, null);
  if (unsub) { try { unsub(); } catch (e) {} }

  st.downloading = false;
  okBtn.disabled = false;

  if (r && r.ok) {
    if (area) area.innerHTML = `<p style="color:var(--ok,#6fdd8f)">✅ 下载完成（${(r.size/1048576).toFixed(1)} MB）<br><small style="opacity:.7">${esc(r.name)}</small></p>`;
    okBtn.textContent = '运行安装程序';
    okBtn.onclick = async () => {
      const rr = await bridge.qqRunInstaller(r.path);
      if (rr && rr.ok) {
        if (area) area.innerHTML += '<p style="margin-top:8px">已启动安装程序，请按提示完成安装。<br>安装完成后重启本程序。</p>';
        okBtn.textContent = '完成';
        okBtn.onclick = closeQQWizard;
      } else {
        toast('启动安装程序失败：' + ((rr && rr.error) || ''), 'err');
      }
    };
  } else {
    if (area) area.innerHTML = `<p style="color:var(--err)">下载失败：${esc((r && r.error) || '未知错误')}</p><p style="margin-top:6px">正在为你打开官网下载页…</p>`;
    await bridge.qqOpenDownloadPage();
    okBtn.textContent = '关闭';
    okBtn.onclick = closeQQWizard;
  }
}
/* ============ 插件管理 ============ */
async function renderPlugins() {
  const el = document.getElementById('page-plugins');
  if (!el) return;

  if (!el.dataset.ready) {
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h3>🔌 插件管理</h3>
        <p class="hint">管理机器人用什么插件。带 <span style="color:var(--accent)">核心</span> 标记的是地基，禁用会导致功能失效。</p>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn sm" id="pl-open-nonebot">📂 打开 NoneBot 插件目录</button>
          <button class="btn sm" id="pl-open-napcat">📂 打开 NapCat 插件目录</button>
          <button class="btn sm" id="pl-refresh">🔄 刷新</button>
        </div>
      </div>
      <div class="tab-bar" id="pl-tabs" style="margin-bottom:12px">
        <button class="tab-btn active" data-tab="nonebot">NoneBot 插件 <span id="pl-cnt-nonebot"></span></button>
        <button class="tab-btn" data-tab="napcat">NapCat 插件 <span id="pl-cnt-napcat"></span></button>
      </div>
      <div id="pl-body"></div>`;
    el.dataset.ready = '1';

    el.querySelectorAll('#pl-tabs .tab-btn').forEach(btn => {
      btn.onclick = () => {
        el.querySelectorAll('#pl-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.pluginTab = btn.dataset.tab;
        renderPluginList();
      };
    });
    document.getElementById('pl-open-nonebot').onclick = () => bridge.pluginsOpenFolder('nonebot');
    document.getElementById('pl-open-napcat').onclick = () => bridge.pluginsOpenFolder('napcat');
    document.getElementById('pl-refresh').onclick = () => loadPlugins(true);
  }

  await loadPlugins();
}

async function loadPlugins(force) {
  if (state.pluginsData && !force) { renderPluginList(); return; }
  const body = document.getElementById('pl-body');
  if (body) body.innerHTML = '<p class="hint">正在读取插件列表…</p>';

  const r = await bridge.pluginsList();
  if (!r || !r.ok) {
    if (body) body.innerHTML = '<div class="card"><p style="color:var(--err)">读取失败：' + esc((r && r.error) || '未知错误') + '</p></div>';
    return;
  }
  state.pluginsData = r.data;

  const nb = r.data.nonebot.length;
  const nc = r.data.napcat.length;
  const c1 = document.getElementById('pl-cnt-nonebot');
  const c2 = document.getElementById('pl-cnt-napcat');
  if (c1) c1.textContent = '（' + nb + '）';
  if (c2) c2.textContent = '（' + nc + '）';

  renderPluginList();
}

function renderPluginList() {
  const body = document.getElementById('pl-body');
  if (!body || !state.pluginsData) return;
  const tab = state.pluginTab || 'nonebot';
  const list = tab === 'nonebot' ? state.pluginsData.nonebot : state.pluginsData.napcat;

  if (!list.length) {
    body.innerHTML = '<div class="card"><p class="hint">这个分类下还没有插件。</p></div>';
    return;
  }

  const isNonebot = tab === 'nonebot';
  const installBtn = isNonebot
    ? '<button class="btn sm primary" id="pl-install" style="margin-bottom:12px">➕ 安装插件（选择 zip）</button>'
    : '<p class="hint" style="margin-bottom:12px">NapCat 插件请手动放入插件目录后刷新。</p>';

  body.innerHTML = installBtn + '<div class="plugin-grid">' + list.map(p => {
    const badge = p.builtin ? '<span class="pl-badge">内置</span>' : '<span class="pl-badge ext">外部</span>';
    const core = p.protected ? '<span class="pl-badge core">核心</span>' : '';
    const missing = p.missing ? '<span class="pl-badge err">目录缺失</span>' : '';
    const desc = p.description ? esc(p.description) : '<span style="opacity:.5">（无描述）</span>';
    const ver = p.version ? 'v' + esc(p.version) : '';
    const id = isNonebot ? p.name : (p.dirName || p.name);
    return `
      <div class="plugin-card" data-name="${esc(id)}">
        <div class="plugin-head">
          <div>
            <strong>${esc(p.name)}</strong> ${badge}${core}${missing}
            <span class="plugin-meta">${ver}${p.author ? ' · ' + esc(p.author) : ''}</span>
          </div>
          <label class="switch">
            <input type="checkbox" data-toggle="${esc(id)}" ${p.enabled ? 'checked' : ''} ${p.protected ? 'disabled' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <p class="plugin-desc">${desc}</p>
        ${p.removable ? `<button class="btn-link" data-remove="${esc(id)}" style="color:var(--err)">删除</button>` : ''}
      </div>`;
  }).join('') + '</div>';

  // 安装
  const inst = document.getElementById('pl-install');
  if (inst) {
    inst.onclick = async () => {
      inst.disabled = true;
      inst.textContent = '正在安装…';
      const r = await bridge.pluginsInstall('nonebot');
      inst.disabled = false;
      inst.textContent = '➕ 安装插件（选择 zip）';
      if (r && r.canceled) return;
      if (r && r.ok) {
        toast('插件「' + r.name + '」安装成功，重启机器人后生效', 'ok');
        await loadPlugins(true);
      } else {
        toast('安装失败：' + ((r && r.error) || '未知错误'), 'err');
      }
    };
  }

  // 启停
  body.querySelectorAll('[data-toggle]').forEach(cb => {
    cb.onchange = async () => {
      const name = cb.dataset.toggle;
      const enabled = cb.checked;
      const r = await bridge.pluginsSetEnabled(tab, name, enabled);
      if (r && r.ok) {
        toast((enabled ? '已启用 ' : '已禁用 ') + name + '，重启机器人后生效', 'ok');
        await loadPlugins(true);
      } else {
        toast((r && r.error) || '操作失败', 'err');
        cb.checked = !enabled;
      }
    };
  });

  // 删除
  body.querySelectorAll('[data-remove]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.remove;
      if (!confirm('确定删除插件「' + name + '」？此操作不可撤销。')) return;
      const r = await bridge.pluginsRemove(tab, name);
      if (r && r.ok) { toast('已删除 ' + name, 'ok'); await loadPlugins(true); }
      else toast((r && r.error) || '删除失败', 'err');
    };
  });
}

/* ============ 人格 ============ */
async function renderPersona() {
  const el = document.getElementById('page-persona');
  if (!el.dataset.ready) {
    el.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h3>🎭 <span data-i18n="persona.current"></span></h3>
          <p class="hint" data-i18n="persona.currentHint"></p>
          <div class="field"><label data-i18n="persona.name"></label><input type="text" id="ps-name" placeholder=""></div>
          <div class="field"><label data-i18n="persona.text"></label><textarea id="ps-text" rows="12"></textarea></div>
          <div class="field"><label data-i18n="persona.actions"></label><textarea id="ps-actions" rows="4" placeholder="每行一个动作词，例如：甩尾巴"></textarea></div>
          <div class="btn-row">
            <button class="btn primary" id="ps-save" data-i18n="persona.save"></button>
            <button class="btn" id="ps-export" data-i18n="persona.export"></button>
            <button class="btn" id="ps-import" data-i18n="persona.import"></button>
          </div>
        </div>
        <div class="card">
          <h3>✨ <span data-i18n="persona.ai.title"></span></h3>
          <p class="hint" data-i18n="persona.ai.hint"></p>
          <div class="field"><label data-i18n="persona.ai.name"></label><input type="text" id="ai-name" placeholder="例如：天禄"></div>
          <div class="field"><label data-i18n="persona.ai.personality"></label><textarea id="ai-personality" rows="2" placeholder="例如：傲娇、嘴硬心软、爱吐槽"></textarea></div>
          <div class="field"><label data-i18n="persona.ai.petphrase"></label><input type="text" id="ai-petphrase" placeholder="例如：哼、才不是关心你"></div>
          <div class="field"><label data-i18n="persona.ai.hobby"></label><input type="text" id="ai-hobby" placeholder="例如：吃零食、晒太阳"></div>
          <div class="field"><label data-i18n="persona.ai.extra"></label><textarea id="ai-extra" rows="2" placeholder="其他补充要求（可选）"></textarea></div>
          <div class="btn-row">
            <button class="btn primary" id="ai-generate" data-i18n="persona.ai.generate"></button>
            <button class="btn" id="ai-fill" data-i18n="persona.ai.fill"></button>
          </div>
          <p class="hint" id="ai-status"></p>
        </div>
      </div>`;
    setLang(state.settings.language || 'zh');
    document.getElementById('ps-save').onclick = async () => {
      await bridge.savePersona({
        name: document.getElementById('ps-name').value,
        system_prompt: document.getElementById('ps-text').value,
        actions: (document.getElementById('ps-actions').value || '').split('\n').map(s => s.trim()).filter(Boolean)
      });
      toast(t('persona.saved'));
    };
    document.getElementById('ps-export').onclick = async () => { const r = await bridge.exportPersona(); r.ok ? toast(t('persona.saved')) : (r.canceled || toast(r.error || 'fail', 'err')); };
    document.getElementById('ps-import').onclick = async () => {
      const r = await bridge.importPersona();
      if (r.ok) { fillPersonaForm(r.data); toast(t('persona.saved')); }
      else if (!r.canceled) toast(r.error || 'fail', 'err');
    };
    document.getElementById('ai-generate').onclick = async () => {
      const name = document.getElementById('ai-name').value.trim();
      const personality = document.getElementById('ai-personality').value.trim();
      const petphrase = document.getElementById('ai-petphrase').value.trim();
      const hobby = document.getElementById('ai-hobby').value.trim();
      const extra = document.getElementById('ai-extra').value.trim();
      if (!name && !personality && !petphrase && !hobby && !extra) { toast(t('persona.ai.empty'), 'err'); return; }
      // 拼提示词：完整代码资料 + 用户填写的信息 → 让免费 AI 生成人格 JSON
      const prompt = `请帮我生成一个机器人的人格配置文件，严格按照下面的 JSON 结构输出，只输出 JSON，不要任何多余解释。

【人物名字】${name || '（未填，请自拟一个）'}
【性格特点】${personality || '（未填，请自拟一个可爱/有趣/傲娇的性格）'}
【口头禅】${petphrase || '（未填，请自拟几个符合人设的口头禅）'}
【爱好/日常】${hobby || '（未填，请自拟符合人设的爱好）'}
【其他补充要求】${extra || '（无）'}

## 需要输出的 JSON 结构（必须严格按这个格式）：

{
  "name": "机器人名字",
  "system_prompt": "一段完整的 system_prompt，用于 AI 对话。要求：1.开头说明角色身份来源（如某作品里的角色或原创设定）；2.描述性格、说话风格、口头禅、行为习惯；3.写明回复要求：说话前先用括号（）描写一个生动的动作，回复正文控制在 80-150 字、不分段、不重复用户的话、不说教",
  "actions": ["动作1", "动作2", "动作3", "动作4", "动作5", "动作6", "动作7", "动作8", "动作9", "动作10"]
}

注意：
- system_prompt 里的"回复要求"要完整保留（说话前加动作、80-150字、不分段等）
- actions 数组给 10-12 个符合人设的动作词，每个 2-5 个字
- 所有内容用中文`;
      try {
        await navigator.clipboard.writeText(prompt);
        toast(t('persona.ai.copied'));
      } catch (e) {
        toast(t('persona.ai.copyFail'), 'err');
      }
      openLinkSafe('https://chat.deepseek.com');
    };
    document.getElementById('ai-fill').onclick = () => { if (state.lastAiPersona) fillPersonaForm(state.lastAiPersona); };
    el.dataset.ready = '1';
  }
  const p = await bridge.getPersona();
  if (p && !document.getElementById('ps-name').value) fillPersonaForm(p);
}
function fillPersonaForm(d) {
  document.getElementById('ps-name').value = d.name || '';
  document.getElementById('ps-text').value = d.system_prompt || '';
  const actionsEl = document.getElementById('ps-actions');
  if (actionsEl) actionsEl.value = Array.isArray(d.actions) ? d.actions.join('\n') : '';
}

/* ============ AI 写代码 ============ */
function openAiCodeModal() {
  if (!state.currentCodeFile) { toast(t('code.select'), 'err'); return; }
  let modal = document.getElementById('ai-code-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ai-code-modal';
    modal.className = 'modal-mask';
    modal.innerHTML = '<div class="modal-box"><h3>✨ <span data-i18n="code.aiTitle"></span></h3>' +
      '<div class="field"><label data-i18n="code.aiReq"></label><textarea id="ai-req" rows="5" placeholder=""></textarea></div>' +
      '<div class="btn-row"><button class="btn primary" id="ai-go" data-i18n="code.aiGo"></button><button class="btn" id="ai-cancel" data-i18n="common.cancel"></button></div>' +
      '<p class="hint" id="ai-status"></p></div>';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  setLang(state.settings.language || 'zh');
  const st = document.getElementById('ai-status');
  st.textContent = '';
  document.getElementById('ai-cancel').onclick = () => { modal.style.display = 'none'; };
  document.getElementById('ai-go').onclick = async () => {
    const req = document.getElementById('ai-req').value.trim();
    if (!req) { st.textContent = t('code.aiEmpty'); return; }
    const btn = document.getElementById('ai-go');
    btn.disabled = true;
    st.textContent = '🤖 ' + t('code.aiThinking');
    const r = await bridge.aiWriteCode({ file: state.currentCodeFile, content: state.editor.getValue(), requirement: req });
    btn.disabled = false;
    if (r.ok) {
      modal.style.display = 'none';
      state.editor.setValue(r.code);
      toast(t('code.aiDone'));
    } else {
      st.textContent = '❌ ' + (r.error || 'fail');
    }
  };
}
/* ============ 使用说明 ============ */
function renderHelp() {
  const el = document.getElementById('page-help');
  if (!el.dataset.ready) {
    el.innerHTML = '<div class="card about-hero" style="margin-bottom:16px"><div class="big">📖 使用说明 · 操作守则</div></div>' +
      '<div class="help-layout">' +
        '<div class="card help-nav" id="help-nav"></div>' +
        '<div class="card help-content" id="help-content" style="flex:1"></div>' +
      '</div>';
    el.dataset.ready = '1';
    renderHelpNav();
  }
}

function renderHelpNav() {
  const nav = document.getElementById('help-nav');
  if (!nav) return;
  const topics = [
    { id: 'quick', name: '① 快速开始' },
    { id: 'rules', name: '② 机器人操作守则' },
    { id: 'games', name: '③ 游戏玩法大全' },
    { id: 'config', name: '④ 配置指南' },
    { id: 'faq', name: '⑤ 故障排查' }
  ];
  nav.innerHTML = topics.map(t => '<div class="help-topic" data-topic="' + t.id + '">' + t.name + '</div>').join('');
  nav.querySelectorAll('[data-topic]').forEach(b => { b.onclick = () => showHelpTopic(b.dataset.topic); });
  showHelpTopic('quick');
}

async function showHelpTopic(id) {
  const box = document.getElementById('help-content');
  if (!box) return;
  document.querySelectorAll('#help-nav .help-topic').forEach(b => b.classList.toggle('active', b.dataset.topic === id));
  if (id === 'quick') {
    box.innerHTML = '<h3>🚀 快速开始（5 步）</h3>' + [
      '<div class="help-rule"><b>第 1 步 · 启动 NapCat</b><br>首页点「启动 NapCat」→ 用手机 QQ 扫码登录机器人号（第一次需要扫码）。</div>'
    ].join('') +
    [
      '<div class="help-rule"><b>第 2 步 · 启动机器人</b><br>首页点「启动机器人」→ 程序会自动检测 Python 和依赖库，缺了会自动安装（首次约 1-3 分钟）。等日志出现「OneBot V11 连接成功」。</div>'
    ].join('') +
    [
      '<div class="help-rule"><b>第 3 步 · 填 API 密钥</b><br>左侧「设置」→ API 配置 → 填 DeepSeek 密钥（对话必填）、智谱（识图可选）、MiniMax（语音可选）。密钥只保存在你自己电脑上。</div>'
    ].join('') +
    [
      '<div class="help-rule"><b>第 4 步 · 配置账号</b><br>设置里填：管理员 QQ（OWNER_ID）、机器人 QQ（BOT_QQ）、群号（GROUP_ID）。机器人只在你填的群里工作。</div>'
    ].join('') +
    [
      '<div class="help-rule"><b>第 5 步 · 测试</b><br>在你配置的群里 @机器人 说句话，它就会回复。点歌、游戏、语音都直接试。</div>'
    ].join('');
  } else if (id === 'rules') {
    box.innerHTML = '<h3>⚔️ 机器人操作守则（5 条）</h3>' + [
      '<div class="help-rule"><b>守则 1 · 群聊只认 @</b><br>群聊里所有命令都要 @机器人（或叫它名字）。私聊可以直接说。</div>',
      '<div class="help-rule"><b>守则 2 · 每日限额</b><br>AI 对话默认每人每天 200 次、语音 30 次、点歌 20 次（防刷爆你的 API 余额）。用完了它会说「明天再来」。可在 配置→ai_chat.env 修改。</div>',
      '<div class="help-rule"><b>守则 3 · 功能开关</b><br>左侧「功能」页可随时开关任何功能（AI对话/游戏/语音/点歌…），改完立即生效不用重启。关掉的功能数据不会丢。</div>',
      '<div class="help-rule"><b>守则 4 · 系统指令仅管理员</b><br>#sysinfo、#cpu 等主机信息指令只有 OWNER_ID 能用，防止群友偷看你的电脑信息。</div>',
      '<div class="help-rule"><b>守则 5 · 隐私</b><br>聊天记录永久保存在本机（消息页可查），不会上传。API 密钥只存在你自己电脑的 .env 里。</div>'
    ].join('');
  } else if (id === 'games') {
    box.innerHTML = '<h3>🎮 游戏玩法大全</h3><p class="hint">群聊里 @机器人 后直接说指令。金币是通用货币，签到/抽签赚，商店买卖回收。</p><div id="help-games-list"></div>' +
      '<h3 style="margin-top:20px">🎯 小游戏触发方式（重点）</h3>' +
      '<div class="help-rule"><b>① 群聊触发</b><br>必须 <b>@机器人 + 指令</b>，例如「@机器人 掷骰子」「@机器人 签到」。不 @ 机器人不会理你。</div>' +
      '<div class="help-rule"><b>② 私聊触发</b><br>白名单 QQ 私聊机器人，直接说指令（不用 @），例如「签到」「我的信息」。</div>' +
      '<div class="help-rule"><b>③ 指令必须一字不差</b><br>指令要和上面列表里的完全一致（部分支持参数，如「买 苹果」）。说错一个字就触发不了。</div>' +
      '<div class="help-rule"><b>④ 触发优先级最高</b><br>@机器人 说游戏指令时，<b>优先当作游戏处理</b>，不会被当成聊天——所以就算群聊被禁闲聊，游戏照常能玩。</div>' +
      '<div class="help-rule"><b>⑤ 经济系统</b><br>签到：每天 1 次 +10~30 金币；抽签：+5~30 经验；经验升级；金币可买/卖/查背包（指令：商店 / 买 / 卖 / 背包 / 我的信息）。</div>' +
      '<div class="help-rule"><b>⑥ 开关与限制</b><br>每个游戏都能在「功能」页单独开关；每人每天有游戏次数上限，防刷屏；只在配置的群里生效。</div>';
    try {
      const gs = await bridge.gamesList();
      const gl = document.getElementById('help-games-list');
      if (gl && gs.length) gl.innerHTML = '<div style="column-count:2;column-gap:16px">' + gs.map(g =>
        '<div class="help-rule" style="break-inside:avoid"><b>' + esc(g.name) + '</b> · 指令「' + esc(g.cmd) + '」' + (g.cost ? '（' + g.cost + '金币/次）' : '（免费）') + '<br><small style="opacity:.7">' + esc(g.desc || '') + '</small></div>'
      ).join('') + '</div>';
    } catch (e) {}
  } else if (id === 'config') {
    box.innerHTML = '<h3>🔧 配置指南（5 项）</h3>' + [
      '<div class="help-rule"><b>1 · 配置文件在哪</b><br>左侧「配置文件」页：主配置 .env（密钥/QQ号）、人格文件 qq.json、ai_chat.env（对话/限额）、00_features.env（功能总开关）、NapCat 配置。</div>',
      '<div class="help-rule"><b>2 · API 密钥获取与充值</b><br>设置 → API 配置里每个密钥下方都有「🔑 获取密钥」「💰 充值」按钮，直达官网。复制密钥粘贴回来即可。</div>',
      '<div class="help-rule"><b>3 · 语音克隆</b><br>工具箱 → 语音克隆：选基准音频（10秒~5分钟）→ 一键克隆并配置 → 机器人立刻用新声音。</div>',
      '<div class="help-rule"><b>4 · 网易云 Cookie</b><br>工具箱 → Cookie 一键导入：浏览器 F12 复制请求头里的 Cookie（需含 MUSIC_U）→ 保存，点歌高音质永久生效。</div>',
      '<div class="help-rule"><b>5 · 壁纸与外观</b><br>设置 → 通用：换壁纸（PCL2 风格半透明）、透明度/模糊滑条、主题色、语言。</div>'
    ].join('');
  } else if (id === 'faq') {
    box.innerHTML = '<h3>🛠 故障排查（5 条）</h3>' + [
      '<div class="help-rule"><b>1 · 机器人不说话？</b><br>① 密钥填了吗 ② 群里 @了吗 ③ 群号在 GROUP_ID 里吗 ④ 首页日志有没有红色报错 → 有报错把日志截图发作者。</div>',
      '<div class="help-rule"><b>2 · NapCat 启动失败 / 异常退出？</b><br>① 官方 QQ 必须彻底退出（托盘右键退出）② 杀软加白名单 ③ 老系统（Win10 1909 及以下）需安装官方 QQ 客户端，程序会自动走兼容模式。</div>',
      '<div class="help-rule"><b>3 · 网页控制台一直加载？</b><br>说明 NapCat 没启动 → 打开该页时会自动拉起 NapCat，等 10 秒左右刷新即可。</div>',
      '<div class="help-rule"><b>4 · 终端打不出字？</b><br>确定当前在「命令行」标签页（NapCat/机器人两个标签是只读日志）。Ctrl+` 快速打开终端。</div>',
      '<div class="help-rule"><b>5 · 代码改坏了？</b><br>左侧「备份」页找回之前的代码一键恢复；或工具箱 → 恢复默认代码。AI 写代码前也会自动备份。</div>'
    ].join('');
  }
}
/* ============ 关于 ============ */
async function renderAbout() {
  const el = document.getElementById('page-about');
  if (!el.dataset.ready) {
    const data = await bridge.aboutData();
    el.innerHTML = `      <div class="card about-hero">
        <div class="big">🦊 机器人控制台</div>
        <div class="ver"><span data-i18n="about.version"></span> ${esc(data.app.version)}</div>
        <div class="btn-row" style="justify-content:center">
          <button class="btn primary" id="btn-bili">📺 <span data-i18n="about.openBili"></span></button>
        </div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <h3>📦 <span data-i18n="about.project"></span></h3>
          <table class="resource-table">
            <tr><th>项目</th><td>机器人 (Tianlu Bot)</td></tr>
            <tr><th><span data-i18n="about.version"></span></th><td>${esc(data.app.version)}</td></tr>
            <tr><th>技术栈</th><td>Electron · NapCat · NoneBot2 · Python</td></tr>
            <tr><th>说明</th><td>集成 NapCat QQ 框架与 AI 机器人的一体化桌面管理程序</td></tr>
          </table>
        </div>
        <div class="card">
          <h3>🙏 <span data-i18n="about.credits"></span></h3>
          <div class="credit-list">
            ${data.credits.map(c => `<div class="credit-item"><span class="c-name">${esc(c.name)}</span><span class="c-desc">${esc(c.desc)}</span></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>📝 <span data-i18n="about.updates"></span></h3>
        ${data.updates.map(u => `<div class="update-item"><h4>${esc(u.file.replace('.txt', ''))}</h4><pre>${esc(u.text)}</pre></div>`).join('') || '<p>' + t('common.none') + '</p>'}
      </div>`;
    setLang(state.settings.language || 'zh');
    document.getElementById('btn-bili').onclick = () => openLinkSafe(data.bilibili);
    el.dataset.ready = '1';
  }
}

/* ============ 崩溃弹窗 ============ */
function showCrash(crash) {
  const ov = h(`<div class="crash-overlay"><div class="crash-card">
    <h2 data-i18n="crash.title">⚠️ ${t('crash.title')}</h2>
    <p>${t('crash.message')}</p>
    <pre>${esc(crash.message)}</pre>
    <div class="btn-row">
      <button class="btn primary" id="crash-copy">📋 <span data-i18n="crash.copy"></span></button>
      <button class="btn" id="crash-close" data-i18n="common.close"></button>
    </div>
  </div></div>`);
  document.body.appendChild(ov);
  ov.querySelector('#crash-copy').onclick = () => { copyText(crash.message); toast(t('crash.copied')); };
  ov.querySelector('#crash-close').onclick = () => ov.remove();
}

/* ============ 事件绑定 ============ */
let napcatWasRunning = false;
function bindEvents() {
  // 全局按钮防抖：避免快速连点导致重复触发（低配机/软件渲染卡顿 + 误触双重防护）
  const btnLastClick = new WeakMap();
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button, .btn');
    if (!btn) return;
    // 按钮被 disabled 时拦截
    if (btn.disabled) return;
    // 快速连点防抖：450ms 内同一按钮只响应一次（软件渲染下反应慢，时长拉长防止连点卡顿）
    const now = Date.now();
    const last = btnLastClick.get(btn) || 0;
    if (now - last < 450) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    btnLastClick.set(btn, now);
  }, true); // 捕获阶段拦截，优先于 onclick

  bridge.on('proc:log', (p) => appendLog(p.kind, p.data));
  bridge.on('proc:status', (s) => {
    state.proc = s; updateProcUI();
    // NapCat 刚启动时自动刷新内置网页
    const wv = document.getElementById('webview');
    if (wv && s.napcat.running && !napcatWasRunning) {
      setTimeout(() => { try { wv.reload(); } catch (e) {} }, 1800);
    }
    // ★ NapCat 从「运行中」变成「已停止」→ 大概率打不开 QQ / 版本不匹配
    if (napcatWasRunning && !s.napcat.running && !state.qqWizardShown) {
      state.qqWizardShown = true;
      setTimeout(() => {
        toast('NapCat 已退出，可能是 QQ 无法启动或版本不匹配', 'err');
        openQQWizard('napcat-exited');
      }, 1200);
    }
    napcatWasRunning = s.napcat.running;
  });
  bridge.on('python:log', (msg) => appendLog('python', msg));
  bridge.on('sys:info', (d) => { state.sysinfo = d; updateResources(d); renderHomeResources(); });
  bridge.on('term:data', (d) => {
    if (!state.termSession) { state.termPreData = (state.termPreData || '') + d.data; return; }
    if (d.session === state.termSession && state.term) state.term.write(d.data);
  });
  bridge.on('crash', (c) => showCrash(c));
}

/* ============ 启动 ============ */
async function boot() {
  try {
    state.settings = await bridge.getSettings();
    state.appInfo = await bridge.appInfo();
    applySettings(state.settings);
    // 自定义图片（用户放在 assets/ 下，缺省自动回退默认样式）
    const _logo = new Image();
    _logo.onload = () => { const d = document.getElementById('logo-dot'); if (d) d.innerHTML = '<img src="assets/logo.png" style="width:100%;height:100%;object-fit:contain;border-radius:12px">'; };
    _logo.src = 'assets/logo.png';
    const _bg = new Image();
    _bg.onload = () => { document.body.style.backgroundImage = "url('assets/background.jpg')"; document.body.style.backgroundSize = 'cover'; document.body.style.backgroundPosition = 'center'; };
    _bg.src = 'assets/background.jpg';
    renderNav();
    navigate('home'); // 激活首页并渲染内容
    bindEvents();
    // 启动后自动运行
    if (state.settings.autoStart && state.settings.autoStart.napcat) bridge.startNapcat(state.settings.memory);
    if (state.settings.autoStart && state.settings.autoStart.bot) bridge.startBot({});
    // 定时刷新进程状态
    setInterval(refreshProc, 4000);
    // 全屏按钮 + F11
    const fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) fsBtn.onclick = () => bridge.toggleFullscreen();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F11') { e.preventDefault(); bridge.toggleFullscreen(); }
      if (e.ctrlKey && e.key === String.fromCharCode(96)) { e.preventDefault(); navigate('terminal'); }
    });
  } catch (e) {
    console.error('boot error', e);
  }
  // 显示主界面 + 隐藏加载画面（关键：移除 #app 的 hidden 类）
  // 更新横幅按钮绑定（去下载 / 稍后）
  const upBanner = document.getElementById('update-banner');
  if (upBanner) {
    const goBtn = document.getElementById('btn-update-go');
    const closeBtn = document.getElementById('btn-update-close');
    if (goBtn) goBtn.onclick = () => {
      const u = state.updateInfo && state.updateInfo.url;
      if (u && /^https?:\/\//i.test(u) && !u.includes('你的下载链接')) { openLinkSafe(u); }
      else { toast(t('update.noUrl'), 'err'); }
    };
    if (closeBtn) closeBtn.onclick = () => {
      upBanner.classList.add('hidden');
      // 记住已忽略的版本：之后的自动检查不再重复弹这个版本
      if (state.updateInfo && state.updateInfo.latest) state.dismissedVersion = state.updateInfo.latest;
    };
  }
  document.getElementById('app').classList.remove('hidden');
  applyWallpaper();
  console.log('[renderer] boot complete, runtime=', state.appInfo && state.appInfo.runtimePath);
  setTimeout(() => document.getElementById('boot-overlay').classList.add('done'), 400);
}

window.__onLangChange = () => {};
document.addEventListener('DOMContentLoaded', boot);
