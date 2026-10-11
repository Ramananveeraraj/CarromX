# CARROMX: APP DEVELOPMENT WORKFLOW & TECHNICAL SPECIFICATION
## Phase 1 Execution Blueprint & Operational Roadmap

This document serves as the master engineering blueprint and operational workflow for **CarromX**. It contains the relational entity-relationship model, database schema specifications, role-based access control matrix, sprint milestone roadmap (Sprints 1–6), and the MVP Definition of Done.

---

## 1. Database Architecture & Relationships Overview

```
[USERS] 1 ────────────< [TOURNAMENTS] (Hosted by organizer)
  │                            │
  │ (Plays in)                 │ (Configures)
  ▼                            ▼
[PARTICIPANTS]           [BOARDS] & [MATCH_FIXTURES]
  │                            │
  │ (Assigned to match)        │ (Officiated by)
  ▼                            ▼
[MATCH_FIXTURES] 1 ───────< [MATCH_OFFICIALS / REFEREES]
  │
  │ (Logs digital score sheet)
  ▼
[MATCH_SCORES]
```

### Relational Schema Specifications

#### 1. `users` Table
Stores all registered users. Role management is handled dynamically via permissions or a role flag since any player can potentially host a tournament.
- `user_id` (PK, VARCHAR/UUID): Unique identifier for the user.
- `full_name` (VARCHAR): Full name of the user.
- `phone_number` (VARCHAR, Unique): Phone number with country code, used for login & SMS push notifications.
- `email` (VARCHAR): Optional contact email address.
- `role` (VARCHAR): Default `'player'`, dynamically switches to `'organizer'`, `'referee'`, or `'help_desk'`.
- `created_at` (TIMESTAMP): Account registration timestamp.

#### 2. `tournaments` Table
Stores tournament configurations created by organizers, including board limits and match scoring rules.
- `tournament_id` (PK, VARCHAR/UUID): Unique identifier for the tournament.
- `organizer_id` (FK -> `users.user_id`): User who created and manages the tournament.
- `title` (VARCHAR): Tournament title (e.g., *"Bangalore Open Carrom Championship 2026"*).
- `venue_address` (TEXT): Physical location or arena address.
- `format` (ENUM): `'knockout'`, `'round_robin'`, or `'double_elimination'`.
- `total_boards` (INT): Number of physical boards available (e.g., 4 or 8 boards).
- `max_points_per_set` (INT): Max points to win a set (e.g., 25 points ICF standard).
- `boards_per_set` (INT): Board cap per set (e.g., 8 boards limit).
- `total_sets` (INT): Number of sets to play (e.g., Best of 3 sets).
- `entry_fee` (DECIMAL): Entry fee in INR (₹).
- `status` (ENUM): `'pending_verification'`, `'published'`, `'ongoing'`, `'completed'`.
- `verified_by_helpdesk` (BOOLEAN): Defaults to `FALSE` until reviewed by Help Desk Admin.
- `upi_id` (VARCHAR): Organizer UPI VPA for Method 1 external registration.
- `rules_summary` (TEXT): Custom guidelines or ICF standard rules.
- `created_at` (TIMESTAMP): Creation timestamp.

#### 3. `participants` Table
Links players to tournaments they have registered and submitted external payment proof for.
- `participant_id` (PK, VARCHAR/UUID): Unique participant registration ID.
- `tournament_id` (FK -> `tournaments.tournament_id`): Tournament enrolled in.
- `user_id` (FK -> `users.user_id`): User participating.
- `payment_reference_id` (VARCHAR): 12-digit UPI UTR transaction reference number or receipt URL.
- `payment_status` (ENUM): `'pending'`, `'approved'`, `'rejected'`.
- `seeding_rank` (INT): Organizer-assigned seeding rank for bracket placement.
- `registered_at` (TIMESTAMP): Registration timestamp.

#### 4. `boards` Table
Represents physical boards available at the tournament venue.
- `board_id` (PK, VARCHAR/UUID): Unique board identifier.
- `tournament_id` (FK -> `tournaments.tournament_id`): Tournament the board belongs to.
- `board_number` (INT): Board identifier (Board 1, Board 2, etc.).
- `is_active` (BOOLEAN): Whether the board is currently active/operational.

#### 5. `match_fixtures` Table
Core engine table storing matchups, schedules, board assignments, and status.
- `fixture_id` (PK, VARCHAR/UUID): Unique match fixture identifier.
- `tournament_id` (FK -> `tournaments.tournament_id`): Parent tournament.
- `round_number` (INT): Round index (Round 1, Quarterfinals, Semifinals, Finals).
- `board_id` (FK -> `boards.board_id`, Nullable): Physical board assigned to this match.
- `player_1_id` (FK -> `participants.participant_id`): Participant in slot 1.
- `player_2_id` (FK -> `participants.participant_id`): Participant in slot 2.
- `scheduled_start_time` (TIMESTAMP): Scheduled match start time.
- `match_status` (ENUM): `'scheduled'`, `'live'`, `'completed'`, `'disputed'`.
- `winner_participant_id` (FK -> `participants.participant_id`, Nullable): Winner of match.

#### 6. `match_officials` Table (Referees)
Assigns a specific referee to a board or fixture to lock down score entry permissions.
- `assignment_id` (PK, VARCHAR/UUID): Unique assignment ID.
- `fixture_id` (FK -> `match_fixtures.fixture_id`): Match being officiated.
- `referee_user_id` (FK -> `users.user_id`): User assigned as the referee.
- `assigned_at` (TIMESTAMP): Assignment timestamp.

#### 7. `match_scores` Table (Digital Score Sheet)
Logs granular set-by-set points entered exclusively by the authorized referee.
- `score_id` (PK, VARCHAR/UUID): Unique score entry record.
- `fixture_id` (FK -> `match_fixtures.fixture_id`): Match fixture.
- `set_number` (INT): Set index (1, 2, 3).
- `player_1_points` (INT): Points accumulated by Player 1 in this set.
- `player_2_points` (INT): Points accumulated by Player 2 in this set.
- `is_set_completed` (BOOLEAN): `TRUE` once locked by referee; locks write permissions.
- `set_winner_id` (FK -> `participants.participant_id`, Nullable): Winner of this set.
- `logged_by_referee_id` (FK -> `users.user_id`): User who logged/locked the score.
- `updated_at` (TIMESTAMP): Last updated timestamp.

#### 8. `notification_logs` Table (Pre-Match Push Engine)
Tracks 10-minute automated reminders dispatched to players.
- `notification_id` (PK, VARCHAR/UUID): Unique notification tracking ID.
- `fixture_id` (FK -> `match_fixtures.fixture_id`): Scheduled match.
- `user_id` (FK -> `users.user_id`): Recipient user.
- `recipient_phone` (VARCHAR): Mobile number notified.
- `notification_type` (VARCHAR): `'10_min_pre_match'`.
- `message` (TEXT): Full alert text with board number, opponent, and time.
- `board_number` (INT): Board number assigned.
- `opponent_name` (VARCHAR): Name of opposing player.
- `status` (VARCHAR): `'sent'`.
- `dispatched_at` (TIMESTAMP): Dispatch timestamp.

---

## 2. Core User Roles & Permissions Matrix

| Feature / Action | Player | Referee / Official | Organizer | Help Desk Admin |
| :--- | :---: | :---: | :---: | :---: |
| **Register for Tournaments (Method 1 UPI)** | ✓ | ✓ | ✓ | — |
| **View Fixtures & Live Scores** | ✓ | ✓ | ✓ | ✓ |
| **Receive 10-Min Pre-Match Alerts** | ✓ | — | — | — |
| **Create Tournaments & Boards** | — | — | ✓ | — |
| **Enter & Lock Match Scores** | — | ✓ *(Assigned Boards)* | ✓ *(Override)* | — |
| **Swap / Interchange Players in Fixtures** | — | — | ✓ | — |
| **Review & Approve UPI Reference UTRs** | — | — | ✓ | — |
| **Verify & Publish Tournaments** | — | — | — | ✓ |
| **Resolve Disputes & Audit Scores** | — | — | ✓ | ✓ |

---

## 3. How Relational Logic Powers CarromX Core Features

1. **The 10-Minute Reminder**:
   - An autonomous background worker runs every 60 seconds.
   - It queries `match_fixtures` joining `tournaments`, `boards`, and `participants` where `scheduled_start_time` is within 10 minutes from `now`.
   - Before dispatching, it checks `notification_logs` to ensure no duplicates.
   - It sends notifications to `player_1_id` and `player_2_id` containing the physical board number, scheduled time, and opponent's name.

2. **Referee Score Auditing & Real-Time Score Locking**:
   - When a referee enters points on `/api/fixtures/:id/score-event`, the server queries `match_officials` to confirm `referee_user_id` matches the assigned fixture.
   - Once a set is finalized (`is_set_completed = true`), referee write permissions are immediately locked.
   - Only users with the `'organizer'` role can execute an Organizer Score Override (`POST /api/fixtures/:id/organizer-override`) to unlock or adjust scores.

3. **Live Audience Updates**:
   - The WebSocket gateway broadcasts score updates, set locks, and match completions to all connected clients in sub-second time.
   - Spectators and players see points update live without refreshing their browser.

---

## 4. Development Sprint Roadmap (Phase 1 Milestones)

### Sprint 1: Authentication & Role Management (Week 1–2)
- **Task 1.1**: Build phone OTP login screen using SMS verification with JWT token issuing.
- **Task 1.2**: Implement user profile creation (`users` table) storing name, phone number, and default "Player" role.
- **Task 1.3**: Set up dynamic role access so users can switch to "Organizer Mode" or be assigned "Referee" status.

### Sprint 2: Tournament Setup & SEO Landing Pages (Week 3–4)
- **Task 2.1**: Build Organizer Tournament Creation Form capturing title, venue, total physical boards, format (`knockout`, `round_robin`, `double_elimination`), and match rules (sets, points limit, boards per set).
- **Task 2.2**: Build SEO-optimized public web page generator (`/tournament/:id`) with OpenGraph, Twitter cards, and Schema.org `SportsEvent` JSON-LD.
- **Task 2.3**: Implement Help Desk Admin panel to review pending tournaments and toggle the "Verified by CarromX" badge.

### Sprint 3: Player Registration & Payment Flow (Week 5)
- **Task 3.1**: Implement the "Register" button on tournament pages.
- **Task 3.2**: Build manual payment instruction view (displaying Organizer's UPI ID / bank details / QR code).
- **Task 3.3**: Add upload field for transaction reference ID / screenshot proof (`participants` table).
- **Task 3.4**: Build Organizer review dashboard to approve or reject pending player payments.

### Sprint 4: Automated Fixtures & Manual Override (Week 6–7)
- **Task 4.1**: Code Automated Fixture Engine algorithm to pair approved participants for Round 1 and map them across available physical boards.
- **Task 4.2**: Build visual bracket tree and round-by-round fixture list view.
- **Task 4.3**: Manual Override Feature: Build drag-and-swap UI for organizers to interchange players or reassign boards if someone runs late.

### Sprint 5: Referees, Digital Score Sheets & Live Scoring (Week 8)
- **Task 5.1**: Build Referee Assignment module (`match_officials` table) allowing organizers to link referees to specific boards/fixtures.
- **Task 5.2**: Build Digital Score Sheet interface for referees to track set-by-set points live (+1 white, +1 black, +3 queen, -1 penalty/due).
- **Task 5.3**: Program auto-trigger rules: when a player hits max points (e.g., 25 pts) or completes set boards, log set winner and lock scores.

### Sprint 6: Notifications & Pre-Match Alerts (Week 9)
- **Task 6.1**: Set up push notification service (Service Worker Web Push + WebSocket broadcasts).
- **Task 6.2**: Build background cron job/worker that checks match start times every minute.
- **Task 6.3**: Program 10-Minute Pre-Match Reminder to automatically alert players with assigned board number and opponent details.

---

## 5. Definition of Done (DoD) for MVP

The CarromX platform is field-ready when:
1. ✅ **Tournament Creation & Verification**: An organizer creates a tournament with custom boards and rules, and the Help Desk reviews and publishes it.
2. ✅ **Player Registration via Method 1 UPI**: Players discover the tournament via SEO link or app, submit their 12-digit UPI UTR, and the organizer approves them.
3. ✅ **Automated Fixture Generation & Manual Overrides**: The organizer auto-generates brackets across physical boards and can drag-and-swap players if needed.
4. ✅ **Referee Digital Scoring & Score Locking**: Referees log points for assigned boards, and finalized sets are locked with organizer override safeguards.
5. ✅ **10-Minute Automated Pre-Match Alerts**: The background worker scans upcoming matches every 60 seconds and alerts players before their match begins.
