-- ============================================================
-- CarromX: Local Carrom Tournament Management Platform
-- Mandatory PostgreSQL Schema Definition
-- ============================================================

-- Drop tables if existing (in reverse dependency order)
DROP TABLE IF EXISTS match_scores CASCADE;
DROP TABLE IF EXISTS match_officials CASCADE;
DROP TABLE IF EXISTS match_fixtures CASCADE;
DROP TABLE IF EXISTS boards CASCADE;
DROP TABLE IF EXISTS participants CASCADE;
DROP TABLE IF EXISTS tournaments CASCADE;
DROP TABLE IF EXISTS notification_logs CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. users Table
CREATE TABLE users (
    user_id VARCHAR(64) PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(150),
    password_hash VARCHAR(255),
    role VARCHAR(50) DEFAULT 'player', -- dynamic role capability: 'player', 'organizer', 'referee', 'help_desk'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. tournaments Table
-- Format ENUM: 'knockout', 'round_robin', 'double_elimination'
-- Status ENUM: 'pending_verification', 'published', 'ongoing', 'completed'
CREATE TABLE tournaments (
    tournament_id VARCHAR(64) PRIMARY KEY,
    organizer_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    venue_address TEXT NOT NULL,
    format VARCHAR(50) NOT NULL CHECK (format IN ('knockout', 'round_robin', 'double_elimination')),
    total_boards INT NOT NULL DEFAULT 4,
    max_points_per_set INT NOT NULL DEFAULT 25,
    boards_per_set INT NOT NULL DEFAULT 8,
    total_sets INT NOT NULL DEFAULT 3,
    entry_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'published', 'ongoing', 'completed')),
    verified_by_helpdesk BOOLEAN NOT NULL DEFAULT FALSE,
    upi_id VARCHAR(100),
    rules_summary TEXT,
    banner_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. participants Table
-- Payment Status ENUM: 'pending', 'approved', 'rejected'
CREATE TABLE participants (
    participant_id VARCHAR(64) PRIMARY KEY,
    tournament_id VARCHAR(64) NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    payment_reference_id VARCHAR(100),
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'approved', 'rejected')),
    seeding_rank INT DEFAULT 0,
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_participant_tournament_user UNIQUE (tournament_id, user_id)
);

-- 4. boards Table
CREATE TABLE boards (
    board_id VARCHAR(64) PRIMARY KEY,
    tournament_id VARCHAR(64) NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    board_number INT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_tournament_board UNIQUE (tournament_id, board_number)
);

-- 5. match_fixtures Table
-- Match Status ENUM: 'scheduled', 'live', 'completed', 'disputed'
CREATE TABLE match_fixtures (
    fixture_id VARCHAR(64) PRIMARY KEY,
    tournament_id VARCHAR(64) NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    round_number INT NOT NULL,
    board_id VARCHAR(64) REFERENCES boards(board_id) ON DELETE SET NULL,
    player_1_id VARCHAR(64) REFERENCES participants(participant_id) ON DELETE CASCADE,
    player_2_id VARCHAR(64) REFERENCES participants(participant_id) ON DELETE CASCADE,
    scheduled_start_time TIMESTAMP NOT NULL,
    match_status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (match_status IN ('scheduled', 'live', 'completed', 'disputed')),
    winner_participant_id VARCHAR(64) REFERENCES participants(participant_id) ON DELETE SET NULL
);

-- 6. match_officials Table (Referees)
CREATE TABLE match_officials (
    assignment_id VARCHAR(64) PRIMARY KEY,
    fixture_id VARCHAR(64) NOT NULL REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
    referee_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_fixture_referee UNIQUE (fixture_id, referee_user_id)
);

-- 7. match_scores Table
CREATE TABLE match_scores (
    score_id VARCHAR(64) PRIMARY KEY,
    fixture_id VARCHAR(64) NOT NULL REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
    set_number INT NOT NULL,
    player_1_points INT NOT NULL DEFAULT 0,
    player_2_points INT NOT NULL DEFAULT 0,
    is_set_completed BOOLEAN NOT NULL DEFAULT FALSE,
    set_winner_id VARCHAR(64) REFERENCES participants(participant_id) ON DELETE SET NULL,
    logged_by_referee_id VARCHAR(64) REFERENCES users(user_id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_fixture_set UNIQUE (fixture_id, set_number)
);

-- 8. notification_logs Table (Tracks 10-minute pre-match push notification dispatch)
CREATE TABLE notification_logs (
    notification_id VARCHAR(64) PRIMARY KEY,
    fixture_id VARCHAR(64) NOT NULL REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    recipient_phone VARCHAR(20) NOT NULL,
    notification_type VARCHAR(50) NOT NULL DEFAULT '10_min_pre_match',
    message TEXT NOT NULL,
    board_number INT,
    opponent_name VARCHAR(150),
    status VARCHAR(50) NOT NULL DEFAULT 'sent',
    dispatched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for optimal lookup performance
CREATE INDEX idx_tournaments_organizer ON tournaments(organizer_id);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_participants_tournament ON participants(tournament_id);
CREATE INDEX idx_fixtures_tournament ON match_fixtures(tournament_id);
CREATE INDEX idx_fixtures_scheduled_time ON match_fixtures(scheduled_start_time);
CREATE INDEX idx_scores_fixture ON match_scores(fixture_id);
CREATE INDEX idx_officials_fixture ON match_officials(fixture_id);
CREATE INDEX idx_officials_referee ON match_officials(referee_user_id);
CREATE INDEX idx_notif_fixture_user ON notification_logs(fixture_id, user_id);
