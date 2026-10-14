-- ============================================================
-- CarromX: Local Carrom Tournament Management Platform
-- Mandatory PostgreSQL Schema Definition (Safe & Non-Destructive)
-- ============================================================

-- 1. users Table
CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS tournaments (
    tournament_id VARCHAR(64) PRIMARY KEY,
    organizer_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    venue_address TEXT NOT NULL,
    format VARCHAR(50) NOT NULL CHECK (format IN ('knockout', 'round_robin', 'double_elimination')),
    total_boards INT NOT NULL DEFAULT 4,
    max_points_per_set INT NOT NULL DEFAULT 25,
    boards_per_set INT NOT NULL DEFAULT 8,
    total_sets INT NOT NULL DEFAULT 3,
    set_time_limit_minutes INT DEFAULT 25,
    match_duration_minutes INT DEFAULT 45,
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
CREATE TABLE IF NOT EXISTS participants (
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
CREATE TABLE IF NOT EXISTS boards (
    board_id VARCHAR(64) PRIMARY KEY,
    tournament_id VARCHAR(64) NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    board_number INT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_tournament_board UNIQUE (tournament_id, board_number)
);

-- 5. match_fixtures Table
-- Match Status ENUM: 'scheduled', 'live', 'completed', 'disputed'
CREATE TABLE IF NOT EXISTS match_fixtures (
    fixture_id VARCHAR(64) PRIMARY KEY,
    tournament_id VARCHAR(64) NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    round_number INT NOT NULL,
    board_id VARCHAR(64) REFERENCES boards(board_id) ON DELETE SET NULL,
    player_1_id VARCHAR(64) REFERENCES participants(participant_id) ON DELETE CASCADE,
    player_2_id VARCHAR(64) REFERENCES participants(participant_id) ON DELETE CASCADE,
    scheduled_start_time TIMESTAMP NOT NULL,
    match_status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (match_status IN ('scheduled', 'live', 'completed', 'disputed')),
    winner_participant_id VARCHAR(64) REFERENCES participants(participant_id) ON DELETE SET NULL,
    match_no VARCHAR(50),
    pool VARCHAR(50),
    age_group VARCHAR(50),
    game_type VARCHAR(50) DEFAULT 'Singles',
    umpire_name VARCHAR(150),
    chief_referee_name VARCHAR(150),
    set_time_limit_minutes INT DEFAULT 25,
    match_duration_minutes INT DEFAULT 45
);

-- 6. match_officials Table (Referees)
CREATE TABLE IF NOT EXISTS match_officials (
    assignment_id VARCHAR(64) PRIMARY KEY,
    fixture_id VARCHAR(64) NOT NULL REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
    referee_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_fixture_referee UNIQUE (fixture_id, referee_user_id)
);

-- 7. match_scores Table
CREATE TABLE IF NOT EXISTS match_scores (
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
CREATE TABLE IF NOT EXISTS notification_logs (
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

-- 9. tournament_officials Table (Umpires, Referees, and Co-Organisers)
CREATE TABLE IF NOT EXISTS tournament_officials (
    official_id VARCHAR(64) PRIMARY KEY,
    tournament_id VARCHAR(64) NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    official_role VARCHAR(50) NOT NULL CHECK (official_role IN ('co_organizer', 'umpire', 'chief_referee')),
    assigned_board_number INT,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tournament_official UNIQUE (tournament_id, user_id, official_role)
);

-- 10. otp_verifications Table (Persistent OTP storage across server restarts and workers)
CREATE TABLE IF NOT EXISTS otp_verifications (
    identifier VARCHAR(150) PRIMARY KEY,
    otp_code VARCHAR(10) NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. match_score_sheets Table (Official Carrom Score Sheet)
CREATE TABLE IF NOT EXISTS match_score_sheets (
    fixture_id VARCHAR(64) PRIMARY KEY REFERENCES match_fixtures(fixture_id) ON DELETE CASCADE,
    match_no VARCHAR(50),
    pool VARCHAR(50),
    age_group VARCHAR(50),
    game_type VARCHAR(50) DEFAULT 'Singles',
    umpire_name VARCHAR(150),
    chief_referee_name VARCHAR(150),
    toss_won_by VARCHAR(50),
    toss_choice VARCHAR(50),
    game_1_start VARCHAR(50),
    game_1_end VARCHAR(50),
    game_2_start VARCHAR(50),
    game_2_end VARCHAR(50),
    game_3_start VARCHAR(50),
    game_3_end VARCHAR(50),
    sheet_json TEXT,
    winner_id VARCHAR(64),
    final_score_summary TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for optimal lookup performance
CREATE INDEX IF NOT EXISTS idx_tournaments_organizer ON tournaments(organizer_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_participants_tournament ON participants(tournament_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_tournament ON match_fixtures(tournament_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_scheduled_time ON match_fixtures(scheduled_start_time);
CREATE INDEX IF NOT EXISTS idx_scores_fixture ON match_scores(fixture_id);
CREATE INDEX IF NOT EXISTS idx_officials_fixture ON match_officials(fixture_id);
CREATE INDEX IF NOT EXISTS idx_officials_referee ON match_officials(referee_user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_officials_tour ON tournament_officials(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_officials_user ON tournament_officials(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_fixture_user ON notification_logs(fixture_id, user_id);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_verifications(expires_at);

