const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

// 抽選設定 (確率は合計 1.0 になるように調整)
const PRIZES = [
  { key: 'special', name: '特選！！', prob: 0.02 },
  { key: 'first',   name: '1等：特製だるま', prob: 0.05 },
  { key: 'second',  name: '2等：和装小物500円引券', prob: 0.10 },
  { key: 'third',   name: '3等：次回100円引券', prob: 0.20 },
  { key: 'lose',    name: '残念', prob: 0.63 },
];

/**
 * 抽選API
 * クライアントから送信されたIDトークンを検証し、Firestoreで残り回数を管理した上で抽選結果を返す
 */
exports.lottery = onRequest({ cors: true }, async (req, res) => {
  // CORSプリフライトリクエストに対応
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const idToken = authHeader.split("Bearer ")[1];

  try {
    // 1. LINE IDトークンの検証
    const verifyRes = await axios.post("https://api.line.me/oauth2/v2.1/verify", 
      new URLSearchParams({
        id_token: idToken,
        client_id: "2009548533" // ← LINEログインのチャネルID（LIFF IDの前の部分）
      })
    );
    const userId = verifyRes.data.sub;

    // 2. Firestore トランザクションで不整合を防ぎつつ回数チェックと更新
    const result = await db.runTransaction(async (t) => {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await t.get(userRef);
      
      let attempts = 3;
      if (userDoc.exists) {
        const data = userDoc.data();
        if (data.lastDraw) {
            // 日本時間での日付またぎ判定
            const lastDate = data.lastDraw.toDate();
            const now = new Date();
            const jstOffset = 9 * 60 * 60 * 1000;
            const lastJst = new Date(lastDate.getTime() + jstOffset);
            const nowJst = new Date(now.getTime() + jstOffset);
            
            const isSameDay = 
               lastJst.getUTCFullYear() === nowJst.getUTCFullYear() &&
               lastJst.getUTCMonth() === nowJst.getUTCMonth() &&
               lastJst.getUTCDate() === nowJst.getUTCDate();
               
            if (isSameDay) {
                attempts = data.remainingAttempts;
            } else {
                attempts = 3; // 日付が変わっていればリセット
            }
        } else {
            attempts = data.remainingAttempts || 3;
        }
      }

      if (attempts <= 0) {
        throw new Error("No attempts left");
      }

      // 3. 抽選ロジック
      const rand = Math.random();
      let cumulative = 0;
      let selectedPrize = 'lose';
      for (const p of PRIZES) {
        cumulative += p.prob;
        if (rand <= cumulative) {
          selectedPrize = p.key;
          break;
        }
      }

      const displayName = req.body.displayName || '不明なユーザー';
      const pictureUrl = req.body.pictureUrl || '';

      // 4. 残り回数と履歴の更新
      t.set(userRef, { 
        displayName,
        pictureUrl,
        remainingAttempts: attempts - 1,
        lastDraw: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 当選履歴の保存
      const historyRef = db.collection("history").doc();
      t.set(historyRef, { 
        userId, 
        displayName,
        pictureUrl,
        prize: selectedPrize, 
        timestamp: admin.firestore.FieldValue.serverTimestamp() 
      });

      return { 
        prize: selectedPrize, 
        remainingAttempts: attempts - 1 
      };
    });

    res.json(result);

  } catch (error) {
    console.error('Error:', error.message);
    const status = error.message === "No attempts left" ? 403 : 400;
    res.status(status).json({ error: error.message });
  }
});
