const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  console.error('Safely caught uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Safely caught unhandledRejection:', reason);
});

function safeCallback(cb, payload) {
  if (typeof cb === 'function') {
    try { cb(payload); } catch (e) { /* ignore */ }
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve public directory
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Netlify function fallback route on local server
const netlifyGame = require('./netlify/functions/game.js');
app.all('/.netlify/functions/game', async (req, res) => {
  try {
    const event = {
      httpMethod: req.method,
      body: JSON.stringify(req.body || {})
    };
    const result = await netlifyGame.handler(event, {});
    res.status(result.statusCode || 200).set(result.headers || {}).send(result.body);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Load Questions
let questions = [];
try {
  const data = fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8');
  questions = JSON.parse(data);
  console.log(`Loaded ${questions.length} questions.`);
} catch (e) {
  console.error('Failed to load questions.json:', e);
}

// In-memory room store
const rooms = new Map();

// Helper to generate 4-letter room codes
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

// Shuffle array
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Fuzzy check if submission matches true answer
function matchesTruth(submission, q) {
  if (!submission || !q) return false;
  const cleanSub = submission.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanAns = q.answer.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cleanSub === cleanAns) return true;

  if (q.synonyms && Array.isArray(q.synonyms)) {
    for (const syn of q.synonyms) {
      const cleanSyn = syn.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanSub === cleanSyn) return true;
    }
  }
  return false;
}

// Get public safe view of a room for clients
function getRoomPublicState(room) {
  const playersList = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    roundScore: p.roundScore || 0,
    isHost: p.id === room.hostId,
    hasSubmittedBluff: !!p.bluff,
    hasVoted: !!p.vote,
    connected: p.connected
  }));

  // Safe question representation (prompt without answer)
  let safeQuestion = null;
  if (room.currentQuestion) {
    safeQuestion = {
      id: room.currentQuestion.id,
      category: room.currentQuestion.category,
      prompt: room.currentQuestion.prompt,
      round: room.currentRound,
      totalRounds: room.totalRounds,
      isFinalRound: room.currentRound === room.totalRounds
    };
  }

  // Voting options (without revealing authors or truth!)
  let safeOptions = null;
  if (room.state === 'VOTING') {
    safeOptions = room.votingOptions.map(opt => ({
      id: opt.id,
      text: opt.text,
      isHouse: opt.isHouse || false
    }));
  }

  // Reveal data (only during REVEAL or ROUND_SUMMARY)
  let revealData = null;
  if (room.state === 'REVEAL' || room.state === 'ROUND_SUMMARY') {
    revealData = {
      trueAnswer: room.currentQuestion.answer,
      funFact: room.currentQuestion.funFact,
      options: room.votingOptions.map(opt => ({
        id: opt.id,
        text: opt.text,
        isReal: opt.isReal,
        authorName: opt.authorName || 'House Fact',
        authorId: opt.authorId || null,
        votes: opt.voterNames || []
      })),
      roundScoreEvents: room.roundScoreEvents || []
    };
  }

  return {
    code: room.code,
    state: room.state,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    hostId: room.hostId,
    players: playersList,
    question: safeQuestion,
    options: safeOptions,
    reveal: revealData,
    timer: room.timer,
    podium: room.state === 'PODIUM' ? room.podiumData : null
  };
}

function broadcastRoom(room) {
  const publicState = getRoomPublicState(room);
  io.to(room.code).emit('roomStateUpdate', publicState);
}

function startTimer(room, durationSeconds, onComplete) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
  }
  room.timer = durationSeconds;
  io.to(room.code).emit('timerTick', room.timer);

  room.timerInterval = setInterval(() => {
    room.timer--;
    io.to(room.code).emit('timerTick', room.timer);
    if (room.timer <= 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      if (onComplete) onComplete();
    }
  }, 1000);
}

function clearTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  room.timer = 0;
}

// Flow: Next Question / Phase
function startBluffPhase(room) {
  clearTimer(room);
  room.state = 'BLUFFING';

  // Clear previous round bluffs & votes
  room.players.forEach(p => {
    p.bluff = null;
    p.vote = null;
    p.voteTime = null;
    p.roundScore = 0;
  });

  // Pick unused question
  if (!room.usedQuestionIds) room.usedQuestionIds = new Set();
  const availableQuestions = questions.filter(q => !room.usedQuestionIds.has(q.id));
  const pool = availableQuestions.length > 0 ? availableQuestions : questions;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  room.usedQuestionIds.add(picked.id);
  room.currentQuestion = picked;

  broadcastRoom(room);

  // 35s timer for players to submit bluffs
  startTimer(room, 35, () => {
    finishBluffPhase(room);
  });
}

function finishBluffPhase(room) {
  clearTimer(room);
  room.state = 'VOTING';

  // Fill default bluffs for anyone who didn't submit
  let fallbackIndex = 0;
  room.players.forEach(p => {
    if (!p.bluff) {
      const houseBluffs = room.currentQuestion.houseBluffs || ['A mystery option', 'Nothing at all'];
      p.bluff = houseBluffs[fallbackIndex % houseBluffs.length] || `Surprise option`;
      fallbackIndex++;
    }
  });

  // Build voting options
  const options = [];

  // Add the Real Truth
  options.push({
    id: 'opt_real',
    text: room.currentQuestion.answer,
    isReal: true,
    authorId: null,
    authorName: 'THE TRUTH',
    voterNames: []
  });

  // Add players' bluffs
  room.players.forEach(p => {
    options.push({
      id: `opt_${p.id}`,
      text: p.bluff,
      isReal: false,
      authorId: p.id,
      authorName: p.name,
      voterNames: []
    });
  });

  // If low player count (e.g. 2 players), inject house bluff so choices are exciting (min 4 options)
  if (options.length < 4 && room.currentQuestion.houseBluffs) {
    for (const hBluff of room.currentQuestion.houseBluffs) {
      if (!options.some(o => o.text.toLowerCase() === hBluff.toLowerCase())) {
        options.push({
          id: `opt_house_${options.length}`,
          text: hBluff,
          isReal: false,
          isHouse: true,
          authorId: null,
          authorName: 'House Bluff',
          voterNames: []
        });
      }
      if (options.length >= 4) break;
    }
  }

  room.votingOptions = shuffle(options);
  broadcastRoom(room);

  // 25s timer for voting
  room.votingStartTime = Date.now();
  startTimer(room, 25, () => {
    finishVotingPhase(room);
  });
}

function finishVotingPhase(room) {
  clearTimer(room);
  room.state = 'REVEAL';

  const isFinalRound = room.currentRound === room.totalRounds;
  const multiplier = isFinalRound ? 2 : 1;
  const scoreEvents = [];

  // Tally votes
  room.players.forEach(p => {
    if (p.vote) {
      const selectedOpt = room.votingOptions.find(o => o.id === p.vote);
      if (selectedOpt) {
        selectedOpt.voterNames.push(p.name);

        if (selectedOpt.isReal) {
          // Voted for Truth!
          const speed = Math.max(0, 25 - ((p.voteTime || 25000) / 1000));
          const speedBonus = Math.floor(speed * 10);
          const earned = (1000 + speedBonus) * multiplier;
          p.score += earned;
          p.roundScore += earned;
          scoreEvents.push({
            type: 'TRUTH',
            playerName: p.name,
            points: earned,
            details: `Found the Truth! (+${earned} pts)`
          });
        } else if (selectedOpt.authorId && selectedOpt.authorId !== p.id) {
          // Fooled by another player's bluff!
          const author = room.players.get(selectedOpt.authorId);
          if (author) {
            const earned = 500 * multiplier;
            author.score += earned;
            author.roundScore += earned;
            scoreEvents.push({
              type: 'BLUFF_FOOLED',
              playerName: author.name,
              targetName: p.name,
              points: earned,
              details: `${author.name} tricked ${p.name}! (+${earned} pts)`
            });
          }
        }
      }
    }
  });

  room.roundScoreEvents = scoreEvents;
  broadcastRoom(room);

  // After 14s of reveal excitement, automatically transition to next round or podium
  startTimer(room, 14, () => {
    if (room.currentRound < room.totalRounds) {
      room.currentRound++;
      startBluffPhase(room);
    } else {
      finishGamePodium(room);
    }
  });
}

function finishGamePodium(room) {
  clearTimer(room);
  room.state = 'PODIUM';

  const sorted = Array.from(room.players.values()).sort((a, b) => b.score - a.score);
  room.podiumData = {
    winners: sorted.map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      avatar: p.avatar,
      score: p.score
    }))
  };

  broadcastRoom(room);
}

// Socket Events
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = socket.id;

  // Create Room
  socket.on('createRoom', ({ name, avatar }, callback) => {
    const code = generateRoomCode();
    const room = {
      code,
      hostId: playerId,
      state: 'LOBBY',
      currentRound: 1,
      totalRounds: 3,
      players: new Map(),
      usedQuestionIds: new Set(),
      timer: 0,
      timerInterval: null
    };

    const hostPlayer = {
      id: playerId,
      name: (name || 'Host').trim().substring(0, 15),
      avatar: avatar || '🦁',
      score: 0,
      roundScore: 0,
      connected: true,
      bluff: null,
      vote: null
    };

    room.players.set(playerId, hostPlayer);
    rooms.set(code, room);
    currentRoom = room;

    socket.join(code);
    safeCallback(callback, { success: true, code, playerId });
    broadcastRoom(room);
  });

  // Join Room
  socket.on('joinRoom', ({ code, name, avatar }, callback) => {
    const roomCode = (code || '').toUpperCase().trim();
    const room = rooms.get(roomCode);

    if (!room) {
      return safeCallback(callback, { success: false, error: 'Room not found! Check the 4-letter code.' });
    }

    if (room.players.size >= 8) {
      return safeCallback(callback, { success: false, error: 'Room is full (max 8 players)!' });
    }

    if (room.state !== 'LOBBY') {
      return safeCallback(callback, { success: false, error: 'Game already in progress in this room!' });
    }

    // Check duplicate name
    let cleanName = (name || 'Player').trim().substring(0, 15);
    const existingNames = Array.from(room.players.values()).map(p => p.name.toLowerCase());
    if (existingNames.includes(cleanName.toLowerCase())) {
      cleanName = `${cleanName} ${room.players.size + 1}`;
    }

    const player = {
      id: playerId,
      name: cleanName,
      avatar: avatar || '🦊',
      score: 0,
      roundScore: 0,
      connected: true,
      bluff: null,
      vote: null
    };

    room.players.set(playerId, player);
    currentRoom = room;

    socket.join(roomCode);
    safeCallback(callback, { success: true, code: roomCode, playerId });
    broadcastRoom(room);
  });

  // Start Game (Host only)
  socket.on('startGame', (callback) => {
    if (!currentRoom) return;
    if (currentRoom.hostId !== playerId) {
      return safeCallback(callback, { success: false, error: 'Only the host can start the game!' });
    }
    if (currentRoom.players.size < 2) {
      return safeCallback(callback, { success: false, error: 'Need at least 2 players to play!' });
    }

    currentRoom.currentRound = 1;
    currentRoom.players.forEach(p => { p.score = 0; });
    startBluffPhase(currentRoom);
    safeCallback(callback, { success: true });
  });

  // Submit Bluff
  socket.on('submitBluff', ({ text }, callback) => {
    if (!currentRoom || currentRoom.state !== 'BLUFFING') return;
    const player = currentRoom.players.get(playerId);
    if (!player) return;

    const trimmed = (text || '').trim();
    if (!trimmed) {
      return safeCallback(callback, { success: false, error: 'Please enter a bluff!' });
    }

    // Check if player accidentally typed the exact truth!
    if (matchesTruth(trimmed, currentRoom.currentQuestion)) {
      return safeCallback(callback, {
        success: false,
        isTruth: true,
        error: '🚨 Whoa! You guessed the ACTUAL truth! Write a fake answer so you don’t spoil it for others!'
      });
    }

    player.bluff = trimmed;
    safeCallback(callback, { success: true });

    // Check if all players have submitted
    const allSubmitted = Array.from(currentRoom.players.values()).every(p => !!p.bluff);
    if (allSubmitted) {
      finishBluffPhase(currentRoom);
    } else {
      broadcastRoom(currentRoom);
    }
  });

  // Submit Vote
  socket.on('submitVote', ({ optionId }, callback) => {
    if (!currentRoom || currentRoom.state !== 'VOTING') return;
    const player = currentRoom.players.get(playerId);
    if (!player) return;

    // Check if player is trying to vote for their own bluff
    const chosenOption = currentRoom.votingOptions.find(o => o.id === optionId);
    if (chosenOption && chosenOption.authorId === playerId) {
      return safeCallback(callback, { success: false, error: 'You cannot vote for your own lie!' });
    }

    player.vote = optionId;
    player.voteTime = Date.now() - (currentRoom.votingStartTime || Date.now());
    safeCallback(callback, { success: true });

    // Check if all players have voted
    const allVoted = Array.from(currentRoom.players.values()).every(p => !!p.vote);
    if (allVoted) {
      finishVotingPhase(currentRoom);
    } else {
      broadcastRoom(currentRoom);
    }
  });

  // Play Again (Host only)
  socket.on('playAgain', (callback) => {
    if (!currentRoom || currentRoom.hostId !== playerId) return;
    currentRoom.state = 'LOBBY';
    currentRoom.currentRound = 1;
    currentRoom.usedQuestionIds = new Set();
    currentRoom.players.forEach(p => {
      p.score = 0;
      p.roundScore = 0;
      p.bluff = null;
      p.vote = null;
    });
    clearTimer(currentRoom);
    broadcastRoom(currentRoom);
    safeCallback(callback, { success: true });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const player = currentRoom.players.get(playerId);
    if (player) {
      player.connected = false;
      // If still in lobby, remove player completely
      if (currentRoom.state === 'LOBBY') {
        currentRoom.players.delete(playerId);
      }

      // If host left, assign new host if any remain
      if (currentRoom.hostId === playerId) {
        const remaining = Array.from(currentRoom.players.keys());
        if (remaining.length > 0) {
          currentRoom.hostId = remaining[0];
        } else {
          clearTimer(currentRoom);
          rooms.delete(currentRoom.code);
          return;
        }
      }

      broadcastRoom(currentRoom);
    }
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎮 BLUFF FACT! Server running live at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`===============================================`);
});
