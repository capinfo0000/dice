// チンチロ クライアント
// 深いお皿（鉢）にサイコロが落ちて転がり、1つずつ止まる演出付き。
const socket = io();

let myId = null;
let state = null;
let myRollLock = false; // 自分の振り直し操作の二重送信防止

const cards = {}; // id -> { root, name, score, badge, bowl, dice:[3], result }
const shownDice = {}; // id -> 現在表示中（またはアニメ目標）の出目JSON
const animating = {}; // id -> アニメーション中フラグ

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

/* ============ 効果音（Web Audio APIで合成。音声ファイル不要） ============ */
let audioCtx = null;
function ac() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}
function resumeAudio() {
  const ctx = ac();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
// サイコロがお皿に当たる「カチッ」という音（フィルタしたノイズバースト）
function playClack(volume = 0.35, freq = 1500) {
  const ctx = ac();
  if (!ctx) return;
  const dur = 0.07;
  const len = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq + Math.random() * 600;
  bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start();
}
// お皿に落ちる「コトッ」という低めの音
function playDrop() {
  const ctx = ac();
  if (!ctx) return;
  playClack(0.4, 600);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.12);
  g.gain.setValueAtTime(0.25, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}

/* ============ ソケット ============ */
socket.on('connect', () => {
  myId = socket.id;
});
socket.on('state', (s) => {
  state = s;
  render();
});

/* ============ 入力 ============ */
el('joinBtn').onclick = () => {
  resumeAudio();
  socket.emit('join', el('nameInput').value);
};
el('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('joinBtn').click();
});
el('rollBtn').onclick = () => tryRoll();
el('readyBtn').onclick = () => {
  resumeAudio();
  const me = myPlayer();
  socket.emit('ready', !(me && me.ready));
};
document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.onclick = () => {
    resumeAudio();
    socket.emit('setMode', btn.dataset.mode);
  };
});

function tryRoll() {
  if (myRollLock) return;
  if (!isMyTurn()) return;
  resumeAudio();
  myRollLock = true;
  socket.emit('roll');
}

function myPlayer() {
  if (!state) return null;
  return state.players.find((p) => p.id === myId) || null;
}
function isRollPhase() {
  return state && (state.phase === 'playing' || state.phase === 'suddenDeath');
}
function isMyTurn() {
  return (
    isRollPhase() &&
    state.players[state.turn] &&
    state.players[state.turn].id === myId
  );
}

/* ============ サイコロ描画 ============ */
function buildDie() {
  const d = document.createElement('div');
  d.className = 'die empty';
  for (let c = 0; c < 9; c++) d.appendChild(document.createElement('span'));
  return d;
}
function setFace(dieEl, value) {
  const cells = PIP_CELLS[value] || [];
  dieEl.classList.toggle('empty', !value);
  const spans = dieEl.children;
  for (let c = 1; c <= 9; c++) {
    spans[c - 1].className = value && cells.includes(c) ? 'pip' : '';
  }
}
function rnd(min, max) {
  return min + Math.random() * (max - min);
}
// お皿の中のサイコロ数をモードに合わせて増減
function ensureDiceCount(card, n) {
  while (card.dice.length < n) {
    const d = buildDie();
    card.diceWrap.appendChild(d);
    card.dice.push(d);
  }
  while (card.dice.length > n) {
    const d = card.dice.pop();
    d.remove();
  }
}

/* ============ メイン描画 ============ */
function render() {
  if (!state) return;
  const me = myPlayer();
  const amJoined = !!me;

  el('joinScreen').classList.toggle('hidden', amJoined);
  el('gameScreen').classList.toggle('hidden', !amJoined);

  if (!amJoined) {
    renderLobbyList();
    return;
  }

  renderRoundInfo();
  renderBanner();
  renderMode();
  reconcilePlayers();
  renderDrink();
  renderControls(me);
  renderLog();
}

/** 罰ゲーム（飲む人・杯数）の大きなバナー */
function renderDrink() {
  const b = el('drinkBanner');
  const r = state.lastResult;
  if (state.phase !== 'roundEnd' || !r) {
    b.classList.add('hidden');
    return;
  }
  if (r.draw) {
    b.classList.remove('hidden');
    b.innerHTML = '<div class="dr-draw">🤝 引き分け</div>';
    return;
  }
  b.classList.remove('hidden');
  let topLine;
  if (r.winnerNames && r.winnerNames.length) {
    topLine = `🏆 ${escapeHTML(r.winnerNames.join('・'))}　${escapeHTML(r.yakuLabel)}`;
  } else {
    topLine = `全員 ${escapeHTML(r.yakuLabel)} で同点！`;
  }
  const sdTag = r.suddenDeath
    ? '<div class="dr-sd">⚔ サドンデスで決定！</div>'
    : '';
  b.innerHTML = `
    <div class="dr-win">${topLine}</div>
    ${sdTag}
    <div class="dr-drink">🍺 ${escapeHTML(r.loserNames.join('・'))}</div>
    <div class="dr-gulps">${r.gulps} 杯 飲む！</div>`;
}

function renderMode() {
  const canChange = state.phase === 'lobby' || state.phase === 'roundEnd';
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
    btn.disabled = !canChange;
  });
  el('modeNote').textContent =
    state.mode === '4'
      ? '4チロ：サイコロ4個を1回だけ振り、最強の3個で役を判定'
      : '3チロ：サイコロ3個、役なしなら最大3回まで振り直し';
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

function renderRoundInfo() {
  el('roundInfo').textContent = state.round > 0 ? `第 ${state.round} 局` : '';
}

function renderBanner() {
  const b = el('phaseBanner');
  if (state.phase === 'lobby') {
    b.textContent = '準備OKを押すと開始（2人以上・全員がOKで開始）';
  } else if (state.phase === 'playing') {
    const cur = state.players[state.turn];
    if (cur && cur.id === myId) b.textContent = '👉 あなたの番！ お皿をタップして振る';
    else b.textContent = cur ? `${cur.name} さんが振っています…` : '';
  } else if (state.phase === 'suddenDeath') {
    const cur = state.players[state.turn];
    if (cur && cur.id === myId) b.textContent = '⚔ サドンデス！ お皿をタップして一振り';
    else b.textContent = cur ? `⚔ サドンデス：${cur.name} さんが一振り…` : '⚔ サドンデス';
  } else if (state.phase === 'roundEnd') {
    b.textContent = '局終了！　準備OKで次の局へ';
  }
}

/** プレイヤーカードをキー付きで再利用しながら更新（アニメーションを壊さない） */
function reconcilePlayers() {
  const wrap = el('players');
  const ids = new Set(state.players.map((p) => p.id));

  // いなくなったプレイヤーのカードを削除
  Object.keys(cards).forEach((id) => {
    if (!ids.has(id)) {
      cards[id].root.remove();
      delete cards[id];
      delete shownDice[id];
      delete animating[id];
    }
  });

  let outcome = { winnerIds: [], loserIds: [] };
  if (state.phase === 'roundEnd') outcome = computeOutcome();

  state.players.forEach((p, idx) => {
    const card = getOrCreateCard(p.id);
    wrap.appendChild(card.root); // 順序を維持
    if (!animating[p.id]) ensureDiceCount(card, state.diceCount);

    card.name.innerHTML = escapeHTML(p.name) + badgeHTML(p);
    card.score.textContent = `${p.score}点`;

    const sd = state.suddenDeathIds && state.suddenDeathIds.includes(p.id);
    card.root.classList.toggle('me', p.id === myId);
    card.root.classList.toggle('turn', isRollPhase() && idx === state.turn);
    card.root.classList.toggle('winner', outcome.winnerIds.includes(p.id));
    card.root.classList.toggle('loser', outcome.loserIds.includes(p.id));
    card.root.classList.toggle('sd', !!sd);

    // お皿のタップ可否（自分の番のときだけ）
    const tappable = isRollPhase() && idx === state.turn && p.id === myId;
    card.bowl.classList.toggle('tappable', tappable && !animating[p.id]);

    updateDice(p);
  });
}

function badgeHTML(p) {
  if (state.phase === 'lobby' || state.phase === 'roundEnd') {
    return p.ready
      ? '<span class="badge ready">準備OK</span>'
      : '<span class="badge wait">待機</span>';
  }
  if (p.done && p.result) return '<span class="badge ready">確定</span>';
  return '';
}

function getOrCreateCard(id) {
  if (cards[id]) return cards[id];

  const root = document.createElement('div');
  root.className = 'player';

  const phead = document.createElement('div');
  phead.className = 'phead';
  const name = document.createElement('span');
  name.className = 'pname';
  const score = document.createElement('span');
  score.className = 'pscore';
  phead.append(name, score);

  const bowl = document.createElement('div');
  bowl.className = 'bowl';
  const inner = document.createElement('div'); // 器の内側（サイコロが入る・落下をクリップ）
  inner.className = 'bowl-inner';
  bowl.appendChild(inner);
  const count = (state && state.diceCount) || 3;
  const dice = [];
  for (let i = 0; i < count; i++) {
    const d = buildDie();
    dice.push(d);
    inner.appendChild(d);
  }
  bowl.addEventListener('click', () => {
    if (bowl.classList.contains('tappable')) tryRoll();
  });

  const result = document.createElement('div');
  result.className = 'result-line';
  result.innerHTML = '&nbsp;';

  root.append(phead, bowl, result);
  cards[id] = { root, name, score, bowl, diceWrap: inner, dice, result };
  return cards[id];
}

function updateDice(p) {
  const card = cards[p.id];
  const target = p.dice;

  if (!target) {
    // 出目なし（新しい局・ロビー）→ お皿を空に
    if (!animating[p.id]) {
      card.dice.forEach((d) => {
        d.style.transition = 'none';
        d.style.transform = '';
        setFace(d, null);
      });
      card.result.innerHTML = '&nbsp;';
    }
    delete shownDice[p.id];
    return;
  }

  const tj = JSON.stringify(target);
  if (shownDice[p.id] === tj) {
    if (!animating[p.id]) showResult(p);
    return;
  }
  shownDice[p.id] = tj;

  if (isRollPhase()) {
    animateRoll(p);
  } else {
    // 途中参加や再接続：即座に確定表示
    card.dice.forEach((d, i) => setFace(d, target[i]));
    showResult(p);
  }
}

/** サイコロが落ちて → 転がって → 一斉に止まる演出 */
function animateRoll(p) {
  const card = cards[p.id];
  ensureDiceCount(card, p.dice.length);
  const dice = card.dice;
  const target = p.dice;
  animating[p.id] = true;
  card.bowl.classList.remove('tappable');
  card.result.innerHTML = '<span class="rolling-msg">…</span>';

  // 落下
  dice.forEach((d) => {
    d.style.transition = 'none';
    d.style.transform = `translateY(-160px) rotate(${rnd(-220, 220)}deg)`;
    setFace(d, Math.ceil(rnd(0.001, 6)));
  });
  void card.bowl.offsetWidth; // リフロー
  dice.forEach((d, i) => {
    d.style.transition = 'transform .38s cubic-bezier(.3,1.5,.6,1)';
    d.style.transform = `translateY(0) rotate(${rnd(-20, 20)}deg)`;
    setTimeout(() => playDrop(), 230 + i * 25);
  });

  // 転がり（落下後）
  const tumble = setInterval(() => {
    dice.forEach((d) => {
      d.style.transition = 'transform .07s linear';
      d.style.transform = `translateY(${rnd(-6, 4)}px) rotate(${rnd(-30, 30)}deg)`;
      setFace(d, Math.ceil(rnd(0.001, 6)));
    });
  }, 80);
  const rollSfx = setInterval(() => playClack(0.12, 2200), 130);

  // 一斉に止まる
  const settleAt = 1100;
  setTimeout(() => {
    clearInterval(tumble);
    clearInterval(rollSfx);
    dice.forEach((d, i) => {
      d.style.transition = 'transform .2s ease-out';
      d.style.transform = `translateY(0) rotate(${rnd(-8, 8)}deg)`;
      setFace(d, target[i]);
      d.classList.add('settle-pop');
      setTimeout(() => d.classList.remove('settle-pop'), 200);
    });
    playClack(0.45, 1100); // 一斉に「カチッ」
    setTimeout(() => playClack(0.3, 1600), 45);
  }, settleAt);

  // 止まったら役を表示
  setTimeout(() => {
    animating[p.id] = false;
    showResult(p);
    if (p.id === myId) myRollLock = false;
    if (state) {
      const idx = state.players.findIndex((x) => x.id === p.id);
      const tappable = isRollPhase() && idx === state.turn && p.id === myId;
      card.bowl.classList.toggle('tappable', tappable);
    }
  }, settleAt + 320);
}

function showResult(p) {
  const card = cards[p.id];
  if (!p.result) {
    card.result.innerHTML = '&nbsp;';
    return;
  }
  const done = p.done || state.phase === 'roundEnd';
  if (!done && p.result.yaku === 'menashi') {
    card.result.className = 'result-line lose';
    card.result.textContent = '役なし（振り直し）';
    return;
  }
  const lose = p.result.yaku === 'hifumi' || p.result.yaku === 'menashi';
  card.result.className = 'result-line ' + (lose ? 'lose' : 'win');
  card.result.textContent = resultText(p.result);
}

function resultText(result) {
  const label = YAKU_LABEL[result.yaku] || '';
  if (result.yaku === 'me') return `${label}（${result.point}の目）`;
  if (result.yaku === 'arashi') return `${label}（${result.point}ゾロ）`;
  return label;
}

function renderControls(me) {
  const rollBtn = el('rollBtn');
  const readyBtn = el('readyBtn');

  rollBtn.disabled = !isMyTurn() || myRollLock;
  rollBtn.textContent = state.phase === 'suddenDeath' ? '⚔ 一振り' : '🎲 振る';
  rollBtn.classList.toggle('hidden', !isRollPhase());

  const canReady = state.phase === 'lobby' || state.phase === 'roundEnd';
  readyBtn.classList.toggle('hidden', !canReady);
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

/* ============ 勝敗判定（表示の強調用。サーバーと同ロジック） ============ */
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
// 勝者（最強）と最下位（飲む人）のidを求める。全員同着なら強調なし。
function computeOutcome() {
  const c = state.players.filter((p) => p.result);
  if (c.length === 0) return { winnerIds: [], loserIds: [] };
  let best = c[0];
  let worst = c[0];
  for (const p of c) {
    if (cmp(p.result, best.result) > 0) best = p;
    if (cmp(p.result, worst.result) < 0) worst = p;
  }
  const winners = c.filter((p) => cmp(p.result, best.result) === 0);
  const losers = c.filter((p) => cmp(p.result, worst.result) === 0);
  if (winners.length === c.length) return { winnerIds: [], loserIds: [] }; // 引き分け
  return {
    winnerIds: winners.map((w) => w.id),
    loserIds: losers.map((l) => l.id),
  };
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
