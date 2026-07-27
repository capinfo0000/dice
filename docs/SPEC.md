# チンチロ Web アプリ 仕様書

| 項目 | 内容 |
|---|---|
| アプリ名 | チンチロ（チンチロリン）Web アプリ |
| リポジトリ | github.com/capinfo0000/dice |
| 言語 | JavaScript（フロント=バニラJS）/ HTML5 / CSS3 / Node.js |
| DB | なし（設定・プレイヤー名はブラウザの localStorage に保存） |
| フレームワーク | フロント=なし（素のJS）/ ローカル確認用サーバーのみ Express / 効果音=Web Audio API |
| OS | 環境非依存（PC・スマホのモダンブラウザ） |
| ホスティング | GitHub Pages（main の /docs）/ CORESERVER（dies.coserv.com） |
| その他 | 静的サイト（docs/ だけで完結）/ テストは Node 標準 assert / サイコロ演出は CSS アニメ |
| フェーズ | 公開・運用（完成） |

## FW（フレームワーク）・DB（データベース）・ツール等
```
Express
Web Audio API
localStorage
Node.js
Git
GitHub
GitHub Pages
CORESERVER
```
- FW：Express（ローカル確認用の静的配信サーバーのみ。フロントはフレームワーク不使用の素の JS）
- DB：なし（設定・プレイヤー名は localStorage に保存）
- ツール等：Node.js（実行・テスト）／ Git・GitHub（バージョン管理）／ GitHub Pages・CORESERVER（ホスティング）／ Web Audio API（効果音生成）

## 背景
飲み会・レク用に、インストール不要でブラウザだけで遊べるチンチロを作成。1 台の端末を
回して複数人で遊ぶローカルプレイ方式。サーバー・DB 不要で、静的ホスティング
（GitHub Pages / CORESERVER）にそのまま置ける構成にした。

## 機能
- 役判定：ピンゾロ／アラシ（ゾロ目）／シゴロ／出目／ヒフミ／役なし を順不同で判定し、
  勝敗と飲み杯数を自動計算。
- 対戦：2〜6 人。同点は**サドンデス**で自動決着（該当者のみ再戦を繰り返す）。
- モード：3 チロ／4 チロ、最大振り直し回数（1〜3 回）、役止め／手動止め。
- 演出：サイコロの落下→バウンド→回転→静止の多段アニメ、確定演出、
  Web Audio による効果音（ON/OFF・音量・試聴付き）。
- 遊び要素：**456 サイコロ**（4〜6 しか出ないイカサマ賽）、
  **チョンボ**（確率でサイコロが鉢外へ飛び出し即負け＋罰杯）。
- 設定・プレイヤー名はすべて localStorage に保存。

## 苦労点
- サイコロの「落下→バウンド→転がって静止」を CSS transition と setTimeout の多段制御で
  自然に見せる調整。
- 同点処理をサドンデスで再帰的に解決するロジック（勝者・敗者の絞り込み）。
- 効果音をファイル無しで完結させるため Web Audio でクラック音・落下音を合成。
- GitHub Pages 配信のため docs/ 集約・相対パス化・.nojekyll 対応
  （Actions での自動有効化は権限制約で不可 →「Deploy from a branch」手動方式に切替）。

## ファイル構成
```
docs/
  index.html      画面（マークアップ）
  style.css       スタイル・サイコロ/鉢のアニメ
  chinchiro.js    役判定・勝敗ロジック（純粋関数、テスト対象）
  client.js       画面制御・演出・効果音・設定
  .nojekyll       GitHub Pages 用
server.js         ローカル確認用の静的配信サーバー（Express）
test/chinchiro.test.js  ロジックの簡易テスト（node 標準 assert）
package.json      npm 設定（start / test）
```

## 動かし方
- そのまま：docs/index.html をブラウザで開く（サーバー不要）。
- ローカルサーバー：`npm install` → `npm start` → http://localhost:3000
- テスト：`npm test`
- 公開：docs/ の中身を CORESERVER の公開フォルダへアップ、または GitHub Pages
  （Settings → Pages → Deploy from a branch → main / docs）。
