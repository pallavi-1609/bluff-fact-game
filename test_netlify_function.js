const gameFunc = require('./netlify/functions/game.js');

async function testNetlifyFunction() {
  console.log('🧪 Testing Netlify Serverless Function (game.js)...');

  async function call(body) {
    const res = await gameFunc.handler({
      httpMethod: 'POST',
      body: JSON.stringify(body)
    }, {});
    return JSON.parse(res.body);
  }

  // 1. Create Room
  const createRes = await call({ action: 'createRoom', name: 'HostAlice', avatar: '🦁' });
  if (!createRes.success) throw new Error('Create room failed: ' + createRes.error);
  const code = createRes.code;
  const hostId = createRes.playerId;
  console.log(`✅ Netlify Function: Room created [${code}], Host ID: ${hostId}`);

  // 2. Join Room
  const joinRes = await call({ action: 'joinRoom', code, name: 'PlayerBob', avatar: '🦊' });
  if (!joinRes.success) throw new Error('Join room failed: ' + joinRes.error);
  const bobId = joinRes.playerId;
  console.log(`✅ Netlify Function: PlayerBob joined [${code}], ID: ${bobId}`);

  // Play 3 Rounds
  for (let r = 1; r <= 3; r++) {
    console.log(`\n--- ROUND ${r} OF 3 ---`);

    // Start or auto-progress
    if (r === 1) {
      const startRes = await call({ action: 'startGame', code, playerId: hostId });
      if (!startRes.success) throw new Error('Start failed: ' + startRes.error);
    }

    // Get current state
    let stateRes = await call({ action: 'getState', code, playerId: hostId });
    console.log(`Phase: ${stateRes.state.state}, Question: "${stateRes.state.question.prompt}"`);

    // Submit Bluffs
    const bluffAlice = await call({ action: 'submitBluff', code, playerId: hostId, text: `Alice Fake R${r}` });
    const bluffBob = await call({ action: 'submitBluff', code, playerId: bobId, text: `Bob Fake R${r}` });
    console.log(`Bluffs submitted: Alice (${bluffAlice.success}), Bob (${bluffBob.success})`);

    // Verify Voting phase
    stateRes = await call({ action: 'getState', code, playerId: hostId });
    console.log(`Phase: ${stateRes.state.state}, Options Count: ${stateRes.state.options.length}`);

    // Vote
    const options = stateRes.state.options;
    const voteAliceOpt = options.find(o => o.text !== `Alice Fake R${r}`);
    const voteBobOpt = options.find(o => o.text !== `Bob Fake R${r}`);

    await call({ action: 'submitVote', code, playerId: hostId, optionId: voteAliceOpt.id });
    const voteBobRes = await call({ action: 'submitVote', code, playerId: bobId, optionId: voteBobOpt.id });

    // Verify Reveal phase
    stateRes = await call({ action: 'getState', code, playerId: hostId });
    console.log(`Phase: ${stateRes.state.state}, True Answer: "${stateRes.state.reveal.trueAnswer}"`);
    console.log(`Standings after Round ${r}:`);
    stateRes.state.players.forEach(p => console.log(`  ${p.name}: ${p.score} pts`));

    // Standings
    stateRes.state.players.forEach(p => console.log(`  ${p.name}: ${p.score} pts`));

    // Advance to next round or podium
    const nextRes = await call({ action: 'nextRound', code, playerId: hostId });
    if (r === 3) {
      console.log(`\n🏆 PODIUM STATE REACHED! State: ${nextRes.state.state}`);
      console.log(`   Winners:`, nextRes.state.podium.winners);
    }
  }

  console.log('\n🏆 NETLIFY FUNCTION TEST: Complete 3-Round Game Simulation Successful!');
}

testNetlifyFunction().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
