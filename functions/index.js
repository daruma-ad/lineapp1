const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

// 抽選設定 (確率は合計 1.0 になるように調整)
const PRIZES = [
  { key: 'first', name: '大当り：1万円割引', prob: 0.10 },
  { key: 'lose',  name: '参加賞', prob: 0.90 },
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
  let idToken = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    idToken = authHeader.split("Bearer ")[1];
  }

  try {
    let userId = req.body.userId || 'guest';

    // 1. LINE IDトークンの検証 (トークンがあれば優先)
    if (idToken && idToken !== 'null') {
        try {
            const verifyRes = await axios.post("https://api.line.me/oauth2/v2.1/verify", 
              new URLSearchParams({
                id_token: idToken,
                client_id: "2009548533" 
              })
            );
            userId = verifyRes.data.sub;
        } catch (verifyError) {
            console.warn('Token verify failed, falling back to body userId:', verifyError.message);
        }
    }

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
