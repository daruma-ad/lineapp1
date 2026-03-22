/**
 * だるまや大抽選会 — app.js
 * 参考サイトと同一のガラポン操作（ドラッグ回転 + 自動回転 + 玉排出物理）
 * + LIFF連携（プロフィール、残回数管理、シェア機能）
 * + Web Audio API（カラカラ音、太鼓、当たり鉦）
 * + バイブレーション
 */
(() => {
    'use strict';

    // ============================================
    // 設定
    // ============================================
    const CONFIG = {
        LIFF_ID: '2009548533-soJTY61B',
        API_ENDPOINT: 'https://lottery-vg3ntzkutq-uc.a.run.app',
        API_TIMEOUT_MS: 10000, // 通信状況を考慮して少し長めに設定
        USE_MOCK: false,
        MAX_ATTEMPTS: 3,
    };

    // ============================================
    // 賞品定義（確率はモックAPI用。本番ではサーバー側で決定）
    // ============================================
    const BALLS = [
        { fill: 'url(#ballGrad-red)',    stroke: '#D32F2F', prob: 0.10, text: '大当り！',   textColor: '#F44336', rank: 1, prizeName: '1万円割引（3万円以上のお買上に使用可）', image: 'https://daruma-ad.github.io/lineapp1/images/win.jpg', key: 'first' },
        { fill: 'url(#ballGrad-white)',  stroke: '#BDBDBD', prob: 0.90, text: '参加賞',    textColor: '#757575', rank: 4, prizeName: '来店ポイント10pt',     image: 'https://daruma-ad.github.io/lineapp1/images/lose.jpg',    key: 'lose' },
    ];

    // ============================================
    // 状態
    // ============================================
    const state = {
        remainingAttempts: CONFIG.MAX_ATTEMPTS,
        isDragging: false,
        currentAngle: 0,
        startAngle: 0,
        lastClickAngle: 0,
        isSpinLocked: false,
        lastSpinCount: -1,
        isAutoSpinning: false,
        liffReady: false,
        userProfile: null,
    };

    // ============================================
    // DOM要素
    // ============================================
    const $ = (id) => document.getElementById(id);

    // ============================================
    // Web Audio API — サウンド
    // ============================================
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    /** カチッ（ラチェット音） */
    function playClickSound() {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(500, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.03);
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 1500;
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
        osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.05);
    }

    /** ドン（太鼓） */
    function playTaiko(time, isStrong = false) {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(130, time);
        osc.frequency.exponentialRampToValueAtTime(40, time + 0.4);
        gain.gain.setValueAtTime(isStrong ? 1.5 : 1.0, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(time); osc.stop(time + 0.5);
    }

    /** カーン（当たり鉦） */
    function playKane(time) {
        if (!audioCtx) return;
        [800, 1200, 1800].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq + (Math.random() * 20 - 10), time);
            gain.gain.setValueAtTime(0.15 / (i + 1), time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 1.2);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(time); osc.stop(time + 1.2);
        });
    }

    /** 結果に応じた効果音 */
    function playResultSound(rank) {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        if (rank === 0) {
            playTaiko(now); playTaiko(now + 0.2); playTaiko(now + 0.4, true);
            playKane(now + 0.4); playKane(now + 0.8);
        } else if (rank === 1) {
            playTaiko(now); playTaiko(now + 0.25, true); playKane(now + 0.25);
        } else if (rank === 2 || rank === 3) {
            playTaiko(now); playTaiko(now + 0.2);
        } else {
            playTaiko(now);
        }
    }

    // ============================================
    // バイブレーション
    // ============================================
    function vibrate(pattern) {
        if ('vibrate' in navigator) {
            try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
        }
    }

    // ============================================
    // API通信（モック / 本番）
    // ============================================
    async function callLotteryAPI(userId) {
        if (CONFIG.USE_MOCK) {
            return new Promise((resolve) => {
                setTimeout(() => {
                    // ※ 本番では必ずサーバー側で抽選すること
                    const rand = Math.random();
                    let cumulative = 0;
                    for (const b of BALLS) {
                        cumulative += b.prob;
                        if (rand <= cumulative) {
                            resolve(b);
                            return;
                        }
                    }
                    resolve(BALLS[0]);
                }, 100);
            });
        }

        // 本番用
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
        try {
            let token = null;
            try { token = liff.getIDToken(); } catch (e) { /* ignore */ }
            const res = await fetch(CONFIG.API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ 
                    userId,
                    displayName: state.userProfile?.displayName || '不明',
                    pictureUrl: state.userProfile?.pictureUrl || ''
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text}`);
            }
            const data = await res.json();
            console.log('Lottery API Response:', data);
            return BALLS.find((b) => b.key === data.prize) || BALLS[0];
        } catch (error) {
            console.error('Lottery API Error:', error);
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    // ============================================
    // ドラッグ回転の操作
    // ============================================
    function getMouseAngle(e) {
        const hitArea = $('hit-area');
        const rect = hitArea.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return Math.atan2(clientY - cy, clientX - cx);
    }

    function onDragStart(e) {
        if (state.isSpinLocked) return;
        e.preventDefault();
        initAudio();
        state.isDragging = true;
        state.startAngle = getMouseAngle(e);
        state.lastSpinCount = Math.floor((state.currentAngle - 292.5) / 360);
    }

    function onDragMove(e) {
        if (!state.isDragging || state.isSpinLocked) return;
        e.preventDefault();
        const angle = getMouseAngle(e);
        let delta = angle - state.startAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        state.currentAngle += delta * (180 / Math.PI);
        state.startAngle = angle;
        updateRotation();
    }

    function onDragEnd() {
        state.isDragging = false;
    }

    function updateRotation() {
        const drum = $('drum-group');
        const handle = $('handle-group');
        drum.setAttribute('transform', `translate(450,280) rotate(${state.currentAngle})`);
        handle.setAttribute('transform', `translate(450,280) rotate(${state.currentAngle})`);

        // カチカチ音（30度ごと）
        if (Math.abs(state.currentAngle - state.lastClickAngle) > 30) {
            playClickSound();
            vibrate([15]);
            state.lastClickAngle = state.currentAngle;
        }

        // 1回転したら玉を排出
        const currentSpinCount = Math.floor((state.currentAngle - 292.5) / 360);
        if (currentSpinCount > state.lastSpinCount) {
            dropBall();
            state.lastSpinCount = currentSpinCount;
        } else if (currentSpinCount < state.lastSpinCount) {
            state.lastSpinCount = currentSpinCount;
        }
    }

    // ============================================
    // 玉の排出アニメーション
    // ============================================
    async function dropBall() {
        console.log('--- dropBall start ---');
        // 残回数チェック
        if (state.remainingAttempts <= 0) {
            showStatus('本日の抽選回数は終了しました。また明日挑戦してください！');
            alert('本日の抽選回数は終了しました。\nまた明日（深夜0時リセット）の挑戦をお待ちしております！');
            return;
        }

        // 即座にロックをかけ、UIを更新
        state.isSpinLocked = true;
        state.isDragging = false;
        $('spin-btn').classList.add('opacity-50', 'pointer-events-none');
        showStatus('抽選中...');

        let ballData;
        try {
            console.log('Calling Lottery API...');
            ballData = await callLotteryAPI(state.userProfile?.userId || 'guest');
            console.log('Lottery API Result:', ballData);
        } catch (e) {
            console.error('Failed to get lottery result:', e);
            alert(`【原因調査用エラー表示】\n${e.message}\n\n※この画面のスクリーンショットをお願いします`);
            showStatus('エラーが発生しました');
            state.isSpinLocked = false;
            // エラー時はスピンボタンを元に戻す
            if (state.remainingAttempts > 0) {
                $('spin-btn').classList.remove('opacity-50', 'pointer-events-none');
            }
            return;
        }

        // SVG玉を作成
        const ballContainer = $('ball-container');
        const ball = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ball.setAttribute('r', '12');
        ball.setAttribute('fill', ballData.fill);
        ball.setAttribute('stroke', ballData.stroke);
        ball.setAttribute('stroke-width', '2');
        ballContainer.appendChild(ball);

        // アニメーション: 出口 → 樋を転がる → 受け皿
        const startX = 450, startY = 420;
        const dropY = 438;
        const endX = 200 + Math.random() * 40;
        const endY = 460 + (Math.random() - 0.5) * 8;

        let startTime = null;
        const duration = 1200;

        function animateBall(time) {
            if (!startTime) startTime = time;
            const progress = Math.min((time - startTime) / duration, 1);
            let x, y;

            if (progress < 0.2) {
                // 穴から落下
                const p = progress / 0.2;
                x = startX;
                y = startY + (dropY - startY) * p;
            } else {
                // 樋を転がる（イージング付き）
                const p = (progress - 0.2) / 0.8;
                const easeP = 1 - Math.pow(1 - p, 3);
                x = startX + (endX - startX) * easeP;
                y = dropY + (endY - dropY) * easeP;
            }

            ball.setAttribute('cx', x);
            ball.setAttribute('cy', y);

            if (progress < 1) {
                requestAnimationFrame(animateBall);
            } else {
                // 転がり終わったら結果表示（1.5秒の溜め）
                vibrate([100, 50, 200]);
                setTimeout(() => {
                    playResultSound(ballData.rank);
                    state.remainingAttempts--;
                    updateRemainingUI();
                    showResultPopup(ballData);
                }, 1500);
            }
        }

        requestAnimationFrame(animateBall);
    }

    // ============================================
    // 自動回転
    // ============================================
    function autoSpin() {
        if (state.isAutoSpinning || state.isSpinLocked) return;
        if (state.remainingAttempts <= 0) {
            showStatus('本日の抽選回数は終了しました');
            return;
        }

        initAudio();
        state.isAutoSpinning = true;
        state.isSpinLocked = true;

        $('spin-btn').classList.add('opacity-50', 'pointer-events-none');

        const targetAngle = state.currentAngle + 360;
        const startAngleAnim = state.currentAngle;
        let startTime = null;
        const duration = 1500;

        function animate(time) {
            if (!startTime) startTime = time;
            const progress = Math.min((time - startTime) / duration, 1);

            // easeInOutQuad
            const easeP = progress < 0.5
                ? 2 * progress * progress
                : -1 + (4 - 2 * progress) * progress;

            state.currentAngle = startAngleAnim + 360 * easeP;
            updateRotation();

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                state.isAutoSpinning = false;
            }
        }

        requestAnimationFrame(animate);
    }

    // ============================================
    // 結果ポップアップ
    // ============================================
    function showResultPopup(ballData) {
        const popup = $('result-popup');
        const resultText = $('result-text');
        const resultImage = $('result-image');
        const resultNoImage = $('result-no-image');
        const resultPrizeName = $('result-prize-name');

        resultText.textContent = ballData.text;
        resultText.style.color = ballData.textColor;

        const popupCard = popup.querySelector('.japanese-border');
        popupCard.style.borderColor = ballData.textColor;
        popupCard.style.boxShadow = '0 0 0 4px #ffca28, 0 10px 25px rgba(0,0,0,0.3)';

        resultPrizeName.textContent = ballData.prizeName;
        resultPrizeName.parentElement.style.backgroundColor = ballData.textColor;

        if (ballData.image) {
            resultImage.src = ballData.image;
            resultImage.classList.remove('hidden');
            resultNoImage.classList.add('hidden');
        } else {
            resultImage.classList.add('hidden');
            resultNoImage.classList.remove('hidden');
        }

        popup.classList.remove('opacity-0', 'scale-50', 'pointer-events-none');
        popup.classList.add('opacity-100', 'scale-100');

        // 特賞・1等で紙吹雪
        if (ballData.rank <= 1) {
            window.confettiInterval = startConfetti();
        }
    }

    function closeResultPopup() {
        const popup = $('result-popup');
        popup.classList.remove('opacity-100', 'scale-100');
        popup.classList.add('opacity-0', 'scale-50', 'pointer-events-none');

        if (window.confettiInterval) {
            clearInterval(window.confettiInterval);
            window.confettiInterval = null;
        }

        state.isSpinLocked = false;
        state.isAutoSpinning = false;

        const spinBtn = $('spin-btn');
        if (state.remainingAttempts > 0) {
            spinBtn.classList.remove('opacity-50', 'pointer-events-none');
        }

        $('ball-container').innerHTML = '';
    }

    // ============================================
    // 紙吹雪（canvas-confetti）
    // ============================================
    function startConfetti() {
        const duration = 15 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

        return setInterval(() => {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) {
                clearInterval(window.confettiInterval);
                return;
            }
            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: Math.random() * 0.2 + 0.1, y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: Math.random() * 0.2 + 0.7, y: Math.random() - 0.2 } });
        }, 250);
    }

    // ============================================
    // UI更新
    // ============================================
    function updateRemainingUI() {
        const btnText = $('spin-btn').querySelector('span');
        const badge = $('remaining-badge');

        if (state.remainingAttempts <= 0) {
            $('spin-btn').classList.add('opacity-50', 'pointer-events-none');
            showStatus('本日の抽選回数は終了しました。また明日お越しください！');
            if (btnText) btnText.textContent = '本日分終了';
            if (badge) {
                badge.innerHTML = '本日は終了しました';
                badge.classList.remove('bg-[#b71c1c]');
                badge.classList.add('bg-gray-700');
            }
        } else {
            $('spin-btn').classList.remove('opacity-50', 'pointer-events-none');
            showStatus('');
            if (btnText) btnText.textContent = '自動で回す';
            if (badge) {
                badge.innerHTML = `残り <span id="remaining-count" class="text-[#ffca28] text-base font-black">${state.remainingAttempts}</span> 回`;
                badge.classList.add('bg-[#b71c1c]');
                badge.classList.remove('bg-gray-700');
            }
        }
    }

    function showStatus(text) {
        $('status-message').textContent = text;
    }

    function showError(message, onRetry) {
        const toast = $('error-toast');
        $('error-message').textContent = message;
        toast.removeAttribute('hidden');
        requestAnimationFrame(() => toast.classList.add('visible'));

        const retryBtn = $('error-retry');
        const handler = () => {
            retryBtn.removeEventListener('click', handler);
            toast.classList.remove('visible');
            setTimeout(() => toast.setAttribute('hidden', ''), 400);
            if (onRetry) onRetry();
        };
        retryBtn.addEventListener('click', handler);
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.setAttribute('hidden', ''), 400);
        }, 10000);
    }

    // ============================================
    // LINEシェア
    // ============================================
    async function shareResult() {
        const resultText = $('result-text').textContent;
        const prizeName = $('result-prize-name').textContent;

        if (state.liffReady && typeof liff !== 'undefined' && liff.isApiAvailable('shareTargetPicker')) {
            try {
                await liff.shareTargetPicker([{
                    type: 'text',
                    text: `🎊 だるまや大抽選会の結果 🎊\n\n${resultText}「${prizeName}」\n\n私もガラポンを回してみよう！`,
                }]);
            } catch (e) {
                console.warn('Share failed:', e);
            }
        } else if (navigator.share) {
            try {
                await navigator.share({
                    title: 'だるまや大抽選会',
                    text: `🎊 ${resultText}「${prizeName}」— だるまや大抽選会で遊んでみよう！`,
                });
            } catch (e) { /* cancel */ }
        } else {
            showStatus('シェア機能は LINE アプリ内で利用できます');
        }
    }

    // ============================================
    // お店へ結果送信 (claimPrize)
    // ============================================
    async function claimPrize() {
        const resultText = $('result-text').textContent;
        const prizeName = $('result-prize-name').textContent;

        if (state.liffReady && typeof liff !== 'undefined') {
            try {
                // トークルームにメッセージを送信するAPI
                await liff.sendMessages([{
                    type: 'text',
                    text: `【ガラポン大抽選会】\n${resultText}！\n「${prizeName}」が当たりました！🎉\n\nこちらの画面をスタッフに確認させてください。`
                }]);
                alert('お店のトークルームに結果を送信しました！\n左上の「×」でガラポンを閉じて、トーク画面をスタッフにお見せください。');
            } catch (error) {
                console.error('Send message failed:', error);
                if (error.code === 'USER_AGREEMENT_ERROR') {
                    alert('メッセージ送信の権限が許可されていませんでした。画面をこのままスタッフにお見せください。');
                } else if (!liff.getContext() || !['utou', 'room', 'group', 'square_chat'].includes(liff.getContext().type)) {
                    // トークルーム以外（外部ブラウザやKeepなど）から開かれた場合
                    alert('この機能はお店のトーク画面から開いた場合のみ利用できます。\n画面をこのままスタッフにお見せください。');
                } else {
                    alert('送信に失敗しました。画面をこのままスタッフにお見せください。');
                }
            }
        } else {
            alert('この機能はLINEアプリ内でのみ利用できます。\n画面をこのままスタッフにお見せください。');
        }
    }

    // ============================================
    // LIFF初期化
    // ============================================
    async function initLIFF() {
        if (typeof liff === 'undefined') {
            console.warn('LIFF SDK not loaded — standalone mode');
            return;
        }
        try {
            await liff.init({ liffId: CONFIG.LIFF_ID });
            state.liffReady = true;

            if (liff.isLoggedIn()) {
                try {
                    const profile = await liff.getProfile();
                    state.userProfile = profile;
                    $('user-name').textContent = `ようこそ、${profile.displayName}さん！`;
                    if (profile.pictureUrl) {
                        $('user-avatar').src = profile.pictureUrl;
                    }
                } catch (e) {
                    console.warn('Profile fetch failed:', e);
                }
            } else {
                $('user-name').textContent = 'ゲストさん';
            }
        } catch (e) {
            console.error('LIFF init failed:', e);
            $('user-name').textContent = 'ゲストさん';
        }
    }

    // ============================================
    // 初期化
    // ============================================
    function init() {
        // LIFF
        initLIFF();

        // 残回数
        updateRemainingUI();

        // ドラッグ操作
        const hitArea = $('hit-area');
        hitArea.addEventListener('mousedown', onDragStart);
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragEnd);
        hitArea.addEventListener('touchstart', onDragStart, { passive: false });
        window.addEventListener('touchmove', onDragMove, { passive: false });
        window.addEventListener('touchend', onDragEnd);

        // 自動回転ボタン
        $('spin-btn').addEventListener('click', autoSpin);

        // ポップアップ閉じる
        $('close-popup-btn').addEventListener('click', closeResultPopup);

        // シェアボタン
        $('share-btn').addEventListener('click', shareResult);

        // お店に送信ボタン
        const claimBtn = $('claim-btn');
        if (claimBtn) claimBtn.addEventListener('click', claimPrize);

        showStatus('ハンドルをドラッグ、または「自動で回す」ボタンで抽選！');
    }

    // ============================================
    // エントリーポイント
    // ============================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
