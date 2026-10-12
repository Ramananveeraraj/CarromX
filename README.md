# CarromX — Local Carrom Tournament Management Platform

**CarromX** is a local Carrom Tournament Management Platform engineered with a single-app architecture, dynamic role-based access, automated fixture generation with manual drag-and-swap overrides, a referee digital score sheet with real-time score locking, and an autonomous background worker dispatching 10-minute pre-match push notifications.

---

## 1. Project Identity & Architecture

- **Single Application with Dynamic Roles**: Seamless runtime switching between **Player**, **Organizer**, **Referee**, and **Help Desk Admin**.
- **Cross-Platform Responsive Web & Mobile**: Mobile bottom navigation bar, desktop operational suite, touch-friendly referee scoreboard, and responsive bracket views.
- **Backend & Database**: Node.js, Express, WebSocket gateway for sub-second real-time sync, and relational database abstraction adhering strictly to the PostgreSQL schema (supporting PostgreSQL/Supabase and local zero-config SQLite).
- **Authentication**: Phone number with OTP verification (with instant dev-mode auto-fill and 1-click persona logins).

---

## 2. Mandatory Relational Database Schema

The database strictly conforms to the PostgreSQL table structure defined in `schema.sql`:

1. **`users` Table:**
   - `user_id` (PK, VARCHAR)
   - `full_name` (VARCHAR)
   - `phone_number` (VARCHAR, Unique)
   - `email` (VARCHAR)
   - `role` (VARCHAR: `player`, `organizer`, `referee`, `help_desk`)
   - `created_at` (TIMESTAMP)

2. **`tournaments` Table:**
   - `tournament_id` (PK, VARCHAR)
   - `organizer_id` (FK -> `users`)
   - `title` (VARCHAR)
   - `venue_address` (TEXT)
   - `format` (ENUM: `'knockout'`, `'round_robin'`, `'double_elimination'`)
   - `total_boards` (INT)
   - `max_points_per_set` (INT)
   - `boards_per_set` (INT)
   - `total_sets` (INT)
   - `entry_fee` (DECIMAL)
   - `status` (ENUM: `'pending_verification'`, `'published'`, `'ongoing'`, `'completed'`)
   - `verified_by_helpdesk` (BOOLEAN, default `FALSE`)
   - `upi_id` (VARCHAR)
   - `rules_summary` (TEXT)
   - `created_at` (TIMESTAMP)

3. **`participants` Table:**
   - `participant_id` (PK, VARCHAR)
   - `tournament_id` (FK -> `tournaments`)
   - `user_id` (FK -> `users`)
   - `payment_reference_id` (VARCHAR)
   - `payment_status` (ENUM: `'pending'`, `'approved'`, `'rejected'`)
   - `seeding_rank` (INT)
   - `registered_at` (TIMESTAMP)

4. **`boards` Table:**
   - `board_id` (PK, VARCHAR)
   - `tournament_id` (FK -> `tournaments`)
   - `board_number` (INT)
   - `is_active` (BOOLEAN)

5. **`match_fixtures` Table:**
   - `fixture_id` (PK, VARCHAR)
   - `tournament_id` (FK -> `tournaments`)
   - `round_number` (INT)
   - `board_id` (FK -> `boards`, Nullable)
   - `player_1_id` (FK -> `participants`)
   - `player_2_id` (FK -> `participants`)
   - `scheduled_start_time` (TIMESTAMP)
   - `match_status` (ENUM: `'scheduled'`, `'live'`, `'completed'`, `'disputed'`)
   - `winner_participant_id` (FK -> `participants`, Nullable)

6. **`match_officials` Table (Referees):**
   - `assignment_id` (PK, VARCHAR)
   - `fixture_id` (FK -> `match_fixtures`)
   - `referee_user_id` (FK -> `users`)
   - `assigned_at` (TIMESTAMP)

7. **`match_scores` Table:**
   - `score_id` (PK, VARCHAR)
   - `fixture_id` (FK -> `match_fixtures`)
   - `set_number` (INT)
   - `player_1_points` (INT)
   - `player_2_points` (INT)
   - `is_set_completed` (BOOLEAN)
   - `set_winner_id` (FK -> `participants`, Nullable)
   - `logged_by_referee_id` (FK -> `users`)
   - `updated_at` (TIMESTAMP)

8. **`notification_logs` Table:**
   - Tracks 10-minute pre-match push notification dispatches with board number, opponent name, recipient phone, and timestamps.

---

## 3. Core Business Logic & Security Rules

### A. Payment & Trust Flow (Method 1)
- **Zero In-App Automated Gateways**: Automated gateways are disabled. All payments use **Method 1**:
  1. Player transfers entry fee via external UPI / Bank App to organizer's UPI ID.
  2. Player uploads 12-digit transaction reference ID (UTR).
  3. Status defaults to `pending`.
  4. Organizer reviews UTR references in the "Payment Verifications Queue" and approves or rejects.
  5. Only approved players are eligible for seeding and automated fixture generation.
- **Trust Verification**: Every newly created tournament defaults to `verified_by_helpdesk = FALSE` and `status = 'pending_verification'` until reviewed and approved by a Help Desk Admin.

### B. Dynamic Role Permissions
- **Players**: Read-only access to fixtures, leaderboards, personal schedule, and receive 10-minute pre-match push alerts.
- **Referees**: Authorized write permissions exclusively on `match_scores` for their assigned fixtures via `match_officials`. Score locking applies upon set finalization.
- **Organizers**: Full control over tournament parameters, board allocation, fixture generation, manual drag-and-swap overrides, and score overrides.
- **Help Desk Admins**: Review tournament trust, verify tournaments (`verified_by_helpdesk = TRUE`), publish tournaments, and resolve disputes.

### C. Automated Fixtures Engine & Drag-and-Swap Overrides
- **Supported Formats**: Knockout (with power-of-2 seeding & bye handling), Round Robin (circle algorithm / Berger tables), and Double Elimination.
- **Automated Board Allocation**: Distributes matches round-by-round across active physical boards (1..N) with staggered start times.
- **Manual Drag-and-Swap Overrides**:
  - HTML5 Drag-and-Drop slots for organizers to drag player pills across match cards or swap boards and match times on the fly.
  - Interactive "Swap Match" modal for board and schedule interchange.

### D. Referee Digital Score Sheet & Real-Time Score Locking
- Tactile Carrom coin buttons: **White Coin (+1)**, **Black Coin (+1)**, **Queen (+3)**, and **Due/Penalty (-1)**.
- Enforces `max_points_per_set` and `boards_per_set`.
- **Real-Time Score Locking**:
  - Once a set is finalized (`is_set_completed = true`), referee buttons are locked with a padlock badge.
  - Only the **Organizer** has the authority to execute an "Organizer Score Override" to unlock or adjust scores.
  - Instant WebSocket broadcast updates all connected spectators and players in real time.

### E. Background Worker for 10-Minute Pre-Match Push Notifications
- Runs autonomously every 60 seconds.
- Scans `match_fixtures` for scheduled matches starting within the 10-minute window.
- Dispatches alert:
  > *"🔔 Match Alert: Your match against [Opponent] starts at [Time] on Board #[Board Number] in '[Tournament]'. Please report to Board #[Board Number] immediately."*
- Broadcasts via WebSockets, triggers native Web Notifications, sounds an audio chime, and records entries in `notification_logs`.
- Includes a dedicated **Worker Monitor Dashboard** with live countdown, scan logs, and an instant "Run Worker Scan Now" trigger button.

### F. SEO Optimization & Server-Side Rendered (SSR) Landing Pages
- Public tournament URLs (`/tournament/:id` and `/tournament/[id]`) are served with full server-side rendered HTML.
- Injects OpenGraph meta tags, Twitter card tags, canonical links, and Schema.org `SportsEvent` JSON-LD structured data for search engine crawlers.

---

## 4. Quick Start & Execution

### 1. Install Dependencies
```bash
npm install
```

### 2. Start CarromX Server
```bash
npm start
```

Open your browser at:
```
http://localhost:3000
```

### 3. Pre-Configured Demo Accounts (1-Click Login)
The application comes pre-seeded with 4 dynamic role personas:
- **CarromX Admin (Super Admin)**: Email `carrromx@gmail.com`, Phone `+919876543210`
- **Rahul Verma (Player)**: Phone `+919876543201`
- **Priya Sharma (Organizer)**: Phone `+919876543202`
- **Suresh Kumar (Official Referee)**: Phone `+919876543203`
- **Amit Patel (Help Desk Admin)**: Phone `+919876543204`

Or sign in with any custom phone number using the SMS dev simulator code `123456`.
