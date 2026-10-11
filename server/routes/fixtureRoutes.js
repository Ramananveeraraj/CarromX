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
      'SELECT * FROM boards WHERE tournament_id = $1 AND is_active = 1 ORDER BY board_number ASC',
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
 * Raise a match dispute (Player, Referee, or Organizer)
 */
router.post('/fixtures/:id/dispute', authenticateToken, async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { reason = 'Scoring or board rule dispute' } = req.body;

    const fixRes = await query('SELECT f.*, t.title as tournament_title FROM match_fixtures f JOIN tournaments t ON f.tournament_id = t.tournament_id WHERE f.fixture_id = $1', [fixtureId]);
    if (fixRes.rows.length === 0) return res.status(404).json({ error: 'Fixture not found' });
    const fix = fixRes.rows[0];

    await query("UPDATE match_fixtures SET match_status = 'disputed' WHERE fixture_id = $1", [fixtureId]);

    const payload = {
      type: 'DISPUTE_RAISED',
      fixtureId,
      tournamentTitle: fix.tournament_title,
      raisedBy: req.user.full_name,
      reason,
      timestamp: new Date().toISOString()
    };

    if (fixtureBroadcast) fixtureBroadcast(payload);

    res.json({
      success: true,
      message: 'Dispute submitted. Match status updated to "disputed". Help Desk notified.',
      payload
    });
  } catch (err) {
    console.error('Error raising dispute:', err);
    res.status(500).json({ error: 'Failed to raise dispute', details: err.message });
  }
});

/**
 * Resolve a match dispute (Help Desk Admin or Organizer)
 */
router.post('/fixtures/:id/resolve-dispute', authenticateToken, requireRoles('help_desk', 'organizer'), async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const { resolutionStatus = 'live', notes = 'Dispute resolved by official review', winnerParticipantId } = req.body;

    await query(
      "UPDATE match_fixtures SET match_status = $1, winner_participant_id = COALESCE($2, winner_participant_id) WHERE fixture_id = $3",
      [resolutionStatus, winnerParticipantId || null, fixtureId]
    );

    const payload = {
      type: 'DISPUTE_RESOLVED',
      fixtureId,
      resolvedBy: req.user.full_name,
      status: resolutionStatus,
      notes,
      timestamp: new Date().toISOString()
    };

    if (fixtureBroadcast) fixtureBroadcast(payload);

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

