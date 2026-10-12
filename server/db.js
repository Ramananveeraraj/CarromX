import sqlite3 from 'sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
let dbClient = null;
let isPostgres = false;

if (DATABASE_URL) {
  console.log('Connecting to PostgreSQL database:', DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
  const { Pool } = pg;
  dbClient = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
  });
  isPostgres = true;
} else {
  const dbPath = path.resolve(__dirname, '../carromx.db');
  console.log(`Using local SQLite database at: ${dbPath}`);
  dbClient = new sqlite3.Database(dbPath);
  // Enable foreign keys in SQLite
  dbClient.run('PRAGMA foreign_keys = ON;');
}

/**
 * Universal query runner: supports $1, $2 (Postgres) or ? (SQLite)
 */
export async function query(sql, params = []) {
  if (isPostgres) {
    // Postgres uses $1, $2, etc. If query was written with ?, replace with $1, $2...
    let pgSql = sql;
    let paramIndex = 1;
    if (sql.includes('?') && !sql.includes('$1')) {
      pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    }
    const res = await dbClient.query(pgSql, params);
    return { rows: res.rows, rowCount: res.rowCount };
  } else {
    // SQLite uses ?; if query was written with $1, $2, replace with ?
    let sqliteSql = sql.replace(/\$\d+/g, '?');
    
    return new Promise((resolve, reject) => {
      const trimmed = sqliteSql.trim();
      const isSelect = /^(SELECT|PRAGMA)/i.test(trimmed);

      if (isSelect) {
        dbClient.all(sqliteSql, params, (err, rows) => {
          if (err) return reject(err);
          // Normalize SQLite booleans (1/0) where expected
          const normalized = (rows || []).map(row => {
            const copy = { ...row };
            for (const key of Object.keys(copy)) {
              if (key === 'verified_by_helpdesk' || key === 'is_active' || key === 'is_set_completed') {
                copy[key] = Boolean(copy[key]);
              }
            }
            return copy;
          });
          resolve({ rows: normalized, rowCount: normalized.length });
        });
      } else {
        dbClient.run(sqliteSql, params, function (err) {
          if (err) return reject(err);
          resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
        });
      }
    });
  }
}

/**
 * Initialize Tables
 */
export async function initDb() {
  if (isPostgres) {
    const schemaSql = fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8');
    await dbClient.query(schemaSql);
    console.log('PostgreSQL database schema verified.');
  } else {
    // Run SQLite migrations
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        phone_number TEXT NOT NULL UNIQUE,
        email TEXT,
        password_hash TEXT,
        role TEXT DEFAULT 'player',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    try {
      await query('ALTER TABLE users ADD COLUMN password_hash TEXT');
    } catch (_) {}

    await query(`
      CREATE TABLE IF NOT EXISTS tournaments (
        tournament_id TEXT PRIMARY KEY,
        organizer_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        venue_address TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('knockout', 'round_robin', 'double_elimination')),
        total_boards INTEGER NOT NULL DEFAULT 4,
        max_points_per_set INTEGER NOT NULL DEFAULT 25,
        boards_per_set INTEGER NOT NULL DEFAULT 8,
        total_sets INTEGER NOT NULL DEFAULT 3,
        entry_fee REAL NOT NULL DEFAULT 0.00,
        status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'published', 'ongoing', 'completed')),
        verified_by_helpdesk INTEGER NOT NULL DEFAULT 0,
        upi_id TEXT,
        rules_summary TEXT,
        banner_url TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS participants (
        participant_id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        payment_reference_id TEXT,
        payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'approved', 'rejected')),
        seeding_rank INTEGER DEFAULT 0,
        registered_at TEXT DEFAULT (datetime('now')),
        UNIQUE(tournament_id, user_id)
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS boards (
        board_id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
        board_number INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(tournament_id, board_number)
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS match_fixtures (
        fixture_id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
        round_number INTEGER NOT NULL,
        board_id TEXT REFERENCES boards(board_id) ON DELETE SET NULL,
        player_1_id TEXT REFERENCES participants(participant_id) ON DELETE CASCADE,
        player_2_id TEXT REFERENCES participants(participant_id) ON DELETE CASCADE,
        scheduled_start_time TEXT NOT NULL,
        match_status TEXT NOT NULL DEFAULT 'scheduled' CHECK (match_status IN ('scheduled', 'live', 'completed', 'disputed')),
        winner_participant_id TEXT REFERENCES participants(participant_id) ON DELETE SET NULL
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS match_officials (
        assignment_id TEXT PRIMARY KEY,
        fixture_id TEXT NOT NULL REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
        referee_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        assigned_at TEXT DEFAULT (datetime('now')),
        UNIQUE(fixture_id, referee_user_id)
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS match_scores (
        score_id TEXT PRIMARY KEY,
        fixture_id TEXT NOT NULL REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
        set_number INTEGER NOT NULL,
        player_1_points INTEGER NOT NULL DEFAULT 0,
        player_2_points INTEGER NOT NULL DEFAULT 0,
        is_set_completed INTEGER NOT NULL DEFAULT 0,
        set_winner_id TEXT REFERENCES participants(participant_id) ON DELETE SET NULL,
        logged_by_referee_id TEXT REFERENCES users(user_id),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(fixture_id, set_number)
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        notification_id TEXT PRIMARY KEY,
        fixture_id TEXT NOT NULL REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        recipient_phone TEXT NOT NULL,
        notification_type TEXT NOT NULL DEFAULT '10_min_pre_match',
        message TEXT NOT NULL,
        board_number INTEGER,
        opponent_name TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        dispatched_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Official Carrom Score Sheet table (Matches Chennai / Tamil Nadu School Games / AICF official sheet)
    await query(`
      CREATE TABLE IF NOT EXISTS match_score_sheets (
        fixture_id TEXT PRIMARY KEY REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
        match_no TEXT,
        pool TEXT,
        age_group TEXT,
        game_type TEXT DEFAULT 'Singles',
        umpire_name TEXT,
        chief_referee_name TEXT,
        toss_won_by TEXT,
        toss_choice TEXT,
        game_1_start TEXT,
        game_1_end TEXT,
        game_2_start TEXT,
        game_2_end TEXT,
        game_3_start TEXT,
        game_3_end TEXT,
        sheet_json TEXT,
        winner_id TEXT,
        final_score_summary TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Tournament Officials: Umpires, Referees, and Co-Organisers
    await query(`
      CREATE TABLE IF NOT EXISTS tournament_officials (
        official_id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        official_role TEXT NOT NULL CHECK (official_role IN ('co_organizer', 'umpire', 'chief_referee')),
        assigned_board_number INTEGER,
        assigned_at TEXT DEFAULT (datetime('now')),
        UNIQUE(tournament_id, user_id, official_role)
      );
    `);

    // Ensure extra columns on match_fixtures and tournaments if missing (SQLite migration helper)
    try {
      const tourColsRes = await query("PRAGMA table_info(tournaments);");
      const tourExisting = tourColsRes.rows.map(r => r.name);
      if (!tourExisting.includes('set_time_limit_minutes')) {
        await query("ALTER TABLE tournaments ADD COLUMN set_time_limit_minutes INTEGER DEFAULT 25;");
      }
      if (!tourExisting.includes('match_duration_minutes')) {
        await query("ALTER TABLE tournaments ADD COLUMN match_duration_minutes INTEGER DEFAULT 45;");
      }

      const fixColsRes = await query("PRAGMA table_info(match_fixtures);");
      const existingCols = fixColsRes.rows.map(r => r.name);
      const colsToAdd = [
        { name: 'match_no', def: 'TEXT' },
        { name: 'pool', def: 'TEXT' },
        { name: 'age_group', def: 'TEXT' },
        { name: 'game_type', def: "TEXT DEFAULT 'Singles'" },
        { name: 'umpire_name', def: 'TEXT' },
        { name: 'chief_referee_name', def: 'TEXT' },
        { name: 'set_time_limit_minutes', def: 'INTEGER DEFAULT 25' },
        { name: 'match_duration_minutes', def: 'INTEGER DEFAULT 45' }
      ];
      for (const col of colsToAdd) {
        if (!existingCols.includes(col.name)) {
          await query(`ALTER TABLE match_fixtures ADD COLUMN ${col.name} ${col.def};`);
        }
      }
    } catch (migErr) {
      console.warn('Migration helper notice:', migErr.message);
    }

    console.log('SQLite database schema initialized.');
  }
}

export { isPostgres };
