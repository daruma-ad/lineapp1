# だるまや大抽選会 (Garapon Lottery App for LIFF)

LINE Front-end Framework (LIFF) 上で動作する、和風のガラポン抽選アプリです。
参考サイト (`https://daruma-ad.github.io/darumaya_fukubiki/`) のデザインと操作性を完全に再現しています。

## 特徴

- 🎰 **本格的なガラポン体験**: SVGによる八角形ドラム。ドラッグで手動回転、またはボタンで自動回転が可能です。
- ⚽ **リアルなアニメーション**: 玉が穴から落ち、樋を転がって受け皿に収まる物理挙動を再現。
- 🥁 **迫力の和風サウンド**: 回転時のカチカチ音、当選時の太鼓・鉦の音を Web Audio API で生成。
- 🎊 **豪華な演出**: 特賞・1等当選時には紙吹雪（canvas-confetti）が舞います。
- 🔐 **LIFF 連携**: ユーザープロフィール取得、抽選残回数管理、LINEでの結果シェア（Share Target Picker）。
- 📱 **レスポンシブデザイン**: Tailwind CSS を使用し、スマホ・PC両方に対応。

## 使い方

1. `app.js` の `CONFIG.LIFF_ID` に、LINE Developers で発行した LIFF ID を設定してください。
2. 抽選結果をバックエンドと連携する場合は、`CONFIG.USE_MOCK` を `false` にし、`CONFIG.API_ENDPOINT` にエンドポイントを設定してください。
3. LINE アプリから LIFF URL を開くと、抽選が開始できます。

## 技術スタック

- HTML5 / CSS3 (Tailwind CSS CDN)
- Vanilla JavaScript (ES6+)
- LIFF SDK v2
- Web Audio API (Sound effects)
- Canvas Confetti (Particle effects)
- SVG (Graphics)
