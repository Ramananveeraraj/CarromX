import { initDb, query } from '../server/db.js';
import { generateToken, normalizeRole, verifyStoredOtp, generateOtp, storeOtpForKeys } from '../server/auth.js';
import http from 'http';
import express from 'express';
import authRoutes from '../server/routes/authRoutes.js';
import tournamentRoutes from '../server/routes/tournamentRoutes.js';
import fixtureRoutes from '../server/routes/fixtureRoutes.js';
import scoreRoutes from '../server/routes/scoreRoutes.js';
import participantRoutes from '../server/routes/participantRoutes.js';

let server;
let baseUrl;

async function startTestServer() {
  await initDb();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/tournaments', tournamentRoutes);
  app.use('/api', fixtureRoutes);
  app.use('/api', scoreRoutes);
  app.use('/api', participantRoutes);

  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[TEST-SUITE] Test server running at ${baseUrl}`);
      resolve();
    });
  });
}

function stopTestServer() {
  return new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
}

async function request(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🧪 CARROMX COMPREHENSIVE FUNCTIONALITIES VERIFICATION');
  console.log('======================================================\n');

  await startTestServer();

  // Ensure Admin user exists in DB with correct credentials
  const existingAdmin = await query("SELECT user_id FROM users WHERE email = 'carrromx@gmail.com' OR phone_number = '+919600436921'");
  if (existingAdmin.rows.length > 0) {
    await query(`
      UPDATE users 
      SET phone_number = '+919600436921',
          email = 'carrromx@gmail.com',
          password_hash = 'Ramanan@03',
          role = 'super_admin'
      WHERE user_id = $1
    `, [existingAdmin.rows[0].user_id]);
  } else {
    await query(`
      INSERT INTO users (user_id, full_name, phone_number, email, password_hash, role)
      VALUES ('usr_admin_carromx', 'CarromX Admin', '+919600436921', 'carrromx@gmail.com', 'Ramanan@03', 'super_admin')
    `);
  }

  // Ensure a test organizer and a test player exist
  const orgId = 'usr_test_org_' + Date.now();
  const playerId = 'usr_test_player_' + Date.now();
  const orgPhone = '+919' + Math.floor(100000000 + Math.random() * 900000000);
  const playerPhone = '+919' + Math.floor(100000000 + Math.random() * 900000000);
  const orgEmail = `vignesh.${Date.now()}@example.com`;
  const playerEmail = `ramesh.${Date.now()}@example.com`;

  await query(`
    INSERT INTO users (user_id, full_name, phone_number, email, role)
    VALUES 
      ('${orgId}', 'Vignesh Organiser', '${orgPhone}', '${orgEmail}', 'organizer'),
      ('${playerId}', 'Ramesh Player', '${playerPhone}', '${playerEmail}', 'player')
  `);

  const adminToken = generateToken({
    user_id: 'usr_admin_carromx',
    full_name: 'CarromX Admin',
    email: 'carrromx@gmail.com',
    role: 'super_admin'
  });

  const orgToken = generateToken({
    user_id: orgId,
    full_name: 'Vignesh Organiser',
    email: orgEmail,
    role: 'organizer'
  });

  const playerToken = generateToken({
    user_id: playerId,
    full_name: 'Ramesh Player',
    email: playerEmail,
    role: 'player'
  });

  // ----------------------------------------------------
  // TEST GROUP 1: Authentication & Super Admin Security
  // ----------------------------------------------------
  console.log('\n--- 1. Authentication & Super Admin Security ---');

  // 1.1 Invalid Password
  let res = await request('POST', '/api/auth/login', {
    email: 'carrromx@gmail.com',
    phoneNumber: '9600436921',
    password: 'WrongPassword123'
  });
  assert(res.status === 401, 'Invalid password is rejected with 401');

  // 1.2 Non-admin email
  res = await request('POST', '/api/auth/login', {
    email: 'hacker@example.com',
    phoneNumber: '9600436921',
    password: 'Ramanan@03'
  });
  assert(res.status === 401, 'Non-admin email is rejected with 401');

  // 1.3 Valid Super Admin Credentials
  res = await request('POST', '/api/auth/login', {
    email: 'carrromx@gmail.com',
    phoneNumber: '9600436921',
    password: 'Ramanan@03'
  });
  assert(res.status === 200, 'Valid Super Admin login returns 200 OK');
  assert(res.data.token && res.data.user.role === 'super_admin', 'Admin login issues JWT with super_admin role');
  assert(res.data.user.phoneNumber === '+919600436921', 'Admin phone is +919600436921');

  // 1.4 Imposter Phone Protection on Registration
  const otpCode = await generateOtp('9600436921');
  await storeOtpForKeys(['9600436921', '+919600436921'], otpCode);
  res = await request('POST', '/api/auth/verify-otp', {
    phoneNumber: '9600436921',
    email: 'imposter@gmail.com',
    otp: otpCode,
    fullName: 'Imposter Player'
  });
  assert(res.status === 403, 'Imposter registration using Admin phone is rejected with 403 Forbidden');

  // ----------------------------------------------------
  // TEST GROUP 2: RBAC & Role Restrictions
  // ----------------------------------------------------
  console.log('\n--- 2. RBAC & Role Tampering Protection ---');

  // 2.1 Player trying to self-promote via switch-role
  res = await request('POST', '/api/auth/switch-role', { role: 'super_admin' }, playerToken);
  assert(res.status === 403, 'Player cannot switch role or self-promote (403)');

  // 2.2 Player trying to access user management
  res = await request('GET', '/api/auth/users', null, playerToken);
  assert(res.status === 403, 'Player cannot access /api/auth/users (403)');

  // 2.3 Super Admin CAN access user directory
  res = await request('GET', '/api/auth/users', null, adminToken);
  assert(res.status === 200 && Array.isArray(res.data.users), 'Super Admin can list users');

  // ----------------------------------------------------
  // TEST GROUP 3: Tournament Creation & Permission Guard
  // ----------------------------------------------------
  console.log('\n--- 3. Tournament Creation & Role Guard ---');

  // 3.1 Player attempts to create tournament -> MUST BE FORBIDDEN
  res = await request('POST', '/api/tournaments', {
    title: 'Unauthorized Player Cup',
    venue_address: 'Chennai Stadium',
    format: 'knockout',
    total_boards: 2
  }, playerToken);
  assert(res.status === 403, 'Player cannot create tournament (403 Forbidden)');
  assert(res.data.error.includes('Only registered Organisers'), 'Returns clear message: Only registered Organisers can create tournaments');

  // 3.2 Organiser creates tournament -> MUST SUCCEED
  res = await request('POST', '/api/tournaments', {
    title: 'Vignesh Open Carrom Trophy 2026',
    venue_address: 'Kanteerava Indoor Stadium, Bangalore',
    format: 'knockout',
    total_boards: 4,
    max_points_per_set: 25,
    boards_per_set: 8,
    total_sets: 3,
    set_time_limit_minutes: 25,
    match_duration_minutes: 45,
    entry_fee: 500.00,
    upi_id: 'vignesh@upi'
  }, orgToken);
  assert(res.status === 201, 'Organiser creates tournament successfully (201 Created)');
  const tourId = res.data.tournamentId;
  assert(tourId, 'Tournament ID generated');

  // 3.3 Verify Tournament Boards and PINs were automatically generated
  res = await request('GET', `/api/tournaments/${tourId}/boards`, null, orgToken);
  assert(res.status === 200 && res.data.boards.length === 4, 'Auto-generated 4 physical boards for tournament');
  const board1 = res.data.boards[0];
  assert(board1.is_locked_pin === true || board1.is_locked_pin === 1, 'Board 1 is locked by PIN on creation');
  assert(board1.access_pin && board1.access_pin.length === 4, 'Board 1 has a secure 4-digit PIN');

  // ----------------------------------------------------
  // TEST GROUP 4: Physical Board PIN Verification
  // ----------------------------------------------------
  console.log('\n--- 4. Physical Board PIN & Umpire Security ---');

  // 4.1 Wrong PIN fails
  res = await request('POST', `/api/boards/${board1.board_id}/verify-pin`, {
    pin: '0000',
    umpireId: 'usr_umpire_1'
  });
  assert(res.status === 403, 'Incorrect board PIN returns 403 Forbidden');

  // 4.2 Correct PIN unlocks board
  res = await request('POST', `/api/boards/${board1.board_id}/verify-pin`, {
    pin: board1.access_pin,
    umpireId: 'usr_umpire_1'
  });
  assert(res.status === 200, 'Correct board PIN unlocks board successfully (200 OK)');

  // 4.3 Verify board status is now unlocked
  res = await request('GET', `/api/boards/${board1.board_id}`);
  assert(res.status === 200, 'Board details fetched');
  assert(res.data.board.is_locked_pin === false || res.data.board.is_locked_pin === 0, 'Board is confirmed unlocked');
  assert(res.data.board.current_umpire_id === 'usr_umpire_1', 'Active umpire bound to board');

  // ----------------------------------------------------
  // TEST GROUP 5: Live Match Disputes & Resolution
  // ----------------------------------------------------
  console.log('\n--- 5. Live Match Disputes & Protests ---');

  // Create a match fixture under the tournament
  const fixId = 'fix_' + Date.now();
  await query(`
    INSERT INTO match_fixtures (fixture_id, tournament_id, round_number, match_no, match_status, scheduled_start_time)
    VALUES ('${fixId}', '${tourId}', 1, 'M1', 'live', CURRENT_TIMESTAMP)
  `);

  // 5.1 Raise Dispute
  res = await request('POST', `/api/fixtures/${fixId}/dispute`, {
    userId: playerId,
    role: 'player',
    reason: 'Queen covered coin illegally pushed before striking.'
  }, playerToken);
  assert(res.status === 201, 'Match dispute raised successfully (201 Created)');
  const disputeId = res.data.disputeId;
  assert(disputeId, 'Returned disputeId');

  // 5.2 Fixture status must be paused to 'disputed'
  const fixCheck = await query('SELECT match_status FROM match_fixtures WHERE fixture_id = $1', [fixId]);
  assert(fixCheck.rows[0].match_status === 'disputed', 'Match fixture status paused to "disputed"');

  // 5.3 Fetch dispute in disputes queue
  res = await request('GET', '/api/disputes');
  assert(res.status === 200 && Array.isArray(res.data.disputes), 'Disputes listing returned');
  const foundDispute = res.data.disputes.find(d => d.dispute_id === disputeId);
  assert(foundDispute && foundDispute.status === 'PENDING', 'Dispute logged in PENDING state');

  // 5.4 Resolve Dispute
  res = await request('PATCH', `/api/disputes/${disputeId}/resolve`, {
    adminId: 'usr_admin_carromx',
    resolutionNotes: 'Referee footage verified. Penalty coin removed. Match resumed.',
    status: 'RESOLVED',
    matchStatus: 'live'
  }, adminToken);
  assert(res.status === 200, 'Dispute resolved successfully by Admin (200 OK)');

  // 5.5 Verify dispute record is now RESOLVED and fixture resumed
  const resolvedCheck = await query('SELECT status, resolution_notes FROM match_disputes WHERE dispute_id = $1', [disputeId]);
  assert(resolvedCheck.rows[0].status === 'RESOLVED', 'Dispute status updated to RESOLVED');
  const fixResumed = await query('SELECT match_status FROM match_fixtures WHERE fixture_id = $1', [fixId]);
  assert(fixResumed.rows[0].match_status === 'live', 'Match fixture resumed to "live"');

  // ----------------------------------------------------
  // TEST GROUP 6: AICF Digital Score Sheet & Scoring Rules
  // ----------------------------------------------------
  console.log('\n--- 6. AICF Digital Score Sheet & Scoring Rules ---');

  // 6.1 Get empty score sheet
  res = await request('GET', `/api/fixtures/${fixId}/score-sheet`);
  assert(res.status === 200, 'Retrieved AICF digital score sheet structure');

  // 6.2 Player trying to log score sheet -> MUST BE FORBIDDEN
  const sheetPayload = {
    games: [
      {
        gameNumber: 1,
        boards: [
          { boardNo: 1, p1Queen: 3, p1Cm: 4, p2Queen: 0, p2Cm: 0 }
        ]
      }
    ]
  };
  res = await request('POST', `/api/fixtures/${fixId}/score-sheet`, { sheet: sheetPayload }, playerToken);
  assert(res.status === 403, 'Player cannot submit score sheet (403 Forbidden)');

  // 6.3 Organiser submits score sheet -> MUST SUCCEED
  res = await request('POST', `/api/fixtures/${fixId}/score-sheet`, { sheet: sheetPayload }, orgToken);
  assert(res.status === 200, 'Organiser logs Board 1 score (4 coins + Queen = 7 points for P1)');
  assert(res.data.sheet.games[0].boards[0].p1Total === 7, 'Cumulative point calculation matches AICF standards');

  // ----------------------------------------------------
  // TEST GROUP 7: Tournament Deletion (SUPER ADMIN ONLY)
  // ----------------------------------------------------
  console.log('\n--- 7. Tournament Deletion (Super Admin Only) ---');

  // 7.1 Player attempting to delete tournament -> FORBIDDEN
  res = await request('DELETE', `/api/tournaments/${tourId}`, null, playerToken);
  assert(res.status === 403, 'Player cannot delete tournament (403 Forbidden)');

  // 7.2 Organiser attempting to delete tournament -> FORBIDDEN
  res = await request('DELETE', `/api/tournaments/${tourId}`, null, orgToken);
  assert(res.status === 403, 'Organiser cannot delete tournament (403 Forbidden)');
  assert(res.data.error.includes('Only the Super Administrator'), 'Returns clear message: Only the Super Administrator has permission to delete tournaments');

  // 7.3 Super Admin deletes tournament -> SUCCESS
  res = await request('DELETE', `/api/tournaments/${tourId}`, null, adminToken);
  assert(res.status === 200, 'Super Admin deletes tournament successfully (200 OK)');

  // 7.4 Verify tournament and all associated boards & fixtures are deleted
  const checkTour = await query('SELECT * FROM tournaments WHERE tournament_id = $1', [tourId]);
  assert(checkTour.rows.length === 0, 'Tournament permanently removed from database');
  const checkBoards = await query('SELECT * FROM boards WHERE tournament_id = $1', [tourId]);
  assert(checkBoards.rows.length === 0, 'All tournament physical boards removed');
  const checkFix = await query('SELECT * FROM match_fixtures WHERE tournament_id = $1', [tourId]);
  assert(checkFix.rows.length === 0, 'All tournament match fixtures removed');

  // Clean up remaining test data
  console.log('\n--- Cleaning up temporary test artifacts ---');
  await query('DELETE FROM users WHERE user_id IN ($1, $2)', [orgId, playerId]);
  console.log('Cleanup finished.');

  await stopTestServer();

  console.log('\n======================================================');
  console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch(async (err) => {
  console.error('Test Suite encountered fatal error:', err);
  await stopTestServer();
  process.exit(1);
});
