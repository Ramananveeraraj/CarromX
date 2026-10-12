import { query } from './db.js';
import crypto from 'crypto';
import { sendPreMatchEmail } from './emailService.js';

let isRunning = false;
let workerInterval = null;
let lastScanTime = null;
let totalAlertsDispatched = 0;
let broadcastCallback = null;

export function registerBroadcastCallback(cb) {
  broadcastCallback = cb;
}

/**
 * Scan for matches scheduled to start within 10 minutes
 */
export async function runPreMatchScan() {
  if (isRunning) return { scanned: 0, dispatched: 0, status: 'already_running' };
  isRunning = true;
  lastScanTime = new Date().toISOString();

  let dispatchedCount = 0;

  try {
    const now = new Date();
    // 10-minute window from now
    const tenMinutesAhead = new Date(now.getTime() + 10 * 60 * 1000);
    // Allow a small grace window of past 2 minutes for matches just scheduled
    const twoMinutesPast = new Date(now.getTime() - 2 * 60 * 1000);

    // Query scheduled fixtures within the 10-minute window
    const sql = `
      SELECT 
        f.fixture_id,
        f.tournament_id,
        f.round_number,
        f.scheduled_start_time,
        f.match_status,
        b.board_number,
        t.title as tournament_title,
        p1.participant_id as p1_participant_id,
        u1.user_id as p1_user_id,
        u1.full_name as p1_name,
        u1.phone_number as p1_phone,
        u1.email as p1_email,
        p2.participant_id as p2_participant_id,
        u2.user_id as p2_user_id,
        u2.full_name as p2_name,
        u2.phone_number as p2_phone,
        u2.email as p2_email
      FROM match_fixtures f
      JOIN tournaments t ON f.tournament_id = t.tournament_id
      LEFT JOIN boards b ON f.board_id = b.board_id
      JOIN participants p1 ON f.player_1_id = p1.participant_id
      JOIN users u1 ON p1.user_id = u1.user_id
      JOIN participants p2 ON f.player_2_id = p2.participant_id
      JOIN users u2 ON p2.user_id = u2.user_id
      WHERE f.match_status = 'scheduled'
    `;

    const { rows } = await query(sql);

    for (const match of rows) {
      const matchTime = new Date(match.scheduled_start_time);
      
      // Check if matchTime is between now - 2 min and now + 10 min
      if (matchTime >= twoMinutesPast && matchTime <= tenMinutesAhead) {
        const boardNum = match.board_number || 'TBA';
        const formattedTime = matchTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Check if player 1 already received alert for this fixture
        const checkP1 = await query(
          'SELECT notification_id FROM notification_logs WHERE fixture_id = $1 AND user_id = $2',
          [match.fixture_id, match.p1_user_id]
        );

        if (checkP1.rows.length === 0) {
          const msgP1 = `🔔 Match Alert: Your match against ${match.p2_name} starts at ${formattedTime} on Board #${boardNum} in "${match.tournament_title}". Please report to Board #${boardNum} immediately.`;
          const notifId1 = 'notif_' + crypto.randomUUID().slice(0, 12);

          await query(
            `INSERT INTO notification_logs (
              notification_id, fixture_id, user_id, recipient_phone,
              notification_type, message, board_number, opponent_name, status, dispatched_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
            [
              notifId1,
              match.fixture_id,
              match.p1_user_id,
              match.p1_phone,
              '10_min_pre_match',
              msgP1,
              typeof boardNum === 'number' ? boardNum : null,
              match.p2_name,
              'sent'
            ]
          );

          dispatchedCount++;
          totalAlertsDispatched++;

          if (broadcastCallback) {
            broadcastCallback({
              type: 'PRE_MATCH_NOTIFICATION',
              userId: match.p1_user_id,
              recipientPhone: match.p1_phone,
              fixtureId: match.fixture_id,
              boardNumber: boardNum,
              opponentName: match.p2_name,
              message: msgP1,
              scheduledTime: match.scheduled_start_time
            });
          }

          // Dispatch free match alert email if email exists
          if (match.p1_email) {
            sendPreMatchEmail({
              to: match.p1_email,
              recipientName: match.p1_name,
              opponentName: match.p2_name,
              tournamentTitle: match.tournament_title,
              boardNumber: boardNum,
              scheduledTime: formattedTime
            }).catch(e => console.error('Error sending P1 match email:', e.message));
          }
        }

        // Check if player 2 already received alert for this fixture
        const checkP2 = await query(
          'SELECT notification_id FROM notification_logs WHERE fixture_id = $1 AND user_id = $2',
          [match.fixture_id, match.p2_user_id]
        );

        if (checkP2.rows.length === 0) {
          const msgP2 = `🔔 Match Alert: Your match against ${match.p1_name} starts at ${formattedTime} on Board #${boardNum} in "${match.tournament_title}". Please report to Board #${boardNum} immediately.`;
          const notifId2 = 'notif_' + crypto.randomUUID().slice(0, 12);

          await query(
            `INSERT INTO notification_logs (
              notification_id, fixture_id, user_id, recipient_phone,
              notification_type, message, board_number, opponent_name, status, dispatched_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
            [
              notifId2,
              match.fixture_id,
              match.p2_user_id,
              match.p2_phone,
              '10_min_pre_match',
              msgP2,
              typeof boardNum === 'number' ? boardNum : null,
              match.p1_name,
              'sent'
            ]
          );

          dispatchedCount++;
          totalAlertsDispatched++;

          if (broadcastCallback) {
            broadcastCallback({
              type: 'PRE_MATCH_NOTIFICATION',
              userId: match.p2_user_id,
              recipientPhone: match.p2_phone,
              fixtureId: match.fixture_id,
              boardNumber: boardNum,
              opponentName: match.p1_name,
              message: msgP2,
              scheduledTime: match.scheduled_start_time
            });
          }

          // Dispatch free match alert email if email exists
          if (match.p2_email) {
            sendPreMatchEmail({
              to: match.p2_email,
              recipientName: match.p2_name,
              opponentName: match.p1_name,
              tournamentTitle: match.tournament_title,
              boardNumber: boardNum,
              scheduledTime: formattedTime
            }).catch(e => console.error('Error sending P2 match email:', e.message));
          }
        }
      }
    }

    return {
      status: 'success',
      scannedMatches: rows.length,
      dispatchedCount,
      totalAlertsDispatched,
      lastScanTime
    };
  } catch (err) {
    console.error('Error during pre-match scan:', err);
    return { status: 'error', error: err.message };
  } finally {
    isRunning = false;
  }
}

/**
 * Start recurring background worker running every 60 seconds
 */
export function startNotificationWorker(intervalSeconds = 60) {
  if (workerInterval) clearInterval(workerInterval);

  console.log(`[Background Worker] Initialized 10-minute pre-match scanner (interval: ${intervalSeconds}s)`);
  // Run once immediately
  runPreMatchScan();

  workerInterval = setInterval(() => {
    runPreMatchScan();
  }, intervalSeconds * 1000);
}

export function stopNotificationWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

export function getWorkerStatus() {
  return {
    isActive: Boolean(workerInterval),
    lastScanTime,
    totalAlertsDispatched,
    intervalSeconds: 60
  };
}
