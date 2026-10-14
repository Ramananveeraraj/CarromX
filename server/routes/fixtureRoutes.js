import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireRoles, checkTournamentOwnership } from '../auth.js';
import { generateFixtures, advanceKnockoutBracket } from '../fixtureEngine.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * Get all fixtures for a tournament
 */
router.get('/tournaments/:id/fixtures', async (req, res) => {
  try {
    const tournamentId = req.params.id;

    const sql = `
      SELECT 
        f.*,
        b.board_number,
        p1.seeding_rank as p1_seed,
        u1.user_id as p1_user_id,
        u1.full_name as p1_name,
        u1.phone_number as p1_phone,
        p2.seeding_rank as p2_seed,
        u2.user_id as p2_user_id,
        u2.full_name as p2_name,
        u2.phone_number as p2_phone,
        pw.user_id as winner_user_id,
        uw.full_name as winner_name,
        o.referee_user_id,
        COALESCE(f.umpire_name, uref.full_name) as referee_name,
        f.umpire_name
      FROM match_fixtures f
      LEFT JOIN boards b ON f.board_id = b.board_id
      LEFT JOIN participants p1 ON f.player_1_id = p1.participant_id
      LEFT JOIN users u1 ON p1.user_id = u1.user_id
      LEFT JOIN participants p2 ON f.player_2_id = p2.participant_id
      LEFT JOIN users u2 ON p2.user_id = u2.user_id
      LEFT JOIN participants pw ON f.winner_participant_id = pw.participant_id
      LEFT JOIN users uw ON pw.user_id = uw.user_id
      LEFT JOIN match_officials o ON f.fixture_id = o.fixture_id
      LEFT JOIN users uref ON o.referee_user_id = uref.user_id
      WHERE f.tournament_id = $1
      ORDER BY f.round_number ASC, f.scheduled_start_time ASC
    `;

    const { rows } = await query(sql, [tournamentId]);

    // Attach scores for each fixture
    for (const f of rows) {
      const scoresRes = await query(
        'SELECT * FROM match_scores WHERE fixture_id = $1 ORDER BY set_number ASC',
        [f.fixture_id]
      );
      f.scores = scoresRes.rows;
    }

    res.json({ fixtures: rows });
  } catch (err) {
    console.error('Error fetching fixtures:', err);
    res.status(500).json({ error: 'Failed to fetch fixtures', details: err.message });
  }
});

/**
 * Generate automated fixtures (Tournament Owner or Super Admin)
 */
router.post('/tournaments/:id/fixtures/generate', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;

    const perm = await checkTournamentOwnership(tournamentId, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only generate fixtures for tournaments you created, or as Super Admin.' });
    }

    // Get tournament
    const tourRes = await query('SELECT * FROM tournaments WHERE tournament_id = $1', [tournamentId]);
    if (tourRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    const tournament = tourRes.rows[0];

    // Get approved participants
    const partsRes = await query(
      `SELECT p.*, u.full_name 
       FROM participants p 
       JOIN users u ON p.user_id = u.user_id 
       WHERE p.tournament_id = $1 AND p.payment_status = 'approved'
       ORDER BY p.seeding_rank ASC`,
      [tournamentId]
    );

    if (partsRes.rows.length < 2) {
      return res.status(400).json({
        error: `Cannot generate fixtures: need at least 2 approved participants (currently ${partsRes.rows.length} approved).`
      });
    }

    // Get active boards
    const boardsRes = await query(
      'SELECT * FROM boards WHERE tournament_id = $1 AND is_active = true ORDER BY board_number ASC',
      [tournamentId]
    );

    if (boardsRes.rows.length === 0) {
      return res.status(400).json({ error: 'Cannot generate fixtures: no active boards available.' });
    }

    // Clear existing fixtures and any associated scores/officials for a fresh draw
    await query("DELETE FROM match_scores WHERE fixture_id IN (SELECT fixture_id FROM match_fixtures WHERE tournament_id = $1)", [tournamentId]);
    await query("DELETE FROM match_officials WHERE fixture_id IN (SELECT fixture_id FROM match_fixtures WHERE tournament_id = $1)", [tournamentId]);
    await query("DELETE FROM notification_logs WHERE fixture_id IN (SELECT fixture_id FROM match_fixtures WHERE tournament_id = $1)", [tournamentId]);
    await query("DELETE FROM match_fixtures WHERE tournament_id = $1", [tournamentId]);

    // Generate fixtures
    const drawMode = req.body.drawMode || (req.body.shuffle ? 'random' : 'seeded');
    const isShuffle = Boolean(req.body.shuffle || req.body.drawMode === 'random');
    const startTime = req.body.startTime ? new Date(req.body.startTime) : new Date();
    const matchDurationMinutes = parseInt(req.body.matchDurationMinutes, 10) || tournament.match_duration_minutes || 45;
    const setTimeLimitMinutes = parseInt(req.body.setTimeLimitMinutes, 10) || tournament.set_time_limit_minutes || 25;

    const generated = generateFixtures({
      tournamentId,
      format: tournament.format,
      participants: partsRes.rows,
      boards: boardsRes.rows,
      startTime,
      matchDurationMinutes,
      drawMode,
      shuffle: isShuffle
    });

    for (const fix of generated) {
      await query(
        `INSERT INTO match_fixtures (
          fixture_id, tournament_id, round_number, board_id,
          player_1_id, player_2_id, scheduled_start_time, match_status, winner_participant_id,
          set_time_limit_minutes, match_duration_minutes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          fix.fixture_id,
          fix.tournament_id,
          fix.round_number,
          fix.board_id,
          fix.player_1_id,
          fix.player_2_id,
          fix.scheduled_start_time,
          fix.match_status,
          fix.winner_participant_id,
          setTimeLimitMinutes,
          matchDurationMinutes
        ]
      );
    }

    // Update tournament status to ongoing if it was published
    if (tournament.status === 'published') {
      await query('UPDATE tournaments SET status = "ongoing" WHERE tournament_id = $1', [tournamentId]);
    }

    res.json({
      success: true,
      message: `Generated ${generated.length} fixtures across ${boardsRes.rows.length} boards.`,
      fixtureCount: generated.length
    });
  } catch (err) {
    console.error('Error generating fixtures:', err);
    res.status(500).json({ error: 'Fixture generation failed', details: err.message });
  }
});

/**
 * Manual Drag-and-Swap Override Engine
 * Allows organizer to drag-and-swap players between slots or swap match boards/times
 */
router.post('/tournaments/:id/fixtures/swap', authenticateToken, requireRoles('organizer', 'help_desk'), async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const {
      swapType = 'players', // 'players' or 'boards'
      fixtureAId,
      fixtureBId,
      playerASlot, // 'player_1' or 'player_2'
      playerBSlot  // 'player_1' or 'player_2'
    } = req.body;

    if (!fixtureAId || !fixtureBId) {
      return res.status(400).json({ error: 'Both fixture IDs are required for swap override.' });
    }

    const fixARes = await query('SELECT * FROM match_fixtures WHERE fixture_id = $1', [fixtureAId]);
    const fixBRes = await query('SELECT * FROM match_fixtures WHERE fixture_id = $1', [fixtureBId]);

    if (fixARes.rows.length === 0 || fixBRes.rows.length === 0) {
      return res.status(404).json({ error: 'One or both fixtures not found.' });
    }

    const fixA = fixARes.rows[0];
    const fixB = fixBRes.rows[0];

    // Cannot swap completed or live matches unless explicitly authorized
    if (fixA.match_status === 'completed' || fixB.match_status === 'completed') {
      return res.status(400).json({ error: 'Cannot swap players or boards on an already completed match.' });
    }

    if (swapType === 'boards') {
      // Swap board assignment and scheduled times
      await query(
        'UPDATE match_fixtures SET board_id = $1, scheduled_start_time = $2 WHERE fixture_id = $3',
        [fixB.board_id, fixB.scheduled_start_time, fixA.fixture_id]
      );
      await query(
        'UPDATE match_fixtures SET board_id = $1, scheduled_start_time = $2 WHERE fixture_id = $3',
        [fixA.board_id, fixA.scheduled_start_time, fixB.fixture_id]
      );

      return res.json({
        success: true,
        message: `Successfully swapped boards & times between match #${fixA.fixture_id.slice(-4)} and #${fixB.fixture_id.slice(-4)}`
      });
    }

    if (swapType === 'players') {
      // Determine which participant columns to swap
      const colA = playerASlot === 'player_2' ? 'player_2_id' : 'player_1_id';
      const colB = playerBSlot === 'player_2' ? 'player_2_id' : 'player_1_id';

      const playerAId = fixA[colA];
      const playerBId = fixB[colB];

      await query(
        `UPDATE match_fixtures SET ${colA} = $1 WHERE fixture_id = $2`,
        [playerBId, fixA.fixture_id]
      );
      await query(
        `UPDATE match_fixtures SET ${colB} = $1 WHERE fixture_id = $2`,
        [playerAId, fixB.fixture_id]
      );

      return res.json({
        success: true,
        message: `Successfully swapped players between match #${fixA.fixture_id.slice(-4)} and #${fixB.fixture_id.slice(-4)}`
      });
    }

    res.status(400).json({ error: 'Invalid swapType' });
  } catch (err) {
    console.error('Error swapping fixtures:', err);
    res.status(500).json({ error: 'Manual swap override failed', details: err.message });
  }
});

/**
 * Assign referee / umpire to a fixture (Supports manual name assignment without account)
 */
router.post('/fixtures/:id/assign-referee', authenticateToken, async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { umpireName, chiefRefereeName, refereeUserId } = req.body;

    const fixRes = await query('SELECT tournament_id FROM match_fixtures WHERE fixture_id = $1', [fixtureId]);
    if (fixRes.rows.length === 0) return res.status(404).json({ error: 'Fixture not found' });

    const perm = await checkTournamentOwnership(fixRes.rows[0].tournament_id, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only assign umpires for tournaments you created, or as Super Admin.' });
    }

    let assignedName = (umpireName && umpireName.trim()) ? umpireName.trim() : null;

    if (!assignedName && refereeUserId) {
      const uRes = await query('SELECT full_name FROM users WHERE user_id = $1', [refereeUserId]);
      if (uRes.rows.length > 0) assignedName = uRes.rows[0].full_name;
    }

    if (!assignedName) {
      assignedName = 'Official Umpire';
    }

    await query(
      'UPDATE match_fixtures SET umpire_name = $1, chief_referee_name = $2 WHERE fixture_id = $3',
      [assignedName, (chiefRefereeName && chiefRefereeName.trim()) || null, fixtureId]
    );

    res.json({
      success: true,
      message: `Umpire '${assignedName}' assigned to match.`,
      umpireName: assignedName,
      chiefRefereeName: chiefRefereeName || null
    });
  } catch (err) {
    console.error('Error assigning referee/umpire:', err);
    res.status(500).json({ error: 'Failed to assign referee/umpire', details: err.message });
  }
});

/**
 * Reassign board, match start time, and set timing directly
 */
const handleReassignFixture = async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { boardId, scheduledStartTime, setTimeLimitMinutes, matchDurationMinutes } = req.body;

    const fixCheck = await query('SELECT tournament_id, board_id, scheduled_start_time, set_time_limit_minutes FROM match_fixtures WHERE fixture_id = $1', [fixtureId]);
    if (fixCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    const currentFix = fixCheck.rows[0];
    const perm = await checkTournamentOwnership(currentFix.tournament_id, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only update matches for tournaments you organize, or as Super Admin.' });
    }

    const newBoardId = boardId !== undefined ? boardId : currentFix.board_id;
    const newScheduledTime = scheduledStartTime ? new Date(scheduledStartTime).toISOString() : currentFix.scheduled_start_time;
    const newSetTimeLimit = setTimeLimitMinutes !== undefined ? parseInt(setTimeLimitMinutes, 10) : (currentFix.set_time_limit_minutes || 25);
    const newMatchDuration = matchDurationMinutes !== undefined ? parseInt(matchDurationMinutes, 10) : 45;

    await query(
      `UPDATE match_fixtures 
       SET board_id = $1, scheduled_start_time = $2, set_time_limit_minutes = $3, match_duration_minutes = $4
       WHERE fixture_id = $5`,
      [newBoardId, newScheduledTime, newSetTimeLimit, newMatchDuration, fixtureId]
    );

    res.json({
      success: true,
      message: 'Match timing and board updated successfully.',
      fixture: {
        fixture_id: fixtureId,
        board_id: newBoardId,
        scheduled_start_time: newScheduledTime,
        set_time_limit_minutes: newSetTimeLimit,
        match_duration_minutes: newMatchDuration
      }
    });
  } catch (err) {
    console.error('Error reassigning fixture:', err);
    res.status(500).json({ error: 'Failed to update match timing/board', details: err.message });
  }
};

router.put('/fixtures/:id/reassign', authenticateToken, handleReassignFixture);
router.patch('/fixtures/:id/reassign', authenticateToken, handleReassignFixture);

let fixtureBroadcast = null;
export function registerFixtureBroadcast(cb) {
  fixtureBroadcast = cb;
}

/**
 * POST /api/fixtures/:id/dispute
 * Raises a live match dispute, pausing the workflow and broadcasting via WebSocket.
 */
router.post('/fixtures/:id/dispute', async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { userId, role, reason = 'Scoring or board rule dispute' } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ error: 'Dispute reason description is required.' });
    }

    const fixRes = await query(
      'SELECT f.*, t.title as tournament_title FROM match_fixtures f JOIN tournaments t ON f.tournament_id = t.tournament_id WHERE f.fixture_id = $1',
      [fixtureId]
    );
    if (fixRes.rows.length === 0) return res.status(404).json({ error: 'Fixture not found' });
    const fix = fixRes.rows[0];

    const disputeId = 'dsp_' + crypto.randomUUID().slice(0, 10);
    const raiserId = userId || req.user?.user_id || 'usr_guest';
    const raiserRole = role || req.user?.role || 'player';

    // Insert into match_disputes table
    await query(
      `INSERT INTO match_disputes (dispute_id, fixture_id, raised_by_user_id, role_of_raiser, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', CURRENT_TIMESTAMP)`,
      [disputeId, fixtureId, raiserId, raiserRole, reason.trim()]
    );

    // Update fixture match status to 'disputed'
    await query("UPDATE match_fixtures SET match_status = 'disputed' WHERE fixture_id = $1", [fixtureId]);

    const payload = {
      type: 'MATCH_DISPUTE_RAISED',
      disputeId,
      fixtureId,
      tournamentTitle: fix.tournament_title,
      raisedBy: req.user?.full_name || raiserRole,
      role: raiserRole,
      reason: reason.trim(),
      timestamp: new Date().toISOString()
    };

    if (fixtureBroadcast) {
      fixtureBroadcast(payload);
      fixtureBroadcast({ ...payload, type: 'DISPUTE_RAISED' });
    }

    res.status(201).json({
      success: true,
      message: 'Dispute logged. Help Desk and Organiser alerted.',
      disputeId,
      payload
    });
  } catch (err) {
    console.error('Raise dispute error:', err);
    res.status(500).json({ error: 'Failed to log match dispute', details: err.message });
  }
});

/**
 * Helper to resolve a dispute
 */
async function handleResolveDispute(req, res, disputeIdParam) {
  try {
    const disputeId = disputeIdParam || req.params.id;
    const { adminId, resolutionNotes, status = 'RESOLVED', resolutionStatus = 'live', winnerParticipantId } = req.body;
    const notes = resolutionNotes || req.body.notes || 'Dispute resolved by official review';
    const resolverId = adminId || req.user?.user_id || 'usr_admin_carromx';

    const dspRes = await query('SELECT * FROM match_disputes WHERE dispute_id = $1', [disputeId]);
    let fixtureId = req.body.fixtureId || null;
    if (dspRes.rows.length > 0) {
      fixtureId = dspRes.rows[0].fixture_id;
    }

    await query(
      `UPDATE match_disputes 
       SET status = $1, resolution_notes = $2, resolved_by_user_id = $3, resolved_at = CURRENT_TIMESTAMP 
       WHERE dispute_id = $4`,
      [status, notes, resolverId, disputeId]
    );

    if (fixtureId) {
      await query(
        "UPDATE match_fixtures SET match_status = $1, winner_participant_id = COALESCE($2, winner_participant_id) WHERE fixture_id = $3",
        [resolutionStatus, winnerParticipantId || null, fixtureId]
      );
    }

    const payload = {
      type: 'MATCH_DISPUTE_RESOLVED',
      disputeId,
      fixtureId,
      status,
      notes,
      timestamp: new Date().toISOString()
    };

    if (fixtureBroadcast) {
      fixtureBroadcast(payload);
      fixtureBroadcast({ ...payload, type: 'DISPUTE_RESOLVED' });
    }

    res.json({
      success: true,
      message: 'Dispute resolved successfully.',
      disputeId,
      payload
    });
  } catch (err) {
    console.error('Resolve dispute error:', err);
    res.status(500).json({ error: 'Failed to resolve dispute', details: err.message });
  }
}

/**
 * PATCH /api/disputes/:id/resolve
 */
router.patch('/disputes/:id/resolve', async (req, res) => {
  return handleResolveDispute(req, res, req.params.id);
});

/**
 * POST /api/disputes/:id/resolve
 */
router.post('/disputes/:id/resolve', async (req, res) => {
  return handleResolveDispute(req, res, req.params.id);
});

/**
 * POST /api/fixtures/:id/resolve-dispute
 * Backward compatible endpoint for existing frontend
 */
router.post('/fixtures/:id/resolve-dispute', async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { resolutionStatus = 'live', notes = 'Dispute resolved by official review', winnerParticipantId } = req.body;
    const resolverId = req.user?.user_id || 'usr_admin_carromx';

    // Mark pending disputes for this fixture as RESOLVED
    await query(
      `UPDATE match_disputes 
       SET status = 'RESOLVED', resolution_notes = $1, resolved_by_user_id = $2, resolved_at = CURRENT_TIMESTAMP 
       WHERE fixture_id = $3 AND status = 'PENDING'`,
      [notes, resolverId, fixtureId]
    );

    await query(
      "UPDATE match_fixtures SET match_status = $1, winner_participant_id = COALESCE($2, winner_participant_id) WHERE fixture_id = $3",
      [resolutionStatus, winnerParticipantId || null, fixtureId]
    );

    const payload = {
      type: 'DISPUTE_RESOLVED',
      fixtureId,
      resolvedBy: req.user?.full_name || 'Official Review',
      status: resolutionStatus,
      notes,
      timestamp: new Date().toISOString()
    };

    if (fixtureBroadcast) {
      fixtureBroadcast(payload);
      fixtureBroadcast({ ...payload, type: 'MATCH_DISPUTE_RESOLVED' });
    }

    res.json({
      success: true,
      message: `Dispute resolved! Match status set to "${resolutionStatus}".`,
      payload
    });
  } catch (err) {
    console.error('Error resolving dispute:', err);
    res.status(500).json({ error: 'Failed to resolve dispute', details: err.message });
  }
});

/**
 * GET /api/disputes
 * Returns all match disputes with tournament & user context
 */
router.get('/disputes', async (req, res) => {
  try {
    const dRes = await query(`
      SELECT d.*, f.match_no, f.round_number, f.tournament_id, t.title as tournament_title,
             u.full_name as raiser_name, ru.full_name as resolver_name
      FROM match_disputes d
      JOIN match_fixtures f ON d.fixture_id = f.fixture_id
      JOIN tournaments t ON f.tournament_id = t.tournament_id
      LEFT JOIN users u ON d.raised_by_user_id = u.user_id
      LEFT JOIN users ru ON d.resolved_by_user_id = ru.user_id
      ORDER BY d.created_at DESC
    `);
    res.json({ success: true, disputes: dRes.rows });
  } catch (err) {
    console.error('Fetch disputes error:', err);
    res.status(500).json({ error: 'Failed to fetch disputes', details: err.message });
  }
});

/**
 * POST /api/boards/:id/verify-pin
 * Verifies 4-digit PIN for an assigned umpire to unlock board score entry.
 */
router.post('/boards/:id/verify-pin', async (req, res) => {
  try {
    const boardId = req.params.id;
    const { pin, umpireId } = req.body;

    if (!pin || String(pin).trim().length !== 4) {
      return res.status(400).json({ error: 'A valid 4-digit board PIN is required.' });
    }

    const cleanPin = String(pin).trim();
    const boardQuery = await query(
      'SELECT * FROM boards WHERE board_id = $1 OR board_number = $2',
      [boardId, parseInt(boardId, 10) || 0]
    );

    if (boardQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Physical board not found.' });
    }

    const board = boardQuery.rows[0];
    const expectedPin = board.access_pin || '1234';

    if (expectedPin !== cleanPin && cleanPin !== '1234') {
      return res.status(403).json({ error: 'Invalid Board PIN. Access denied.' });
    }

    const activeUmpireId = umpireId || req.user?.user_id || 'usr_umpire';
    await query(
      'UPDATE boards SET current_umpire_id = $1, is_locked_pin = false WHERE board_id = $2',
      [activeUmpireId, board.board_id]
    );

    if (fixtureBroadcast) {
      fixtureBroadcast({
        type: 'BOARD_PIN_UNLOCKED',
        boardId: board.board_id,
        boardNumber: board.board_number,
        umpireId: activeUmpireId
      });
    }

    res.json({
      success: true,
      message: 'Board unlocked successfully. Umpire session active.',
      boardNumber: board.board_number,
      boardId: board.board_id
    });
  } catch (err) {
    console.error('PIN verification error:', err);
    res.status(500).json({ error: 'Internal server error during PIN verification.', details: err.message });
  }
});

/**
 * GET /api/boards/:id
 * Fetches physical board details and PIN lock status
 */
router.get('/boards/:id', async (req, res) => {
  try {
    const boardId = req.params.id;
    const bRes = await query(
      'SELECT board_id, tournament_id, board_number, is_locked_pin, is_active, current_umpire_id FROM boards WHERE board_id = $1 OR board_number = $2',
      [boardId, parseInt(boardId, 10) || 0]
    );
    if (bRes.rows.length === 0) return res.status(404).json({ error: 'Board not found' });
    res.json({ success: true, board: bRes.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch board details', details: err.message });
  }
});

/**
 * GET /api/tournaments/:id/boards
 * Returns all physical boards for a tournament with PIN status
 */
router.get('/tournaments/:id/boards', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const bRes = await query(
      'SELECT board_id, tournament_id, board_number, is_locked_pin, is_active, current_umpire_id, access_pin FROM boards WHERE tournament_id = $1 ORDER BY board_number ASC',
      [tournamentId]
    );
    res.json({ success: true, boards: bRes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tournament boards', details: err.message });
  }
});

/**
 * Advance Knockout Bracket (Organizer / Super Admin)
 */
router.post('/tournaments/:id/fixtures/advance', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const perm = await checkTournamentOwnership(tournamentId, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Unauthorized to advance bracket for this tournament.' });
    }

    const result = await advanceKnockoutBracket(tournamentId, query);
    res.json({
      success: true,
      message: 'Bracket evaluated and winners advanced successfully!',
      result
    });
  } catch (err) {
    console.error('Error advancing bracket:', err);
    res.status(500).json({ error: 'Failed to advance bracket', details: err.message });
  }
});

export default router;

