import express from 'express';
import { query } from '../db.js';
import { authenticateToken, requireRoles, checkTournamentOwnership } from '../auth.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * Register participant for tournament using Payment Method 1
 * (External UPI/bank transfer with transaction reference ID upload + pending organizer approval)
 */
router.post('/tournaments/:id/register', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const userId = req.user.user_id;
    const { paymentReferenceId } = req.body || {};
    const paymentRef = (paymentReferenceId && typeof paymentReferenceId === 'string' && paymentReferenceId.trim()) ? paymentReferenceId.trim() : 'Direct GPay / Call';

    // Verify tournament exists and is open
    const tourRes = await query('SELECT * FROM tournaments WHERE tournament_id = $1', [tournamentId]);
    if (tourRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if user is already registered
    const existing = await query(
      'SELECT * FROM participants WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, userId]
    );

    if (existing.rows.length > 0) {
      const p = existing.rows[0];
      if (p.payment_status === 'approved') {
        return res.status(400).json({ error: 'You are already registered and approved for this tournament!' });
      }
      // If pending or rejected, allow updating payment reference
      await query(
        `UPDATE participants 
         SET payment_reference_id = $1, payment_status = 'pending', registered_at = datetime('now')
         WHERE participant_id = $2`,
        [paymentRef, p.participant_id]
      );

      return res.json({
        success: true,
        message: 'Application updated! Contact the organizer to confirm entry.',
        participantId: p.participant_id,
        paymentStatus: 'pending'
      });
    }

    const participantId = 'prt_' + crypto.randomUUID().slice(0, 10);

    await query(
      `INSERT INTO participants (
        participant_id, tournament_id, user_id, payment_reference_id,
        payment_status, seeding_rank, registered_at
      ) VALUES ($1, $2, $3, $4, 'pending', 0, datetime('now'))`,
      [participantId, tournamentId, userId, paymentRef]
    );

    res.status(201).json({
      success: true,
      message: 'Application submitted! Please contact the organizer to confirm via GPay / Cash.',
      participantId,
      paymentStatus: 'pending'
    });
  } catch (err) {
    console.error('Error registering participant:', err);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

/**
 * Organizer approves or rejects payment reference (Tournament Owner or Super Admin)
 */
router.put('/participants/:participantId/payment', authenticateToken, async (req, res) => {
  try {
    const { participantId } = req.params;
    const { paymentStatus } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected', 'pending'].includes(paymentStatus)) {
      return res.status(400).json({ error: "Invalid payment status. Must be 'approved', 'rejected', or 'pending'." });
    }

    const checkRes = await query('SELECT * FROM participants WHERE participant_id = $1', [participantId]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    const part = checkRes.rows[0];

    const perm = await checkTournamentOwnership(part.tournament_id, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only approve payments for tournaments you created, or as Super Admin.' });
    }

    await query(
      'UPDATE participants SET payment_status = $1 WHERE participant_id = $2',
      [paymentStatus, participantId]
    );

    res.json({
      success: true,
      message: `Participant payment status updated to ${paymentStatus}`,
      participantId,
      paymentStatus
    });
  } catch (err) {
    console.error('Error updating payment status:', err);
    res.status(500).json({ error: 'Failed to update payment status', details: err.message });
  }
});

/**
 * Organizer sets seeding rank for participant
 */
router.put('/participants/:participantId/seed', authenticateToken, async (req, res) => {
  try {
    const { participantId } = req.params;
    const { seedingRank } = req.body;

    const checkRes = await query('SELECT * FROM participants WHERE participant_id = $1', [participantId]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    const part = checkRes.rows[0];

    const perm = await checkTournamentOwnership(part.tournament_id, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only set seeding for tournaments you created, or as Super Admin.' });
    }

    const rank = parseInt(seedingRank, 10) || 0;

    await query('UPDATE participants SET seeding_rank = $1 WHERE participant_id = $2', [rank, participantId]);

    res.json({
      success: true,
      message: `Seeding rank set to ${rank}`,
      participantId,
      seedingRank: rank
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update seeding rank', details: err.message });
  }
});

/**
 * Direct Player Entry / Registration by Organiser or Super Admin
 */
router.post('/tournaments/:id/players/entry', authenticateToken, async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const { fullName, phoneNumber, email, seedingRank = 0, paymentStatus = 'approved', paymentReferenceId } = req.body;

    const perm = await checkTournamentOwnership(tournamentId, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only register players into tournaments you created, or as Super Admin.' });
    }

    if (!fullName || !phoneNumber) {
      return res.status(400).json({ error: 'Player full name and phone number are required.' });
    }

    const cleanPhone = phoneNumber.trim();

    // Check if tournament exists
    const tourRes = await query('SELECT * FROM tournaments WHERE tournament_id = $1', [tournamentId]);
    if (tourRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Find or create user
    let userRes = await query('SELECT * FROM users WHERE phone_number = $1', [cleanPhone]);
    let user;

    if (userRes.rows.length === 0) {
      const newUserId = 'usr_' + crypto.randomUUID().slice(0, 10);
      const userEmail = email && email.trim() ? email.trim() : `${newUserId}@carromx.local`;
      await query(
        `INSERT INTO users (user_id, full_name, phone_number, email, role, created_at)
         VALUES ($1, $2, $3, $4, 'player', datetime('now'))`,
        [newUserId, fullName.trim(), cleanPhone, userEmail]
      );
      userRes = await query('SELECT * FROM users WHERE user_id = $1', [newUserId]);
    } else {
      // Update name if changed
      if (fullName && fullName.trim() !== userRes.rows[0].full_name) {
        await query('UPDATE users SET full_name = $1 WHERE user_id = $2', [fullName.trim(), userRes.rows[0].user_id]);
      }
    }
    user = userRes.rows[0];

    // Check if user is already a participant
    const partRes = await query('SELECT * FROM participants WHERE tournament_id = $1 AND user_id = $2', [tournamentId, user.user_id]);
    
    let participantId;
    if (partRes.rows.length > 0) {
      participantId = partRes.rows[0].participant_id;
      await query(
        `UPDATE participants 
         SET seeding_rank = $1, payment_status = $2, payment_reference_id = $3
         WHERE participant_id = $4`,
        [parseInt(seedingRank, 10) || 0, paymentStatus, paymentReferenceId || 'MANUAL-ENTRY', participantId]
      );
    } else {
      participantId = 'prt_' + crypto.randomUUID().slice(0, 10);
      await query(
        `INSERT INTO participants (
          participant_id, tournament_id, user_id, payment_reference_id,
          payment_status, seeding_rank, registered_at
        ) VALUES ($1, $2, $3, $4, $5, $6, datetime('now'))`,
        [
          participantId,
          tournamentId,
          user.user_id,
          paymentReferenceId || 'ENTRY-' + Math.floor(100000 + Math.random() * 900000),
          paymentStatus,
          parseInt(seedingRank, 10) || 0
        ]
      );
    }

    const saved = await query(`
      SELECT p.*, u.full_name, u.phone_number, u.email 
      FROM participants p 
      LEFT JOIN users u ON p.user_id = u.user_id 
      WHERE p.participant_id = $1
    `, [participantId]);

    res.status(201).json({
      success: true,
      message: `Player '${fullName.trim()}' successfully entered into tournament!`,
      participant: saved.rows[0]
    });
  } catch (err) {
    console.error('Error entering player:', err);
    res.status(500).json({ error: 'Failed to complete player entry', details: err.message });
  }
});

/**
 * Remove participant from tournament
 */
router.delete('/tournaments/:tournamentId/participants/:participantId', authenticateToken, async (req, res) => {
  try {
    const { tournamentId, participantId } = req.params;

    const perm = await checkTournamentOwnership(tournamentId, req.user);
    if (!perm.authorized) {
      return res.status(403).json({ error: 'Forbidden: You can only remove participants from tournaments you created, or as Super Admin.' });
    }

    // Check if player has played matches
    const activeMatch = await query(
      `SELECT * FROM match_fixtures 
       WHERE tournament_id = $1 AND (player_1_id = $2 OR player_2_id = $2) AND match_status IN ('live', 'completed')`,
      [tournamentId, participantId]
    );

    if (activeMatch.rows.length > 0) {
      return res.status(400).json({ error: 'Cannot remove participant who has already played or is currently playing a match.' });
    }

    await query('DELETE FROM participants WHERE participant_id = $1 AND tournament_id = $2', [participantId, tournamentId]);
    res.json({ success: true, message: 'Participant removed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove participant', details: err.message });
  }
});

export default router;
