'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  appInfo: () => invoke('app:info'),

  ensureRuntime: () => invoke('runtime:ensure'),
  healthCheck: () => invoke('runtime:health'),
  listRuntimeFiles: (dir) => invoke('runtime:listFiles', dir),
  openRuntimeFolder: () => invoke('runtime:openFolder'),

  readFile: (rel) => invoke('file:read', rel),
  writeFile: (rel, content) => invoke('file:write', rel, content),
  readEnv: (rel) => invoke('env:read', rel),
  writeEnv: (rel, entries) => invoke('env:write', rel, entries),

  procStatus: () => invoke('proc:status'),
  startNapcat: (opts) => invoke('proc:startNapcat', opts),
  stopNapcat: () => invoke('proc:stopNapcat'),
  startBot: (opts) => invoke('proc:startBot', opts),
  stopBot: () => invoke('proc:stopBot'),

  detectPython: () => invoke('python:detect'),
  setupPython: () => invoke('python:setup'),

  readNetwork: () => invoke('network:read'),
  applyNetwork: (cfg) => invoke('network:apply', cfg),

  sysInfo: () => invoke('sys:info'),

  termCreate: () => invoke('term:create'),
  termWrite: (id, data) => invoke('term:write', id, data),
  termResize: (id, c, r) => invoke('term:resize', id, c, r),
  termKill: (id) => invoke('term:kill', id),

  getSettings: () => invoke('settings:get'),
  setSettings: (obj) => invoke('settings:set', obj),
  setSetting: (key, value) => invoke('settings:set', { [key]: value }),
  resetSettings: () => invoke('settings:reset'),

  pickFile: () => invoke('dialog:pickFile'),
  writePickedFile: (p, content) => invoke('file:writePicked', p, content),

  openExternal: (url) => invoke('shell:open', url),
  launchTool: (toolName) => invoke('tool:launch', toolName),
  queryUsage: (kind) => invoke('usage:query', kind),
  aboutData: () => invoke('about:data'),
  lastCrash: () => invoke('crash:last'),
  toggleFullscreen: () => invoke('win:toggleFullscreen'),
  exportCode: () => invoke('code:export'),
  importCode: () => invoke('code:import'),
  restoreCode: () => invoke('code:restore'),
  saveCookie: (cookie) => invoke('cookie:save', cookie),
  getPersona: () => invoke('persona:get'),
  savePersona: (data) => invoke('persona:save', data),
  exportPersona: () => invoke('persona:export'),
  importPersona: () => invoke('persona:import'),
  generatePersona: (input) => invoke('ai:generatePersona', input),
  gamesList: () => invoke('games:list'),
  checkUpdate: () => invoke('update:check'),
  downloadUpdate: (url) => invoke('update:download', url),
  openUpdatePage: (url) => invoke('update:openPage', url),
  backupList: () => invoke('backup:list'),
  backupRead: (id, file) => invoke('backup:read', id, file),
  backupApply: (id, file) => invoke('backup:apply', id, file),
  repairCode: () => invoke('code:repair'),
  markFeedbackDone: (id) => invoke('feedback:markDone', id),
  secStatus: () => invoke('sec:status'),
  secWhitelist: () => invoke('sec:whitelist'),
  aiWriteCode: (input) => invoke('ai:writeCode', input),
  pickImage: () => invoke('dialog:pickImage'),
  clearWallpaper: () => invoke('wallpaper:clear'),
  feedbackSubmit: (item) => invoke('feedback:submit', item),
  feedbackList: () => invoke('feedback:list'),
  audioList: () => invoke('audio:list'),
  audioUpload: () => invoke('audio:upload'),
  audioDelete: (name) => invoke('audio:delete', name),
  pickAudio: () => invoke('dialog:pickAudio'),
  cloneVoice: (opts) => invoke('audio:clone', opts),
  listTtsAudio: () => invoke('media:listTts'),
  listMusicAudio: () => invoke('media:listMusic'),
  msgList: () => invoke('msg:list'),
  msgRead: (name) => invoke('msg:read', name),

  // 插件管理
  pluginsList: () => invoke('plugins:list'),
  pluginsSetEnabled: (type, name, enabled) => invoke('plugins:setEnabled', { type, name, enabled }),
  pluginsInstall: (type) => invoke('plugins:install', { type }),
  pluginsRemove: (type, name) => invoke('plugins:remove', { type, name }),
  pluginsOpenFolder: (type) => invoke('plugins:openFolder', type),

  // 主页 AI 发送
  sendStatus: () => invoke('send:status'),
  sendMessage: (args) => invoke('send:message', args),

  // 工具：MD5
  md5: (text) => invoke('util:md5', text),

  // 账号登录管理
  accountState: () => invoke('account:state'),
  accountLogout: (account) => invoke('account:logout', { account }),

  // 命令速查
  commandsList: () => invoke('commands:list'),
  commandsText: () => invoke('commands:text'),

  // QQ 版本检测与更新向导
  qqCheck: (opts) => invoke('qq:check', opts),
  qqWizardSteps: () => invoke('qq:wizardSteps'),
  qqDownloadInstaller: (url, destDir) => invoke('qq:downloadInstaller', { url, destDir }),
  qqRunInstaller: (filePath) => invoke('qq:runInstaller', filePath),
  qqOpenDownloadPage: () => invoke('qq:openDownloadPage'),
  onQQDownloadProgress: (cb) => on('qq:downloadProgress', cb),
  onUpdateStatus: (cb) => on('update:status', cb),
  onUpdateProgress: (cb) => on('update:progress', cb),

  // 事件订阅
  on: (channel, cb) => {
    const valid = ['proc:log', 'proc:status', 'python:log', 'sys:info', 'term:data', 'crash', 'progress', 'update:progress', 'update:status', 'qq:downloadProgress'];
    if (valid.includes(channel)) {
      const listener = (e, payload) => cb(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
    return () => {};
  }
});
