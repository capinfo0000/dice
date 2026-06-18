// チンチロ クライアント
const socket = io();

let myId = null;
let state = null;
let joined = false;
const prevDice = {}; // プレイヤーごとの前回出目（アニメーション判定用）

const YAKU_LABEL = {
  pinzoro: 'ピンゾロ',
  arashi: 'アラシ',
  shigoro: 'シゴロ',
  me: '出目',
  hifumi: 'ヒフミ',
  menashi: '役なし',
};

// サイコロの目→3x3グリッドのどのセルにピップを置くか（1始まり）
const PIP_CELLS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

const el = (id) => document.getElementById(id);

socket.on('connect', () => {
  myId = socket.id;
});
socket.on('state', (s) => {
  state = s;
  render();
});

el('joinBtn').onclick = () => {
  socket.emit('join', el('nameInput').value);
  joined = true;
};
el('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('joinBtn').click();
});
el('rollBtn').onclick = () => socket.emit('roll');
el('readyBtn').onclick = () => {
  const me = myPlayer();
  socket.emit('ready', !(me && me.ready));
};

function myPlayer() {
  if (!state) return null;
  return state.players.find((p) => p.id === myId) || null;
}

function dieHTML(value, rolling) {
  if (!value) return '<div class="die empty"></div>';
  const cells = PIP_CELLS[value] || [];
  let inner = '';
  for (let c = 1; c <= 9; c++) {
    inner += cells.includes(c) ? '<span class="pip"></span>' : '<span></span>';
  }
  return `<div class="die${rolling ? ' rolling' : ''}">${inner}</div>`;
}

function resultText(result) {
  if (!result) return '';
  const label = YAKU_LABEL[result.yaku] || '';
  if (result.yaku === 'me') return `${label}（${result.point}の目）`;
  if (result.yaku === 'arashi') return `${label}（${result.point}ゾロ）`;
  return label;
}

function render() {
  if (!state) return;

  const me = myPlayer();
  const amJoined = !!me;

  // 画面切り替え
  el('joinScreen').classList.toggle('hidden', amJoined);
  el('gameScreen').classList.toggle('hidden', !amJoined);

  if (!amJoined) {
    renderLobbyList();
    return;
  }

  renderBanner(me);
  renderPlayers(me);
  renderControls(me);
  renderLog();
}

function renderLobbyList() {
  const ul = el('lobbyList');
  ul.innerHTML = '';
  if (state.players.length === 0) {
    ul.innerHTML = '<li>まだ誰もいません</li>';
    return;
  }
  state.players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHTML(p.name)}</span><span>${
      p.ready ? '準備OK' : '待機中'
    }</span>`;
    ul.appendChild(li);
  });
}

function renderBanner(me) {
  const b = el('phaseBanner');
  if (state.phase === 'lobby') {
    b.textContent = '準備OKを押すと開始（2人以上・全員がOKで開始）';
  } else if (state.phase === 'playing') {
    const cur = state.players[state.turn];
    if (cur && cur.id === myId) b.textContent = '👉 あなたの番です。振ってください！';
    else b.textContent = cur ? `${cur.name} さんが振っています…` : '';
  } else if (state.phase === 'roundEnd') {
    b.textContent = 'ラウンド終了！　準備OKで次のラウンドへ';
  }
}

function renderPlayers(me) {
  const wrap = el('players');
  wrap.innerHTML = '';

  // 勝者判定（roundEnd時の強調用）
  let winnerIds = [];
  if (state.phase === 'roundEnd') winnerIds = computeWinners();

  state.players.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'player';
    if (p.id === myId) div.classList.add('me');
    if (state.phase === 'playing' && idx === state.turn) div.classList.add('turn');
    if (winnerIds.includes(p.id)) div.classList.add('winner');

    let badge = '';
    if (state.phase === 'lobby' || state.phase === 'roundEnd') {
      badge = p.ready
        ? '<span class="badge ready">準備OK</span>'
        : '<span class="badge wait">待機</span>';
    } else if (p.done && p.result) {
      badge = '<span class="badge ready">確定</span>';
    }

    // サイコロ表示（出目が変わったらアニメーション）
    const dice = p.dice || [null, null, null];
    const changed =
      p.dice && prevDice[p.id] !== JSON.stringify(p.dice) && state.phase === 'playing';
    const diceHTML = dice.map((d) => dieHTML(d, changed)).join('');
    if (p.dice) prevDice[p.id] = JSON.stringify(p.dice);

    // 役テキスト
    let rline = '';
    if (p.result && (p.done || state.phase === 'roundEnd')) {
      const cls = p.result.yaku === 'hifumi' || p.result.yaku === 'menashi' ? 'lose' : 'win';
      rline = `<div class="result-line ${cls}">${resultText(p.result)}</div>`;
    } else if (p.result) {
      rline = '<div class="result-line">…振り直し中</div>';
    } else {
      rline = '<div class="result-line">　</div>';
    }

    div.innerHTML = `
      <div class="phead">
        <span class="pname">${escapeHTML(p.name)}${badge}</span>
        <span class="pscore">${p.score}点</span>
      </div>
      <div class="dice-row">${diceHTML}</div>
      ${rline}`;
    wrap.appendChild(div);
  });
}

function renderControls(me) {
  const rollBtn = el('rollBtn');
  const readyBtn = el('readyBtn');

  const myTurn =
    state.phase === 'playing' &&
    state.players[state.turn] &&
    state.players[state.turn].id === myId;
  rollBtn.disabled = !myTurn;

  const canReady = state.phase === 'lobby' || state.phase === 'roundEnd';
  readyBtn.classList.toggle('hidden', !canReady);
  rollBtn.classList.toggle('hidden', !(state.phase === 'playing'));

  if (canReady) {
    readyBtn.textContent = me.ready ? '準備OK ✓（解除）' : '準備OK';
    readyBtn.classList.toggle('ready-on', me.ready);
  }
}

function renderLog() {
  const ul = el('log');
  ul.innerHTML = '';
  state.log.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = entry.msg;
    ul.appendChild(li);
  });
  ul.scrollTop = ul.scrollHeight;
}

// サーバーと同じ勝敗ロジック（表示の強調用）
const RANK = { pinzoro: 7, arashi: 6, shigoro: 5, me: 4, menashi: 1, hifumi: 0 };
const LOSE = { hifumi: true };
function cmp(a, b) {
  if (LOSE[a.yaku] && LOSE[b.yaku]) return 0;
  if (LOSE[a.yaku]) return -1;
  if (LOSE[b.yaku]) return 1;
  if (RANK[a.yaku] !== RANK[b.yaku]) return RANK[a.yaku] - RANK[b.yaku];
  if (a.yaku === 'me' || a.yaku === 'arashi') return a.point - b.point;
  return 0;
}
function computeWinners() {
  const c = state.players.filter((p) => p.result);
  if (c.length === 0) return [];
  let best = c[0];
  let winners = [best];
  for (let i = 1; i < c.length; i++) {
    const r = cmp(c[i].result, best.result);
    if (r > 0) {
      best = c[i];
      winners = [c[i]];
    } else if (r === 0) winners.push(c[i]);
  }
  if (LOSE[best.result.yaku] || winners.length > 1) return []; // 引き分けは強調なし
  return winners.map((w) => w.id);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
