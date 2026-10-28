const { getStore } = require('@netlify/blobs');
const {
  generateRoomCode,
  matchesTruth,
  getRoomPublicState,
  checkAutoPhaseTransitions,
  transitionToBluffing,
  transitionToVoting,
  transitionToReveal,
  transitionToPodium
} = require('../../lib/gameEngine');

// In-memory fallback if Blobs not configured
const memoryStore = new Map();

async function getRoom(code) {
  try {
    const store = getStore('bluff-fact-rooms', { consistency: 'strong' });
    const data = await store.get(code, { type: 'json' });
    if (data) return data;
  } catch (e) {
    // Fallback to memory
  }
  return memoryStore.get(code) || null;
}

async function saveRoom(code, room) {
  memoryStore.set(code, room);
  try {
    const store = getStore('bluff-fact-rooms', { consistency: 'strong' });
    await store.setJSON(code, room);
  } catch (e) {
    // Memory store handles it
  }
}

exports.handler = async function (event, context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
  }

  const { action, code, name, avatar, playerId, text, optionId } = body;

  // 1. CREATE ROOM
  if (action === 'createRoom') {
    const newCode = generateRoomCode();
    const newPlayerId = 'p_' + Math.random().toString(36).substring(2, 9);
    const hostPlayer = {
      id: newPlayerId,
      name: (name || 'Host').trim().substring(0, 15),
      avatar: avatar || '🦁',
      score: 0,
      roundScore: 0,
      bluff: null,
      vote: null
    };

    const room = {
      code: newCode,
      hostId: newPlayerId,
      state: 'LOBBY',
      currentRound: 1,
      totalRounds: 3,
      players: [hostPlayer],
      usedQuestionIds: [],
      phaseStartTime: Date.now(),
      phaseDuration: 0
    };

    await saveRoom(newCode, room);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, code: newCode, playerId: newPlayerId, state: getRoomPublicState(room) })
    };
  }

  // Find Room for following actions
  const roomCode = (code || '').toUpperCase().trim();
  if (!roomCode) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing room code' }) };
  }

  const room = await getRoom(roomCode);
  if (!room) {
    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Room not found! Check 4-letter code.' }) };
  }

  // Auto transition phases if timer elapsed
  checkAutoPhaseTransitions(room);

  // 2. GET STATE
  if (action === 'getState') {
    await saveRoom(roomCode, room);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, state: getRoomPublicState(room) })
    };
  }

  // 3. JOIN ROOM
  if (action === 'joinRoom') {
    if (room.players.length >= 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Room is full (max 8 players)!' }) };
    }
    if (room.state !== 'LOBBY') {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Game is already in progress!' }) };
    }

    let cleanName = (name || 'Player').trim().substring(0, 15);
    const existingNames = room.players.map(p => p.name.toLowerCase());
    if (existingNames.includes(cleanName.toLowerCase())) {
      cleanName = `${cleanName} ${room.players.length + 1}`;
    }

    const newPlayerId = 'p_' + Math.random().toString(36).substring(2, 9);
    const player = {
      id: newPlayerId,
      name: cleanName,
      avatar: avatar || '🦊',
      score: 0,
      roundScore: 0,
      bluff: null,
      vote: null
    };

    room.players.push(player);
    await saveRoom(roomCode, room);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, code: roomCode, playerId: newPlayerId, state: getRoomPublicState(room) })
    };
  }

  // 4. START GAME
  if (action === 'startGame') {
    if (room.hostId !== playerId) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Only the host can start the game!' }) };
    }
    if (room.players.length < 2) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Need at least 2 players to start!' }) };
    }

    room.currentRound = 1;
    room.players.forEach(p => { p.score = 0; p.roundScore = 0; });
    transitionToBluffing(room);
    await saveRoom(roomCode, room);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, state: getRoomPublicState(room) })
    };
  }

  // 5. SUBMIT BLUFF
  if (action === 'submitBluff') {
    if (room.state !== 'BLUFFING') {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Not currently bluffing phase!' }) };
    }
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Player not found' }) };
    }

    const trimmed = (text || '').trim();
    if (!trimmed) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Please enter a bluff!' }) };
    }

    // Truth detection check
    if (matchesTruth(trimmed, room.currentQuestion)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          isTruth: true,
          error: '🚨 Whoa! You guessed the ACTUAL truth! Write a fake answer so you don’t spoil it for others!'
        })
      };
    }

    player.bluff = trimmed;

    // Check if all players have submitted
    const allDone = room.players.every(p => !!p.bluff);
    if (allDone) {
      transitionToVoting(room);
    }

    await saveRoom(roomCode, room);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, state: getRoomPublicState(room) })
    };
  }

  // 6. SUBMIT VOTE
  if (action === 'submitVote') {
    if (room.state !== 'VOTING') {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Not in voting phase!' }) };
    }
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Player not found' }) };
    }

    const chosenOption = (room.votingOptions || []).find(o => o.id === optionId);
    if (chosenOption && chosenOption.authorId === playerId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'You cannot vote for your own lie!' }) };
    }

    player.vote = optionId;
    player.voteTime = Date.now() - (room.phaseStartTime || Date.now());

    // Check if all voted
    const allVoted = room.players.every(p => !!p.vote);
    if (allVoted) {
      transitionToReveal(room);
    }

    await saveRoom(roomCode, room);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, state: getRoomPublicState(room) })
    };
  }

  // 7. NEXT ROUND
  if (action === 'nextRound') {
    if (room.state === 'REVEAL') {
      if (room.currentRound < room.totalRounds) {
        room.currentRound++;
        transitionToBluffing(room);
      } else {
        transitionToPodium(room);
      }
      await saveRoom(roomCode, room);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, state: getRoomPublicState(room) })
      };
    }
  }

  // 8. PLAY AGAIN
  if (action === 'playAgain') {
    if (room.hostId !== playerId) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Only the host can restart!' }) };
    }
    room.state = 'LOBBY';
    room.currentRound = 1;
    room.usedQuestionIds = [];
    room.players.forEach(p => {
      p.score = 0;
      p.roundScore = 0;
      p.bluff = null;
      p.vote = null;
    });
    room.phaseStartTime = Date.now();
    room.phaseDuration = 0;

    await saveRoom(roomCode, room);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, state: getRoomPublicState(room) })
    };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Unknown action' }) };
};
