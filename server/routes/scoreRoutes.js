import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireRoles, checkTournamentOwnership, normalizeRole } from '../auth.js';
import crypto from 'crypto';
import { advanceKnockoutBracket } from '../fixtureEngine.js';

const router = express.Router();

let broadcastCallback = null;
export function registerScoreBroadcast(cb) {
  broadcastCallback = cb;
}

/**
 * Helper: Check if requesting user is authorized to edit score for this fixture
 * - Super Admin: Universal override authority across all tournaments
 * - Organiser: Can only score matches for tournaments they created
 * - Player: Read-only, not authorized
 */
async function checkScoreEditPermission(fixtureId, user) {
  if (!user) return { authorized: false, isSuperAdmin: false, isOwner: false };
  const currentRole = normalizeRole(user.activeRole || user.role);
  if (currentRole === 'super_admin') {
    return { authorized: true, isSuperAdmin: true, isOwner: true };
  }

  // Find tournament owner
  const fixRes = await query('SELECT tournament_id FROM match_fixtures WHERE fixture_id = $1', [fixtureId]);
  if (fixRes.rows.length === 0) return { authorized: false, isSuperAdmin: false, isOwner: false };

  const tournamentId = fixRes.rows[0].tournament_id;
  const perm = await checkTournamentOwnership(tournamentId, user);
  return perm;
}

/**
 * Get full scoreboard data for a fixture
 */
router.get('/fixtures/:id/scoreboard', async (req, res) => {
  try {
    const fixtureId = req.params.id;

    // Fixture details
    const fixRes = await query(`
      SELECT 
        f.*,
        t.title as tournament_title,
        t.max_points_per_set,
        t.boards_per_set,
        t.total_sets,
        b.board_number,
        u1.user_id as p1_user_id,
        u1.full_name as p1_name,
        u1.phone_number as p1_phone,
        u2.user_id as p2_user_id,
        u2.full_name as p2_name,
        u2.phone_number as p2_phone,
        uref.user_id as referee_id,
        uref.full_name as referee_name
      FROM match_fixtures f
      JOIN tournaments t ON f.tournament_id = t.tournament_id
      LEFT JOIN boards b ON f.board_id = b.board_id
      LEFT JOIN participants p1 ON f.player_1_id = p1.participant_id
      LEFT JOIN users u1 ON p1.user_id = u1.user_id
      LEFT JOIN participants p2 ON f.player_2_id = p2.participant_id
      LEFT JOIN users u2 ON p2.user_id = u2.user_id
      LEFT JOIN match_officials o ON f.fixture_id = o.fixture_id
      LEFT JOIN users uref ON o.referee_user_id = uref.user_id
      WHERE f.fixture_id = $1
    `, [fixtureId]);

    if (fixRes.rows.length === 0) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    const fixture = fixRes.rows[0];

    // Get sets and scores
    const scoresRes = await query(
      'SELECT * FROM match_scores WHERE fixture_id = $1 ORDER BY set_number ASC',
      [fixtureId]
    );

    res.json({
      fixture,
      scores: scoresRes.rows
    });
  } catch (err) {
    console.error('Error getting scoreboard:', err);
    res.status(500).json({ error: 'Failed to load scoreboard', details: err.message });
  }
});

/**
 * Referee updates points for a set (Carrom points: white coin +1, black coin +1, queen +3, due/penalty -1)
 */
router.post('/fixtures/:id/score-event', authenticateToken, async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { setNumber = 1, player, pointDelta, carromAction } = req.body;
    // player: 'player_1' or 'player_2'
    // pointDelta: integer (e.g. +1, +3, -1)

    const permission = await checkScoreEditPermission(fixtureId, req.user);
    if (!permission.authorized) {
      return res.status(403).json({
        error: 'Forbidden: You can only edit scores for tournaments you created, or as Super Admin.'
      });
    }

    // Check fixture status
    const fixRes = await query(`
      SELECT f.*, t.max_points_per_set, t.total_sets 
      FROM match_fixtures f 
      JOIN tournaments t ON f.tournament_id = t.tournament_id 
      WHERE f.fixture_id = $1
    `, [fixtureId]);

    if (fixRes.rows.length === 0) {
      return res.status(404).json({ error: 'Fixture not found' });
    }
    const fixture = fixRes.rows[0];

    if (fixture.match_status === 'completed' && !permission.isSuperAdmin && !permission.isOwner) {
      return res.status(400).json({ error: 'This match is completed and locked.' });
    }

    // Get or create set score record
    let scoreRes = await query(
      'SELECT * FROM match_scores WHERE fixture_id = $1 AND set_number = $2',
      [fixtureId, setNumber]
    );

    let scoreRecord;
    if (scoreRes.rows.length === 0) {
      const scoreId = 'scr_' + crypto.randomUUID().slice(0, 10);
      await query(
        `INSERT INTO match_scores (
          score_id, fixture_id, set_number, player_1_points, player_2_points,
          is_set_completed, set_winner_id, logged_by_referee_id, updated_at
        ) VALUES ($1, $2, $3, 0, 0, 0, NULL, $4, CURRENT_TIMESTAMP)`,
        [scoreId, fixtureId, setNumber, req.user.user_id]
      );
      scoreRes = await query('SELECT * FROM match_scores WHERE score_id = $1', [scoreId]);
    }

    scoreRecord = scoreRes.rows[0];

    // Check Score Locking: If set is already completed/locked, reject non-organizer edits!
    if (Boolean(scoreRecord.is_set_completed) && !permission.isOrganizer) {
      return res.status(403).json({
        error: 'SCORE LOCKED: This set has been locked and completed. Only an Organizer can perform a score override.'
      });
    }

    // Calculate new points
    let p1Points = scoreRecord.player_1_points || 0;
    let p2Points = scoreRecord.player_2_points || 0;
    const delta = parseInt(pointDelta, 10) || 0;

    if (player === 'player_1') {
      p1Points = Math.max(0, p1Points + delta);
    } else if (player === 'player_2') {
      p2Points = Math.max(0, p2Points + delta);
    }

    // Respect max points per set cap if configured (e.g. 25 points)
    const maxPoints = fixture.max_points_per_set || 25;
    if (p1Points > maxPoints) p1Points = maxPoints;
    if (p2Points > maxPoints) p2Points = maxPoints;

    // Update score
    await query(
      `UPDATE match_scores 
       SET player_1_points = $1, player_2_points = $2, logged_by_referee_id = $3, updated_at = CURRENT_TIMESTAMP
       WHERE score_id = $4`,
      [p1Points, p2Points, req.user.user_id, scoreRecord.score_id]
    );

    // If fixture status was 'scheduled', update to 'live'
    if (fixture.match_status === 'scheduled') {
      await query("UPDATE match_fixtures SET match_status = 'live' WHERE fixture_id = $1", [fixtureId]);
    }

    const payload = {
      type: 'SCORE_UPDATE',
      fixtureId,
      setNumber,
      player_1_points: p1Points,
      player_2_points: p2Points,
      carromAction,
      loggedBy: req.user.full_name
    };

    if (broadcastCallback) {
      broadcastCallback(payload);
    }

    res.json({
      success: true,
      message: `Score updated: P1: ${p1Points} | P2: ${p2Points}`,
      setNumber,
      player_1_points: p1Points,
      player_2_points: p2Points
    });
  } catch (err) {
    console.error('Error logging score event:', err);
    res.status(500).json({ error: 'Failed to update score', details: err.message });
  }
});

/**
 * Lock set: Marks set completed and locks scores
 */
router.post('/fixtures/:id/lock-set', authenticateToken, async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { setNumber = 1 } = req.body;

    const permission = await checkScoreEditPermission(fixtureId, req.user);
    if (!permission.authorized) {
      return res.status(403).json({ error: 'Unauthorized to lock set: Only the tournament owner or Super Admin can lock scores.' });
    }

    const fixRes = await query('SELECT * FROM match_fixtures WHERE fixture_id = $1', [fixtureId]);
    if (fixRes.rows.length === 0) return res.status(404).json({ error: 'Fixture not found' });
    const fixture = fixRes.rows[0];

    const scoreRes = await query(
      'SELECT * FROM match_scores WHERE fixture_id = $1 AND set_number = $2',
      [fixtureId, setNumber]
    );
    if (scoreRes.rows.length === 0) return res.status(404).json({ error: 'Set score not found' });
    const score = scoreRes.rows[0];

    // Determine set winner
    let winnerId = null;
    if (score.player_1_points > score.player_2_points) {
      winnerId = fixture.player_1_id;
    } else if (score.player_2_points > score.player_1_points) {
      winnerId = fixture.player_2_id;
    }

    await query(
      `UPDATE match_scores 
       SET is_set_completed = true, set_winner_id = $1, logged_by_referee_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE score_id = $3`,
      [winnerId, req.user.user_id, score.score_id]
    );

    // Check if match is decided (e.g. Best of 3 sets)
    const allSetsRes = await query(
      'SELECT * FROM match_scores WHERE fixture_id = $1 AND is_set_completed = true',
      [fixtureId]
    );
    let p1SetsWon = 0;
    let p2SetsWon = 0;
    for (const s of allSetsRes.rows) {
      if (s.set_winner_id === fixture.player_1_id) p1SetsWon++;
      if (s.set_winner_id === fixture.player_2_id) p2SetsWon++;
    }

    // Default sets needed is 2 (for best of 3)
    let matchWinner = null;
    if (p1SetsWon >= 2) matchWinner = fixture.player_1_id;
    if (p2SetsWon >= 2) matchWinner = fixture.player_2_id;

    if (matchWinner) {
      await query(
        "UPDATE match_fixtures SET match_status = 'completed', winner_participant_id = $1 WHERE fixture_id = $2",
        [matchWinner, fixtureId]
      );
      // Auto-advance winners into next round (Quarters, Semis, Finals)
      try {
        await advanceKnockoutBracket(fixture.tournament_id, query);
      } catch (advErr) {
        console.warn('[KNOCKOUT-ADVANCE-NOTICE]', advErr.message);
      }
    }

    const lockPayload = {
      type: 'SET_LOCKED',
      fixtureId,
      setNumber,
      winnerId,
      matchCompleted: Boolean(matchWinner),
      winnerParticipantId: matchWinner
    };

    if (broadcastCallback) broadcastCallback(lockPayload);

    res.json({
      success: true,
      message: `Set ${setNumber} completed and score LOCKED.`,
      setNumber,
      winnerId,
      matchCompleted: Boolean(matchWinner),
      winnerParticipantId: matchWinner
    });
  } catch (err) {
    console.error('Error locking set:', err);
    res.status(500).json({ error: 'Failed to lock set', details: err.message });
  }
});

/**
 * Organizer / Super Admin Score Override
 */
router.post('/fixtures/:id/organizer-override', authenticateToken, async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { setNumber = 1, unlock = true, p1Points, p2Points, matchStatus } = req.body;

    const permission = await checkScoreEditPermission(fixtureId, req.user);
    if (!permission.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only override scores for your own tournaments or as Super Admin.' });
    }

    const updates = [];
    const params = [];

    if (unlock !== undefined) {
      params.push(unlock ? false : true);
      updates.push(`is_set_completed = $${params.length}`);
    }
    if (p1Points !== undefined) {
      params.push(parseInt(p1Points, 10));
      updates.push(`player_1_points = $${params.length}`);
    }
    if (p2Points !== undefined) {
      params.push(parseInt(p2Points, 10));
      updates.push(`player_2_points = $${params.length}`);
    }

    params.push(datetimeNow());
    updates.push(`updated_at = $${params.length}`);

    params.push(fixtureId);
    params.push(setNumber);

    await query(
      `UPDATE match_scores SET ${updates.join(', ')} WHERE fixture_id = $${params.length - 1} AND set_number = $${params.length}`,
      params
    );

    if (matchStatus) {
      await query('UPDATE match_fixtures SET match_status = $1 WHERE fixture_id = $2', [matchStatus, fixtureId]);
    }

    const overridePayload = {
      type: 'ORGANIZER_SCORE_OVERRIDE',
      fixtureId,
      setNumber,
      unlocked: unlock,
      byUser: req.user.full_name
    };

    if (broadcastCallback) broadcastCallback(overridePayload);

    res.json({
      success: true,
      message: `Score override applied: Set ${setNumber} ${unlock ? 'unlocked' : 'locked'}.`,
      fixtureId,
      setNumber
    });
  } catch (err) {
    console.error('Error in organizer override:', err);
    res.status(500).json({ error: 'Organizer override failed', details: err.message });
  }
});

/**
 * GET Official Carrom Score Sheet (Official Chennai / Tamil Nadu / AICF Format)
 */
router.get('/fixtures/:id/score-sheet', async (req, res) => {
  try {
    const fixtureId = req.params.id;

    // Fetch fixture and tournament metadata
    const fixRes = await query(`
      SELECT 
        f.*,
        t.title as tournament_title,
        t.organizer_id,
        t.format,
        t.max_points_per_set,
        t.boards_per_set,
        t.total_sets,
        b.board_number,
        p1.participant_id as p1_id,
        u1.full_name as p1_name,
        u1.phone_number as p1_phone,
        p2.participant_id as p2_id,
        u2.full_name as p2_name,
        u2.phone_number as p2_phone
      FROM match_fixtures f
      JOIN tournaments t ON f.tournament_id = t.tournament_id
      LEFT JOIN boards b ON f.board_id = b.board_id
      LEFT JOIN participants p1 ON f.player_1_id = p1.participant_id
      LEFT JOIN users u1 ON p1.user_id = u1.user_id
      LEFT JOIN participants p2 ON f.player_2_id = p2.participant_id
      LEFT JOIN users u2 ON p2.user_id = u2.user_id
      WHERE f.fixture_id = $1
    `, [fixtureId]);

    if (fixRes.rows.length === 0) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    const fixture = fixRes.rows[0];

    // Determine if requesting user can edit (organizer of this tournament or super_admin)
    let canEdit = false;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'carromx-super-secret-jwt-key-2026');
        const uRes = await query('SELECT user_id, role FROM users WHERE user_id = $1', [decoded.userId]);
        if (uRes.rows.length > 0) {
          const user = uRes.rows[0];
          const perm = await checkTournamentOwnership(fixture.tournament_id, user);
          canEdit = perm.authorized;
        }
      } catch (e) {}
    }

    // Check if score sheet already saved
    const sheetRes = await query('SELECT * FROM match_score_sheets WHERE fixture_id = $1', [fixtureId]);
    let sheetData = null;

    if (sheetRes.rows.length > 0) {
      const row = sheetRes.rows[0];
      try {
        sheetData = JSON.parse(row.sheet_json);
      } catch (e) {
        sheetData = null;
      }
      if (sheetData) {
        sheetData.matchNo = row.match_no || sheetData.matchNo;
        sheetData.pool = row.pool || sheetData.pool;
        sheetData.ageGroup = row.age_group || sheetData.ageGroup;
        sheetData.gameType = row.game_type || sheetData.gameType;
        sheetData.umpireName = row.umpire_name || sheetData.umpireName;
        sheetData.chiefRefereeName = row.chief_referee_name || sheetData.chiefRefereeName;
        sheetData.tossWonBy = row.toss_won_by || sheetData.tossWonBy;
        sheetData.tossChoice = row.toss_choice || sheetData.tossChoice;
      }
    }

    // If no sheet saved yet, generate default official structure
    if (!sheetData) {
      const createDefaultBoards = () => [
        { boardNo: 1, breakBy: 'player_1', p1Queen: 0, p1Cm: 0, p1Total: 0, p1Cum: 0, p2Queen: 0, p2Cm: 0, p2Total: 0, p2Cum: 0 },
        { boardNo: 2, breakBy: 'player_2', p1Queen: 0, p1Cm: 0, p1Total: 0, p1Cum: 0, p2Queen: 0, p2Cm: 0, p2Total: 0, p2Cum: 0 },
        { boardNo: 3, breakBy: 'player_1', p1Queen: 0, p1Cm: 0, p1Total: 0, p1Cum: 0, p2Queen: 0, p2Cm: 0, p2Total: 0, p2Cum: 0 },
        { boardNo: 4, breakBy: 'player_2', p1Queen: 0, p1Cm: 0, p1Total: 0, p1Cum: 0, p2Queen: 0, p2Cm: 0, p2Total: 0, p2Cum: 0 },
        { boardNo: 5, breakBy: 'player_1', p1Queen: 0, p1Cm: 0, p1Total: 0, p1Cum: 0, p2Queen: 0, p2Cm: 0, p2Total: 0, p2Cum: 0 },
        { boardNo: 6, breakBy: 'player_2', p1Queen: 0, p1Cm: 0, p1Total: 0, p1Cum: 0, p2Queen: 0, p2Cm: 0, p2Total: 0, p2Cum: 0 },
        { boardNo: 'Tie Break', breakBy: 'player_1', p1Queen: 0, p1Cm: 0, p1Total: 0, p1Cum: 0, p2Queen: 0, p2Cm: 0, p2Total: 0, p2Cum: 0 },
        { boardNo: 'S. Death', breakBy: 'player_2', p1Queen: 0, p1Cm: 0, p1Total: 0, p1Cum: 0, p2Queen: 0, p2Cm: 0, p2Total: 0, p2Cum: 0 }
      ];

      sheetData = {
        matchNo: fixture.match_no || `M-${fixture.fixture_id.slice(-4).toUpperCase()}`,
        pool: fixture.pool || 'Pool A',
        ageGroup: fixture.age_group || 'Men Singles',
        round: `Round ${fixture.round_number}`,
        gameType: fixture.game_type || 'Singles',
        umpireName: fixture.umpire_name || '',
        chiefRefereeName: fixture.chief_referee_name || '',
        boardNumber: fixture.board_number || 1,
        tossWonBy: fixture.toss_won_by || 'player_1',
        tossChoice: fixture.toss_choice || 'break',
        games: [
          { gameNo: 1, startTime: '', finishTime: '', p1State: 'Tamil Nadu', p2State: 'Karnataka', boards: createDefaultBoards(), wonBy: '', points: '' },
          { gameNo: 2, startTime: '', finishTime: '', p1State: 'Tamil Nadu', p2State: 'Karnataka', boards: createDefaultBoards(), wonBy: '', points: '' },
          { gameNo: 3, startTime: '', finishTime: '', p1State: 'Tamil Nadu', p2State: 'Karnataka', boards: createDefaultBoards(), wonBy: '', points: '' }
        ],
        result: {
          matchWonBy: '',
          winnerName: '',
          points1: '',
          points2: '',
          points3: '',
          winnerSignature: '',
          loserSignature: '',
          umpireSignature: '',
          chiefRefereeSignature: ''
        }
      };
    }

    res.json({
      fixture,
      sheet: sheetData,
      canEdit
    });
  } catch (err) {
    console.error('Error fetching score sheet:', err);
    res.status(500).json({ error: 'Failed to load official score sheet', details: err.message });
  }
});

/**
 * POST Save / Update Official Carrom Score Sheet
 */
router.post('/fixtures/:id/score-sheet', authenticateToken, async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const sheet = req.body.sheet || req.body.sheetData;
    const matchStatus = req.body.matchStatus || (req.body.isCompleted ? 'completed' : 'live');

    if (!sheet) {
      return res.status(400).json({ error: 'Score sheet payload is required' });
    }

    // Permission check: Organizer of this tournament or Super Admin only
    const permission = await checkScoreEditPermission(fixtureId, req.user);
    if (!permission.authorized) {
      return res.status(403).json({
        error: 'Forbidden: You do not have permission to edit the score sheet for this tournament.'
      });
    }

    const fixRes = await query('SELECT * FROM match_fixtures WHERE fixture_id = $1', [fixtureId]);
    if (fixRes.rows.length === 0) return res.status(404).json({ error: 'Fixture not found' });
    const fixture = fixRes.rows[0];

    // Auto-calculate cumulative points and set winners for each game
    let p1GamesWon = 0;
    let p2GamesWon = 0;

    if (sheet.games && Array.isArray(sheet.games)) {
      sheet.games.forEach((g) => {
        let p1Cum = 0;
        let p2Cum = 0;

        if (g.boards && Array.isArray(g.boards)) {
          g.boards.forEach(b => {
            const p1Q = parseInt(b.p1Queen, 10) || 0;
            const p1Cm = parseInt(b.p1Cm, 10) || 0;
            const p1Tot = p1Q + p1Cm;
            b.p1Total = p1Tot;
            p1Cum += p1Tot;
            b.p1Cum = p1Cum;

            const p2Q = parseInt(b.p2Queen, 10) || 0;
            const p2Cm = parseInt(b.p2Cm, 10) || 0;
            const p2Tot = p2Q + p2Cm;
            b.p2Total = p2Tot;
            p2Cum += p2Tot;
            b.p2Cum = p2Cum;
          });
        }

        // Determine Game Winner if points were logged
        if (p1Cum > 0 || p2Cum > 0) {
          if (p1Cum > p2Cum) {
            g.wonBy = 'player_1';
            g.points = `${p1Cum} - ${p2Cum}`;
            p1GamesWon++;
          } else if (p2Cum > p1Cum) {
            g.wonBy = 'player_2';
            g.points = `${p2Cum} - ${p1Cum}`;
            p2GamesWon++;
          }
        }
      });
    }

    // Determine Match Winner
    let matchWinnerParticipantId = null;
    const pointsSummary = (sheet.games || []).map(g => g.points || '0-0').filter(p => p !== '0-0').join(', ');

    if (p1GamesWon >= 2) {
      matchWinnerParticipantId = fixture.player_1_id;
      sheet.result = sheet.result || {};
      sheet.result.matchWonBy = 'player_1';
      sheet.result.winnerParticipantId = matchWinnerParticipantId;
    } else if (p2GamesWon >= 2) {
      matchWinnerParticipantId = fixture.player_2_id;
      sheet.result = sheet.result || {};
      sheet.result.matchWonBy = 'player_2';
      sheet.result.winnerParticipantId = matchWinnerParticipantId;
    }

    const finalStatus = (matchStatus === 'completed' || matchWinnerParticipantId) ? 'completed' : 'live';

    // Save into match_score_sheets
    const sheetJson = JSON.stringify(sheet);
    await query(`
      INSERT INTO match_score_sheets (
        fixture_id, match_no, pool, age_group, game_type,
        umpire_name, chief_referee_name, toss_won_by, toss_choice,
        sheet_json, winner_id, final_score_summary, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      ON CONFLICT(fixture_id) DO UPDATE SET
        match_no = excluded.match_no,
        pool = excluded.pool,
        age_group = excluded.age_group,
        game_type = excluded.game_type,
        umpire_name = excluded.umpire_name,
        chief_referee_name = excluded.chief_referee_name,
        toss_won_by = excluded.toss_won_by,
        toss_choice = excluded.toss_choice,
        sheet_json = excluded.sheet_json,
        winner_id = excluded.winner_id,
        final_score_summary = excluded.final_score_summary,
        updated_at = CURRENT_TIMESTAMP
    `, [
      fixtureId,
      sheet.matchNo || null,
      sheet.pool || null,
      sheet.ageGroup || null,
      sheet.gameType || 'Singles',
      sheet.umpireName || null,
      sheet.chiefRefereeName || null,
      sheet.tossWonBy || null,
      sheet.tossChoice || null,
      sheetJson,
      matchWinnerParticipantId,
      pointsSummary
    ]);

    // Update match_fixtures metadata & status
    await query(`
      UPDATE match_fixtures 
      SET 
        match_status = $1,
        winner_participant_id = $2,
        umpire_name = $3,
        chief_referee_name = $4,
        match_no = $5,
        pool = $6,
        age_group = $7,
        game_type = $8
      WHERE fixture_id = $9
    `, [
      finalStatus,
      matchWinnerParticipantId,
      sheet.umpireName || null,
      sheet.chiefRefereeName || null,
      sheet.matchNo || null,
      sheet.pool || null,
      sheet.ageGroup || null,
      sheet.gameType || 'Singles',
      fixtureId
    ]);

    // Sync match_scores for backward compatibility
    if (sheet.games && Array.isArray(sheet.games)) {
      for (const [idx, g] of sheet.games.entries()) {
        const setNum = idx + 1;
        const lastBoard = (g.boards || []).slice(-1)[0] || {};
        const p1Pts = lastBoard.p1Cum || 0;
        const p2Pts = lastBoard.p2Cum || 0;
        const isCompleted = Boolean(g.wonBy);
        const winnerId = g.wonBy === 'player_1' ? fixture.player_1_id : (g.wonBy === 'player_2' ? fixture.player_2_id : null);

        const scoreRes = await query('SELECT score_id FROM match_scores WHERE fixture_id = $1 AND set_number = $2', [fixtureId, setNum]);
        if (scoreRes.rows.length === 0) {
          const scoreId = 'scr_' + crypto.randomUUID().slice(0, 10);
          await query(`
            INSERT INTO match_scores (score_id, fixture_id, set_number, player_1_points, player_2_points, is_set_completed, set_winner_id, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
          `, [scoreId, fixtureId, setNum, p1Pts, p2Pts, isCompleted, winnerId]);
        } else {
          await query(`
            UPDATE match_scores 
            SET player_1_points = $1, player_2_points = $2, is_set_completed = $3, set_winner_id = $4, updated_at = CURRENT_TIMESTAMP
            WHERE fixture_id = $5 AND set_number = $6
          `, [p1Pts, p2Pts, isCompleted, winnerId, fixtureId, setNum]);
        }
      }
    }

    const broadcastData = {
      type: 'OFFICIAL_SCORE_SHEET_UPDATE',
      fixtureId,
      sheet,
      matchStatus: finalStatus,
      winnerParticipantId: matchWinnerParticipantId,
      updatedBy: req.user.full_name
    };

    if (broadcastCallback) {
      broadcastCallback(broadcastData);
    }

    // Auto-advance winners into the next tournament round (Quarters, Semis, Finals)
    if (finalStatus === 'completed' || matchWinnerParticipantId) {
      try {
        await advanceKnockoutBracket(fixture.tournament_id, query);
      } catch (advErr) {
        console.warn('[KNOCKOUT-ADVANCE-NOTICE]', advErr.message);
      }
    }

    res.json({
      success: true,
      message: 'Official Carrom Score Sheet saved successfully!',
      sheet,
      matchStatus: finalStatus,
      winnerParticipantId: matchWinnerParticipantId
    });
  } catch (err) {
    console.error('Error saving score sheet:', err);
    res.status(500).json({ error: 'Failed to save official score sheet', details: err.message });
  }
});

function datetimeNow() {
  return new Date().toISOString();
}

export default router;
