// チンチロ（チンチロリン）ゲームロジック
// 3つのサイコロを振り、役を判定・比較・精算する。
// ブラウザでは window.Chinchiro、Node では require で利用可能。
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Chinchiro = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 役の種類 */
  const Yaku = {
    PINZORO: 'pinzoro', // 1-1-1（ピンゾロ）
    ARASHI: 'arashi', // ゾロ目（嵐）
    SHIGORO: 'shigoro', // 4-5-6（シゴロ）
    ME: 'me', // 出目（ペア＋1つ）
    HIFUMI: 'hifumi', // 1-2-3（ヒフミ）
    MENASHI: 'menashi', // 役なし（目なし）
  };

  /** 役ごとの表示情報。rank が大きいほど強い。payout は配当倍率。lose は負け役か。 */
  const YakuInfo = {
    [Yaku.PINZORO]: { label: 'ピンゾロ', rank: 7, payout: 5, lose: false },
    [Yaku.ARASHI]: { label: 'アラシ（ゾロ目）', rank: 6, payout: 3, lose: false },
    [Yaku.SHIGORO]: { label: 'シゴロ', rank: 5, payout: 2, lose: false },
    [Yaku.ME]: { label: '出目', rank: 4, payout: 1, lose: false },
    [Yaku.MENASHI]: { label: '役なし', rank: 1, payout: 0, lose: false },
    [Yaku.HIFUMI]: { label: 'ヒフミ', rank: 0, payout: 2, lose: true },
  };

  /** サイコロを1つ振る（1〜6） */
  function rollDie() {
    return Math.floor(Math.random() * 6) + 1;
  }

  /** サイコロを count 個振る（既定3個） */
  function rollDice(count = 3) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(rollDie());
    return out;
  }

  /**
   * ゲームモード定義。
   * 3チロ：3個・最大3振り。4チロ：4個・1振り（最強の3個で判定）。
   */
  const Modes = {
    '3': { dice: 3, rolls: 3, label: '3チロ（3個・3振り）' },
    '4': { dice: 4, rolls: 1, label: '4チロ（4個・1振り）' },
  };

  /**
   * 3つの出目から役を判定する。
   * @param {number[]} dice 長さ3の配列
   * @returns {{yaku: string, point: number}}
   *   point は「出目」のときの目、アラシのときのゾロ目の数、それ以外は0。
   */
  function judge(dice) {
    const sorted = [...dice].sort((a, b) => a - b);
    const [a, b, c] = sorted;

    if (a === b && b === c) {
      if (a === 1) return { yaku: Yaku.PINZORO, point: 1 };
      return { yaku: Yaku.ARASHI, point: a };
    }
    if (a === 4 && b === 5 && c === 6) {
      return { yaku: Yaku.SHIGORO, point: 0 };
    }
    if (a === 1 && b === 2 && c === 3) {
      return { yaku: Yaku.HIFUMI, point: 0 };
    }
    if (a === b) return { yaku: Yaku.ME, point: c };
    if (b === c) return { yaku: Yaku.ME, point: a };

    return { yaku: Yaku.MENASHI, point: 0 };
  }

  /** 配列から3個を選ぶ全組み合わせを返す */
  function combos3(arr) {
    const res = [];
    for (let i = 0; i < arr.length - 2; i++) {
      for (let j = i + 1; j < arr.length - 1; j++) {
        for (let k = j + 1; k < arr.length; k++) {
          res.push([arr[i], arr[j], arr[k]]);
        }
      }
    }
    return res;
  }

  /**
   * 任意個数（3個以上）のサイコロから役を判定する。
   * 4個以上のときは、最も強くなる3個の組み合わせの役を採用する。
   */
  function judgeHand(dice) {
    if (!dice || dice.length <= 3) return judge(dice);
    let best = null;
    for (const c of combos3(dice)) {
      const r = judge(c);
      if (!best || compare(r, best) > 0) best = r;
    }
    return best;
  }

  /**
   * 2つの判定結果の強さを比較する。
   * @returns {number} 正なら r1 の勝ち、負なら r2 の勝ち、0なら引き分け。
   */
  function compare(r1, r2) {
    const i1 = YakuInfo[r1.yaku];
    const i2 = YakuInfo[r2.yaku];

    if (i1.lose && i2.lose) return 0;
    if (i1.lose) return -1;
    if (i2.lose) return 1;

    if (i1.rank !== i2.rank) return i1.rank - i2.rank;

    if (r1.yaku === Yaku.ME || r1.yaku === Yaku.ARASHI) {
      return r1.point - r2.point;
    }
    return 0;
  }

  /**
   * 子（player）視点での精算額を返す。bet は賭け金。
   * 勝てば正、負ければ負、引き分けは0。倍率は勝者の役の配当による。
   * ヒフミで負けた側は2倍払う。
   */
  function settle(playerResult, dealerResult, bet) {
    const cmp = compare(playerResult, dealerResult);
    if (cmp === 0) return 0;
    if (cmp > 0) {
      let m = YakuInfo[playerResult.yaku].payout || 1;
      if (YakuInfo[dealerResult.yaku].lose) {
        m = Math.max(m, YakuInfo[dealerResult.yaku].payout);
      }
      return bet * m;
    }
    let m = YakuInfo[dealerResult.yaku].payout || 1;
    if (YakuInfo[playerResult.yaku].lose) {
      m = Math.max(m, YakuInfo[playerResult.yaku].payout);
    }
    return -bet * m;
  }

  return { Yaku, YakuInfo, Modes, rollDie, rollDice, judge, judgeHand, compare, settle };
});
