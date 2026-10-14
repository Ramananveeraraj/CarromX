# CarromX: Comprehensive Workflow & Technical Implementation Guide

**Document Version:** 2.0  
**Status:** Production Ready  
**Last Updated:** October 2026  
**Repository:** [CarromX GitHub](https://github.com/Ramananveeraraj/CarromX)

---

## 1. System Architecture Overview

CarromX is a tournament management platform designed for carrom tournaments ranging from local community clubs to state championships and official AICF (All India Carrom Federation) tournaments.

### Architecture Diagram

```mermaid
graph TD
    subgraph Client Layer
        WebSPA["Web Client (Vanilla JS + Tailwind CSS)"]
        FlutterApp["Mobile App (Flutter / Android AAB)"]
    end

    subgraph API & Gateway Layer
        ExpressServer["Express.js Server (Node.js ESM)"]
        WSServer["WebSocket Server (ws)"]
        AuthMiddleware["JWT & RBAC Middleware"]
    end

    subgraph Data & Storage Layer
        PostgresDB["Production: PostgreSQL (Render Managed)"]
        SQLiteDB["Development: SQLite3 (carromx.db)"]
        UniversalAdapter["Universal DB Adapter (server/db.js)"]
    end

    subgraph Background Services
        NotifWorker["10-Min Pre-Match Worker"]
        EmailService["Nodemailer SMTP + Timeout Fallback"]
        SeedEngine["Runtime Migration & Seeder"]
    end

    WebSPA --> ExpressServer
    WebSPA <--> WSServer
    FlutterApp --> ExpressServer

    ExpressServer --> AuthMiddleware
    AuthMiddleware --> UniversalAdapter
    UniversalAdapter --> PostgresDB
    UniversalAdapter --> SQLiteDB

    ExpressServer --> NotifWorker
    ExpressServer --> EmailService
    ExpressServer --> SeedEngine
```

### Technology Stack

| Layer | Technologies | Key Responsibilities |
| :--- | :--- | :--- |
| **Frontend Web** | HTML5, Tailwind CSS, Vanilla ES6+ JS, FontAwesome 6 | Responsive SPA, bracket visualizers, AICF score sheet, audio effects |
| **Mobile App** | Flutter 3.x, Dart, Android SDK 34 | Native Android APK/AAB for Google Play Store, push notification listeners |
| **Backend Server** | Node.js (v20+), Express.js 4.x (ESM) | REST API endpoints, RBAC enforcement, fixture generation engine |
| **Realtime Gateway** | `ws` (WebSockets) | Sub-second broadcast of live scores, board assignments, and status locks |
| **Database** | PostgreSQL (Render) / SQLite3 (Local) | Relational persistence, transactional data integrity, schema migrations |
| **Email / Alerts** | Nodemailer (SMTP) + Background Worker | 6-digit OTP delivery, 10-minute pre-match schedule dispatches |

---

## 2. Role-Based Access Control (RBAC) Matrix

CarromX operates on a role hierarchy. User roles are controlled by the Administrator; player accounts cannot self-escalate or change roles automatically.

```mermaid
graph TD
    SuperAdmin["👑 Super Admin (Full Platform Control)"]
    HelpDesk["🛡️ Help Desk Admin (Verification & Auditing)"]
    Organiser["📂 Tournament Organiser (Host & Bracket Manager)"]
    Referee["⚖️ Umpire / Referee (Digital Score Sheet)"]
    Player["🎯 Player (Participant & Spectator)"]

    SuperAdmin --> HelpDesk
    SuperAdmin --> Organiser
    SuperAdmin --> Referee
    SuperAdmin --> Player
    HelpDesk --> Player
    Organiser --> Referee
    Organiser --> Player
```

### Permission Matrix

| Operation / Endpoint | Player | Referee / Umpire | Organiser | Help Desk | Super Admin |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Browse Tournaments & Live Scores | ✓ | ✓ | ✓ | ✓ | ✓ |
| Register & Submit UPI Payment | ✓ | ✓ | ✓ | ✓ | ✓ |
| Receive 10-Min Pre-Match Notifications | ✓ | — | — | — | — |
| Create Tournaments & Physical Boards | — | — | ✓ | — | ✓ |
| Verify & Publish Tournaments | — | — | — | ✓ | ✓ |
| Review & Approve Player UPI Payments | — | — | ✓ *(Own)* | — | ✓ |
| Generate Fixtures & Seed Brackets | — | — | ✓ *(Own)* | — | ✓ |
| Swap / Interchange Players in Fixtures | — | — | ✓ *(Own)* | — | ✓ |
| Fill Official AICF Digital Score Sheet | — | ✓ *(Assigned)* | ✓ *(Own)* | — | ✓ |
| Override Locked Scores | — | — | ✓ *(Own)* | — | ✓ |
| Manage User Roles in Directory | — | — | — | — | ✓ |

> [!IMPORTANT]
> **Strict Role Guarding:** When a user registers or signs in via OTP, their role defaults strictly to `player`. Role upgrades to `organizer`, `referee`, or `help_desk` can only be granted by the **Super Admin** through the Super Admin Master Directory.

---

## 3. Authentication & Security Workflows

CarromX features dual authentication pathways:
1. **Public Player / Organiser Pathway**: Fast OTP authentication.
2. **Master Super Admin Pathway**: Triple-lock credential verification.

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Player
    participant Client as CarromX Web / App
    participant Server as Auth Server (/api/auth)
    participant DB as Database

    alt Player / Organiser Authentication
        User->>Client: Enters Mobile Number & Email
        Client->>Server: POST /api/auth/send-otp
        Server->>Server: Generate cryptographically random 6-digit OTP
        Server->>User: Sends email via SMTP (dev code fallback in response)
        User->>Client: Enters 6-digit OTP
        Client->>Server: POST /api/auth/verify-otp
        Server->>DB: Check phone ownership (Protects Admin Phone)
        Server->>DB: Find or create user record (role = 'player')
        Server->>Client: Returns signed JWT token + user profile
    else Super Admin Master Portal
        User->>Client: Selects "Master Admin Suite"
        User->>Client: Enters email, phone (+919600436921), and password (Ramanan@03)
        Client->>Server: POST /api/auth/login
        Server->>DB: Verify email is carrromx@gmail.com
        Server->>Server: Verify mobile matches +919600436921
        Server->>Server: Verify master password matches Ramanan@03
        Server->>Client: Returns Super Admin JWT token
    end
```

### Security Safeguards

- **Admin Phone Protection:** If an imposter attempts to register through the public player portal using the Super Admin mobile number (`+919600436921`), the server rejects the request with HTTP `403 Forbidden` (`"This mobile number is reserved for the Super Administrator"`).
- **No Guest Auto-Login:** Guest visitors remain unauthenticated. The app never auto-assigns tokens or masks failed logins with demo profiles.
- **Master Admin Password Verification:** Admin logins verify email, phone, and password before issuing a token.

---

## 4. Database Architecture & Dual-Engine Compatibility

CarromX supports both local development and production cloud databases through an abstraction layer in [`server/db.js`](file:///c:/xampp/htdocs/CarromX/server/db.js).

### Database Schema Entity-Relationship Model

```mermaid
erDiagram
    USERS ||--o{ TOURNAMENTS : "organizes"
    USERS ||--o{ PARTICIPANTS : "enrolls"
    USERS ||--o{ MATCH_OFFICIALS : "officiates"
    USERS ||--o{ NOTIFICATION_LOGS : "receives"

    TOURNAMENTS ||--|{ BOARDS : "contains"
    TOURNAMENTS ||--o{ PARTICIPANTS : "registers"
    TOURNAMENTS ||--o{ MATCH_FIXTURES : "schedules"
    TOURNAMENTS ||--o{ TOURNAMENT_OFFICIALS : "employs"

    BOARDS ||--o{ MATCH_FIXTURES : "hosts"

    PARTICIPANTS ||--o{ MATCH_FIXTURES : "plays as player 1"
    PARTICIPANTS ||--o{ MATCH_FIXTURES : "plays as player 2"

    MATCH_FIXTURES ||--o{ MATCH_SCORES : "records set scores"
    MATCH_FIXTURES ||--o| MATCH_SCORE_SHEETS : "official AICF score sheet"
    MATCH_FIXTURES ||--o{ MATCH_OFFICIALS : "assigned referees"
    MATCH_FIXTURES ||--o{ NOTIFICATION_LOGS : "dispatches reminder"
```

### Dual-Engine Compatibility Layer

| Feature | PostgreSQL (Render Production) | SQLite3 (Local Development) | Universal Translation (`server/db.js`) |
| :--- | :--- | :--- | :--- |
| **Parameterized Queries** | `$1, $2, $3` | `?, ?, ?` | Query translator auto-converts `?` to `$1, $2` on Postgres and `$1` to `?` on SQLite |
| **Boolean Types** | Native `BOOLEAN` (`TRUE` / `FALSE`) | `INTEGER` (`1` / `0`) | Query runner translates `is_active = 1` $\rightarrow$ `is_active = true`, etc. |
| **Runtime Migrations** | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` | Auto-runs during `initDb()` on server startup without table drops |
| **Date / Time Functions** | `CURRENT_TIMESTAMP`, `CURRENT_DATE` | `CURRENT_TIMESTAMP`, `datetime('now')` | Auto-normalized in SQL string builder |

---

## 5. End-to-End Tournament Lifecycle

```mermaid
flowchart TD
    A["1. Organiser Creates Tournament<br/>(Sets, Points, Duration, Boards)"] --> B["Status: pending_verification<br/>verified_by_helpdesk = false"]
    B --> C["2. Help Desk Admin Review<br/>(Approves & Verifies)"]
    C --> D["Status: published<br/>(Visible on Public Portal)"]
    D --> E["3. Player Registration & Payment<br/>(UPI Reference UTR Submitted)"]
    E --> F["4. Organiser Payment Approval<br/>(Status: approved + Seeding Rank)"]
    F --> G{"5. Draw Generation"}
    G -->|Seeded Bracket| H["ICF Standard Seeded Matchups<br/>(Seed 1 vs Seed 4, Seed 2 vs Seed 3)"]
    G -->|Random Shuffle| I["Fair Draw Shuffle Animation<br/>(Random pairing across boards)"]
    H --> J["6. Scheduled Fixtures Ready"]
    I --> J
    J --> K["7. 10-Min Pre-Match Alerts Dispatched<br/>(Background worker alerts players)"]
    K --> L["8. Live Match Officiating<br/>(Official AICF Digital Score Sheet)"]
    L --> M["9. Set Completion & Verification<br/>(Best of 3 sets, points locked)"]
    M --> N["10. Bracket Advancement<br/>(Winner moves to Next Round / Finals)"]
    N --> O["11. Tournament Completion<br/>(Podium & Final Standings)"]
```

---

## 6. Official AICF / ICF Digital Score Sheet Implementation

The digital score sheet conforms to the **All India Carrom Federation (AICF)** and **International Carrom Federation (ICF)** standards.

### Data Model & Table: `match_score_sheets`
- **Metadata**: `fixture_id`, `match_no`, `pool`, `age_group`, `game_type` (Singles / Doubles), `umpire_name`, `chief_referee_name`.
- **Toss Details**: `toss_won_by`, `toss_choice` (White / Black / Side).
- **Game Clock**: `game_1_start`, `game_1_end`, `game_2_start`, `game_2_end`, `game_3_start`, `game_3_end`.
- **Granular Board Logs (`sheet_json`)**:
  - White carrom coins pocketed (+1 point).
  - Black carrom coins pocketed (+1 point).
  - Queen pocketed & covered (+3 points, available until cumulative score reaches 21).
  - Due / Penalty deductions (-1 coin).
  - Break-to-finish (White Slam / Black Slam) indicators.
- **Export & Certification**:
  - Digital signatures of Umpire, Chief Referee, Player 1, and Player 2.
  - One-click PDF generation matching the official paper tournament score sheet format.

---

## 7. Real-Time Synchronization & Notification Engine

### 1. WebSocket Broadcast Gateway
- **Event Types**:
  - `SCORE_UPDATE`: Live set points for spectator view.
  - `OFFICIAL_SCORE_SHEET_UPDATE`: Real-time coin-by-coin tally.
  - `MATCH_STATUS_CHANGE`: When a match starts (`live`), completes (`completed`), or is locked.
  - `TOURNAMENT_UPDATE`: When brackets or fixtures are refreshed.
- **Sub-Second Delivery**: Avoids client-side polling loops and updates connected devices automatically.

### 2. 10-Minute Pre-Match Background Worker
- An autonomous timer runs every 60 seconds on the server.
- Evaluates fixtures where `scheduled_start_time` is between 0 and 10 minutes from `CURRENT_TIMESTAMP`.
- Checks `notification_logs` to prevent duplicate alerts.
- Dispatches alert containing:
  - Board number (e.g. *"Board 3"*).
  - Opponent name.
  - Scheduled start time.
  - Set time limit (e.g. *"25 Minutes"*).

---

## 8. Mobile Application (Flutter) & Web Integration

### Flutter App Overview (`carromx_mobile`)
- **SDK**: Flutter 3.x / Dart 3.x.
- **API Client**: REST API integration with automatic token preservation via `SharedPreferences`.
- **Build Targets**:
  - Google Android App Bundle (`app-release.aab`) targeting Android API 34.
  - Signed using official upload keystore with ProGuard rules preserving JSON serialization.
- **Web App**: Single Page Application built with vanilla JavaScript, optimized for zero build step overhead and instant loading across mobile browsers and desktops.

---

## 9. Environment Variables & Production Operations

### Environment Variables (`.env`)

| Variable | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `PORT` | Web server listening port | `3000` (Local) / `10000` (Render) |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host/carromx_db` |
| `PGSSLMODE` | SSL requirement for cloud database | `require` |
| `JWT_SECRET` | Secret key for signing auth tokens | Strong 64-char random hex string |
| `SMTP_HOST` | Outgoing email server | `smtp.gmail.com` |
| `SMTP_PORT` | Outgoing email port | `587` |
| `SMTP_USER` | Email dispatch address | `carrromx@gmail.com` |
| `SMTP_PASS` | SMTP application password | 16-character App Password |

### Primary Super Admin Credentials

- **Email**: `carrromx@gmail.com`
- **Mobile Number**: `+919600436921` (`9600436921`)
- **Master Password**: `Ramanan@03`
- **Access Route**: `/#admin` or click **"Master Admin Portal"** on the sign-in modal.
