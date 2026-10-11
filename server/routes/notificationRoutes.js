import express from 'express';
import { query } from '../db.js';
import { authenticateToken } from '../auth.js';
import { runPreMatchScan, getWorkerStatus } from '../worker.js';

const router = express.Router();

/**
 * Get current user's match notifications
 */
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { rows } = await query(`
      SELECT n.*, f.tournament_id, f.scheduled_start_time
      FROM notification_logs n
      JOIN match_fixtures f ON n.fixture_id = f.fixture_id
      WHERE n.user_id = $1
      ORDER BY n.dispatched_at DESC
      LIMIT 20
    `, [userId]);

    res.json({ notifications: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user notifications', details: err.message });
  }
});

/**
 * Get background worker status
 */
router.get('/worker-status', async (req, res) => {
  try {
    const status = getWorkerStatus();
    const countRes = await query('SELECT COUNT(*) as total FROM notification_logs');
    status.totalDbNotifications = countRes.rows[0]?.total || 0;
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get worker status', details: err.message });
  }
});

/**
 * Trigger manual pre-match scan on demand
 */
router.post('/trigger-worker', async (req, res) => {
  try {
    const scanResult = await runPreMatchScan();
    res.json({
      success: true,
      message: 'Pre-match 10-minute scan completed.',
      result: scanResult
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger scan', details: err.message });
  }
});

/**
 * Get recent system-wide alerts for dashboard monitoring
 */
router.get('/recent-alerts', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT 
        n.*,
        u.full_name as recipient_name,
        t.title as tournament_title,
        f.round_number
      FROM notification_logs n
      JOIN users u ON n.user_id = u.user_id
      JOIN match_fixtures f ON n.fixture_id = f.fixture_id
      JOIN tournaments t ON f.tournament_id = t.tournament_id
      ORDER BY n.dispatched_at DESC
      LIMIT 30
    `);

    res.json({ alerts: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recent alerts', details: err.message });
  }
});

export default router;
