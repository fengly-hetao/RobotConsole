'use strict';
// 命令速查：从游戏的 games.json + 各插件的固定命令里汇总出一份"能直接发群里"的清单
//
// 用途：
//   1. 界面「工具 → 命令速查」页展示，用户点一下就能复制
//   2. 生成纯文本版，方便一键复制到群里/文档

const fs = require('fs');
const path = require('path');

// 固定命令（写在插件代码里，不在 games.json）
const FIXED_COMMANDS = [
  { cmd: '签到', desc: '每天签到领金币和经验', group: '基础', needAt: true, needParam: '' },
  { cmd: '我的信息', desc: '查看等级 / 经验 / 金币 / 点券', group: '基础', needAt: true, needParam: '' },
  { cmd: '背包', desc: '查看已购买的道具', group: '基础', needAt: true, needParam: '' },
  { cmd: '商店', desc: '打开商店看能买什么', group: '基础', needAt: true, needParam: '' },
  { cmd: '买 <商品名>', desc: '购买商品，例：买 小蛋糕', group: '基础', needAt: true, needParam: '<商品名>' },
  { cmd: '卖 <商品名>', desc: '卖掉背包里的东西', group: '基础', needAt: true, needParam: '<商品名>' },
  { cmd: '抽签', desc: '抽运势签（大吉/中吉/小吉/末吉）', group: '基础', needAt: true, needParam: '' },
  { cmd: '今日运势', desc: '查看今天的运势（每个群友不同，每天固定）', group: '实用工具', needAt: true, needParam: '' },
  { cmd: '天气 <城市>', desc: '查实时天气，例：天气 北京', group: '实用工具', needAt: true, needParam: '<城市名>' },
  { cmd: '群友印象', desc: '看看机器人对你的印象（可 @别人 查对方）', group: '实用工具', needAt: true, needParam: '' },
  { cmd: '今日一句', desc: '每天一句不同的话', group: '实用工具', needAt: true, needParam: '' },
  { cmd: '一言', desc: '随机来一句', group: '实用工具', needAt: true, needParam: '' },
  { cmd: '骰<N>', desc: '免费掷骰子，最多 10 个，例：骰3', group: '实用工具', needAt: true, needParam: '' },
  { cmd: '随机数 <A> <B>', desc: 'A 到 B 之间的随机数，例：随机数 1 100', group: '实用工具', needAt: true, needParam: '<最小值> <最大值>' },
  { cmd: '音频列表', desc: '查看工具箱上传的音频', group: '音频', needAt: true, needParam: '' },
  { cmd: '播放音频 <名字>', desc: '播放指定音频，例：播放音频 早安', group: '音频', needAt: true, needParam: '<名字>' }
];

// games.json 的 type → 参数说明
// 注意：同 type 的不同游戏参数词可能不同，用 id 覆盖更精确
const PARAM_HINT = {
  coin: { need: true, hint: '正 / 反', example: '正' },
  oddeven: { need: true, hint: '单 / 双（或 大 / 小）', example: '单' },
  lucknum: { need: false, hint: '', example: '' },
  dice: { need: false, hint: '', example: '' },
  dice2: { need: false, hint: '', example: '' },
  dice3: { need: false, hint: '', example: '' },
  pick: { need: false, hint: '', example: '' },
  rand: { need: false, hint: '', example: '' },
  lootbox: { need: false, hint: '', example: '' },
  slot: { need: false, hint: '', example: '' },
  wheel: { need: false, hint: '', example: '' },
  danger: { need: false, hint: '', example: '' }
};

// 按游戏 id 精确指定参数（优先于 type 默认值）
const PARAM_BY_ID = {
  guess_hand: { need: true, hint: '左 / 右', example: '左' },
  big_small: { need: true, hint: '大 / 小', example: '大' },
  odd_even: { need: true, hint: '单 / 双', example: '单' },
  coin_flip: { need: true, hint: '正 / 反', example: '正' }
};

function readGames(runtimePath) {
  const p = path.join(runtimePath, 'tianlu_bot', 'plugins', 'games', 'games.json');
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

// 读 .env 里的 BOT_QQ（用于生成 @机器人 的示例）
function readBotQQ(runtimePath) {
  try {
    const envPath = path.join(runtimePath, 'tianlu_bot', '.env');
    const txt = fs.readFileSync(envPath, 'utf8');
    const m = /^\s*BOT_QQ\s*=\s*(\d+)/m.exec(txt);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

// 汇总所有命令
function collectCommands(runtimePath) {
  const games = readGames(runtimePath);
  const list = [];

  // 固定命令
  for (const f of FIXED_COMMANDS) {
    list.push(Object.assign({}, f, { source: 'plugin' }));
  }

  // 游戏命令
  for (const g of games) {
    const cmd = String(g.cmd || '');
    if (!cmd) continue;
    const type = String(g.type || 'pick');
    const ph = PARAM_BY_ID[String(g.id || '')] || PARAM_HINT[type] || { need: false, hint: '', example: '' };
    const cost = Number(g.cost || 0);
    const win = Number(g.win || 0);
    list.push({
      cmd: ph.need ? (cmd + ' ' + ph.example) : cmd,
      desc: String(g.desc || g.name || ''),
      group: '游戏',
      needAt: true,
      needParam: ph.need ? ph.hint : '',
      source: 'game',
      gameId: String(g.id || ''),
      cost,
      win,
      cooldown: Number(g.cooldown || 0),
      dailyLimit: Number(g.daily_limit || 0)
    });
  }

  return list;
}

// 生成纯文本（可直接复制发群/发文档）
function buildText(runtimePath) {
  const list = collectCommands(runtimePath);
  const botQQ = readBotQQ(runtimePath);

  const lines = [];
  lines.push('══════════ 机器人命令速查 ══════════');
  lines.push('');
  lines.push('【怎么用】在群里发消息时，先 @机器人 再跟上命令：');
  lines.push('   @机器人 掷骰子');
  lines.push('   @机器人 签到');
  lines.push('   @机器人 猜大小 大       ← 带参数的命令，参数跟在后面');
  lines.push('');

  const groups = [
    { key: '基础', title: '【基础命令】' },
    { key: '游戏', title: '【小游戏】共 ' + list.filter((x) => x.group === '游戏').length + ' 个' },
    { key: '音频', title: '【音频播放】' }
  ];

  for (const gr of groups) {
    const items = list.filter((x) => x.group === gr.key);
    if (!items.length) continue;
    lines.push(gr.title);
    for (const it of items) {
      let line = '   ' + it.cmd;
      if (it.needParam) line += '        （参数：' + it.needParam + '）';
      if (it.desc) line += '   — ' + it.desc;
      if (it.source === 'game' && it.cost) {
        line += '   [' + it.cost + ' 金币';
        if (it.win) line += '，赢 ' + it.win;
        line += ']';
      }
      lines.push(line);
    }
    lines.push('');
  }

  lines.push('【金币怎么来】');
  lines.push('   · 每天发「签到」领 10~30 金币');
  lines.push('   · 玩游戏中奖');
  lines.push('   · 部分游戏免费（天降金币、抢红包）');
  lines.push('');
  lines.push('【提示】');
  lines.push('   · 每个游戏有冷却和每日次数上限，防止刷屏');
  lines.push('   · 可以在控制台「工具 → 功能开关」里关掉不想玩的游戏');
  lines.push('═══════════════════════════════');

  return lines.join('\n');
}

module.exports = { collectCommands, buildText, FIXED_COMMANDS, readGames, readBotQQ };
