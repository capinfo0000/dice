// リアルタイム対戦チンチロ サーバー（Node.js + Socket.IO）
// 1つのテーブル（ルーム）を共有し、接続したプレイヤー全員で対戦する。
// 親・子の区別はなく、全員が振って一番強い役のプレイヤーが勝ち。
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const C = require('./chinchiro');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/** ゲーム状態（テーブルは1つだけ） */
const game = {
  phase: 'lobby', // 'lobby' | 'playing' | 'roundEnd'
  players: [], // {id, name, ready, score, dice, result, rolls, done}
  turn: 0, // game.players のインデックス
  round: 0, // 何局目か
  mode: '3', // '3'=3チロ（3個3振り） / '4'=4チロ（4個1振り）
  lastResult: null, // 直近の局の結果（勝者・飲む人・杯数）
  tiebreak: null, // サドンデス中の情報（参加者・引き継ぐ杯数など）
  log: [],
};

function modeConf() {
  return C.Modes[game.mode] || C.Modes['3'];
}

function findPlayer(id) {
  return game.players.find((p) => p.id === id);
}

function addLog(msg) {
  game.log.push({ t: Date.now(), msg });
  if (game.log.length > 60) game.log.shift();
}

function pointLabel(result) {
  if (result.yaku === C.Yaku.ME) return `（${result.point}の目）`;
  if (result.yaku === C.Yaku.ARASHI) return `（${result.point}ゾロ）`;
  return '';
}

/** クライアントに送る公開状態 */
function publicState() {
  return {
    phase: game.phase,
    turn: game.turn,
    round: game.round,
    mode: game.mode,
    diceCount: modeConf().dice,
    maxRolls: modeConf().rolls,
    lastResult: game.lastResult,
    suddenDeathIds:
      game.phase === 'suddenDeath' && game.tiebreak
        ? game.tiebreak.participantIds
        : null,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      score: p.score,
      dice: p.dice,
      result: p.result,
      rolls: p.rolls,
      done: p.done,
    })),
    log: game.log.slice(-14),
  };
}

function broadcast() {
  io.emit('state', publicState());
}

/** 次の「まだ振り終えていない」プレイヤーへ手番を移す。全員終了なら局を解決。 */
function advanceTurn() {
  const n = game.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (game.turn + i) % n;
    if (!game.players[idx].done) {
      game.turn = idx;
      return;
    }
  }
  resolvePhase();
}

/** 現在のフェーズに応じて勝敗を解決する */
function resolvePhase() {
  if (game.phase === 'suddenDeath') endSuddenDeath();
  else endRound();
}

function startRound() {
  game.phase = 'playing';
  game.turn = 0;
  game.round += 1;
  game.lastResult = null;
  game.tiebreak = null;
  game.players.forEach((p) => {
    p.dice = null;
    p.result = null;
    p.rolls = 0;
    p.done = false;
    p.ready = false;
  });
  addLog(`▶ 第${game.round}局 開始！`);
}

/** ロビー／ラウンド終了後、2人以上が全員準備OKなら開始 */
function maybeStart() {
  if (
    (game.phase === 'lobby' || game.phase === 'roundEnd') &&
    game.players.length >= 2 &&
    game.players.every((p) => p.ready)
  ) {
    startRound();
  }
}

/** 全員の役を比較し、勝者・最下位（飲む人）・杯数を決める */
function endRound() {
  game.phase = 'roundEnd';
  game.lastResult = null;

  const contenders = game.players.filter((p) => p.result);
  if (contenders.length === 0) {
    addLog('（参加者なし）');
    return;
  }

  // 一番強い役・一番弱い役を求める
  let best = contenders[0];
  let worst = contenders[0];
  for (const p of contenders) {
    if (C.compare(p.result, best.result) > 0) best = p;
    if (C.compare(p.result, worst.result) < 0) worst = p;
  }
  const winners = contenders.filter((p) => C.compare(p.result, best.result) === 0);
  const losers = contenders.filter((p) => C.compare(p.result, worst.result) === 0);

  const bestInfo = C.YakuInfo[best.result.yaku];
  const gulps = Math.max(1, bestInfo.payout); // 勝者の役の倍率ぶん
  const fullDraw = winners.length === contenders.length; // 全員同じ強さ
  const ctx = {
    gulps,
    yakuLabel: bestInfo.label + pointLabel(best.result),
    winnerNames: fullDraw ? [] : winners.map((w) => w.name),
    fullDraw,
  };

  // 任意：単独勝ちならポイント加算
  if (!fullDraw && winners.length === 1) winners[0].score += gulps;

  // 最下位がタイ（複数人）→ サドンデスで一振り決着
  if (losers.length >= 2) {
    startSuddenDeath(losers, ctx);
    return;
  }

  finalizeDrink(ctx, losers, false);
}

/** サドンデス（一振り）開始。participants だけが対象。 */
function startSuddenDeath(participants, ctx) {
  game.phase = 'suddenDeath';
  game.tiebreak = { ...ctx, participantIds: participants.map((p) => p.id) };
  const partSet = new Set(game.tiebreak.participantIds);
  game.players.forEach((p) => {
    if (partSet.has(p.id)) {
      p.dice = null;
      p.result = null;
      p.rolls = 0;
      p.done = false;
    } else {
      p.done = true; // 不参加は見学（直前の出目はそのまま表示）
    }
  });
  game.turn = game.players.findIndex((p) => partSet.has(p.id));
  addLog(`⚔ 引き分け！ サドンデス（一振り）：${participants.map((p) => p.name).join('・')}`);
}

/** サドンデスの結果から飲む人を決める。また同点なら再サドンデス。 */
function endSuddenDeath() {
  game.phase = 'roundEnd';
  const ctx = game.tiebreak || {};
  const partSet = new Set(ctx.participantIds || []);
  const parts = game.players.filter((p) => partSet.has(p.id) && p.result);

  if (parts.length === 0) {
    game.lastResult = { draw: true };
    return;
  }
  if (parts.length === 1) {
    finalizeDrink(ctx, parts, true);
    return;
  }

  let worst = parts[0];
  for (const p of parts) {
    if (C.compare(p.result, worst.result) < 0) worst = p;
  }
  const losers = parts.filter((p) => C.compare(p.result, worst.result) === 0);

  if (losers.length >= 2) {
    addLog('⚔ またも同点！ 再サドンデス');
    startSuddenDeath(losers, ctx);
    return;
  }
  finalizeDrink(ctx, losers, true);
}

/** 最終結果（飲む人・杯数）を確定して表示用に格納する */
function finalizeDrink(ctx, losers, suddenDeath) {
  const loserNames = losers.map((l) => l.name);
  game.lastResult = {
    draw: false,
    winnerNames: ctx.winnerNames || [],
    yakuLabel: ctx.yakuLabel || '',
    loserNames,
    gulps: ctx.gulps,
    suddenDeath: !!suddenDeath,
    fullDraw: !!ctx.fullDraw,
  };
  if (ctx.winnerNames && ctx.winnerNames.length) {
    addLog(`🏆 ${ctx.winnerNames.join('・')}：${ctx.yakuLabel}`);
  }
  addLog(
    `🍺 ${loserNames.join('・')} が ${ctx.gulps}杯 飲む！${
      suddenDeath ? '（サドンデス）' : ''
    }`
  );
}

function resetGame() {
  game.phase = 'lobby';
  game.players = [];
  game.turn = 0;
  game.round = 0;
  game.mode = '3';
  game.lastResult = null;
  game.tiebreak = null;
  game.log = [];
}

io.on('connection', (socket) => {
  socket.emit('state', publicState());

  socket.on('join', (rawName) => {
    if (findPlayer(socket.id)) return;
    const name =
      String(rawName || '').trim().slice(0, 12) ||
      `プレイヤー${game.players.length + 1}`;
    game.players.push({
      id: socket.id,
      name,
      ready: false,
      score: 0,
      dice: null,
      result: null,
      rolls: 0,
      // 対局中・サドンデス中に参加した場合はその局は見学（次から参加）
      done: game.phase === 'playing' || game.phase === 'suddenDeath',
    });
    addLog(`＋ ${name} が参加しました`);
    broadcast();
  });

  socket.on('ready', (isReady) => {
    const p = findPlayer(socket.id);
    if (!p) return;
    if (game.phase !== 'lobby' && game.phase !== 'roundEnd') return;
    p.ready = !!isReady;
    maybeStart();
    broadcast();
  });

  socket.on('setMode', (mode) => {
    if (!findPlayer(socket.id)) return;
    if (game.phase !== 'lobby' && game.phase !== 'roundEnd') return; // 対局中・SD中は変更不可
    if (!C.Modes[mode] || mode === game.mode) return;
    game.mode = mode;
    addLog(`⚙ モードを「${C.Modes[mode].label}」に変更`);
    broadcast();
  });

  socket.on('roll', () => {
    if (game.phase !== 'playing' && game.phase !== 'suddenDeath') return;
    const cur = game.players[game.turn];
    if (!cur || cur.id !== socket.id || cur.done) return;

    // サドンデスは一振り固定。通常はモードの振り直し回数。
    const maxRolls = game.phase === 'suddenDeath' ? 1 : modeConf().rolls;
    cur.dice = C.rollDice(modeConf().dice);
    cur.rolls += 1;
    cur.result = C.judgeHand(cur.dice);
    const info = C.YakuInfo[cur.result.yaku];

    if (cur.result.yaku !== C.Yaku.MENASHI || cur.rolls >= maxRolls) {
      cur.done = true;
      const tail =
        cur.result.yaku === C.Yaku.MENASHI ? '役なし' : info.label;
      addLog(`🎲 ${cur.name}：${cur.dice.join('・')} → ${tail}${pointLabel(cur.result)}`);
      advanceTurn();
    } else {
      addLog(`🎲 ${cur.name}：${cur.dice.join('・')} → 役なし（振り直し ${cur.rolls}/${maxRolls}）`);
    }
    broadcast();
  });

  socket.on('disconnect', () => {
    const idx = game.players.findIndex((p) => p.id === socket.id);
    if (idx < 0) return;
    const [gone] = game.players.splice(idx, 1);
    addLog(`－ ${gone.name} が退出しました`);

    if (game.players.length === 0) {
      resetGame();
      broadcast();
      return;
    }
    if (game.phase === 'playing' || game.phase === 'suddenDeath') {
      if (game.turn >= game.players.length) game.turn = 0;
      if (game.players.every((p) => p.done)) {
        resolvePhase();
      } else if (game.players[game.turn].done) {
        advanceTurn();
      }
    }
    broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`チンチロ サーバー起動: http://localhost:${PORT}`);
});
