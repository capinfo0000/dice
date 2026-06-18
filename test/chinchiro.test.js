// チンチロのロジックの簡易テスト（外部ライブラリ不要）
const assert = require('assert');
const C = require('../chinchiro');

function judgeYaku(dice) {
  return C.judge(dice).yaku;
}

// --- 役判定 ---
assert.strictEqual(judgeYaku([1, 1, 1]), C.Yaku.PINZORO, 'ピンゾロ');
assert.strictEqual(judgeYaku([5, 5, 5]), C.Yaku.ARASHI, 'アラシ');
assert.strictEqual(judgeYaku([6, 4, 5]), C.Yaku.SHIGORO, 'シゴロ（順不同）');
assert.strictEqual(judgeYaku([3, 1, 2]), C.Yaku.HIFUMI, 'ヒフミ（順不同）');
assert.strictEqual(judgeYaku([2, 2, 5]), C.Yaku.ME, '出目');
assert.strictEqual(judgeYaku([6, 1, 4]), C.Yaku.MENASHI, '役なし');

// 出目の point は残りの1つ
assert.strictEqual(C.judge([4, 4, 6]).point, 6, '出目=6');
assert.strictEqual(C.judge([2, 5, 5]).point, 2, '出目=2');
assert.strictEqual(C.judge([3, 3, 3]).point, 3, 'アラシ=3ゾロ');

// --- 比較 ---
assert.ok(C.compare(C.judge([1, 1, 1]), C.judge([6, 6, 6])) > 0, 'ピンゾロ>アラシ');
assert.ok(C.compare(C.judge([6, 6, 6]), C.judge([2, 2, 2])) > 0, '6ゾロ>2ゾロ');
assert.ok(C.compare(C.judge([5, 5, 6]), C.judge([5, 5, 2])) > 0, '出目6>出目2');
assert.ok(C.compare(C.judge([4, 5, 6]), C.judge([3, 3, 6])) > 0, 'シゴロ>出目');
assert.ok(C.compare(C.judge([2, 4, 6]), C.judge([1, 2, 3])) > 0, '役なし>ヒフミ');
assert.strictEqual(C.compare(C.judge([2, 2, 5]), C.judge([3, 3, 5])), 0, '同じ目は引き分け');
assert.strictEqual(C.compare(C.judge([1, 2, 3]), C.judge([1, 2, 3])), 0, 'ヒフミ同士は引き分け');

// --- 精算 ---
assert.strictEqual(C.settle(C.judge([1, 1, 1]), C.judge([2, 2, 5]), 100), 500, 'ピンゾロで×5');
assert.strictEqual(C.settle(C.judge([2, 2, 5]), C.judge([1, 2, 3]), 100), 200, '相手ヒフミで×2勝ち');
assert.strictEqual(C.settle(C.judge([1, 2, 3]), C.judge([2, 2, 5]), 100), -200, '自分ヒフミで×2負け');
assert.strictEqual(C.settle(C.judge([5, 5, 1]), C.judge([5, 5, 6]), 100), -100, '出目負けで-100');

// --- モード定義 ---
assert.strictEqual(C.Modes['3'].dice, 3, '3チロは3個');
assert.strictEqual(C.Modes['3'].rolls, 3, '3チロは3振り');
assert.strictEqual(C.Modes['4'].dice, 4, '4チロは4個');
assert.strictEqual(C.Modes['4'].rolls, 1, '4チロは1振り');

// --- 4個判定（最強の3個で判定）---
assert.strictEqual(C.judgeHand([1, 1, 1, 4]).yaku, C.Yaku.PINZORO, '4個でピンゾロ採用');
assert.strictEqual(C.judgeHand([2, 3, 4, 4]).yaku, C.Yaku.ME, '4個で出目採用');
assert.strictEqual(C.judgeHand([2, 3, 4, 4]).point, 3, '出目=3（4-4ペア＋3）');
assert.strictEqual(C.judgeHand([4, 5, 6, 1]).yaku, C.Yaku.SHIGORO, '4個でシゴロ採用');
// ヒフミになる3個があっても、別の3個（役なし）の方が強いので役なしを採用
assert.strictEqual(C.judgeHand([1, 2, 3, 5]).yaku, C.Yaku.MENASHI, '4個ならヒフミを回避');
// 3個ならこれまで通り
assert.strictEqual(C.judgeHand([1, 1, 1]).yaku, C.Yaku.PINZORO, '3個はjudgeと同じ');

// rollDice の個数指定
assert.strictEqual(C.rollDice(4).length, 4, 'rollDice(4)で4個');
assert.strictEqual(C.rollDice().length, 3, 'rollDice()既定3個');

console.log('✅ 全テスト通過');
