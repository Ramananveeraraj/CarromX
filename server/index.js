import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fs from 'fs';

import { query, initDb } from './db.js';
import { seedData } from './seed.js';
import { startNotificationWorker, registerBroadcastCallback } from './worker.js';
import { registerScoreBroadcast } from './routes/scoreRoutes.js';

import authRoutes from './routes/authRoutes.js';
import tournamentRoutes from './routes/tournamentRoutes.js';
import participantRoutes from './routes/participantRoutes.js';
import fixtureRoutes, { registerFixtureBroadcast } from './routes/fixtureRoutes.js';
import scoreRoutes from './routes/scoreRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Real-time WebSocket broadcasting to connected clients
const connectedClients = new Set();

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Connected to CarromX Real-Time Gateway' }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // Client can send ping
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      } else if (data.type === 'SPECTATOR_REACTION' || data.type === 'SHOT_CLOCK_SYNC' || data.type === 'BOARD_COINS_SYNC') {
        // Forward real-time spectator reactions, shot-clock timers & visual coins to all active clients
        broadcastRealtime(data);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
  });
});

function broadcastRealtime(payload) {
  const data = JSON.stringify(payload);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Hook background worker, scoring engine and fixtures to WebSocket broadcaster
registerBroadcastCallback(broadcastRealtime);
registerScoreBroadcast(broadcastRealtime);
registerFixtureBroadcast(broadcastRealtime);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api', participantRoutes);
app.use('/api', fixtureRoutes);
app.use('/api', scoreRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CarromX Local Platform',
    timestamp: new Date().toISOString(),
    connectedSockets: connectedClients.size
  });
});

/**
 * SEO Optimization: Server-Side Rendered (SSR) Public Tournament Landing Page
 * Matches `/tournament/:id` and `/tournament/[id]`
 */
async function renderTournamentPage(req, res) {
  try {
    let tournamentId = req.params.id;
    // Handle literal [id] if passed as parameter
    if (!tournamentId || tournamentId === '[id]') {
      tournamentId = req.query.id || 'trn_blr_open_2026';
    }

    const tourRes = await query(`
      SELECT 
        t.*,
        u.full_name as organizer_name,
        u.phone_number as organizer_phone,
        (SELECT COUNT(*) FROM participants p WHERE p.tournament_id = t.tournament_id) as participant_count,
        (SELECT COUNT(*) FROM participants p WHERE p.tournament_id = t.tournament_id AND p.payment_status = 'approved') as approved_count
      FROM tournaments t
      JOIN users u ON t.organizer_id = u.user_id
      WHERE t.tournament_id = $1
    `, [tournamentId]);

    if (tourRes.rows.length === 0) {
      return res.status(404).send('<h1>Tournament Not Found - CarromX</h1>');
    }

    const t = tourRes.rows[0];
    const pageTitle = `${escapeHtml(t.title)} | Official Carrom Tournament | CarromX`;
    const pageDescription = `Join ${escapeHtml(t.title)} at ${escapeHtml(t.venue_address)}. Format: ${t.format.toUpperCase()} (${t.total_sets} Sets, ${t.max_points_per_set} Pts Cap), Entry Fee: ₹${t.entry_fee}. Help Desk ${t.verified_by_helpdesk ? 'Verified' : 'Pending'}. Register now on CarromX.`;
    const pageImage = t.banner_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80';
    const canonicalUrl = `http://localhost:${PORT}/tournament/${t.tournament_id}`;

    // Schema.org SportsEvent JSON-LD
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      "name": t.title,
      "description": pageDescription,
      "startDate": t.created_at,
      "location": {
        "@type": "Place",
        "name": t.venue_address,
        "address": t.venue_address
      },
      "organizer": {
        "@type": "Person",
        "name": t.organizer_name
      },
      "offers": {
        "@type": "Offer",
        "price": t.entry_fee,
        "priceCurrency": "INR",
        "availability": "https://schema.org/InStock",
        "url": canonicalUrl
      }
    };

    // Pre-rendered HTML page for SEO bots + humans
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${pageDescription}">
  <link rel="canonical" href="${canonicalUrl}">
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${pageDescription}">
  <meta property="og:image" content="${pageImage}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${pageDescription}">
  <meta name="twitter:image" content="${pageImage}">

  <!-- Schema.org SportsEvent JSON-LD -->
  <script type="application/ld+json">
    ${JSON.stringify(jsonLd)}
  </script>

  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="/css/app.css">
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <!-- Top Navigation Bar -->
  <header class="border-b border-amber-900/30 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center font-black text-xl text-amber-100 shadow-lg border border-amber-500/30">
          CX
        </div>
        <div>
          <span class="text-xl font-bold tracking-tight text-white">Carrom<span class="text-amber-500">X</span></span>
          <span class="text-xs block text-slate-400">Tournament Hub</span>
        </div>
      </a>
      <div class="flex items-center gap-3">
        <a href="/?open=${t.tournament_id}" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm transition shadow-lg shadow-amber-900/20">
          Open in App
        </a>
      </div>
    </div>
  </header>

  <!-- Tournament Hero -->
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div class="rounded-2xl overflow-hidden border border-amber-800/30 bg-slate-900/90 shadow-2xl">
      <div class="relative h-64 md:h-80 w-full overflow-hidden">
        <img src="${pageImage}" alt="${escapeHtml(t.title)}" class="w-full h-full object-cover">
        <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent"></div>
        <div class="absolute bottom-6 left-6 right-6">
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <span class="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
              t.status === 'ongoing' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
              t.status === 'published' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' :
              'bg-amber-500/20 text-amber-400 border border-amber-500/40'
            }">
              ${t.status.replace('_', ' ')}
            </span>
            ${
              t.verified_by_helpdesk
                ? `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center gap-1">
                    <i class="fa-solid fa-certificate text-amber-400"></i> Help Desk Verified
                   </span>`
                : `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-700/50 text-slate-400 border border-slate-600">
                    <i class="fa-solid fa-clock"></i> Pending Help Desk Verification
                   </span>`
            }
            <span class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800/80 text-slate-300 border border-slate-700 uppercase">
              <i class="fa-solid fa-diagram-project mr-1"></i> ${t.format.replace('_', ' ')}
            </span>
          </div>
          <h1 class="text-2xl md:text-4xl font-extrabold text-white tracking-tight">${escapeHtml(t.title)}</h1>
          <p class="text-slate-300 text-sm md:text-base mt-2 flex items-center gap-2">
            <i class="fa-solid fa-location-dot text-amber-400"></i> ${escapeHtml(t.venue_address)}
          </p>
        </div>
      </div>

      <!-- Quick Metrics Bar -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 border-b border-slate-800 bg-slate-900/60 text-center">
        <div class="p-3 rounded-xl bg-slate-800/50 border border-slate-800">
          <div class="text-xs text-slate-400">Entry Fee</div>
          <div class="text-xl font-bold text-amber-400">₹${t.entry_fee}</div>
        </div>
        <div class="p-3 rounded-xl bg-slate-800/50 border border-slate-800">
          <div class="text-xs text-slate-400">Total Boards</div>
          <div class="text-xl font-bold text-slate-200">${t.total_boards} Boards</div>
        </div>
        <div class="p-3 rounded-xl bg-slate-800/50 border border-slate-800">
          <div class="text-xs text-slate-400">Match Rules</div>
          <div class="text-xl font-bold text-slate-200">${t.total_sets} Sets / ${t.max_points_per_set} Pts</div>
        </div>
        <div class="p-3 rounded-xl bg-slate-800/50 border border-slate-800">
          <div class="text-xs text-slate-400">Players Approved</div>
          <div class="text-xl font-bold text-emerald-400">${t.approved_count} Confirmed</div>
        </div>
      </div>

      <!-- Content Area -->
      <div class="p-6 md:p-8 space-y-6">
        <div>
          <h2 class="text-lg font-bold text-amber-400 mb-2 flex items-center gap-2">
            <i class="fa-solid fa-gavel"></i> Tournament Rules & Match Configuration
          </h2>
          <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-300 text-sm leading-relaxed">
            <p class="mb-2"><strong>Format:</strong> ${t.format.toUpperCase()} (Board count: ${t.total_boards})</p>
            <p class="mb-2"><strong>Limits:</strong> Maximum ${t.max_points_per_set} points per set, maximum ${t.boards_per_set} boards per set, best of ${t.total_sets} sets.</p>
            <p class="text-slate-400">${escapeHtml(t.rules_summary || 'Standard ICF carrom tournament guidelines apply.')}</p>
          </div>
        </div>

        <div>
          <h2 class="text-lg font-bold text-emerald-400 mb-2 flex items-center gap-2">
            <i class="fa-solid fa-phone"></i> Direct GPay / Phone Call Registration
          </h2>
          <div class="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/30 text-slate-300 text-sm">
            <p class="text-slate-200 mb-1 font-medium">To register as a player:</p>
            <ol class="list-decimal list-inside space-y-1 text-slate-400 text-xs md:text-sm">
              <li>Call or WhatsApp Organiser <strong>${escapeHtml(t.organizer_name)}</strong> at <a href="tel:${t.organizer_phone}" class="text-emerald-400 font-bold underline font-mono">${escapeHtml(t.organizer_phone)}</a></li>
              <li>Pay entry fee of ₹${t.entry_fee} directly via Google Pay / PhonePe / Cash.</li>
              <li>Organiser admits and confirms your entry in the app with 1 click.</li>
            </ol>
          </div>
        </div>

        <div class="pt-4 flex flex-col sm:flex-row gap-3">
          <a href="/?open=${t.tournament_id}&action=register" class="flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold text-center shadow-lg transition">
            <i class="fa-solid fa-ticket mr-2"></i> Register for Tournament
          </a>
          <a href="/tournament/${t.tournament_id}/fixtures/print" class="flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white font-bold text-center shadow-lg transition">
            <i class="fa-solid fa-file-pdf mr-2"></i> Download Fixtures PDF
          </a>
          <a href="/?open=${t.tournament_id}&tab=fixtures" class="flex-1 py-3 px-6 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-center border border-slate-700 transition">
            <i class="fa-solid fa-trophy mr-2"></i> Live Fixtures & Scores
          </a>
        </div>
      </div>
    </div>
  </main>

  <footer class="border-t border-slate-800 text-center py-6 text-xs text-slate-500">
    CarromX Tournament Platform &bull; SEO SSR Landing Page &bull; &copy; 2026 CarromX
  </footer>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Error rendering tournament SSR page:', err);
    res.status(500).send('Internal Server Error rendering tournament page');
  }
}

/**
 * Server-Rendered Printable Tournament Fixtures Chart & PDF View
 */
async function renderPrintableFixturesPage(req, res) {
  try {
    let tournamentId = req.params.id;
    if (!tournamentId || tournamentId === '[id]') {
      tournamentId = req.query.id || 'trn_blr_open_2026';
    }

    const tourRes = await query(`
      SELECT t.*, u.full_name as organizer_name, u.phone_number as organizer_phone
      FROM tournaments t
      JOIN users u ON t.organizer_id = u.user_id
      WHERE t.tournament_id = $1
    `, [tournamentId]);

    if (tourRes.rows.length === 0) {
      return res.status(404).send('<h1>Tournament Not Found - CarromX</h1>');
    }

    const t = tourRes.rows[0];

    const fixRes = await query(`
      SELECT 
        f.*,
        b.board_number,
        u1.full_name as p1_name,
        u1.phone_number as p1_phone,
        u2.full_name as p2_name,
        u2.phone_number as p2_phone,
        f.umpire_name,
        uref.full_name as referee_name
      FROM match_fixtures f
      LEFT JOIN boards b ON f.board_id = b.board_id
      LEFT JOIN participants p1 ON f.player_1_id = p1.participant_id
      LEFT JOIN users u1 ON p1.user_id = u1.user_id
      LEFT JOIN participants p2 ON f.player_2_id = p2.participant_id
      LEFT JOIN users u2 ON p2.user_id = u2.user_id
      LEFT JOIN match_officials o ON f.fixture_id = o.fixture_id
      LEFT JOIN users uref ON o.referee_user_id = uref.user_id
      WHERE f.tournament_id = $1
      ORDER BY f.round_number ASC, f.scheduled_start_time ASC
    `, [tournamentId]);

    const fixtures = fixRes.rows;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Official Match Fixtures & Board Chart | ${escapeHtml(t.title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/js/html2pdf.bundle.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @media print {
      .no-print { display: none !important; }
      body { background: #fff !important; color: #000 !important; padding: 0 !important; }
      .sheet-box { border: 2px solid #000 !important; box-shadow: none !important; }
    }
  </style>
</head>
<body class="bg-slate-100 text-slate-900 min-h-screen p-4 sm:p-8 font-sans">
  <div class="max-w-4xl mx-auto space-y-4">
    <div class="no-print bg-slate-900 text-white rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-xl">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-file-pdf text-rose-500 text-xl"></i>
        <div>
          <h2 class="font-bold text-sm sm:text-base">${escapeHtml(t.title)} - Official Fixtures Chart</h2>
          <p class="text-xs text-slate-400">Download championship PDF or share with players</p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button onclick="downloadPDF()" class="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white font-extrabold text-xs shadow-lg transition flex items-center gap-1.5 active:scale-95">
          <i class="fa-solid fa-download"></i> 📥 Download PDF
        </button>
        <button onclick="window.print()" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs transition flex items-center gap-1.5">
          <i class="fa-solid fa-print text-amber-400"></i> Print / PDF
        </button>
        <button onclick="shareWhatsApp()" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition flex items-center gap-1.5 active:scale-95">
          <i class="fa-brands fa-whatsapp text-sm"></i> Share WhatsApp
        </button>
        <a href="/?open=${t.tournament_id}" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700">
          <i class="fa-solid fa-arrow-left mr-1"></i> Back to App
        </a>
      </div>
    </div>

    <div id="printContainer" class="sheet-box bg-white border-2 border-slate-900 rounded-xl p-6 sm:p-8 shadow-sm space-y-6">
      <div class="text-center border-b-2 border-slate-900 pb-4 space-y-1">
        <div class="text-[10px] tracking-widest uppercase font-extrabold text-slate-600">
          TAMIL NADU / ALL INDIA CARROM FEDERATION COMPLIANT FORMAT
        </div>
        <h1 class="text-2xl font-black uppercase tracking-tight text-slate-900">
          ${escapeHtml(t.title)}
        </h1>
        <div class="text-xs font-semibold text-slate-700 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1">
          <span><strong>Venue:</strong> ${escapeHtml(t.venue_address)}</span>
          <span class="text-slate-400">&bull;</span>
          <span><strong>Format:</strong> Knockout (${escapeHtml(t.format)})</span>
          <span class="text-slate-400">&bull;</span>
          <span><strong>Total Boards:</strong> ${t.total_boards} Active Boards</span>
          <span class="text-slate-400">&bull;</span>
          <span><strong>Organiser:</strong> ${escapeHtml(t.organizer_name)} (${escapeHtml(t.organizer_phone)})</span>
        </div>
        <div class="inline-block mt-2 px-3 py-1 bg-slate-900 text-white text-[11px] font-black uppercase tracking-wider rounded">
          OFFICIAL TOURNAMENT MATCH FIXTURES &amp; BOARD ALLOCATION CHART
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse border border-slate-900">
          <thead>
            <tr class="bg-slate-200 text-slate-900 font-black uppercase text-[10px] border-b-2 border-slate-900">
              <th class="py-2.5 px-2 border-r border-slate-900 text-center w-12">Match</th>
              <th class="py-2.5 px-2 border-r border-slate-900 text-center w-20">Board</th>
              <th class="py-2.5 px-3 border-r border-slate-900">Player 1 (White / Strike)</th>
              <th class="py-2.5 px-2 text-center border-r border-slate-900 w-10">VS</th>
              <th class="py-2.5 px-3 border-r border-slate-900">Player 2 (Black)</th>
              <th class="py-2.5 px-2.5 border-r border-slate-900 text-center w-24">Scheduled</th>
              <th class="py-2.5 px-2.5 border-r border-slate-900 text-center w-24">Status</th>
              <th class="py-2.5 px-3 text-center w-28">Referee</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800 text-slate-900 font-medium">
            ${fixtures.length === 0 ? `
              <tr><td colspan="8" class="py-8 text-center text-slate-500">No match fixtures generated yet for this tournament.</td></tr>
            ` : fixtures.map((f, idx) => {
              const isBye = !f.player_2_id;
              return `
                <tr class="border-b border-slate-900 hover:bg-slate-50 transition">
                  <td class="py-2.5 px-2 border-r border-slate-900 text-center font-bold font-mono">
                    M${idx + 1}
                  </td>
                  <td class="py-2.5 px-2 border-r border-slate-900 text-center font-bold">
                    ${isBye ? '<span class="text-emerald-700 font-bold italic">Bye</span>' : `<span class="bg-slate-900 text-white px-2 py-0.5 rounded text-[10px] font-mono">Board #${f.board_number || 1}</span>`}
                  </td>
                  <td class="py-2.5 px-3 border-r border-slate-900 font-bold">
                    <div>${escapeHtml(f.p1_name || 'Player 1')}</div>
                    ${f.p1_phone ? `<div class="text-[10px] text-slate-500 font-mono font-normal">${escapeHtml(f.p1_phone)}</div>` : ''}
                  </td>
                  <td class="py-2.5 px-2 text-center border-r border-slate-900 font-black text-slate-500">
                    VS
                  </td>
                  <td class="py-2.5 px-3 border-r border-slate-900 font-bold">
                    ${isBye ? `
                      <span class="text-emerald-700 font-black uppercase text-[11px]">&bull; ADVANCED ON BYE &bull;</span>
                    ` : `
                      <div>${escapeHtml(f.p2_name || 'Player 2')}</div>
                      ${f.p2_phone ? `<div class="text-[10px] text-slate-500 font-mono font-normal">${escapeHtml(f.p2_phone)}</div>` : ''}
                    `}
                  </td>
                  <td class="py-2.5 px-2.5 border-r border-slate-900 text-center font-mono text-[11px]">
                    ${new Date(f.scheduled_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td class="py-2.5 px-2.5 border-r border-slate-900 text-center font-bold uppercase text-[10px]">
                    ${isBye ? '<span class="text-emerald-700">COMPLETED</span>' : f.match_status}
                  </td>
                  <td class="py-2.5 px-3 text-center text-[10px] text-slate-700">
                    ${escapeHtml(f.referee_name || f.umpire_name || 'Official Referee')}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-center text-xs">
        <div class="space-y-8">
          <div class="h-10 border-b border-dashed border-slate-400"></div>
          <div>
            <div class="font-bold uppercase text-[11px] text-slate-900">Chief Referee / Umpire</div>
            <div class="text-[10px] text-slate-500">Signature &amp; Date</div>
          </div>
        </div>
        <div class="space-y-8">
          <div class="h-10 border-b border-dashed border-slate-400"></div>
          <div>
            <div class="font-bold uppercase text-[11px] text-slate-900">Tournament Director / Organiser</div>
            <div class="text-[10px] text-slate-500">Authorized Signature</div>
          </div>
        </div>
        <div class="space-y-8">
          <div class="h-10 border-b border-dashed border-slate-400"></div>
          <div>
            <div class="font-bold uppercase text-[11px] text-slate-900">Association Seal / Stamp</div>
            <div class="text-[10px] text-slate-500">Official Sanction Stamp</div>
          </div>
        </div>
      </div>

      <div class="text-center pt-2 text-[10px] text-slate-500 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <span>Generated by CarromX Platform &bull; Validated under ICF &amp; AICF Laws</span>
        <span>Laws of Carrom: Best of ${t.total_sets} Sets &bull; 25 Points Limit</span>
        <span>Generated on: ${new Date().toLocaleString()}</span>
      </div>
    </div>
  </div>

  <script>
    function downloadPDF() {
      const el = document.getElementById('printContainer');
      const filename = 'Carrom_Fixtures_${escapeHtml(t.title).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf';
      if (typeof html2pdf !== 'undefined') {
        const opt = {
          margin: [8, 8, 8, 8],
          filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(el).save();
      } else {
        window.print();
      }
    }

    function shareWhatsApp() {
      const text = \`🏆 *${t.title.toUpperCase()}*\\n📍 Venue: ${t.venue_address}\\n📋 Official Fixtures Chart: \${window.location.href}\\n\\nOrganised via CarromX Platform 🎯\`;
      window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Error rendering printable fixtures page:', err);
    res.status(500).send('Internal Server Error rendering printable fixtures');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.get('/tournament/:id/fixtures/print', renderPrintableFixturesPage);
app.get('/tournament/:id/fixtures/pdf', renderPrintableFixturesPage);
app.get('/tournament/:id', renderTournamentPage);
app.get('/tournament/\\[id\\]', renderTournamentPage);

// Serve static frontend assets
app.use(express.static(path.resolve(__dirname, '../public')));

// Fallback to index.html for SPA client-side routes
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

// Boot Database, Seed, Worker and Server
async function startServer() {
  try {
    await initDb();
    await seedData();
    startNotificationWorker(60);

    server.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 CarromX Platform running on http://localhost:${PORT}`);
      console.log(`📡 WebSocket Gateway ready for live score sync`);
      console.log(`🔔 Background Worker active for 10-minute pre-match alerts`);
      console.log(`====================================================`);
    });
  } catch (err) {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  }
}

startServer();
