// Built-in global fetch in Node 22

async function runTests() {
  console.log('--- 1. Testing Player Login ---');
  let res = await fetch('http://localhost:3000/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: '+919876543211', otp: '123456', desiredRole: 'player' })
  });
  let data = await res.json();
  const playerToken = data.token;
  console.log('Player Logged In:', data.user.fullName, '| User ID:', data.user.userId);

  console.log('\n--- 2. Raising Match Dispute on fix_qf_1 ---');
  res = await fetch('http://localhost:3000/api/fixtures/fix_qf_1/dispute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${playerToken}`
    },
    body: JSON.stringify({ reason: 'Striker Placement Line Violation' })
  });
  data = await res.json();
  console.log('Dispute Raised Response:', data.message);

  console.log('\n--- 3. Verifying Match Status is Disputed ---');
  res = await fetch('http://localhost:3000/api/fixtures/fix_qf_1/scoreboard');
  data = await res.json();
  console.log('Fixture Current Status:', data.fixture.match_status);
  if (data.fixture.match_status !== 'disputed') {
    throw new Error('Expected status to be "disputed"');
  }

  console.log('\n--- 4. Help Desk Admin Login ---');
  res = await fetch('http://localhost:3000/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: '+919876543213', otp: '123456', desiredRole: 'help_desk' })
  });
  data = await res.json();
  const helpToken = data.token;
  console.log('Help Desk Admin Logged In:', data.user.fullName);

  console.log('\n--- 5. Resolving Match Dispute as Help Desk ---');
  res = await fetch('http://localhost:3000/api/fixtures/fix_qf_1/resolve-dispute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${helpToken}`,
      'x-carromx-active-role': 'help_desk'
    },
    body: JSON.stringify({
      resolutionStatus: 'live',
      notes: 'Video evidence examined; striker was within legal ICF baselines. Match resumed.'
    })
  });
  data = await res.json();
  console.log('Dispute Resolution Response:', data.message);

  console.log('\n--- 6. Verifying Match Status Restored to Live ---');
  res = await fetch('http://localhost:3000/api/fixtures/fix_qf_1/scoreboard');
  data = await res.json();
  console.log('Fixture Current Status:', data.fixture.match_status);
  if (data.fixture.match_status !== 'live') {
    throw new Error('Expected status to be "live"');
  }

  console.log('\n--- 7. Testing Live Standings API ---');
  res = await fetch('http://localhost:3000/api/tournaments/trn_blr_open_2026/standings');
  data = await res.json();
  console.log(`Standings Count: ${data.standings.length} players calculated.`);
  data.standings.slice(0, 3).forEach((s, idx) => {
    console.log(` Rank ${idx + 1}: ${s.fullName} | Played: ${s.played} | Diff: ${s.pointsDiff} | Pts: ${s.tablePoints}`);
  });

  console.log('\nALL REAL-TIME ENDPOINTS PASSED VERIFICATION WITH 100% SUCCESS!');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
