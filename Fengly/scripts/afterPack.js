'use strict';
// afterPack 钩子：用 rcedit 给主程序 exe 嵌入图标与版本信息（不依赖签名工具链）
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  // 若提供签名证书（CSC_LINK），electron-builder 自己会完成图标+签名，这里不再重复处理
  if (process.env.CSC_LINK) { console.log('[afterPack] CSC_LINK set, skip (electron-builder handles icon+sign)'); return; }
  try {
    const root = path.join(__dirname, '..');
    const rcedit = path.join(root, 'tools', 'rcedit-x64.exe');
    const ico = path.join(root, 'build', 'icon.ico');
    const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
    if (!fs.existsSync(rcedit)) { console.log('[afterPack] rcedit not found, skip'); return; }
    if (!fs.existsSync(ico)) { console.log('[afterPack] icon.ico not found, skip'); return; }
    if (!fs.existsSync(exe)) { console.log('[afterPack] exe not found, skip'); return; }
    const args = [
      exe,
      '--set-icon', ico,
      '--set-version-string', 'ProductName', 'RobotConsole',
      '--set-version-string', 'FileDescription', 'Robot Console - NapCat All-in-One Manager',
      '--set-version-string', 'CompanyName', 'RobotConsole',
      '--set-version-string', 'LegalCopyright', 'Copyright (C) 2025',
      '--set-file-version', context.packager.appInfo.version,
      '--set-product-version', context.packager.appInfo.version
    ];
    execFileSync(rcedit, args, { stdio: 'inherit', windowsHide: true });
    console.log('[afterPack] icon + version info applied to', path.basename(exe));
  } catch (e) {
    console.error('[afterPack] failed:', e.message);
  }
};
