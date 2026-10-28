const fs = require('fs');
const path = require('path');

let questions = [];
try {
  questions = require('../questions.json');
} catch (e) {
  console.error('Error loading questions:', e);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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

function getRoomPublicState(room) {
  if (!room) return null;

  const now = Date.now();
  const elapsed = Math.floor((now - (room.phaseStartTime || now)) / 1000);
  const timeLeft = Math.max(0, (room.phaseDuration || 0) - elapsed);

  const playersList = (room.players || []).map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score || 0,
    roundScore: p.roundScore || 0,
    isHost: p.id === room.hostId,
    hasSubmittedBluff: !!p.bluff,
    hasVoted: !!p.vote,
    connected: true
  }));

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

  let safeOptions = null;
  if (room.state === 'VOTING' && room.votingOptions) {
    safeOptions = room.votingOptions.map(opt => ({
      id: opt.id,
      text: opt.text,
      isHouse: opt.isHouse || false
    }));
  }

  let revealData = null;
  if ((room.state === 'REVEAL' || room.state === 'ROUND_SUMMARY') && room.currentQuestion) {
    revealData = {
      trueAnswer: room.currentQuestion.answer,
      funFact: room.currentQuestion.funFact,
      options: (room.votingOptions || []).map(opt => ({
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
    timer: timeLeft,
    podium: room.state === 'PODIUM' ? room.podiumData : null
  };
}

function checkAutoPhaseTransitions(room) {
  if (!room || !room.phaseStartTime || !room.phaseDuration) return;
  const now = Date.now();
  const elapsed = Math.floor((now - room.phaseStartTime) / 1000);

  if (elapsed >= room.phaseDuration) {
    if (room.state === 'BLUFFING') {
      transitionToVoting(room);
    } else if (room.state === 'VOTING') {
      transitionToReveal(room);
    } else if (room.state === 'REVEAL') {
      if (room.currentRound < room.totalRounds) {
        room.currentRound++;
        transitionToBluffing(room);
      } else {
        transitionToPodium(room);
      }
    }
  }
}

function transitionToBluffing(room) {
  room.state = 'BLUFFING';
  room.phaseStartTime = Date.now();
  room.phaseDuration = 35;

  (room.players || []).forEach(p => {
    p.bluff = null;
    p.vote = null;
    p.voteTime = null;
    p.roundScore = 0;
  });

  const used = new Set(room.usedQuestionIds || []);
  const available = questions.filter(q => !used.has(q.id));
  const pool = available.length > 0 ? available : questions;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  used.add(picked.id);
  room.usedQuestionIds = Array.from(used);
  room.currentQuestion = picked;
}

function transitionToVoting(room) {
  room.state = 'VOTING';
  room.phaseStartTime = Date.now();
  room.phaseDuration = 25;

  let fallbackIndex = 0;
  const houseBluffs = (room.currentQuestion && room.currentQuestion.houseBluffs) || ['Mystery Option'];
  (room.players || []).forEach(p => {
    if (!p.bluff) {
      p.bluff = houseBluffs[fallbackIndex % houseBluffs.length] || 'Surprise Option';
      fallbackIndex++;
    }
  });

  const options = [];
  options.push({
    id: 'opt_real',
    text: room.currentQuestion.answer,
    isReal: true,
    authorId: null,
    authorName: 'THE TRUTH',
    voterNames: []
  });

  (room.players || []).forEach(p => {
    options.push({
      id: `opt_${p.id}`,
      text: p.bluff,
      isReal: false,
      authorId: p.id,
      authorName: p.name,
      voterNames: []
    });
  });

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
}

function transitionToReveal(room) {
  room.state = 'REVEAL';
  room.phaseStartTime = Date.now();
  room.phaseDuration = 14;

  const isFinalRound = room.currentRound === room.totalRounds;
  const multiplier = isFinalRound ? 2 : 1;
  const scoreEvents = [];

  (room.players || []).forEach(p => {
    if (p.vote && room.votingOptions) {
      const selectedOpt = room.votingOptions.find(o => o.id === p.vote);
      if (selectedOpt) {
        selectedOpt.voterNames.push(p.name);

        if (selectedOpt.isReal) {
          const speed = Math.max(0, 25 - ((p.voteTime || 25000) / 1000));
          const speedBonus = Math.floor(speed * 10);
          const earned = (1000 + speedBonus) * multiplier;
          p.score = (p.score || 0) + earned;
          p.roundScore = (p.roundScore || 0) + earned;
          scoreEvents.push({
            type: 'TRUTH',
            playerName: p.name,
            points: earned,
            details: `Found the Truth! (+${earned} pts)`
          });
        } else if (selectedOpt.authorId && selectedOpt.authorId !== p.id) {
          const author = (room.players || []).find(pl => pl.id === selectedOpt.authorId);
          if (author) {
            const earned = 500 * multiplier;
            author.score = (author.score || 0) + earned;
            author.roundScore = (author.roundScore || 0) + earned;
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
}

function transitionToPodium(room) {
  room.state = 'PODIUM';
  room.phaseStartTime = Date.now();
  room.phaseDuration = 0;

  const sorted = [...(room.players || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
  room.podiumData = {
    winners: sorted.map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      avatar: p.avatar,
      score: p.score || 0
    }))
  };
}

module.exports = {
  questions,
  generateRoomCode,
  matchesTruth,
  getRoomPublicState,
  checkAutoPhaseTransitions,
  transitionToBluffing,
  transitionToVoting,
  transitionToReveal,
  transitionToPodium
};
