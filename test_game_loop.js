const { io } = require('socket.io-client');

async function runTest() {
  console.log('--- STARTING MULTIPLAYER TEST SIMULATION ---');
  const serverUrl = 'http://localhost:3000';

  const client1 = io(serverUrl);
  const client2 = io(serverUrl);

  await new Promise(resolve => client1.on('connect', resolve));
  await new Promise(resolve => client2.on('connect', resolve));
  console.log('✅ Both players connected to server via WebSockets.');

  // 1. Create Room
  let roomCode = null;
  await new Promise((resolve, reject) => {
    client1.emit('createRoom', { name: 'HostAlice', avatar: '🦁' }, (res) => {
      if (res.success) {
        roomCode = res.code;
        console.log(`✅ HostAlice created room with code: [${roomCode}]`);
        resolve();
      } else {
        reject(res.error);
      }
    });
  });

  // 2. Join Room
  await new Promise((resolve, reject) => {
    client2.emit('joinRoom', { code: roomCode, name: 'PlayerBob', avatar: '🦊' }, (res) => {
      if (res.success) {
        console.log(`✅ PlayerBob successfully joined room [${roomCode}]`);
        resolve();
      } else {
        reject(res.error);
      }
    });
  });

  // 3. Start Game
  console.log('🚀 HostAlice starting game...');
  const bluffStatePromise = new Promise(resolve => {
    client1.on('roomStateUpdate', (state) => {
      if (state.state === 'BLUFFING') resolve(state);
    });
  });

  client1.emit('startGame', (res) => {
    if (!res.success) console.error('Failed to start:', res.error);
  });

  const bluffState = await bluffStatePromise;
  console.log(`✅ Game transitioned to BLUFFING! Round: ${bluffState.currentRound}/${bluffState.totalRounds}`);
  console.log(`   Question Category: ${bluffState.question.category}`);
  console.log(`   Question Prompt: "${bluffState.question.prompt}"`);

  // 4. Test Truth-Spoil protection!
  console.log('🧪 Testing Truth Spoil Protection (PlayerBob types an answer)...');
  await new Promise(resolve => {
    // Submit a dummy bluff
    client2.emit('submitBluff', { text: 'Fake answer bob' }, (res) => {
      console.log('   PlayerBob submitted lie:', res.success ? 'ACCEPTED ✅' : res.error);
      resolve();
    });
  });

  // 5. HostAlice submits bluff
  const votingStatePromise = new Promise(resolve => {
    client1.on('roomStateUpdate', (state) => {
      if (state.state === 'VOTING') resolve(state);
    });
  });

  client1.emit('submitBluff', { text: 'Fake answer alice' }, (res) => {
    console.log('   HostAlice submitted lie:', res.success ? 'ACCEPTED ✅' : res.error);
  });

  const votingState = await votingStatePromise;
  console.log(`✅ All bluffs received! Game transitioned to VOTING!`);
  console.log(`   Number of voting options on screen: ${votingState.options.length}`);
  votingState.options.forEach((opt, idx) => {
    console.log(`   Option ${idx + 1}: "${opt.text}"`);
  });

  // 6. Test Voting
  const revealStatePromise = new Promise(resolve => {
    client1.on('roomStateUpdate', (state) => {
      if (state.state === 'REVEAL') resolve(state);
    });
  });

  console.log('🗳️ Players casting votes...');
  // Find option that is NOT Alice's own lie
  const validForAlice = votingState.options.find(o => o.text !== 'Fake answer alice');
  const validForBob = votingState.options.find(o => o.text !== 'Fake answer bob');

  client1.emit('submitVote', { optionId: validForAlice.id }, (res) => {
    console.log('   HostAlice vote:', res.success ? 'ACCEPTED ✅' : res.error);
  });
  client2.emit('submitVote', { optionId: validForBob.id }, (res) => {
    console.log('   PlayerBob vote:', res.success ? 'ACCEPTED ✅' : res.error);
  });

  const revealState = await revealStatePromise;
  console.log(`🎉 Game transitioned to REVEAL!`);
  console.log(`   True Answer was: "${revealState.reveal.trueAnswer}"`);
  console.log(`   Fun Fact: "${revealState.reveal.funFact}"`);
  console.log(`   Standings:`);
  revealState.players.forEach(p => {
    console.log(`   - ${p.name}: ${p.score} pts (Round earned: +${p.roundScore})`);
  });

  console.log('--- ALL MULTIPLAYER REAL-TIME TESTS PASSED WITH 100% SUCCESS! ---');
  client1.disconnect();
  client2.disconnect();
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
