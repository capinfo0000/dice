// チンチロ 静的配信サーバー（ローカル確認用）
// アプリは docs/ 配下だけで完結する静的サイト（GitHub Pages でもそのまま動く）。
const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'docs')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`チンチロ サーバー起動: http://localhost:${PORT}`);
});
