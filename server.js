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
const MAX_ROLLS = 3; // 役なしのとき振り直せる上限回数

/** ゲーム状態（テーブルは1つだけ） */
const game = {
  phase: 'lobby', // 'lobby' | 'playing' | 'roundEnd'
  players: [], // {id, name, ready, score, dice, result, rolls, done}
  turn: 0, // game.players のインデックス
  log: [],
};

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

/** 次の「まだ振り終えていない」プレイヤーへ手番を移す。全員終了ならラウンド終了。 */
function advanceTurn() {
  const n = game.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (game.turn + i) % n;
    if (!game.players[idx].done) {
      game.turn = idx;
      return;
    }
  }
  endRound();
}

function startRound() {
  game.phase = 'playing';
  game.turn = 0;
  game.players.forEach((p) => {
    p.dice = null;
    p.result = null;
    p.rolls = 0;
    p.done = false;
    p.ready = false;
  });
  addLog('▶ 新しいラウンド開始！');
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

/** 全員の役を比較して勝者を決める */
function endRound() {
  game.phase = 'roundEnd';

  const contenders = game.players.filter((p) => p.result);
  if (contenders.length === 0) {
    addLog('（参加者なし）');
    return;
  }

  let best = contenders[0];
  let winners = [best];
  for (let i = 1; i < contenders.length; i++) {
    const p = contenders[i];
    const cmp = C.compare(p.result, best.result);
    if (cmp > 0) {
      best = p;
      winners = [p];
    } else if (cmp === 0) {
      winners.push(p);
    }
  }

  const bestInfo = C.YakuInfo[best.result.yaku];
  if (bestInfo.lose) {
    addLog('💥 全員ヒフミ／勝ち役なしで引き分け');
  } else if (winners.length === 1) {
    const w = winners[0];
    const pts = Math.max(1, bestInfo.payout);
    w.score += pts;
    addLog(`🏆 ${w.name} の勝ち！ ${bestInfo.label}${pointLabel(w.result)} ＋${pts}点`);
  } else {
    const names = winners.map((w) => w.name).join('・');
    addLog(`🤝 引き分け（${bestInfo.label}：${names}）`);
  }
}

function resetGame() {
  game.phase = 'lobby';
  game.players = [];
  game.turn = 0;
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
      // 対戦中に参加した場合はそのラウンドは見学（次から参加）
      done: game.phase === 'playing',
    });
    addLog(`＋ ${name} が参加しました`);
    broadcast();
  });

  socket.on('ready', (isReady) => {
    const p = findPlayer(socket.id);
    if (!p) return;
    if (game.phase === 'playing') return;
    p.ready = !!isReady;
    maybeStart();
    broadcast();
  });

  socket.on('roll', () => {
    if (game.phase !== 'playing') return;
    const cur = game.players[game.turn];
    if (!cur || cur.id !== socket.id || cur.done) return;

    cur.dice = C.rollDice();
    cur.rolls += 1;
    cur.result = C.judge(cur.dice);
    const info = C.YakuInfo[cur.result.yaku];

    if (cur.result.yaku !== C.Yaku.MENASHI || cur.rolls >= MAX_ROLLS) {
      cur.done = true;
      const tail =
        cur.result.yaku === C.Yaku.MENASHI ? '役なし（ションベン）' : info.label;
      addLog(`🎲 ${cur.name}：${cur.dice.join('・')} → ${tail}${pointLabel(cur.result)}`);
      advanceTurn();
    } else {
      addLog(`🎲 ${cur.name}：${cur.dice.join('・')} → 役なし（振り直し ${cur.rolls}/${MAX_ROLLS}）`);
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
    if (game.phase === 'playing') {
      if (game.turn >= game.players.length) game.turn = 0;
      if (game.players.every((p) => p.done)) {
        endRound();
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
