// チンチロ 静的配信サーバー（1端末ローカルプレイ）
// ゲームロジックはブラウザ側（chinchiro.js / client.js）で動く。
const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
// ルート直下のロジックをブラウザからも読めるように配信
app.get('/chinchiro.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'chinchiro.js'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`チンチロ サーバー起動: http://localhost:${PORT}`);
});
