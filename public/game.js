// Client-Side Game Controller for BLUFF FACT!
// Supports both Real-Time WebSockets & Netlify Functions directly at /.netlify/functions/game
(function () {
  const NETLIFY_ENDPOINT = '/.netlify/functions/game';
  const socket = typeof io === 'function' ? io({ transports: ['websocket', 'polling'] }) : null;

  // Local state
  let myId = localStorage.getItem('bluff_playerId') || ('p_' + Math.random().toString(36).substring(2, 9));
  localStorage.setItem('bluff_playerId', myId);

  let myName = '';
  let myAvatar = '🦁';
  let myRoomCode = null;
  let isHost = false;
  let currentRoomState = null;
  let hasVotedThisRound = false;
  let hasBluffedThisRound = false;
  let myBluffText = '';
  let pollInterval = null;

  // Audio helper shortcut
  const sounds = window.sounds;

  // DOM Elements - Screens
  const screens = {
    welcome: document.getElementById('screen-welcome'),
    lobby: document.getElementById('screen-lobby'),
    bluffing: document.getElementById('screen-bluffing'),
    voting: document.getElementById('screen-voting'),
    reveal: document.getElementById('screen-reveal'),
    podium: document.getElementById('screen-podium')
  };

  // Nav Elements
  const roomBadge = document.getElementById('room-badge');
  const navRoomCode = document.getElementById('nav-room-code');
  const soundBtn = document.getElementById('sound-btn');

  // Welcome Screen Inputs
  const avatarPicker = document.getElementById('avatar-picker');
  const playerNameInput = document.getElementById('player-name-input');
  const roomCodeInput = document.getElementById('room-code-input');
  const btnCreateGame = document.getElementById('btn-create-game');
  const btnJoinGame = document.getElementById('btn-join-game');
  const welcomeError = document.getElementById('welcome-error');

  // Lobby Screen
  const lobbyRoomCode = document.getElementById('lobby-room-code');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const playerCount = document.getElementById('player-count');
  const playerRoster = document.getElementById('player-roster');
  const btnStartGame = document.getElementById('btn-start-game');
  const hostControls = document.getElementById('host-controls');
  const guestWaiting = document.getElementById('guest-waiting');

  // Bluffing Screen
  const bluffRoundBadge = document.getElementById('bluff-round-badge');
  const bluffTimer = document.getElementById('bluff-timer');
  const bluffCategory = document.getElementById('bluff-category');
  const bluffPrompt = document.getElementById('bluff-prompt');
  const bluffInputArea = document.getElementById('bluff-input-area');
  const bluffTextInput = document.getElementById('bluff-text-input');
  const btnSubmitBluff = document.getElementById('btn-submit-bluff');
  const bluffWarning = document.getElementById('bluff-warning');
  const bluffWaitingArea = document.getElementById('bluff-waiting-area');
  const bluffSubmittedTracker = document.getElementById('bluff-submitted-tracker');

  // Voting Screen
  const voteRoundBadge = document.getElementById('vote-round-badge');
  const voteTimer = document.getElementById('vote-timer');
  const votePrompt = document.getElementById('vote-prompt');
  const votingOptionsGrid = document.getElementById('voting-options-grid');
  const voteStatusBanner = document.getElementById('vote-status-banner');

  // Reveal Screen
  const revealRoundBadge = document.getElementById('reveal-round-badge');
  const revealTimer = document.getElementById('reveal-timer');
  const revealTruthAnswer = document.getElementById('reveal-truth-answer');
  const revealFunFact = document.getElementById('reveal-fun-fact');
  const revealOptionsList = document.getElementById('reveal-options-list');
  const roundLeaderboardCards = document.getElementById('round-leaderboard-cards');

  // Podium Screen
  const podiumStage = document.getElementById('podium-stage');
  const finalScoresTable = document.getElementById('final-scores-table');
  const btnPlayAgain = document.getElementById('btn-play-again');
  const guestPlayAgainMsg = document.getElementById('guest-play-again-msg');

  // Switch Active Screen
  function showScreen(name) {
    Object.keys(screens).forEach(key => {
      screens[key].classList.toggle('active', key === name);
    });
  }

  // Check URL query parameters for direct room join
  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code) {
      roomCodeInput.value = code.toUpperCase().trim();
      playerNameInput.focus();
    }
  }

  // --- API CALL DISPATCHER (Socket.io or Netlify Function direct) ---
  async function apiCall(action, payload = {}) {
    if (socket && socket.connected) {
      return new Promise((resolve) => {
        socket.emit(action, payload, (res) => resolve(res));
      });
    } else {
      // Call Netlify Function directly
      try {
        const res = await fetch(NETLIFY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            code: myRoomCode,
            playerId: myId,
            name: myName,
            avatar: myAvatar,
            ...payload
          })
        });
        const data = await res.json();
        if (data.state) {
          onRoomUpdate(data.state);
        }
        return data;
      } catch (err) {
        return { success: false, error: 'Network communication error.' };
      }
    }
  }

  function startNetlifyPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      if (!myRoomCode) return;
      try {
        const res = await fetch(NETLIFY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'getState',
            code: myRoomCode,
            playerId: myId
          })
        });
        const data = await res.json();
        if (data.success && data.state) {
          onRoomUpdate(data.state);
        }
      } catch (e) {
        // network polling
      }
    }, 1000);
  }

  // --- SOCKET LISTENERS ---
  if (socket) {
    socket.on('connect', () => {
      myId = socket.id;
    });

    socket.on('roomStateUpdate', (room) => {
      onRoomUpdate(room);
    });

    socket.on('timerTick', (timeLeft) => {
      updateTimers(timeLeft);
    });
  }

  function updateTimers(timeLeft) {
    bluffTimer.textContent = timeLeft;
    voteTimer.textContent = timeLeft;
    revealTimer.textContent = timeLeft;

    if (timeLeft <= 5 && timeLeft > 0) {
      bluffTimer.classList.add('urgent');
      voteTimer.classList.add('urgent');
      sounds.playTick();
    } else {
      bluffTimer.classList.remove('urgent');
      voteTimer.classList.remove('urgent');
    }
  }

  // Sound toggle button
  soundBtn.addEventListener('click', () => {
    const muted = sounds.toggleMute();
    soundBtn.textContent = muted ? '🔇' : '🔊';
  });

  // Avatar Selection
  avatarPicker.querySelectorAll('.avatar-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      avatarPicker.querySelectorAll('.avatar-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      myAvatar = btn.getAttribute('data-avatar');
      sounds.playVote();
    });
  });

  playerNameInput.value = 'Player ' + Math.floor(Math.random() * 900 + 100);

  // CREATE ROOM
  btnCreateGame.addEventListener('click', async () => {
    const name = playerNameInput.value.trim() || 'Host';
    myName = name;
    welcomeError.classList.add('hidden');

    sounds.init();
    const res = await apiCall('createRoom', { name, avatar: myAvatar });
    if (res.success) {
      myRoomCode = res.code;
      if (res.playerId) myId = res.playerId;
      isHost = true;
      navRoomCode.textContent = myRoomCode;
      roomBadge.classList.remove('hidden');
      sounds.playJoin();
      if (!socket || !socket.connected) startNetlifyPolling();
    } else {
      showError(welcomeError, res.error);
    }
  });

  // JOIN ROOM
  btnJoinGame.addEventListener('click', async () => {
    const name = playerNameInput.value.trim() || 'Player';
    const code = roomCodeInput.value.trim().toUpperCase();
    myName = name;
    welcomeError.classList.add('hidden');

    if (!code || code.length !== 4) {
      showError(welcomeError, 'Please enter a valid 4-letter room code!');
      return;
    }

    sounds.init();
    const res = await apiCall('joinRoom', { code, name, avatar: myAvatar });
    if (res.success) {
      myRoomCode = res.code;
      if (res.playerId) myId = res.playerId;
      isHost = false;
      navRoomCode.textContent = myRoomCode;
      roomBadge.classList.remove('hidden');
      sounds.playJoin();
      if (!socket || !socket.connected) startNetlifyPolling();
    } else {
      showError(welcomeError, res.error);
    }
  });

  function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // COPY LINK BUTTON
  btnCopyLink.addEventListener('click', () => {
    const url = `${window.location.origin}?room=${myRoomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      btnCopyLink.textContent = '✅ Link Copied!';
      setTimeout(() => {
        btnCopyLink.textContent = '📋 Copy Join Link';
      }, 2500);
    }).catch(() => {
      btnCopyLink.textContent = url;
    });
  });

  // HOST: START GAME
  btnStartGame.addEventListener('click', async () => {
    sounds.playRoundStart();
    const res = await apiCall('startGame');
    if (res && !res.success) {
      alert(res.error);
    }
  });

  // SUBMIT BLUFF
  btnSubmitBluff.addEventListener('click', submitBluff);
  bluffTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitBluff();
  });

  async function submitBluff() {
    const text = bluffTextInput.value.trim();
    if (!text) {
      showError(bluffWarning, 'Please type a fake answer!');
      return;
    }

    bluffWarning.classList.add('hidden');
    myBluffText = text;

    const res = await apiCall('submitBluff', { text });
    if (res && res.success) {
      hasBluffedThisRound = true;
      sounds.playSubmit();
      bluffInputArea.classList.add('hidden');
      bluffWaitingArea.classList.remove('hidden');
    } else if (res) {
      showError(bluffWarning, res.error);
      if (res.isTruth) {
        sounds.playFooled();
      }
    }
  }

  // HOST: PLAY AGAIN
  btnPlayAgain.addEventListener('click', async () => {
    const res = await apiCall('playAgain');
    if (res && !res.success) alert(res.error);
  });

  // MAIN STATE UPDATE
  function onRoomUpdate(room) {
    if (!room) return;
    const prevState = currentRoomState ? currentRoomState.state : null;
    currentRoomState = room;

    myRoomCode = room.code;
    navRoomCode.textContent = room.code;
    roomBadge.classList.remove('hidden');

    isHost = room.hostId === myId;
    if (room.timer !== undefined) {
      updateTimers(room.timer);
    }

    // Screens
    switch (room.state) {
      case 'LOBBY':
        handleLobbyState(room, prevState);
        break;
      case 'BLUFFING':
        handleBluffingState(room, prevState);
        break;
      case 'VOTING':
        handleVotingState(room, prevState);
        break;
      case 'REVEAL':
      case 'ROUND_SUMMARY':
        handleRevealState(room, prevState);
        break;
      case 'PODIUM':
        handlePodiumState(room, prevState);
        break;
    }
  }

  // 1. LOBBY HANDLER
  function handleLobbyState(room, prevState) {
    showScreen('lobby');
    lobbyRoomCode.textContent = room.code;
    playerCount.textContent = room.players.length;

    playerRoster.innerHTML = '';
    room.players.forEach(p => {
      const card = document.createElement('div');
      card.className = `player-card ${p.isHost ? 'is-host' : ''}`;
      card.innerHTML = `
        <div class="player-avatar">${p.avatar}</div>
        <div class="player-info">
          <div class="player-name">${escapeHtml(p.name)}</div>
          <div class="player-role">${p.isHost ? '👑 HOST' : 'PLAYER'}</div>
        </div>
      `;
      playerRoster.appendChild(card);
    });

    if (prevState === 'LOBBY' && currentRoomState && room.players.length > (currentRoomState.players?.length || 0)) {
      sounds.playJoin();
    }

    if (isHost) {
      hostControls.classList.remove('hidden');
      guestWaiting.classList.add('hidden');
      if (room.players.length >= 2) {
        btnStartGame.disabled = false;
        btnStartGame.textContent = 'START GAME 🚀';
      } else {
        btnStartGame.disabled = true;
        btnStartGame.textContent = 'START GAME (NEED 2+ PLAYERS)';
      }
    } else {
      hostControls.classList.add('hidden');
      guestWaiting.classList.remove('hidden');
    }
  }

  // 2. BLUFFING HANDLER
  function handleBluffingState(room, prevState) {
    showScreen('bluffing');

    if (prevState !== 'BLUFFING') {
      sounds.playRoundStart();
      hasBluffedThisRound = false;
      bluffTextInput.value = '';
      bluffWarning.classList.add('hidden');
      bluffInputArea.classList.remove('hidden');
      bluffWaitingArea.classList.add('hidden');
      bluffTextInput.focus();
    }

    const roundText = room.question?.isFinalRound 
      ? `FINAL ROUND (DOUBLE POINTS! 🔥)` 
      : `ROUND ${room.currentRound} OF ${room.totalRounds}`;
    bluffRoundBadge.textContent = roundText;
    bluffCategory.textContent = `🎯 ${room.question?.category || 'TRIVIA'}`;

    const rawPrompt = room.question?.prompt || '';
    const formattedPrompt = rawPrompt.replace(/________/g, '<span class="blank">_________</span>');
    bluffPrompt.innerHTML = formattedPrompt;

    bluffSubmittedTracker.innerHTML = '';
    room.players.forEach(p => {
      const pill = document.createElement('div');
      pill.className = `submit-pill ${p.hasSubmittedBluff ? 'done' : ''}`;
      pill.innerHTML = `<span>${p.avatar}</span> <span>${escapeHtml(p.name)}</span> ${p.hasSubmittedBluff ? '✓' : '...'}`;
      bluffSubmittedTracker.appendChild(pill);
    });

    const me = room.players.find(p => p.id === myId || p.name === myName);
    if (me && me.hasSubmittedBluff && !hasBluffedThisRound) {
      hasBluffedThisRound = true;
      bluffInputArea.classList.add('hidden');
      bluffWaitingArea.classList.remove('hidden');
    }
  }

  // 3. VOTING HANDLER
  function handleVotingState(room, prevState) {
    showScreen('voting');

    if (prevState !== 'VOTING') {
      hasVotedThisRound = false;
      voteStatusBanner.classList.add('hidden');
      sounds.playVote();
    }

    const roundText = room.question?.isFinalRound 
      ? `FINAL ROUND (DOUBLE POINTS! 🔥)` 
      : `ROUND ${room.currentRound} OF ${room.totalRounds}`;
    voteRoundBadge.textContent = roundText;

    const rawPrompt = room.question?.prompt || '';
    const formattedPrompt = rawPrompt.replace(/________/g, '<span class="blank">_________</span>');
    votePrompt.innerHTML = formattedPrompt;

    votingOptionsGrid.innerHTML = '';
    if (room.options) {
      room.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vote-btn';

        const isMyLie = myBluffText && opt.text.trim().toLowerCase() === myBluffText.trim().toLowerCase();

        if (isMyLie) {
          btn.classList.add('own-bluff');
          btn.disabled = true;
          btn.innerHTML = `<span>${escapeHtml(opt.text)}</span> <span class="own-tag">YOUR LIE!</span>`;
        } else {
          btn.innerHTML = `<span>${escapeHtml(opt.text)}</span>`;
          if (hasVotedThisRound) {
            btn.disabled = true;
          } else {
            btn.addEventListener('click', async () => {
              if (hasVotedThisRound) return;
              hasVotedThisRound = true;
              btn.classList.add('selected');
              sounds.playVote();
              voteStatusBanner.classList.remove('hidden');

              votingOptionsGrid.querySelectorAll('.vote-btn').forEach(b => b.disabled = true);

              const res = await apiCall('submitVote', { optionId: opt.id });
              if (res && !res.success) alert(res.error);
            });
          }
        }

        votingOptionsGrid.appendChild(btn);
      });
    }
  }

  // 4. REVEAL HANDLER
  function handleRevealState(room, prevState) {
    showScreen('reveal');

    if (prevState !== 'REVEAL' && prevState !== 'ROUND_SUMMARY') {
      sounds.playTruthReveal();
      window.burstConfetti({ count: 70 });
    }

    revealRoundBadge.textContent = `ROUND ${room.currentRound} REVEAL`;

    if (room.reveal) {
      revealTruthAnswer.textContent = room.reveal.trueAnswer;
      revealFunFact.textContent = room.reveal.funFact;

      revealOptionsList.innerHTML = '';
      room.reveal.options.forEach(opt => {
        const card = document.createElement('div');
        card.className = `reveal-card ${opt.isReal ? 'is-truth' : ''}`;

        const voterTags = opt.votes.map(v => 
          `<span class="voter-tag ${opt.isReal ? 'correct' : ''}">👤 ${escapeHtml(v)}</span>`
        ).join(' ');

        const authorTag = opt.isReal 
          ? `<span class="reveal-author truth-tag">🌟 ACTUAL TRUTH</span>`
          : `<span class="reveal-author">Lie by ${escapeHtml(opt.authorName)}</span>`;

        card.innerHTML = `
          <div class="reveal-top">
            <span class="reveal-text">${escapeHtml(opt.text)}</span>
            ${authorTag}
          </div>
          <div class="reveal-voters">
            ${opt.votes.length > 0 ? `<span>Voted by:</span> ${voterTags}` : `<span>No one picked this.</span>`}
          </div>
        `;
        revealOptionsList.appendChild(card);
      });

      roundLeaderboardCards.innerHTML = '';
      const sorted = [...room.players].sort((a, b) => b.score - a.score);
      sorted.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'standing-row';
        row.innerHTML = `
          <div class="standing-player">
            <span>#${idx + 1}</span>
            <span>${p.avatar}</span>
            <span>${escapeHtml(p.name)}</span>
          </div>
          <div class="standing-score">${p.score} PTS</div>
        `;
        roundLeaderboardCards.appendChild(row);
      });
    }
  }

  // 5. PODIUM HANDLER
  function handlePodiumState(room, prevState) {
    showScreen('podium');

    if (prevState !== 'PODIUM') {
      sounds.playPodium();
      window.burstConfetti({ count: 180 });
      setTimeout(() => window.burstConfetti({ count: 120 }), 1500);
    }

    if (room.podium && room.podium.winners) {
      const winners = room.podium.winners;
      podiumStage.innerHTML = '';

      const podiumOrder = [];
      if (winners.length > 1) podiumOrder.push({ ...winners[1], rank: 2 });
      if (winners.length > 0) podiumOrder.push({ ...winners[0], rank: 1 });
      if (winners.length > 2) podiumOrder.push({ ...winners[2], rank: 3 });

      podiumOrder.forEach(w => {
        const pillar = document.createElement('div');
        pillar.className = `podium-pillar rank-${w.rank}`;
        pillar.innerHTML = `
          <div class="podium-avatar">${w.avatar}</div>
          <div class="podium-name">${escapeHtml(w.name)}</div>
          <div class="podium-score">${w.score} PTS</div>
          <div class="podium-block">#${w.rank}</div>
        `;
        podiumStage.appendChild(pillar);
      });

      finalScoresTable.innerHTML = '';
      winners.forEach(w => {
        const row = document.createElement('div');
        row.className = 'standing-row';
        row.innerHTML = `
          <div class="standing-player">
            <span>#${w.rank}</span>
            <span>${w.avatar}</span>
            <span>${escapeHtml(w.name)}</span>
          </div>
          <div class="standing-score">${w.score} PTS</div>
        `;
        finalScoresTable.appendChild(row);
      });
    }

    if (isHost) {
      btnPlayAgain.classList.remove('hidden');
      guestPlayAgainMsg.classList.add('hidden');
    } else {
      btnPlayAgain.classList.add('hidden');
      guestPlayAgainMsg.classList.remove('hidden');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  checkUrlParams();
})();
