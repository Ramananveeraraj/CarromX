import crypto from 'crypto';

/**
 * Generate Fixtures based on tournament format, approved participants, and boards.
 * Formats: 'knockout', 'round_robin', 'double_elimination'
 */
export function generateFixtures({
  tournamentId,
  format = 'knockout',
  participants,
  boards,
  startTime = new Date(),
  matchDurationMinutes = 45,
  drawMode = 'random', // 'random' or 'seeded'
  shuffle = true
}) {
  if (!participants || participants.length < 2) {
    throw new Error('At least 2 approved participants are required to generate fixtures.');
  }

  const activeBoards = boards.filter(b => b.is_active);
  if (activeBoards.length === 0) {
    throw new Error('Tournament must have at least one active board.');
  }

  let preparedParticipants = [...participants];
  const isShuffle = Boolean(shuffle || drawMode === 'random');

  if (isShuffle) {
    // True Fisher-Yates Random Shuffle for Blind Draw
    for (let i = preparedParticipants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [preparedParticipants[i], preparedParticipants[j]] = [preparedParticipants[j], preparedParticipants[i]];
    }
  } else {
    // Sort participants by seeding rank (ascending, 1 is highest seed). Unseeded (0 or null) go to end.
    preparedParticipants.sort((a, b) => {
      const seedA = a.seeding_rank && a.seeding_rank > 0 ? a.seeding_rank : 9999;
      const seedB = b.seeding_rank && b.seeding_rank > 0 ? b.seeding_rank : 9999;
      return seedA - seedB;
    });
  }

  let rounds = [];

  if (format === 'round_robin') {
    rounds = generateRoundRobinRounds(preparedParticipants);
  } else if (format === 'double_elimination') {
    rounds = generateKnockoutRounds(preparedParticipants, isShuffle);
  } else {
    // Standard Knockout (Default)
    rounds = generateKnockoutRounds(preparedParticipants, isShuffle);
  }

  // Allocate physical boards and staggered start times
  const fixtures = [];
  let baseTime = new Date(startTime).getTime();

  rounds.forEach((roundMatches, roundIndex) => {
    const roundNumber = roundIndex + 1;
    let boardIndex = 0;
    let currentSlotTime = baseTime + roundIndex * (matchDurationMinutes * 60 * 1000);

    roundMatches.forEach((match) => {
      const isBye = !match.player2 || match.isBye;

      if (isBye) {
        // Bye fixture: Player advances automatically without using a physical board
        fixtures.push({
          fixture_id: 'fix_' + crypto.randomUUID().slice(0, 12),
          tournament_id: tournamentId,
          round_number: roundNumber,
          board_id: null,
          board_number: null,
          player_1_id: match.player1.participant_id,
          player_2_id: null,
          scheduled_start_time: new Date(currentSlotTime).toISOString(),
          match_status: 'completed',
          winner_participant_id: match.player1.participant_id
        });
      } else {
        // Active competitive match: Assign a physical board
        const assignedBoard = activeBoards[boardIndex % activeBoards.length];
        const slotOffset = Math.floor(boardIndex / activeBoards.length) * (matchDurationMinutes * 60 * 1000);
        const scheduledTime = new Date(currentSlotTime + slotOffset).toISOString();

        fixtures.push({
          fixture_id: 'fix_' + crypto.randomUUID().slice(0, 12),
          tournament_id: tournamentId,
          round_number: roundNumber,
          board_id: assignedBoard ? assignedBoard.board_id : null,
          board_number: assignedBoard ? assignedBoard.board_number : 1,
          player_1_id: match.player1.participant_id,
          player_2_id: match.player2.participant_id,
          scheduled_start_time: scheduledTime,
          match_status: 'scheduled',
          winner_participant_id: null
        });

        boardIndex++;
      }
    });
  });

  return fixtures;
}

/**
 * Generate Knockout (Single Elimination) bracket
 * Ensures all scheduled matches have 2 active players.
 */
function generateKnockoutRounds(participants, isRandomShuffle = false) {
  const n = participants.length;
  if (n < 2) return [];

  // For Random Shuffle (Blind Draw):
  // Pair players directly 2-by-2 across the shuffled list.
  if (isRandomShuffle) {
    const matches = [];
    for (let i = 0; i < n - 1; i += 2) {
      matches.push({
        player1: participants[i],
        player2: participants[i + 1]
      });
    }
    // If odd number of participants, the odd player gets a Bye
    if (n % 2 !== 0) {
      matches.push({
        player1: participants[n - 1],
        player2: null,
        isBye: true
      });
    }
    return [matches];
  }

  // For Seeded Draw:
  let power = 2;
  while (power < n) {
    power *= 2;
  }

  if (power === n) {
    // Exact power of 2 (2, 4, 8, 16): Standard classic ICF seeding (1 vs N, 2 vs N-1...)
    const seededOrder = getSeededBracketOrder(power);
    const matches = [];
    for (let i = 0; i < power; i += 2) {
      const p1 = participants[seededOrder[i] - 1];
      const p2 = participants[seededOrder[i + 1] - 1];
      matches.push({ player1: p1, player2: p2 });
    }
    return [matches];
  }

  // When n is not a power of 2 (e.g. 5, 6, 7 in an 8-draw):
  // The top (power - n) seeds get Byes into Round 2.
  // The lower seeds play Round 1 preliminary matches.
  const numByes = power - n;
  const byePlayers = participants.slice(0, numByes);
  const playPlayers = participants.slice(numByes);
  const matches = [];

  for (let i = 0; i < playPlayers.length; i += 2) {
    if (i + 1 < playPlayers.length) {
      matches.push({
        player1: playPlayers[i],
        player2: playPlayers[i + 1]
      });
    }
  }

  byePlayers.forEach(p => {
    matches.push({
      player1: p,
      player2: null,
      isBye: true
    });
  });

  return [matches];
}

/**
 * Helper to generate classic tournament seeding order
 * e.g. for 4: [1, 4, 2, 3]
 * for 8: [1, 8, 4, 5, 2, 7, 3, 6]
 */
function getSeededBracketOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const nextOrder = [];
    const sum = order.length * 2 + 1;
    for (let i = 0; i < order.length; i++) {
      nextOrder.push(order[i]);
      nextOrder.push(sum - order[i]);
    }
    order = nextOrder;
  }
  return order;
}

/**
 * Round Robin generation (Berger tables)
 */
function generateRoundRobinRounds(participants) {
  const list = [...participants];
  if (list.length % 2 !== 0) {
    list.push(null); // Dummy player for bye
  }

  const numPlayers = list.length;
  const numRounds = numPlayers - 1;
  const half = numPlayers / 2;
  const rounds = [];

  for (let r = 0; r < numRounds; r++) {
    const roundMatches = [];
    for (let i = 0; i < half; i++) {
      const p1 = list[i];
      const p2 = list[numPlayers - 1 - i];
      if (p1 && p2) {
        roundMatches.push({ player1: p1, player2: p2 });
      }
    }
    rounds.push(roundMatches);

    // Rotate elements except the first
    const fixed = list[0];
    const rest = list.slice(1);
    const last = rest.pop();
    rest.unshift(last);
    list.splice(0, list.length, fixed, ...rest);
  }

  return rounds;
}

/**
 * Advance Knockout Bracket:
 * Automatically advances winners from completed rounds into Quarter-Finals, Semi-Finals, and Finals.
 */
export async function advanceKnockoutBracket(tournamentId, dbQuery) {
  try {
    // 1. Get tournament details
    const tRes = await dbQuery('SELECT * FROM tournaments WHERE tournament_id = $1', [tournamentId]);
    if (tRes.rows.length === 0) return { advanced: false, reason: 'Tournament not found' };
    const tournament = tRes.rows[0];

    // 2. Get active boards for board allocation
    const bRes = await dbQuery('SELECT * FROM boards WHERE tournament_id = $1 AND is_active = true ORDER BY board_number ASC', [tournamentId]);
    const activeBoards = bRes.rows;

    // 3. Get all fixtures ordered by round and start time
    const fRes = await dbQuery(
      'SELECT * FROM match_fixtures WHERE tournament_id = $1 ORDER BY round_number ASC, scheduled_start_time ASC, fixture_id ASC',
      [tournamentId]
    );
    if (fRes.rows.length === 0) return { advanced: false, reason: 'No fixtures found' };

    // Group by round_number
    const roundMap = new Map();
    for (const f of fRes.rows) {
      if (!roundMap.has(f.round_number)) roundMap.set(f.round_number, []);
      roundMap.get(f.round_number).push(f);
    }

    const rounds = Array.from(roundMap.keys()).sort((a, b) => a - b);
    let totalNewCreated = 0;
    let totalUpdated = 0;

    for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
      const currentRound = rounds[rIdx];
      const fixturesInRound = roundMap.get(currentRound);

      // If only 1 match in this round and it's completed, tournament is finished!
      if (fixturesInRound.length === 1) {
        const finalMatch = fixturesInRound[0];
        if (finalMatch.match_status === 'completed' && finalMatch.winner_participant_id) {
          if (tournament.status !== 'completed') {
            await dbQuery('UPDATE tournaments SET status = $1 WHERE tournament_id = $2', ['completed', tournamentId]);
          }
        }
        continue;
      }

      // There are 2 or more matches in this round.
      // Target next round: currentRound + 1
      const nextRoundNumber = currentRound + 1;
      let nextRoundFixtures = roundMap.get(nextRoundNumber) || [];
      const expectedNextMatches = Math.ceil(fixturesInRound.length / 2);

      if (nextRoundFixtures.length === 0) {
        // Check if at least 1 match in current round is completed with a winner
        const hasAnyCompleted = fixturesInRound.some(f => f.match_status === 'completed' && f.winner_participant_id);
        if (!hasAnyCompleted) continue;

        // Compute scheduled start time for next round: 45 min after last match in current round
        const lastRoundTime = new Date(fixturesInRound[fixturesInRound.length - 1].scheduled_start_time).getTime();
        const matchDuration = (tournament.match_duration_minutes || 45) * 60 * 1000;
        const nextRoundBaseTime = lastRoundTime + matchDuration;

        // Create expectedNextMatches in next round
        for (let mIdx = 0; mIdx < expectedNextMatches; mIdx++) {
          const fixId = 'fix_' + crypto.randomUUID().slice(0, 12);
          const assignedBoard = activeBoards.length > 0 ? activeBoards[mIdx % activeBoards.length] : null;
          const slotOffset = activeBoards.length > 0 ? Math.floor(mIdx / activeBoards.length) * matchDuration : 0;
          const schedTime = new Date(nextRoundBaseTime + slotOffset).toISOString();

          // Feeder matches: 2*mIdx and 2*mIdx + 1
          const feeder1 = fixturesInRound[2 * mIdx];
          const feeder2 = fixturesInRound[2 * mIdx + 1];

          const p1Id = feeder1 && feeder1.match_status === 'completed' ? feeder1.winner_participant_id : null;
          const p2Id = feeder2 && feeder2.match_status === 'completed' ? feeder2.winner_participant_id : null;

          await dbQuery(
            `INSERT INTO match_fixtures (
              fixture_id, tournament_id, round_number, board_id,
              player_1_id, player_2_id, scheduled_start_time, match_status,
              winner_participant_id, set_time_limit_minutes, match_duration_minutes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              fixId,
              tournamentId,
              nextRoundNumber,
              assignedBoard ? assignedBoard.board_id : null,
              p1Id,
              p2Id,
              schedTime,
              'scheduled',
              null,
              tournament.set_time_limit_minutes || 25,
              tournament.match_duration_minutes || 45
            ]
          );
          totalNewCreated++;
        }

        // Re-fetch next round fixtures so subsequent loop iterations see them
        const refetchedNext = await dbQuery(
          'SELECT * FROM match_fixtures WHERE tournament_id = $1 AND round_number = $2 ORDER BY scheduled_start_time ASC, fixture_id ASC',
          [tournamentId, nextRoundNumber]
        );
        roundMap.set(nextRoundNumber, refetchedNext.rows);
        if (!rounds.includes(nextRoundNumber)) rounds.push(nextRoundNumber);
      } else {
        // Next round fixtures already exist. Check if any new winner has emerged and slot them in!
        for (let mIdx = 0; mIdx < nextRoundFixtures.length; mIdx++) {
          const nextFix = nextRoundFixtures[mIdx];
          const feeder1 = fixturesInRound[2 * mIdx];
          const feeder2 = fixturesInRound[2 * mIdx + 1];

          let needsUpdate = false;
          let newP1 = nextFix.player_1_id;
          let newP2 = nextFix.player_2_id;

          if (!newP1 && feeder1 && feeder1.match_status === 'completed' && feeder1.winner_participant_id) {
            newP1 = feeder1.winner_participant_id;
            needsUpdate = true;
          }

          if (!newP2 && feeder2 && feeder2.match_status === 'completed' && feeder2.winner_participant_id) {
            newP2 = feeder2.winner_participant_id;
            needsUpdate = true;
          }

          if (needsUpdate) {
            await dbQuery(
              'UPDATE match_fixtures SET player_1_id = $1, player_2_id = $2 WHERE fixture_id = $3',
              [newP1, newP2, nextFix.fixture_id]
            );
            nextFix.player_1_id = newP1;
            nextFix.player_2_id = newP2;
            totalUpdated++;
          }
        }
      }
    }

    return { success: true, newFixtures: totalNewCreated, updatedFixtures: totalUpdated };
  } catch (err) {
    console.error('Error in advanceKnockoutBracket:', err);
    return { success: false, error: err.message };
  }
}
