import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireRoles, checkTournamentOwnership } from '../auth.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * List tournaments
 */
router.get('/', async (req, res) => {
  try {
    const { status, organizerId } = req.query;
    let sql = `
      SELECT 
        t.*,
        u.full_name as organizer_name,
        u.phone_number as organizer_phone,
        (SELECT COUNT(*) FROM participants p WHERE p.tournament_id = t.tournament_id) as participant_count,
        (SELECT COUNT(*) FROM participants p WHERE p.tournament_id = t.tournament_id AND p.payment_status = 'approved') as approved_participant_count
      FROM tournaments t
      JOIN users u ON t.organizer_id = u.user_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      sql += ` AND t.status = $${params.length}`;
    }
    if (organizerId) {
      params.push(organizerId);
      sql += ` AND t.organizer_id = $${params.length}`;
    }

    sql += ' ORDER BY t.created_at DESC';

    const { rows } = await query(sql, params);
    res.json({ tournaments: rows });
  } catch (err) {
    console.error('Error fetching tournaments:', err);
    res.status(500).json({ error: 'Failed to fetch tournaments', details: err.message });
  }
});

/**
 * Get single tournament details with boards and participants
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tourRes = await query(`
      SELECT 
        t.*,
        u.full_name as organizer_name,
        u.phone_number as organizer_phone,
        u.email as organizer_email
      FROM tournaments t
      JOIN users u ON t.organizer_id = u.user_id
      WHERE t.tournament_id = $1
    `, [id]);

    if (tourRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tourRes.rows[0];

    // Fetch boards
    const boardsRes = await query(
      'SELECT * FROM boards WHERE tournament_id = $1 ORDER BY board_number ASC',
      [id]
    );

    // Fetch participants
    const participantsRes = await query(`
      SELECT 
        p.*,
        u.full_name,
        u.phone_number,
        u.email
      FROM participants p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.tournament_id = $1
      ORDER BY p.seeding_rank ASC, p.registered_at ASC
    `, [id]);

    // Fetch fixtures summary
    const fixturesRes = await query(`
      SELECT 
        f.*,
        b.board_number,
        u1.full_name as player_1_name,
        u2.full_name as player_2_name,
        w.full_name as winner_name
      FROM match_fixtures f
      LEFT JOIN boards b ON f.board_id = b.board_id
      LEFT JOIN participants p1 ON f.player_1_id = p1.participant_id
      LEFT JOIN users u1 ON p1.user_id = u1.user_id
      LEFT JOIN participants p2 ON f.player_2_id = p2.participant_id
      LEFT JOIN users u2 ON p2.user_id = u2.user_id
      LEFT JOIN participants pw ON f.winner_participant_id = pw.participant_id
      LEFT JOIN users w ON pw.user_id = w.user_id
      WHERE f.tournament_id = $1
      ORDER BY f.round_number ASC, f.scheduled_start_time ASC
    `, [id]);

    res.json({
      tournament,
      boards: boardsRes.rows,
      participants: participantsRes.rows,
      fixtures: fixturesRes.rows
    });
  } catch (err) {
    console.error('Error fetching tournament details:', err);
    res.status(500).json({ error: 'Failed to fetch tournament', details: err.message });
  }
});

/**
 * Create a new tournament
 * Handled by Organizer role
 * Enforces verified_by_helpdesk = false default and creates boards
 */
router.post('/', authenticateToken, requireRoles('organizer', 'help_desk'), async (req, res) => {
  try {
    const {
      title,
      venue_address,
      format,
      total_boards,
      max_points_per_set,
      boards_per_set,
      total_sets,
      entry_fee,
      upi_id,
      rules_summary,
      banner_url
    } = req.body;

    if (!title || !venue_address || !format) {
      return res.status(400).json({ error: 'Title, venue address, and format are required.' });
    }

    const validFormats = ['knockout', 'round_robin', 'double_elimination'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({ error: `Format must be one of: ${validFormats.join(', ')}` });
    }

    const numBoards = parseInt(total_boards, 10) || 4;
    const maxPoints = parseInt(max_points_per_set, 10) || 25;
    const boardsPerSet = parseInt(boards_per_set, 10) || 8;
    const sets = parseInt(total_sets, 10) || 3;
    const setTimeLimit = parseInt(req.body.set_time_limit_minutes, 10) || 25;
    const matchDuration = parseInt(req.body.match_duration_minutes, 10) || 45;
    const fee = parseFloat(entry_fee) || 0.00;
    const organizerId = req.user.user_id;

    const tournamentId = 'trn_' + crypto.randomUUID().slice(0, 10);

    // Insert tournament with verified_by_helpdesk = 0 (false) and status = 'pending_verification'
    await query(
      `INSERT INTO tournaments (
        tournament_id, organizer_id, title, venue_address, format,
        total_boards, max_points_per_set, boards_per_set, total_sets,
        set_time_limit_minutes, match_duration_minutes, entry_fee,
        status, verified_by_helpdesk, upi_id, rules_summary, banner_url, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending_verification', 0, $13, $14, $15, datetime('now'))`,
      [
        tournamentId,
        organizerId,
        title,
        venue_address,
        format,
        numBoards,
        maxPoints,
        boardsPerSet,
        sets,
        setTimeLimit,
        matchDuration,
        fee,
        upi_id || 'organizer@upi',
        rules_summary || 'Standard ICF Carrom Tournament Rules apply.',
        banner_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80'
      ]
    );

    // Automatically create boards (Board 1 to Board N)
    for (let i = 1; i <= numBoards; i++) {
      const boardId = `brd_${tournamentId}_${i}`;
      await query(
        `INSERT INTO boards (board_id, tournament_id, board_number, is_active)
         VALUES ($1, $2, $3, 1)`,
        [boardId, tournamentId, i]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Tournament created successfully. Submitted for Help Desk verification.',
      tournamentId,
      publicUrl: `/tournament/${tournamentId}`
    });
  } catch (err) {
    console.error('Error creating tournament:', err);
    res.status(500).json({ error: 'Failed to create tournament', details: err.message });
  }
});

/**
 * Help Desk Admin: Verify / Approve Tournament
 */
router.post('/:id/verify', authenticateToken, requireRoles('help_desk'), async (req, res) => {
  try {
    const { id } = req.params;
    const { approved = true, notes } = req.body;

    const tourCheck = await query('SELECT * FROM tournaments WHERE tournament_id = $1', [id]);
    if (tourCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const newStatus = approved ? 'published' : 'pending_verification';
    const isVerified = approved ? 1 : 0;

    await query(
      `UPDATE tournaments 
       SET verified_by_helpdesk = $1, status = $2 
       WHERE tournament_id = $3`,
      [isVerified, newStatus, id]
    );

    res.json({
      success: true,
      message: approved ? 'Tournament verified and published by Help Desk' : 'Verification revoked',
      verified_by_helpdesk: Boolean(isVerified),
      status: newStatus
    });
  } catch (err) {
    console.error('Error verifying tournament:', err);
    res.status(500).json({ error: 'Verification failed', details: err.message });
  }
});

/**
 * Organizer updates tournament status (e.g. to ongoing or completed)
 * Only the owner of the tournament or Super Admin can update
 */
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const perm = await checkTournamentOwnership(id, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only update tournaments you created, or as Super Admin.' });
    }

    const validStatuses = ['pending_verification', 'published', 'ongoing', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    await query('UPDATE tournaments SET status = $1 WHERE tournament_id = $2', [status, id]);
    res.json({ success: true, message: `Tournament status updated to ${status}`, status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tournament status', details: err.message });
  }
});

/**
 * Organizer updates tournament timing rules (Set timing & Match duration)
 */
router.put('/:id/timing', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const perm = await checkTournamentOwnership(id, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only update tournaments you created, or as Super Admin.' });
    }

    const { set_time_limit_minutes, match_duration_minutes, max_points_per_set, boards_per_set, total_sets } = req.body;

    const setTimeLimit = set_time_limit_minutes !== undefined ? (parseInt(set_time_limit_minutes, 10) || 25) : 25;
    const matchDuration = match_duration_minutes !== undefined ? (parseInt(match_duration_minutes, 10) || 45) : 45;
    const maxPoints = max_points_per_set !== undefined ? (parseInt(max_points_per_set, 10) || 25) : 25;
    const boardsPerSet = boards_per_set !== undefined ? (parseInt(boards_per_set, 10) || 8) : 8;
    const sets = total_sets !== undefined ? (parseInt(total_sets, 10) || 3) : 3;

    await query(
      `UPDATE tournaments 
       SET set_time_limit_minutes = $1, match_duration_minutes = $2, max_points_per_set = $3, boards_per_set = $4, total_sets = $5
       WHERE tournament_id = $6`,
      [setTimeLimit, matchDuration, maxPoints, boardsPerSet, sets, id]
    );

    res.json({
      success: true,
      message: 'Tournament timing & match rules updated successfully.',
      timing: {
        set_time_limit_minutes: setTimeLimit,
        match_duration_minutes: matchDuration,
        max_points_per_set: maxPoints,
        boards_per_set: boardsPerSet,
        total_sets: sets
      }
    });
  } catch (err) {
    console.error('Error updating tournament timing:', err);
    res.status(500).json({ error: 'Failed to update tournament timing', details: err.message });
  }
});

/**
 * Delete a tournament (Owner or Super Admin only)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const perm = await checkTournamentOwnership(id, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only delete tournaments you created, or as Super Admin.' });
    }

    await query('DELETE FROM tournaments WHERE tournament_id = $1', [id]);
    res.json({ success: true, message: 'Tournament deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete tournament', details: err.message });
  }
});

/**
 * Live Tournament Standings & Points Table
 */
router.get('/:id/standings', async (req, res) => {
  try {
    const { id } = req.params;

    // Get approved participants
    const partsRes = await query(`
      SELECT p.participant_id, p.seeding_rank, u.user_id, u.full_name, u.phone_number
      FROM participants p
      JOIN users u ON p.user_id = u.user_id
      WHERE p.tournament_id = $1 AND p.payment_status = 'approved'
      ORDER BY p.seeding_rank ASC
    `, [id]);

    const participants = partsRes.rows;

    // Get all completed fixtures
    const fixRes = await query(`
      SELECT f.* 
      FROM match_fixtures f 
      WHERE f.tournament_id = $1
    `, [id]);
    const fixtures = fixRes.rows;

    // Get all match scores
    const scoresRes = await query(`
      SELECT s.*, f.player_1_id, f.player_2_id 
      FROM match_scores s
      JOIN match_fixtures f ON s.fixture_id = f.fixture_id
      WHERE f.tournament_id = $1
    `, [id]);
    const scores = scoresRes.rows;

    const standings = participants.map(p => {
      let played = 0;
      let won = 0;
      let lost = 0;
      let setsWon = 0;
      let setsLost = 0;
      let ptsScored = 0;
      let ptsConceded = 0;
      const form = [];

      // Check fixtures
      for (const f of fixtures) {
        if (f.player_1_id === p.participant_id || f.player_2_id === p.participant_id) {
          if (f.match_status === 'completed') {
            played++;
            if (f.winner_participant_id === p.participant_id) {
              won++;
              form.push('W');
            } else {
              lost++;
              form.push('L');
            }
          }
        }
      }

      // Check scores
      for (const s of scores) {
        const isP1 = s.player_1_id === p.participant_id;
        const isP2 = s.player_2_id === p.participant_id;
        if (isP1) {
          ptsScored += s.player_1_points || 0;
          ptsConceded += s.player_2_points || 0;
          if (s.is_set_completed) {
            if (s.set_winner_id === p.participant_id) setsWon++;
            else setsLost++;
          }
        } else if (isP2) {
          ptsScored += s.player_2_points || 0;
          ptsConceded += s.player_1_points || 0;
          if (s.is_set_completed) {
            if (s.set_winner_id === p.participant_id) setsWon++;
            else setsLost++;
          }
        }
      }

      const diff = ptsScored - ptsConceded;
      const tablePoints = won * 2;

      return {
        participantId: p.participant_id,
        fullName: p.full_name,
        seedRank: p.seeding_rank,
        played,
        won,
        lost,
        setsWon,
        setsLost,
        ptsScored,
        ptsConceded,
        pointsDiff: diff,
        tablePoints,
        form: form.slice(-3).reverse()
      };
    });

    // Sort by tablePoints DESC, pointsDiff DESC, setsWon DESC
    standings.sort((a, b) => {
      if (b.tablePoints !== a.tablePoints) return b.tablePoints - a.tablePoints;
      if (b.pointsDiff !== a.pointsDiff) return b.pointsDiff - a.pointsDiff;
      return b.setsWon - a.setsWon;
    });

    res.json({ standings });
  } catch (err) {
    console.error('Error calculating standings:', err);
    res.status(500).json({ error: 'Failed to calculate standings', details: err.message });
  }
});

export default router;

