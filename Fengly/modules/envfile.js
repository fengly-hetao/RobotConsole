'use strict';
const fs = require('fs');

// 解析 .env：保留注释与空行，返回行数组
function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') { out.push({ type: 'empty', raw: line }); continue; }
    if (trimmed.startsWith('#') || trimmed.startsWith(';')) { out.push({ type: 'comment', raw: line }); continue; }
    const idx = line.indexOf('=');
    if (idx < 0) { out.push({ type: 'raw', raw: line }); continue; }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out.push({ type: 'key', key, value, raw: line });
  }
  return out;
}

function serializeEnv(lines) {
  return lines.map(l => {
    if (l.type === 'key') return `${l.key}=${l.value}`;
    return l.raw || '';
  }).join('\n');
}

function readEnvFile(path) {
  const text = fs.readFileSync(path, 'utf8');
  return parseEnv(text);
}

function writeEnvFile(path, lines) {
  const tmp = path + '.tmp-' + Date.now();
  fs.writeFileSync(tmp, serializeEnv(lines), 'utf8');
  try { fs.renameSync(tmp, path); } catch (err) { fs.copyFileSync(tmp, path); try { fs.unlinkSync(tmp); } catch (e2) {} }
}

// 将 key/value 映射回写，保留注释结构；新 key 追加到文件末尾
function updateEnv(path, entries) {
  const lines = readEnvFile(path);
  const existing = new Set();
  for (const l of lines) {
    if (l.type === 'key' && entries[l.key] !== undefined) {
      l.value = entries[l.key];
      existing.add(l.key);
    }
  }
  for (const k of Object.keys(entries)) {
    if (!existing.has(k)) lines.push({ type: 'key', key: k, value: entries[k] });
  }
  writeEnvFile(path, lines);
}

module.exports = { parseEnv, serializeEnv, readEnvFile, writeEnvFile, updateEnv };
