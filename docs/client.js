// チンチロ（1端末ローカルプレイ）
// ロジックは window.Chinchiro（chinchiro.js）を使用。
const C = window.Chinchiro;

const el = (id) => document.getElementById(id);

/* ===== 状態 ===== */
const num = (k, d) => {
  const v = parseFloat(localStorage.getItem(k));
  return Number.isFinite(v) ? v : d;
};
let mode = localStorage.getItem('chinchiro.mode') || '3'; // '3'=3チロ / '4'=4チロ
let players = [{ name: 'プレイヤー1' }, { name: 'プレイヤー2' }];
let hands = []; // players と整列：{dice,result,rolls,done}
let state = 'play'; // 'play' | 'sudden' | 'over'
let participants = []; // 手番が回るプレイヤーのindex（通常は全員、SDは一部）
let turn = 0; // participants 内のindex
let sdCtx = null; // サドンデスで引き継ぐ情報
let busy = false; // アニメ中ロック
let stopMode = localStorage.getItem('chinchiro.stopMode') || 'yaku'; // 'yaku'=役止め / 'manual'=手動
let dice456 = localStorage.getItem('chinchiro.dice456') === '1'; // 456サイコロ（4〜6しか出ない）
let maxThrows = num('chinchiro.maxThrows', 3); // 3チロの最大振り直し回数（1〜3）
let chonboOn = localStorage.getItem('chinchiro.chonboOn') !== '0'; // チョンボの有無（既定ON）
let chonboRate = num('chinchiro.chonboRate', 0.01); // チョンボ発生確率
let soundOn = localStorage.getItem('chinchiro.soundOn') !== '0'; // 効果音の有無（既定ON）
let soundVol = num('chinchiro.soundVol', 1); // 効果音の音量（0〜1）

const MAX = 6;
const CHONBO_GULPS = 2; // チョンボの罰杯
const diceCount = () => (mode === '4' ? 4 : 3);
const maxRolls = () => (state === 'sudden' || mode === '4' ? 1 : maxThrows);
const curIdx = () => participants[turn];
const canEdit = () =>
  state === 'play' && turn === 0 && hands[participants[0]] && hands[participants[0]].rolls === 0;

/* ===== 効果音（Web Audio） ===== */
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
function playClack(volume = 0.35, freq = 1500) {
  if (!soundOn) return;
  const ctx = ac();
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * 0.07);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq + Math.random() * 600;
  bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.value = volume * soundVol;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start();
}
function playDrop() {
  if (!soundOn) return;
  const ctx = ac();
  if (!ctx) return;
  playClack(0.4, 600);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.12);
  g.gain.setValueAtTime(0.25 * soundVol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}

/* ===== サイコロ描画 ===== */
const PIP_CELLS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};
function buildDie() {
  const d = document.createElement('div');
  d.className = 'die';
  for (let c = 0; c < 9; c++) d.appendChild(document.createElement('span'));
  return d;
}
function setFace(die, val) {
  const cells = PIP_CELLS[val] || [];
  const spans = die.children;
  for (let c = 1; c <= 9; c++) {
    const on = val && cells.includes(c);
    // 1の目だけ赤
    spans[c - 1].className = on ? (val === 1 ? 'pip red' : 'pip') : '';
  }
}
function ensureDice(n) {
  const wrap = el('diceWrap');
  while (wrap.children.length < n) wrap.appendChild(buildDie());
  while (wrap.children.length > n) wrap.lastChild.remove();
  return Array.from(wrap.children);
}
const rnd = (a, b) => a + Math.random() * (b - a);

// 出目の生成（456サイコロモードなら 4〜6 のみ）
function rollN(n) {
  if (dice456) return Array.from({ length: n }, () => 4 + Math.floor(Math.random() * 3));
  return C.rollDice(n);
}
// 演出用のランダムな目（456モードを反映）
function randFace() {
  return dice456 ? 4 + Math.floor(Math.random() * 3) : Math.ceil(rnd(0.001, 6));
}

/* ===== ゲーム進行 ===== */
function newRound() {
  state = 'play';
  hands = players.map(() => ({ dice: null, result: null, rolls: 0, done: false }));
  participants = players.map((_, i) => i);
  turn = 0;
  sdCtx = null;
  el('overlay').classList.add('hidden');
  el('overlay').classList.remove('chonbo');
  el('bowl').classList.remove('chonbo-fly');
  showIdle();
  render();
}

function yakuText(r) {
  if (!r) return '';
  const label = C.YakuInfo[r.yaku].label;
  if (r.yaku === C.Yaku.ME) return `${r.point}の目`;
  if (r.yaku === C.Yaku.ARASHI) return `${label}（${r.point}ゾロ）`;
  return label;
}

// 手番開始時：大きいサイコロを鉢に置いた“構え”の表示
function showIdle() {
  const dice = ensureDice(diceCount());
  el('diceWrap').classList.remove('settled');
  el('diceWrap').classList.add('idle');
  dice.forEach((d) => {
    d.style.transform = `rotate(${rnd(-12, 12)}deg)`;
    d.style.transition = '';
    d.style.opacity = '1';
    setFace(d, randFace());
  });
  el('resultTitle').textContent = state === 'sudden' ? 'サドンデス！' : '　';
  el('resultTitle').className = 'result-title' + (state === 'sudden' ? ' sd' : '');
}

function doRoll() {
  if (busy) return;
  const idx = curIdx();
  const h = hands[idx];
  if (h.done) return;
  resumeAudio();
  busy = true;

  const chonbo = chonboOn && Math.random() < chonboRate; // チョンボ発生判定

  h.dice = rollN(diceCount());
  h.rolls += 1;
  h.result = C.judgeHand(h.dice);

  const dice = ensureDice(h.dice.length);
  const wrap = el('diceWrap');
  wrap.classList.remove('idle');
  wrap.classList.add('settled');
  el('resultTitle').textContent = '振っています…';
  el('resultTitle').className = 'result-title rolling';
  renderDots(h.rolls, true);

  const spin = () => dice.forEach((d) => setFace(d, randFace()));

  // ① 鉢の上から落とす（落下開始位置：上方・大きく回転）
  el('bowl').classList.remove('chonbo-fly');
  dice.forEach((d) => {
    d.style.transition = 'none';
    d.style.opacity = '1';
    d.style.transform = `translate(${rnd(-30, 30)}px,-150px) rotate(${rnd(-220, 220)}deg)`;
    setFace(d, randFace());
  });
  void wrap.offsetWidth; // リフローで開始位置を確定

  const faceTimer = setInterval(spin, 55);
  const sfx = setInterval(() => playClack(0.1, 2400), 130);

  // ② 落下（加速しながら鉢の底へ）
  requestAnimationFrame(() => {
    dice.forEach((d) => {
      d.style.transition = 'transform .26s cubic-bezier(.45,0,.75,1)';
      d.style.transform = `translate(${rnd(-16, 16)}px,${rnd(4, 16)}px) rotate(${rnd(-90, 90)}deg)`;
    });
  });
  playDrop();

  // ③ バウンド（跳ね上がる）
  setTimeout(() => {
    playClack(0.4, 720);
    dice.forEach((d) => {
      d.style.transition = 'transform .12s ease-out';
      d.style.transform = `translate(${rnd(-22, 22)}px,${rnd(-36, -20)}px) rotate(${rnd(-140, 140)}deg)`;
    });
  }, 280);

  // ④ 着地して転がる
  setTimeout(() => {
    dice.forEach((d) => {
      d.style.transition = 'transform .14s ease-in';
      d.style.transform = `translate(${rnd(-15, 15)}px,${rnd(2, 12)}px) rotate(${rnd(-70, 70)}deg)`;
    });
  }, 405);

  // チョンボ：着地後にサイコロが鉢から飛び出す → 即負け
  if (chonbo) {
    setTimeout(() => {
      clearInterval(faceTimer);
      clearInterval(sfx);
      flyOut(dice);
      document.querySelector('.app').classList.add('shake');
      el('resultTitle').textContent = '💦 チョンボ！';
      el('resultTitle').className = 'result-title lose';
      playClack(0.5, 400);
      setTimeout(() => playClack(0.4, 300), 90);
      setTimeout(() => document.querySelector('.app').classList.remove('shake'), 520);
      setTimeout(() => finishChonbo(idx), 760);
    }, 470);
    return;
  }

  // ⑤ 小さく転がって減速
  setTimeout(() => {
    playClack(0.25, 1500);
    dice.forEach((d) => {
      d.style.transition = 'transform .12s ease-out';
      d.style.transform = `translate(${rnd(-9, 9)}px,${rnd(-4, 7)}px) rotate(${rnd(-24, 24)}deg)`;
    });
  }, 560);

  // ⑥ 確定（出目を表示して静止）
  setTimeout(() => {
    clearInterval(faceTimer);
    clearInterval(sfx);
    dice.forEach((d, i) => {
      d.style.transition = 'transform .18s ease-out';
      d.style.transform = `translate(${rnd(-6, 6)}px,${rnd(-3, 5)}px) rotate(${rnd(-10, 10)}deg)`;
      setFace(d, h.dice[i]);
      d.classList.add('pop');
      setTimeout(() => d.classList.remove('pop'), 200);
    });
    playClack(0.45, 1100);
    setTimeout(() => playClack(0.3, 1600), 45);

    // 役確定 or 振り直し
    const isMenashi = h.result.yaku === C.Yaku.MENASHI;
    const isHifumi = h.result.yaku === C.Yaku.HIFUMI;
    if (h.rolls >= maxRolls()) h.done = true; // 上限まで振ったら確定
    else if (isHifumi) h.done = true; // ヒフミは振り直しなしで即確定（次のプレイヤーへ）
    else if (stopMode === 'yaku' && !isMenashi) h.done = true; // 役止め：役が出たら自動確定
    // 手動モードは役が出ても自動確定しない（プレイヤーが「止める」で確定）

    el('resultTitle').textContent = isMenashi && !h.done ? '役なし' : yakuText(h.result);
    const lose = h.result.yaku === C.Yaku.HIFUMI || h.result.yaku === C.Yaku.MENASHI;
    el('resultTitle').className = 'result-title ' + (lose ? 'lose' : 'win');

    busy = false;
    render();
  }, 920);
}

// チョンボ：サイコロが鉢の外へ飛び出す演出
function flyOut(dice) {
  el('bowl').classList.add('chonbo-fly');
  dice.forEach((d) => {
    const dir = Math.random() < 0.5 ? -1 : 1;
    d.style.transition = 'transform .55s cubic-bezier(.15,.7,.4,1), opacity .55s ease-in';
    d.style.transform = `translate(${dir * rnd(170, 320)}px,${rnd(-360, -210)}px) rotate(${rnd(-600, 600)}deg)`;
    d.style.opacity = '0';
  });
}

// チョンボ確定：即負け → やり直し
function finishChonbo(idx) {
  state = 'over';
  el('overlay').classList.add('chonbo');
  el('ovWinner').textContent = '💦 チョンボ！';
  el('ovSd').textContent = 'サイコロを飛ばした… 即負け！';
  el('ovLoser').textContent = players[idx].name;
  el('ovGulps').textContent = `${CHONBO_GULPS} 杯 飲んでやり直し！`;

  const list = el('ovList');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    if (i === idx) li.className = 'loser';
    li.innerHTML = `<span>${escapeHTML(p.name)}</span><span>${i === idx ? 'チョンボ' : '—'}</span>`;
    list.appendChild(li);
  });

  el('againBtn').textContent = 'やり直し';
  el('overlay').classList.remove('hidden');
  busy = false;
  render();
}

function onAction() {
  if (busy) return;
  const h = hands[curIdx()];
  if (!h.done) {
    doRoll();
    return;
  }
  // 次へ
  if (turn < participants.length - 1) {
    turn += 1;
    showIdle();
    renderDots(0, false);
    render();
  } else {
    state === 'sudden' ? endSudden() : resolve();
  }
}

/* ===== 勝敗・飲み判定 ===== */
function evaluate(idxs) {
  const c = idxs.map((i) => ({ i, r: hands[i].result })).filter((x) => x.r);
  let best = c[0];
  let worst = c[0];
  for (const x of c) {
    if (C.compare(x.r, best.r) > 0) best = x;
    if (C.compare(x.r, worst.r) < 0) worst = x;
  }
  const winners = c.filter((x) => C.compare(x.r, best.r) === 0);
  const losers = c.filter((x) => C.compare(x.r, worst.r) === 0);
  return { best, worst, winners, losers, c };
}

function resolve() {
  const { best, winners, losers } = evaluate(participants);
  const bestInfo = C.YakuInfo[best.r.yaku];
  const gulps = Math.max(1, bestInfo.payout);
  const fullDraw = winners.length === participants.length;
  const ctx = {
    gulps,
    yakuLabel: yakuText(best.r),
    winnerNames: fullDraw ? [] : winners.map((w) => players[w.i].name),
    fullDraw,
  };
  if (losers.length >= 2) {
    startSudden(losers.map((l) => l.i), ctx);
    return;
  }
  finishOver(ctx, losers.map((l) => l.i), false);
}

function startSudden(idxs, ctx) {
  state = 'sudden';
  sdCtx = ctx;
  participants = idxs;
  turn = 0;
  idxs.forEach((i) => (hands[i] = { dice: null, result: null, rolls: 0, done: false }));
  showIdle();
  renderDots(0, false);
  render();
}

function endSudden() {
  const { losers } = evaluate(participants);
  if (losers.length >= 2) {
    startSudden(losers.map((l) => l.i), sdCtx);
    return;
  }
  finishOver(sdCtx, losers.map((l) => l.i), true);
}

function finishOver(ctx, loserIdxs, sudden) {
  state = 'over';
  el('overlay').classList.remove('chonbo');
  el('againBtn').textContent = 'もう一局';
  const winnerLine =
    ctx.winnerNames && ctx.winnerNames.length
      ? `🏆 ${ctx.winnerNames.join('・')}　${ctx.yakuLabel}`
      : `全員 ${ctx.yakuLabel} で同点！`;
  el('ovWinner').textContent = winnerLine;
  el('ovSd').textContent = sudden ? '⚔ サドンデスで決定！' : '';
  el('ovLoser').textContent = loserIdxs.map((i) => players[i].name).join('・');
  el('ovGulps').textContent = `${ctx.gulps} 杯 飲む！`;

  // 全員の結果一覧
  const list = el('ovList');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const h = hands[i];
    const li = document.createElement('li');
    const res = h.result ? yakuText(h.result) : '—';
    if (loserIdxs.includes(i)) li.className = 'loser';
    li.innerHTML = `<span>${escapeHTML(p.name)}</span><span>${res}</span>`;
    list.appendChild(li);
  });

  el('overlay').classList.remove('hidden');
  render();
}

/* ===== 描画 ===== */
function renderDots(used, active) {
  const n = maxRolls();
  const wrap = el('rollDots');
  wrap.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i < used ? ' on' : '');
    wrap.appendChild(dot);
  }
}

function render() {
  // モードボタン（456サイコロ時はバッジ表示）
  el('modeBtn').textContent = (mode === '4' ? '4チロ' : '3チロ') + (dice456 ? '・456' : '');
  el('modeBtn').disabled = !canEdit();

  // ドット（現手番のrolls）
  const h = hands[curIdx()];
  renderDots(h ? h.rolls : 0, state !== 'over');

  // アクションボタン
  const btn = el('actionBtn');
  const stop = el('stopBtn');
  stop.classList.add('hidden');
  if (state === 'over') {
    btn.classList.add('hidden');
  } else if (h && h.done) {
    btn.classList.remove('hidden');
    btn.textContent = turn < participants.length - 1 ? '次へ' : '結果を見る';
  } else {
    btn.classList.remove('hidden');
    const hasYaku =
      h && h.result && h.result.yaku !== C.Yaku.MENASHI && h.result.yaku !== C.Yaku.HIFUMI;
    // 手動モードで役があり、まだ振れる → 「止める」or「もう一回振る」（ヒフミは即確定なので対象外）
    if (stopMode === 'manual' && hasYaku && h.rolls < maxRolls()) {
      btn.textContent = 'もう一回振る';
      stop.classList.remove('hidden');
    } else {
      btn.textContent = 'サイコロを振る';
    }
  }

  renderPlayers();
}

function renderPlayers() {
  const wrap = el('players');
  wrap.innerHTML = '';
  const activeIdx = state === 'over' ? -1 : curIdx();

  players.forEach((p, i) => {
    const tab = document.createElement('div');
    tab.className = 'ptab';
    if (i === activeIdx) tab.classList.add('active');
    if (state === 'sudden' && !participants.includes(i)) tab.classList.add('dim');

    const h = hands[i];
    const res = h && h.result && (h.done || state === 'over') ? yakuText(h.result) : '';

    const name = document.createElement('div');
    name.className = 'pname';
    name.textContent = p.name;
    if (canEdit()) {
      name.classList.add('editable');
      name.onclick = () => renamePlayer(i);
    }
    tab.appendChild(name);

    const r = document.createElement('div');
    r.className = 'pres';
    r.textContent = res || '';
    tab.appendChild(r);

    if (canEdit() && players.length > 2) {
      const x = document.createElement('button');
      x.className = 'pdel';
      x.textContent = '×';
      x.onclick = (e) => {
        e.stopPropagation();
        players.splice(i, 1);
        newRound();
      };
      tab.appendChild(x);
    }
    wrap.appendChild(tab);
  });

  if (canEdit() && players.length < MAX) {
    const add = document.createElement('div');
    add.className = 'ptab add';
    add.innerHTML = '<div class="pname">追加</div><div class="pres">＋</div>';
    add.onclick = () => {
      players.push({ name: `プレイヤー${players.length + 1}` });
      newRound();
    };
    wrap.appendChild(add);
  }
}

function renamePlayer(i) {
  const name = prompt('名前を入力', players[i].name);
  if (name && name.trim()) {
    players[i].name = name.trim().slice(0, 12);
    render();
  }
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 手動モード：この役で止める
function onStop() {
  if (busy) return;
  const h = hands[curIdx()];
  if (!h || h.done) return;
  h.done = true;
  render();
}

/* ===== 設定 ===== */
// セグメント（ボタン群）の選択表示
function setSeg(groupId, value) {
  document.querySelectorAll('#' + groupId + ' button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === String(value));
  });
}
function bindSeg(groupId, onPick) {
  document.querySelectorAll('#' + groupId + ' button').forEach((b) => {
    b.onclick = () => {
      setSeg(groupId, b.dataset.v);
      onPick(b.dataset.v);
    };
  });
}

function openSettings() {
  el('yakudomeChk').checked = stopMode === 'yaku';
  el('dice456Chk').checked = dice456;
  el('chonboChk').checked = chonboOn;
  el('soundChk').checked = soundOn;
  el('volRange').value = Math.round(soundVol * 100);
  setSeg('segMode', mode);
  setSeg('segThrows', maxThrows);
  setSeg('segChonbo', chonboRate);
  el('settings').classList.remove('hidden');
}

/* ===== 入力 ===== */
el('actionBtn').onclick = onAction;
el('stopBtn').onclick = onStop;
el('bowl').onclick = () => {
  if (state !== 'over' && !busy && hands[curIdx()] && !hands[curIdx()].done) onAction();
};
el('againBtn').onclick = () => newRound();
el('modeBtn').onclick = () => {
  if (!canEdit()) return;
  mode = mode === '3' ? '4' : '3';
  localStorage.setItem('chinchiro.mode', mode);
  newRound();
};
el('settingsBtn').onclick = openSettings;
el('settingsClose').onclick = () => el('settings').classList.add('hidden');

el('yakudomeChk').onchange = (e) => {
  stopMode = e.target.checked ? 'yaku' : 'manual';
  localStorage.setItem('chinchiro.stopMode', stopMode);
  render();
};
el('dice456Chk').onchange = (e) => {
  dice456 = e.target.checked;
  localStorage.setItem('chinchiro.dice456', dice456 ? '1' : '0');
  newRound(); // 局をリセットして反映
};
bindSeg('segMode', (v) => {
  mode = v;
  localStorage.setItem('chinchiro.mode', mode);
  newRound();
});
bindSeg('segThrows', (v) => {
  maxThrows = parseInt(v, 10);
  localStorage.setItem('chinchiro.maxThrows', maxThrows);
  newRound();
});
el('chonboChk').onchange = (e) => {
  chonboOn = e.target.checked;
  localStorage.setItem('chinchiro.chonboOn', chonboOn ? '1' : '0');
};
bindSeg('segChonbo', (v) => {
  chonboRate = parseFloat(v);
  localStorage.setItem('chinchiro.chonboRate', chonboRate);
  if (!chonboOn) {
    chonboOn = true; // 確率を選んだら自動でON
    el('chonboChk').checked = true;
    localStorage.setItem('chinchiro.chonboOn', '1');
  }
});
el('soundChk').onchange = (e) => {
  soundOn = e.target.checked;
  localStorage.setItem('chinchiro.soundOn', soundOn ? '1' : '0');
  if (soundOn) {
    resumeAudio();
    playClack(0.4, 1200); // 試聴
  }
};
el('volRange').oninput = (e) => {
  soundVol = (parseInt(e.target.value, 10) || 0) / 100;
  localStorage.setItem('chinchiro.soundVol', soundVol);
};
el('volRange').onchange = () => {
  resumeAudio();
  playClack(0.4, 1200); // 離したときに試聴
};

newRound();
