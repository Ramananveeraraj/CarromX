/**
 * CarromX - Single Application Frontend Engine
 * Dynamic Roles, Real-Time Sync, Automated Fixtures & Referee Score Sheet
 */

let currentUser = null;
let currentToken = localStorage.getItem('carromx_token') || null;
let activeRole = localStorage.getItem('carromx_role') || 'player';
let ws = null;
let currentTournamentId = 'trn_blr_open_2026';
let activeFixtureId = null;
let activeSetNumber = 1;
let currentDragSource = null;
let workerCountdown = 60;

// Initialize on document ready
document.addEventListener('DOMContentLoaded', async () => {
  initColorTheme();
  setupWebSocket();
  setupServiceWorker();
  await restoreSession();
  await loadInitialView();
  startWorkerCountdownTimer();
});

/**
 * Color Theme Engine (Light Purple / Lavender Royale vs Midnight Dark)
 */
function initColorTheme() {
  const savedTheme = localStorage.getItem('carromx_theme') || 'emerald-gold';
  applyColorTheme(savedTheme);
}

function applyColorTheme(theme) {
  const body = document.body;
  const label = document.getElementById('themeToggleLabel');
  const btn = document.getElementById('themeToggleBtn');

  // Clear previous theme classes
  body.classList.remove('theme-light-purple', 'theme-midnight-dark', 'theme-emerald-gold');

  if (theme === 'dark') {
    body.classList.add('theme-midnight-dark');
    if (label) label.innerText = 'Classic Carrom';
    if (btn) {
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-200 transition text-xs font-bold shadow-sm';
      btn.innerHTML = `<i class="fa-solid fa-moon text-amber-400"></i> <span id="themeToggleLabel" class="hidden sm:inline">Classic Dark</span>`;
    }
    localStorage.setItem('carromx_theme', 'dark');
  } else if (theme === 'light-purple') {
    body.classList.add('theme-light-purple');
    if (label) label.innerText = 'Light Purple';
    if (btn) {
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 transition text-xs font-bold shadow-sm';
      btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles text-purple-600"></i> <span id="themeToggleLabel" class="hidden sm:inline">Light Purple</span>`;
    }
    localStorage.setItem('carromx_theme', 'light-purple');
  } else {
    // Default: emerald-gold
    body.classList.add('theme-emerald-gold');
    if (label) label.innerText = 'Emerald & Gold';
    if (btn) {
      btn.className = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-amber-500/40 bg-emerald-950/80 hover:bg-emerald-900 text-amber-300 transition text-xs font-bold shadow-sm';
      btn.innerHTML = `<i class="fa-solid fa-gem text-emerald-400"></i> <span id="themeToggleLabel" class="hidden sm:inline">Emerald & Gold</span>`;
    }
    localStorage.setItem('carromx_theme', 'emerald-gold');
  }
}

function toggleColorTheme() {
  const current = localStorage.getItem('carromx_theme') || 'emerald-gold';
  let nextTheme = 'emerald-gold';
  let themeName = '🏆 Switched to Emerald Green & Gold Theme!';

  if (current === 'emerald-gold') {
    nextTheme = 'dark';
    themeName = '🪵 Switched to Classic Carrom Wood & Slate Theme!';
  } else if (current === 'dark') {
    nextTheme = 'light-purple';
    themeName = '✨ Switched to Light Purple (Lavender) Theme!';
  } else {
    nextTheme = 'emerald-gold';
    themeName = '🏆 Switched to Emerald Green & Gold Theme!';
  }

  applyColorTheme(nextTheme);
  playStrikerSound();
  showToastNotification(themeName);
}

/**
 * Ensure user has an active token; if missing, auto-initialize organizer profile for rapid zero-friction testing
 */
async function ensureOrganizerAuthToken() {
  if (currentToken && currentUser) {
    return currentToken;
  }
  try {
    const demoRes = await fetch('/api/auth/demo-users');
    if (demoRes.ok) {
      const demoData = await demoRes.json();
      const orgProfile = (demoData.demoProfiles || []).find(d => d.role === 'organizer') || (demoData.demoProfiles || [])[0];
      if (orgProfile) {
        currentToken = orgProfile.token;
        currentUser = {
          userId: orgProfile.userId,
          fullName: orgProfile.fullName,
          phoneNumber: orgProfile.phoneNumber,
          email: orgProfile.email,
          role: orgProfile.role,
          activeRole: orgProfile.role
        };
        activeRole = orgProfile.role;
        localStorage.setItem('carromx_token', currentToken);
        localStorage.setItem('carromx_role', activeRole);
        updateHeaderProfile();
        return currentToken;
      }
    }
  } catch (e) {
    console.warn('ensureOrganizerAuthToken error:', e);
  }
  return currentToken;
}

/**
 * Restore user session from token
 */
async function restoreSession() {
  if (currentToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${currentToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        activeRole = currentUser.role || activeRole;
      } else {
        localStorage.removeItem('carromx_token');
        currentToken = null;
        currentUser = null;
      }
    } catch (e) {
      console.warn('Session check error:', e);
    }
  }

  // Auto-fallback to organizer if not signed in so buttons always work out-of-the-box
  if (!currentToken || !currentUser) {
    await ensureOrganizerAuthToken();
  }

  updateHeaderProfile();
}

/**
 * Setup WebSocket for real-time live events
 */
function setupWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      document.getElementById('wsStatusDot').className = 'w-2 h-2 rounded-full bg-emerald-500 live-pulse';
      document.getElementById('wsStatusText').innerText = 'Live Sync Active';
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleRealtimeEvent(data);
      } catch (err) {
        console.error('WS Parse Error:', err);
      }
    };

    ws.onclose = () => {
      document.getElementById('wsStatusDot').className = 'w-2 h-2 rounded-full bg-amber-500';
      document.getElementById('wsStatusText').innerText = 'Reconnecting...';
      setTimeout(setupWebSocket, 3000);
    };

    ws.onerror = () => {
      document.getElementById('wsStatusDot').className = 'w-2 h-2 rounded-full bg-red-500';
    };
  } catch (err) {
    console.error('WS init failed:', err);
  }
}

/**
 * Handle incoming real-time socket events
 */
function handleRealtimeEvent(event) {
  console.log('Realtime Event:', event);

  if (event.type === 'PRE_MATCH_NOTIFICATION') {
    // 10-minute pre-match push alert!
    triggerNotificationAlert(event);
  } else if (event.type === 'SPECTATOR_REACTION') {
    // Floating crowd cheering emoji
    showFloatingReaction(event.emoji);
  } else if (event.type === 'SHOT_CLOCK_SYNC') {
    // Live shot clock timer sync across spectator screens
    if (activeFixtureId === event.fixtureId) {
      applyRemoteShotClock(event.timeLeft, event.isRunning);
    }
  } else if (event.type === 'BOARD_COINS_SYNC') {
    // Real-time board visualizer coins sync
    if (activeFixtureId === event.fixtureId) {
      applyRemoteBoardCoins(event.whiteCoins, event.blackCoins, event.queenState, event.fouls);
    }
  } else if (event.type === 'DISPUTE_RAISED') {
    triggerNotificationAlert({
      message: `⚠️ Live Match Dispute Raised: "${event.reason}" in ${event.tournamentTitle || 'Match'}. Help Desk Review Required!`
    });
    if (document.getElementById('view-tournament-detail').classList.contains('hidden') === false) {
      loadTournamentDetailData(currentTournamentId);
    }
  } else if (event.type === 'DISPUTE_RESOLVED') {
    triggerNotificationAlert({
      message: `✓ Dispute Resolved: ${event.notes}`
    });
    if (activeFixtureId === event.fixtureId) {
      loadRefereeFixtureScore(event.fixtureId);
    }
  } else if (event.type === 'SCORE_UPDATE') {
    if (activeFixtureId === event.fixtureId) {
      renderScoreboardNumbers(event.player_1_points, event.player_2_points);
    }
    // Refresh tournament fixtures if open
    if (document.getElementById('view-tournament-detail').classList.contains('hidden') === false) {
      loadTournamentDetailData(currentTournamentId);
    }
  } else if (event.type === 'SET_LOCKED' || event.type === 'ORGANIZER_SCORE_OVERRIDE') {
    if (activeFixtureId === event.fixtureId) {
      loadRefereeFixtureScore(event.fixtureId);
    }
    if (document.getElementById('view-tournament-detail').classList.contains('hidden') === false) {
      loadTournamentDetailData(currentTournamentId);
    }
  } else if (event.type === 'OFFICIAL_SCORE_SHEET_UPDATE') {
    if (activeFixtureId === event.fixtureId && currentScoreSheetData) {
      currentScoreSheetData = event.sheet;
      renderOfficialScoreSheet(currentScoreSheetFixture, currentScoreSheetData, currentScoreSheetCanEdit);
    }
    if (document.getElementById('view-tournament-detail')?.classList.contains('hidden') === false) {
      loadTournamentDetailData(currentTournamentId);
    }
  }
}

/**
 * Register Service Worker for Web Push
 */
function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW register failed:', err));
  }
}

/**
 * Navigation Router
 */
function navigateTo(viewName) {
  // Normalize legacy helpdesk to superadmin
  if (viewName === 'helpdesk') viewName = 'superadmin';

  const views = ['tournaments', 'tournament-detail', 'organizer', 'scoreboard', 'scoresheet', 'playerentry', 'superadmin', 'player', 'worker', 'pmboard'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
    const navBtn = document.getElementById(`nav-${v}`);
    if (navBtn) navBtn.classList.remove('bg-amber-600', 'text-white');
  });

  const activeView = document.getElementById(`view-${viewName}`);
  if (activeView) activeView.classList.remove('hidden');

  const activeNavBtn = document.getElementById(`nav-${viewName}`);
  if (activeNavBtn) activeNavBtn.classList.add('bg-amber-600', 'text-white');

  // Trigger view data refresh
  if (viewName === 'tournaments') { fetchTournaments(); updateRoleNavigation(); }
  if (viewName === 'organizer') loadOrganizerSuite();
  if (viewName === 'scoreboard') loadRefereeScoreSheet();
  if (viewName === 'scoresheet') loadOfficialScoreSheet(activeFixtureId);
  if (viewName === 'playerentry') loadPlayerEntryView();
  if (viewName === 'superadmin') loadSuperAdminSuite();
  if (viewName === 'player') loadPlayerSchedule();
  if (viewName === 'worker') loadWorkerDashboard();
}

async function loadInitialView() {
  const urlParams = new URLSearchParams(window.location.search);
  const openTourId = urlParams.get('open');
  if (openTourId) {
    viewTournamentDetail(openTourId);
  } else {
    navigateTo('tournaments');
  }
}

/**
 * Header Profile & Role Indicators
 */
function updateHeaderProfile() {
  const normRole = (currentUser?.role === 'super_admin' || currentUser?.role === 'help_desk') ? 'super_admin'
    : (currentUser?.role === 'organizer' || currentUser?.role === 'organiser') ? 'organizer'
    : 'player';

  activeRole = normRole;

  const authContainer = document.getElementById('authContainer');
  if (authContainer) {
    if (currentUser) {
      let roleBadgeHtml = '';
      if (normRole === 'super_admin') {
        roleBadgeHtml = `<span class="px-2.5 py-1 rounded-xl text-[10px] font-black uppercase bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm flex items-center gap-1"><i class="fa-solid fa-crown text-purple-400"></i> Super Admin</span>`;
      } else if (normRole === 'organizer') {
        roleBadgeHtml = `<span class="px-2.5 py-1 rounded-xl text-[10px] font-black uppercase bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm flex items-center gap-1"><i class="fa-solid fa-folder-open text-blue-400"></i> Organiser</span>`;
      } else {
        roleBadgeHtml = `<span class="px-2.5 py-1 rounded-xl text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm flex items-center gap-1"><i class="fa-solid fa-bullseye text-amber-400"></i> Player</span>`;
      }

      authContainer.innerHTML = `
        <div class="flex items-center gap-2">
          ${roleBadgeHtml}
          <div class="text-right hidden sm:block">
            <div class="text-xs font-bold text-white leading-tight">${escapeHtml(currentUser.fullName)}</div>
            <div class="text-[10px] text-slate-400 font-mono leading-tight">${escapeHtml(currentUser.phoneNumber)}</div>
          </div>
          <button onclick="logout()" class="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 hover:text-rose-300 text-xs transition border border-slate-700 shadow flex items-center gap-1.5" title="Sign Out">
            <i class="fa-solid fa-right-from-bracket"></i>
            <span class="font-semibold hidden sm:inline">Sign Out</span>
          </button>
        </div>
      `;
    } else {
      authContainer.innerHTML = `
        <button onclick="openAuthModal()" class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold text-xs transition shadow-md flex items-center gap-1.5">
          <i class="fa-solid fa-right-to-bracket"></i> Sign In / Register
        </button>
      `;
    }
  }

  // Update Player Card if on player schedule
  const cardName = document.getElementById('playerCardName');
  const cardPhone = document.getElementById('playerCardPhone');
  if (cardName && currentUser) cardName.innerText = currentUser.fullName;
  if (cardPhone && currentUser) cardPhone.innerText = currentUser.phoneNumber;

  updateRoleNavigation();
}

/**
 * Context-Aware Role Navigation Toggler
 * Strict 3-Role Access:
 * - Super Admin: Global overview + overrides across all tournaments
 * - Organiser: View all tournaments, manage ONLY own tournaments
 * - Player: Browse tournaments, register, see schedule & read-only score sheets
 */
function updateRoleNavigation() {
  const normRole = (currentUser?.role === 'super_admin' || currentUser?.role === 'help_desk') ? 'super_admin'
    : (currentUser?.role === 'organizer' || currentUser?.role === 'organiser') ? 'organizer'
    : 'player';

  // Desktop navigation items
  const navTournaments = document.getElementById('nav-tournaments');
  const navMyTournaments = document.getElementById('nav-my-tournaments');
  const navOrganizer = document.getElementById('nav-organizer');
  const navPlayerEntry = document.getElementById('nav-playerentry');
  const navScoreSheet = document.getElementById('nav-scoresheet');
  const navSuperAdmin = document.getElementById('nav-superadmin');
  const navPlayer = document.getElementById('nav-player');

  // Mobile navigation items
  const mNavContext = document.getElementById('mNavContext');
  const mNavContextIcon = document.getElementById('mNavContextIcon');
  const mNavContextText = document.getElementById('mNavContextText');

  if (normRole === 'super_admin') {
    navTournaments?.classList.remove('hidden');
    navMyTournaments?.classList.add('hidden');
    navOrganizer?.classList.remove('hidden');
    navPlayerEntry?.classList.remove('hidden');
    navScoreSheet?.classList.remove('hidden');
    navSuperAdmin?.classList.remove('hidden');
    navPlayer?.classList.add('hidden');

    if (mNavContextIcon) mNavContextIcon.className = 'fa-solid fa-crown text-sm text-purple-400';
    if (mNavContextText) mNavContextText.innerText = 'Admin';
  } else if (normRole === 'organizer') {
    navTournaments?.classList.remove('hidden');
    navMyTournaments?.classList.remove('hidden');
    navOrganizer?.classList.remove('hidden');
    navPlayerEntry?.classList.remove('hidden');
    navScoreSheet?.classList.remove('hidden');
    navSuperAdmin?.classList.add('hidden');
    navPlayer?.classList.add('hidden');

    if (mNavContextIcon) mNavContextIcon.className = 'fa-solid fa-shuffle text-sm text-blue-400';
    if (mNavContextText) mNavContextText.innerText = 'Fixtures';
  } else {
    // Player
    navTournaments?.classList.remove('hidden');
    navMyTournaments?.classList.add('hidden');
    navOrganizer?.classList.add('hidden');
    navPlayerEntry?.classList.add('hidden');
    navScoreSheet?.classList.remove('hidden');
    navSuperAdmin?.classList.add('hidden');
    navPlayer?.classList.remove('hidden');

    if (mNavContextIcon) mNavContextIcon.className = 'fa-solid fa-user-check text-sm text-amber-400';
    if (mNavContextText) mNavContextText.innerText = 'My Matches';
  }
}

/**
 * Filter My Tournaments (Organiser Ownership View)
 */
async function filterMyTournaments() {
  navigateTo('tournaments');
  if (!currentUser) return;
  try {
    const res = await fetch('/api/tournaments');
    const data = await res.json();
    const myTournaments = (data.tournaments || []).filter(t => t.organizer_id === currentUser.userId);
    renderTournamentsGrid(myTournaments);
    showToastNotification(`Showing ${myTournaments.length} tournament(s) owned by you (${currentUser.fullName})`);
  } catch (e) {
    console.error('Filter my tournaments error:', e);
  }
}

/**
 * Handle Mobile Bottom Nav Context Button
 */
function handleMobileContextNav() {
  const normRole = (currentUser?.role === 'super_admin' || currentUser?.role === 'help_desk') ? 'super_admin'
    : (currentUser?.role === 'organizer' || currentUser?.role === 'organiser') ? 'organizer'
    : 'player';

  if (normRole === 'super_admin') {
    navigateTo('superadmin');
  } else if (normRole === 'organizer') {
    navigateTo('organizer');
  } else {
    navigateTo('player');
  }
}

function toggleRoleDropdown() {
  const dd = document.getElementById('roleDropdown');
  if (dd) dd.classList.toggle('hidden');
}

/**
 * Dynamic Role Switcher
 */
async function switchRole(newRole) {
  activeRole = newRole;
  localStorage.setItem('carromx_role', newRole);
  const dd = document.getElementById('roleDropdown');
  if (dd) dd.classList.add('hidden');

  if (currentToken) {
    try {
      const res = await fetch('/api/auth/switch-role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ role: newRole })
      });
      if (res.ok) {
        const data = await res.json();
        currentToken = data.token;
        localStorage.setItem('carromx_token', currentToken);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  updateHeaderProfile();
  playStrikerSound();

  if (newRole === 'organizer' || newRole === 'organiser') navigateTo('organizer');
  else if (newRole === 'super_admin' || newRole === 'help_desk') navigateTo('superadmin');
  else navigateTo('player');
}

/**
 * Demo Login Helper: Seamless 1-Click Role Verification & Preview
 */
async function loginAsDemo(userId) {
  try {
    const res = await fetch('/api/auth/demo-users');
    const data = await res.json();
    const demo = data.demoProfiles.find(d => d.userId === userId);
    if (demo) {
      currentToken = demo.token;
      currentUser = {
        userId: demo.userId,
        fullName: demo.fullName,
        phoneNumber: demo.phoneNumber,
        email: demo.email,
        role: demo.role,
        activeRole: demo.role
      };
      activeRole = demo.role;
      localStorage.setItem('carromx_token', currentToken);
      localStorage.setItem('carromx_role', activeRole);
      updateHeaderProfile();
      playStrikerSound();

      navigateTo('tournaments');
      showToastNotification(`Signed in as ${demo.roleTitle}: ${demo.fullName}`);
    }
  } catch (err) {
    console.error('Demo login error:', err);
  }
}

function logout() {
  localStorage.removeItem('carromx_token');
  localStorage.removeItem('carromx_role');
  currentToken = null;
  currentUser = null;
  activeRole = 'player';
  updateHeaderProfile();
  navigateTo('tournaments');
  showToastNotification('You have signed out successfully.');
}

// -------------------------------------------------------------
// VIEW 1: TOURNAMENTS EXPLORER
// -------------------------------------------------------------

let allTournaments = [];

async function fetchTournaments() {
  try {
    const res = await fetch('/api/tournaments');
    const data = await res.json();
    allTournaments = data.tournaments || [];
    renderTournamentsGrid(allTournaments);
  } catch (err) {
    console.error('Error fetching tournaments:', err);
  }
}

function filterTournaments(status) {
  document.querySelectorAll('.tour-filter').forEach(b => b.classList.remove('bg-amber-600', 'text-white'));
  event.target.classList.add('bg-amber-600', 'text-white');

  if (status === 'all') {
    renderTournamentsGrid(allTournaments);
  } else {
    const filtered = allTournaments.filter(t => t.status === status);
    renderTournamentsGrid(filtered);
  }
}

function renderTournamentsGrid(tournaments) {
  const container = document.getElementById('tournamentsGrid');
  if (!container) return;

  if (tournaments.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-500">
        <i class="fa-solid fa-trophy text-4xl mb-3 text-slate-600"></i>
        <p class="text-sm">No tournaments found in this category.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = tournaments.map(t => {
    const isVerified = Boolean(t.verified_by_helpdesk);
    const statusColor = t.status === 'ongoing' ? 'emerald' : t.status === 'published' ? 'blue' : 'amber';

    return `
      <div class="rounded-2xl bg-slate-900 border border-slate-800 hover:border-amber-800/60 overflow-hidden shadow-xl transition-all duration-200 flex flex-col group">
        <div class="relative h-44 overflow-hidden">
          <img src="${t.banner_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80'}" alt="${t.title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
          <div class="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent"></div>
          
          <div class="absolute top-3 left-3 flex flex-wrap gap-1.5">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-${statusColor}-500/20 text-${statusColor}-400 border border-${statusColor}-500/40 backdrop-blur">
              ${t.status.replace('_', ' ')}
            </span>
            ${isVerified ? `
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 backdrop-blur flex items-center gap-1">
                <i class="fa-solid fa-certificate text-amber-400"></i> Verified
              </span>
            ` : `
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800/80 text-slate-400 border border-slate-700 backdrop-blur">
                <i class="fa-solid fa-clock"></i> Pending Review
              </span>
            `}
          </div>

          <div class="absolute bottom-3 left-3 right-3">
            <div class="text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-0.5">${t.format.replace('_', ' ')} &bull; ${t.total_boards} Boards</div>
            <h3 class="text-base font-bold text-white line-clamp-1 leading-snug">${t.title}</h3>
          </div>
        </div>

        <div class="p-4 flex-1 flex flex-col justify-between space-y-4">
          <div class="space-y-2 text-xs text-slate-300">
            <div class="flex items-start gap-2 text-slate-400">
              <i class="fa-solid fa-location-dot mt-0.5 text-amber-500"></i>
              <span class="line-clamp-2">${t.venue_address}</span>
            </div>
            <div class="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800 text-slate-400">
              <span>Rules: ${t.total_sets} Sets / ${t.max_points_per_set} Pts</span>
              <span>Approved: <strong class="text-emerald-400">${t.approved_participant_count || 0}</strong></span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
            <div>
              <span class="text-[10px] text-slate-400 block">Entry Fee</span>
              <span class="text-base font-extrabold text-amber-400">₹${t.entry_fee}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <a href="/tournament/${t.tournament_id}" target="_blank" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs" title="Open SEO Landing Page">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
              <button onclick="viewTournamentDetail('${t.tournament_id}')" class="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow transition">
                View Fixtures
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * View Tournament Details & Full Interactive Fixtures Bracket
 */
async function viewTournamentDetail(tournamentId) {
  currentTournamentId = tournamentId;
  navigateTo('tournament-detail');

  const content = document.getElementById('tournamentDetailContent');
  content.innerHTML = `
    <div class="py-12 text-center text-slate-400">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl mb-2 text-amber-500"></i>
      <p class="text-xs">Loading tournament fixtures and boards...</p>
    </div>
  `;

  await loadTournamentDetailData(tournamentId);
}

async function loadTournamentDetailData(tournamentId) {
  try {
    const res = await fetch(`/api/tournaments/${tournamentId}`);
    if (!res.ok) throw new Error('Tournament not found');
    const data = await res.json();
    const t = data.tournament;
    const boards = data.boards || [];
    const participants = data.participants || [];
    const fixtures = data.fixtures || [];

    // Fetch live standings & points table
    let standings = [];
    try {
      const standRes = await fetch(`/api/tournaments/${tournamentId}/standings`);
      if (standRes.ok) {
        const standData = await standRes.json();
        standings = standData.standings || [];
      }
    } catch (e) {
      console.warn('Could not load standings:', e);
    }

    const isVerified = Boolean(t.verified_by_helpdesk);
    const isSuperAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'help_desk';
    const isOwner = currentUser && (t.organizer_id === currentUser.userId);
    const canManageTournament = isSuperAdmin || isOwner;

    const content = document.getElementById('tournamentDetailContent');
    content.innerHTML = `
      <!-- Tournament Header Banner -->
      <div class="rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-xl space-y-4">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
                ${t.status.replace('_', ' ')}
              </span>
              ${canManageTournament ? `
                <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-500/20 text-blue-300 border border-blue-500/40 flex items-center gap-1 shadow-sm">
                  <i class="fa-solid fa-shield-halved text-blue-400"></i> ${isSuperAdmin ? 'Super Admin Master Access' : 'You Own This Tournament'}
                </span>
              ` : `
                <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800/80 text-slate-400 border border-slate-700">
                  Host: ${escapeHtml(t.organizer_name || 'Tournament Official')}
                </span>
              `}
              ${isVerified ? `
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center gap-1">
                  <i class="fa-solid fa-certificate"></i> Help Desk Verified
                </span>
              ` : `
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
                  Pending Verification
                </span>
              `}
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                ${t.format.replace('_', ' ')}
              </span>
            </div>
            <h1 class="text-2xl md:text-3xl font-extrabold text-white">${t.title}</h1>
            <p class="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <i class="fa-solid fa-location-dot text-amber-500"></i> ${t.venue_address}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            ${canManageTournament ? `
              <button onclick="currentTournamentId = '${t.tournament_id}'; navigateTo('organizer');" class="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg transition flex items-center gap-1.5" title="Manage Boards, Paired Matches and Scores">
                <i class="fa-solid fa-shuffle"></i> Manage Fixtures
              </button>
              <button onclick="currentTournamentId = '${t.tournament_id}'; navigateTo('playerentry');" class="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs shadow-lg transition flex items-center gap-1.5" title="Add Players Directly to this Roster">
                <i class="fa-solid fa-user-plus"></i> Add Players
              </button>
            ` : ''}
            <button onclick="openRegisterModal('${t.tournament_id}', '${t.entry_fee}', '${escapeHtml(t.organizer_name || 'Organiser')}', '${escapeHtml(t.organizer_phone || '')}')" class="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold text-xs shadow-lg transition flex items-center gap-2">
              <i class="fa-solid fa-ticket"></i> Apply / Contact Organiser
            </button>
            <a href="/tournament/${t.tournament_id}" target="_blank" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition" title="Public Web Landing Page">
              <i class="fa-solid fa-globe mr-1"></i> Public Page
            </a>
          </div>
        </div>

        <!-- Rules & Specs Pill Bar -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800 text-xs">
          <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <div class="text-[10px] text-slate-400 uppercase">Physical Boards</div>
            <div class="font-bold text-slate-200 mt-0.5">${t.total_boards} Active Boards</div>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <div class="text-[10px] text-slate-400 uppercase">Points Limit</div>
            <div class="font-bold text-slate-200 mt-0.5">${t.max_points_per_set} Pts / Set</div>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <div class="text-[10px] text-slate-400 uppercase">Boards Limit</div>
            <div class="font-bold text-slate-200 mt-0.5">${t.boards_per_set} Boards / Set</div>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
            <div class="text-[10px] text-slate-400 uppercase">Match Format</div>
            <div class="font-bold text-amber-400 mt-0.5">Best of ${t.total_sets} Sets</div>
          </div>
        </div>
      </div>

      <!-- Live Match Fixtures & Brackets Section -->
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-chess-board text-amber-500"></i> Match Fixtures & Board Allocations (${fixtures.length})
          </h2>
          <div class="flex items-center gap-2">
            ${fixtures.length > 0 ? `
              <button onclick="openPrintableFixturesModal('${t.tournament_id}')" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white text-xs font-bold transition flex items-center gap-1.5 shadow" title="Download Official Fixtures PDF">
                <i class="fa-solid fa-file-pdf"></i> Download PDF
              </button>
              <button onclick="shareFixturesWhatsApp('${t.tournament_id}')" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow" title="Share Match Schedule via WhatsApp">
                <i class="fa-brands fa-whatsapp text-sm"></i> Share WhatsApp
              </button>
            ` : ''}
            <span class="text-xs text-slate-400">Real-time sync enabled</span>
          </div>
        </div>

        ${fixtures.length === 0 ? `
          <div class="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-400">
            <i class="fa-solid fa-calendar-xmark text-3xl mb-2 text-slate-600"></i>
            <p class="text-xs">No fixtures generated yet. Organizer will generate fixtures after participant verification.</p>
          </div>
        ` : `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${fixtures.map(f => renderFixtureCard(f, t)).join('')}
          </div>
        `}
      </div>

      <!-- Live Standings & Points Table -->
      <div class="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-ranking-star text-amber-500"></i> Live Standings & Points Table
          </h2>
          <span class="text-xs text-slate-400">ICF 2-Point Win Rule | Diff Tie-Break</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                <th class="py-2.5 px-3">Rank</th>
                <th class="py-2.5 px-3">Player</th>
                <th class="py-2.5 px-3 text-center">Played</th>
                <th class="py-2.5 px-3 text-center">Won</th>
                <th class="py-2.5 px-3 text-center">Lost</th>
                <th class="py-2.5 px-3 text-center">Sets (W-L)</th>
                <th class="py-2.5 px-3 text-center">Score Diff</th>
                <th class="py-2.5 px-3 text-right font-black text-amber-400">PTS</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/60 text-slate-200">
              ${standings.length === 0 ? `
                <tr><td colspan="8" class="py-6 text-center text-slate-500">No standings data available yet.</td></tr>
              ` : standings.map((s, idx) => `
                <tr class="hover:bg-slate-800/40 transition ${idx === 0 ? 'bg-amber-500/5' : ''}">
                  <td class="py-2.5 px-3">
                    <span class="w-6 h-6 rounded-full inline-flex items-center justify-center font-bold text-xs ${
                      idx === 0 ? 'bg-amber-500 text-slate-950 font-black' :
                      idx === 1 ? 'bg-slate-400 text-slate-950 font-bold' :
                      idx === 2 ? 'bg-amber-700 text-white font-bold' : 'bg-slate-800 text-slate-400'
                    }">${idx + 1}</span>
                  </td>
                  <td class="py-2.5 px-3">
                    <div class="font-bold text-white flex items-center gap-1.5">
                      ${s.fullName}
                      ${idx === 0 ? '<i class="fa-solid fa-crown text-amber-400 text-xs"></i>' : ''}
                    </div>
                    <div class="text-[10px] text-slate-500">Seed #${s.seedRank || 'N/A'}</div>
                  </td>
                  <td class="py-2.5 px-3 text-center font-mono font-semibold">${s.played}</td>
                  <td class="py-2.5 px-3 text-center font-mono text-emerald-400 font-bold">${s.won}</td>
                  <td class="py-2.5 px-3 text-center font-mono text-slate-400">${s.lost}</td>
                  <td class="py-2.5 px-3 text-center font-mono text-slate-300">${s.setsWon}-${s.setsLost}</td>
                  <td class="py-2.5 px-3 text-center font-mono font-bold ${s.pointsDiff >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                    ${s.pointsDiff > 0 ? '+' : ''}${s.pointsDiff}
                  </td>
                  <td class="py-2.5 px-3 text-right font-black font-mono text-amber-400 text-base">
                    ${s.tablePoints}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Approved Participants -->
      <div class="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <i class="fa-solid fa-users text-amber-500"></i> Registered Participants (${participants.length})
        </h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
          ${participants.map(p => `
            <div class="p-3 rounded-xl bg-slate-950 border ${p.payment_status === 'approved' ? 'border-emerald-500/30' : 'border-amber-500/30'} flex items-center justify-between">
              <div>
                <div class="font-bold text-white">${p.full_name}</div>
                <div class="text-[10px] text-slate-400">Seed #${p.seeding_rank || 'N/A'}</div>
              </div>
              <span class="text-[10px] px-2 py-0.5 rounded font-bold uppercase ${p.payment_status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}">
                ${p.payment_status}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error loading tournament details:', err);
  }
}

/**
 * Fixture Card HTML Renderer
 */
function renderFixtureCard(f, tournament) {
  const isLive = f.match_status === 'live';
  const isCompleted = f.match_status === 'completed';
  const timeStr = new Date(f.scheduled_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return `
    <div class="rounded-xl bg-slate-900 border ${isLive ? 'border-amber-500/80 shadow-amber-900/20 shadow-lg' : 'border-slate-800'} p-4 space-y-3 relative overflow-hidden">
      ${isLive ? '<div class="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600"></div>' : ''}
      
      <div class="flex items-center justify-between text-xs">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono font-bold text-[10px]">
            Board #${f.board_number || 'TBA'}
          </span>
          <span class="text-[10px] text-slate-400">Round ${f.round_number} &bull; ${timeStr}</span>
        </div>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
          isLive ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
          isCompleted ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
        }">
          ${isLive ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block mr-1 live-pulse"></span> LIVE' : f.match_status}
        </span>
      </div>

      <!-- Players Battle Card -->
      <div class="space-y-2">
        <div class="p-2.5 rounded-lg bg-slate-950/80 flex items-center justify-between border border-slate-800/80 ${f.winner_name === f.player_1_name ? 'border-amber-500/40 bg-amber-950/10' : ''}">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-slate-800 text-slate-300 text-[10px] flex items-center justify-center font-bold">1</span>
            <span class="text-xs font-bold text-white">${f.player_1_name || 'TBD'}</span>
            ${f.winner_name === f.player_1_name ? '<i class="fa-solid fa-crown text-amber-400 text-xs ml-1"></i>' : ''}
          </div>
        </div>

        <div class="p-2.5 rounded-lg bg-slate-950/80 flex items-center justify-between border border-slate-800/80 ${f.winner_name === f.player_2_name ? 'border-amber-500/40 bg-amber-950/10' : ''}">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-slate-800 text-slate-300 text-[10px] flex items-center justify-center font-bold">2</span>
            <span class="text-xs font-bold text-white">${f.player_2_name || 'TBD'}</span>
            ${f.winner_name === f.player_2_name ? '<i class="fa-solid fa-crown text-amber-400 text-xs ml-1"></i>' : ''}
          </div>
        </div>
      </div>

      <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <div>
          <i class="fa-solid fa-user-tie mr-1 text-slate-500"></i>
          <span>Referee: ${f.referee_name || 'Official Assigner'}</span>
        </div>
        <button onclick="openOfficialScoreSheet('${f.fixture_id}')" class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold text-[11px] transition shadow flex items-center gap-1.5">
          <i class="fa-solid fa-file-invoice"></i> Score Sheet <i class="fa-solid fa-chevron-right ml-0.5"></i>
        </button>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// VIEW 2: ORGANIZER OPERATIONS SUITE
// -------------------------------------------------------------

async function loadOrganizerSuite() {
  await populateOrganizerTournamentSelect();
  await loadOrganizerTournamentData();
}

async function populateOrganizerTournamentSelect() {
  const sel = document.getElementById('organizerTournamentSelect');
  if (!sel) return;

  const res = await fetch('/api/tournaments');
  const data = await res.json();
  let list = data.tournaments || [];

  const isSuperAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'help_desk';
  if (!isSuperAdmin && currentUser) {
    const myTournaments = list.filter(t => t.organizer_id === currentUser.userId);
    if (myTournaments.length > 0) {
      list = myTournaments;
    }
  }

  if (list.length === 0) {
    sel.innerHTML = `<option value="">No tournaments available</option>`;
    currentTournamentId = '';
    return;
  }

  sel.innerHTML = list.map(t => `
    <option value="${t.tournament_id}" ${t.tournament_id === currentTournamentId ? 'selected' : ''}>
      ${t.title} (${t.status.toUpperCase()})
    </option>
  `).join('');

  if (!list.some(t => t.tournament_id === currentTournamentId) && list.length > 0) {
    currentTournamentId = list[0].tournament_id;
    sel.value = currentTournamentId;
  }
}

async function loadOrganizerTournamentData() {
  const sel = document.getElementById('organizerTournamentSelect');
  const tourId = sel?.value;

  if (!tourId) {
    document.getElementById('orgPendingPaymentCount').innerText = `0 Pending`;
    document.getElementById('orgFixtureCount').innerText = `0 Matches`;
    const tbody = document.getElementById('orgPaymentsTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400">You have not created any tournaments yet. Click "Create New Tournament" above to start your championship.</td></tr>`;
    const dragContainer = document.getElementById('orgDragSwapContainer');
    if (dragContainer) dragContainer.innerHTML = `<div class="col-span-full p-8 text-center bg-slate-950 border border-slate-800 rounded-2xl text-slate-400">Click "+ Create New Tournament" to set up your boards and fixtures.</div>`;
    return;
  }

  currentTournamentId = tourId;

  try {
    const res = await fetch(`/api/tournaments/${tourId}`);
    const data = await res.json();
    const t = data.tournament;
    const participants = data.participants || [];
    const fixtures = data.fixtures || [];

    // Pending payment count
    const pendingList = participants.filter(p => p.payment_status === 'pending');
    document.getElementById('orgPendingPaymentCount').innerText = `${pendingList.length} Pending`;
    document.getElementById('orgFixtureCount').innerText = `${fixtures.length} Matches`;

    // Cache for quick match editing
    activeTournamentFixtures = fixtures;
    activeTournamentBoards = data.boards || [];
    activeTournamentData = t;

    // Populate tournament timing inputs
    const setTimingSel = document.getElementById('fixturesSetTimingLimit');
    const roundDurationSel = document.getElementById('fixturesRoundDuration');
    const startTimeInput = document.getElementById('fixturesMatchStartTime');
    if (setTimingSel && t.set_time_limit_minutes !== undefined && t.set_time_limit_minutes !== null) {
      setTimingSel.value = String(t.set_time_limit_minutes);
    }
    if (roundDurationSel && t.match_duration_minutes !== undefined && t.match_duration_minutes !== null) {
      roundDurationSel.value = String(t.match_duration_minutes);
    }
    if (startTimeInput) {
      if (fixtures.length > 0 && fixtures[0].scheduled_start_time) {
        startTimeInput.value = formatDateTimeLocal(fixtures[0].scheduled_start_time);
      } else if (!startTimeInput.value) {
        startTimeInput.value = formatDateTimeLocal(new Date(Date.now() + 10 * 60 * 1000));
      }
    }

    // Render payments table
    renderOrganizerPaymentsTable(pendingList);

    // Render Drag and Swap Fixtures
    renderOrganizerDragSwapFixtures(fixtures, tourId);
  } catch (err) {
    console.error('Error loading organizer data:', err);
  }
}

function renderOrganizerPaymentsTable(pendingList) {
  const tbody = document.getElementById('orgPaymentsTableBody');
  if (!tbody) return;

  if (pendingList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-6 text-center text-slate-400">
          <i class="fa-solid fa-circle-check text-emerald-400 mr-1.5"></i>
          No pending player applications. All players are approved and ready for fixtures!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pendingList.map(p => `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-2.5 px-3 font-bold text-white flex items-center gap-2">
        <span class="w-6 h-6 rounded-full bg-slate-800 text-amber-400 font-bold text-[10px] flex items-center justify-center">
          ${p.full_name ? p.full_name.charAt(0).toUpperCase() : 'P'}
        </span>
        <span>${escapeHtml(p.full_name)}</span>
      </td>
      <td class="py-2.5 px-3">
        <a href="tel:${p.phone_number}" class="text-emerald-400 hover:text-emerald-300 font-mono font-bold flex items-center gap-1.5" title="Call Player">
          <i class="fa-solid fa-phone text-[10px]"></i>
          <span>${escapeHtml(p.phone_number)}</span>
        </a>
      </td>
      <td class="py-2.5 px-3 font-mono text-amber-300 text-xs">${escapeHtml(p.payment_reference_id || 'Direct GPay / Cash')}</td>
      <td class="py-2.5 px-3 text-slate-400 text-xs">${new Date(p.registered_at).toLocaleString()}</td>
      <td class="py-2.5 px-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase">
          ${p.payment_status}
        </span>
      </td>
      <td class="py-2.5 px-3 text-right space-x-1.5">
        <button onclick="updatePaymentStatus('${p.participant_id}', 'approved')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition inline-flex items-center gap-1">
          <i class="fa-solid fa-check"></i> Approve &amp; Admit
        </button>
        <button onclick="updatePaymentStatus('${p.participant_id}', 'rejected')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-rose-400 hover:text-rose-300 text-xs transition inline-flex items-center gap-1">
          <i class="fa-solid fa-xmark"></i> Decline
        </button>
      </td>
    </tr>
  `).join('');
}

async function updatePaymentStatus(participantId, status) {
  try {
    const res = await fetch(`/api/participants/${participantId}/payment`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({ paymentStatus: status })
    });
    if (res.ok) {
      playStrikerSound();
      showToastNotification(status === 'approved' ? '✓ Player approved & admitted to tournament!' : 'Player application declined.');
      await loadOrganizerTournamentData();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error || 'Failed to update'}`);
    }
  } catch (e) {
    alert(e.message);
  }
}

/**
 * Trigger Automated Fixture Generation Engine
 */
function triggerAutomatedFixtureGeneration() {
  executeDirectRandomShuffle();
}

/**
 * Render Drag-and-Swap Overrides Grid with Direct Score Sheet Access
 */
function renderOrganizerDragSwapFixtures(fixtures, tournamentId) {
  const container = document.getElementById('orgDragSwapContainer');
  if (!container) return;

  if (fixtures.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center bg-slate-950/60 border border-slate-800/80 rounded-2xl p-6 space-y-3">
        <i class="fa-solid fa-chess-board text-4xl text-slate-600 block"></i>
        <p class="font-bold text-white text-sm">No match fixtures generated yet for this tournament.</p>
        <p class="text-xs text-slate-400 max-w-md mx-auto">Make sure you have at least 2 approved players, then click the button below to randomly shuffle match pairings!</p>
        <div class="pt-2 flex items-center justify-center gap-2">
          <button onclick="executeDirectRandomShuffle()" class="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-xs shadow-lg transition flex items-center gap-1.5 active:scale-95">
            <i class="fa-solid fa-shuffle"></i> 🎲 Random Shuffle Draw Now
          </button>
          <button onclick="navigateTo('playerentry')" class="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs shadow transition">
            <i class="fa-solid fa-user-plus mr-1"></i> Add Players Directly
          </button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = fixtures.map((f, idx) => {
    const isBye = !f.player_2_id;
    const isLive = f.match_status === 'live';
    const isCompleted = f.match_status === 'completed';

    if (isBye) {
      return `
        <div class="fixture-card p-4 rounded-xl bg-slate-950/80 border border-emerald-500/30 space-y-2.5">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-emerald-400 flex items-center gap-1">
              <i class="fa-solid fa-forward-step"></i> Match ${idx + 1} &bull; Bye Round
            </span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              ADVANCED ON BYE
            </span>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-slate-800 text-amber-400 text-xs flex items-center justify-center font-bold">1</span>
              <span class="text-xs font-bold text-white">${escapeHtml(f.p1_name || f.player_1_name || 'Player')}</span>
              <i class="fa-solid fa-crown text-amber-400 text-xs ml-1"></i>
            </div>
            <span class="text-[10px] text-emerald-400 font-semibold">Automatic Advance</span>
          </div>
          <p class="text-[11px] text-slate-400">Advances straight to next round without board play.</p>
        </div>
      `;
    }

    return `
      <div class="fixture-card p-4 rounded-xl bg-slate-950 border ${isLive ? 'border-amber-500/80 shadow-amber-900/20 shadow-lg' : 'border-slate-800'} space-y-3 relative overflow-hidden" id="fixture-card-${f.fixture_id}">
        ${isLive ? '<div class="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500"></div>' : ''}

        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-mono font-bold text-[10px]">
              Board #${f.board_number || 1}
            </span>
            <span class="font-bold text-amber-400">Match ${idx + 1} &bull; Round ${f.round_number || 1}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              isLive ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
              isCompleted ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
            }">
              ${isLive ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block mr-1 live-pulse"></span> LIVE' : f.match_status}
            </span>
            <button onclick="openEditMatchTimingModal('${f.fixture_id}')" class="px-2 py-0.5 rounded bg-purple-950/60 hover:bg-purple-900 border border-purple-700/50 text-purple-300 font-mono text-[10px] font-bold flex items-center gap-1 transition" title="Click to edit match timing & board">
              <i class="fa-solid fa-clock text-[9px]"></i>
              <span>${new Date(f.scheduled_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span class="opacity-75">(${f.set_time_limit_minutes || 25}m)</span>
            </button>
          </div>
        </div>

        <!-- Player Slots with HTML5 Drag & Drop -->
        <div class="space-y-2">
          <!-- Player 1 Slot -->
          <div 
            draggable="true" 
            ondragstart="handleDragStart(event, '${f.fixture_id}', 'player_1', '${escapeHtml(f.p1_name || f.player_1_name)}')"
            ondragover="handleDragOver(event)"
            ondragleave="handleDragLeave(event)"
            onddrop="handleDrop(event, '${f.fixture_id}', 'player_1')"
            class="draggable-slot p-2.5 rounded-lg bg-slate-900 border border-slate-700/60 hover:border-amber-500 flex items-center justify-between transition cursor-grab active:cursor-grabbing ${f.winner_name === (f.p1_name || f.player_1_name) ? 'border-amber-500/60 bg-amber-950/20' : ''}"
          >
            <div class="flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-slate-800 text-amber-400 text-[10px] flex items-center justify-center font-bold">1</span>
              <span class="text-xs font-bold text-white">${escapeHtml(f.p1_name || f.player_1_name || 'Player 1')}</span>
              ${f.winner_name === (f.p1_name || f.player_1_name) ? '<i class="fa-solid fa-crown text-amber-400 text-xs ml-1" title="Winner"></i>' : ''}
            </div>
            <span class="text-[10px] text-slate-500 font-mono">Drag to swap</span>
          </div>

          <!-- Player 2 Slot -->
          <div 
            draggable="true" 
            ondragstart="handleDragStart(event, '${f.fixture_id}', 'player_2', '${escapeHtml(f.p2_name || f.player_2_name)}')"
            ondragover="handleDragOver(event)"
            ondragleave="handleDragLeave(event)"
            ondrop="handleDrop(event, '${f.fixture_id}', 'player_2')"
            class="draggable-slot p-2.5 rounded-lg bg-slate-900 border border-slate-700/60 hover:border-amber-500 flex items-center justify-between transition cursor-grab active:cursor-grabbing ${f.winner_name === (f.p2_name || f.player_2_name) ? 'border-amber-500/60 bg-amber-950/20' : ''}"
          >
            <div class="flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-slate-800 text-slate-300 text-[10px] flex items-center justify-center font-bold">2</span>
              <span class="text-xs font-bold text-white">${escapeHtml(f.p2_name || f.player_2_name || 'Player 2')}</span>
              ${f.winner_name === (f.p2_name || f.player_2_name) ? '<i class="fa-solid fa-crown text-amber-400 text-xs ml-1" title="Winner"></i>' : ''}
            </div>
            <span class="text-[10px] text-slate-500 font-mono">Drag to swap</span>
          </div>
        </div>

        <!-- Quick Controls with Direct Score Sheet Access -->
        <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-xs">
          <div class="flex items-center gap-1.5 flex-wrap">
            <button onclick="openEditMatchTimingModal('${f.fixture_id}')" class="px-2.5 py-1.5 rounded-lg bg-purple-950/60 hover:bg-purple-900 text-purple-300 border border-purple-700/40 text-[11px] font-bold transition flex items-center gap-1" title="Edit Match Timing & Assigned Board">
              <i class="fa-solid fa-clock"></i> Time &amp; Board
            </button>
            <button onclick="promptSwapPairings('${f.fixture_id}')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition" title="Swap with another match">
              <i class="fa-solid fa-right-left mr-1"></i> Swap
            </button>
            <button onclick="assignRefereePrompt('${f.fixture_id}')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition" title="Assign Match Referee">
              <i class="fa-solid fa-user-tie mr-1"></i> ${escapeHtml(f.referee_name || 'Ref')}
            </button>
          </div>
          <button onclick="openOfficialScoreSheet('${f.fixture_id}')" class="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-extrabold text-xs shadow transition flex items-center gap-1.5">
            <i class="fa-solid fa-file-invoice"></i> Score Sheet <i class="fa-solid fa-chevron-right text-[10px]"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Drag & Drop Handlers
function handleDragStart(e, fixtureId, slot, playerName) {
  currentDragSource = { fixtureId, slot, playerName };
  e.dataTransfer.setData('text/plain', JSON.stringify(currentDragSource));
  e.target.classList.add('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e, targetFixtureId, targetSlot) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  document.querySelectorAll('.draggable-slot').forEach(el => el.classList.remove('dragging'));

  if (!currentDragSource) return;
  if (currentDragSource.fixtureId === targetFixtureId && currentDragSource.slot === targetSlot) return;

  // Perform API swap
  try {
    const res = await fetch(`/api/tournaments/${currentTournamentId}/fixtures/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({
        swapType: 'players',
        fixtureAId: currentDragSource.fixtureId,
        fixtureBId: targetFixtureId,
        playerASlot: currentDragSource.slot,
        playerBSlot: targetSlot
      })
    });

    const data = await res.json();
    if (res.ok) {
      loadOrganizerTournamentData();
    } else {
      alert(`Swap Error: ${data.error}`);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    currentDragSource = null;
  }
}

async function promptSwapPairings(fixtureAId) {
  const targetFixtureId = prompt('Enter fixture ID to swap boards and scheduled time with:');
  if (!targetFixtureId) return;

  try {
    const res = await fetch(`/api/tournaments/${currentTournamentId}/fixtures/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({
        swapType: 'boards',
        fixtureAId,
        fixtureBId: targetFixtureId
      })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      loadOrganizerTournamentData();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function assignRefereePrompt(fixtureId) {
  const refUserId = prompt('Assign referee to fixture. Enter Referee User ID (Default demo: usr_ref_1 for Suresh Kumar):', 'usr_ref_1');
  if (!refUserId) return;

  try {
    const res = await fetch(`/api/fixtures/${fixtureId}/assign-referee`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({ refereeUserId: refUserId })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      loadOrganizerTournamentData();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// VIEW 3: REFEREE DIGITAL SCORE SHEET & SCORE LOCKING
// -------------------------------------------------------------

async function loadRefereeScoreSheet() {
  await populateRefereeFixtureSelect();
  await loadRefereeFixtureScore();
}

async function populateRefereeFixtureSelect() {
  const sel = document.getElementById('refFixtureSelect');
  if (!sel) return;

  try {
    const res = await fetch(`/api/tournaments/${currentTournamentId}/fixtures`);
    const data = await res.json();
    const fixtures = data.fixtures || [];

    if (fixtures.length === 0) {
      sel.innerHTML = '<option value="">No fixtures found</option>';
      return;
    }

    sel.innerHTML = fixtures.map(f => `
      <option value="${f.fixture_id}" ${f.fixture_id === activeFixtureId ? 'selected' : ''}>
        Board #${f.board_number || 'TBA'}: ${f.player_1_name} vs ${f.player_2_name} (${f.match_status})
      </option>
    `).join('');

    if (!activeFixtureId && fixtures.length > 0) {
      activeFixtureId = fixtures[0].fixture_id;
    }
  } catch (err) {
    console.error('Error in referee fixture select:', err);
  }
}

async function loadRefereeFixtureScore(targetId) {
  const sel = document.getElementById('refFixtureSelect');
  const fixtureId = targetId || (sel ? sel.value : activeFixtureId);
  if (!fixtureId) return;
  activeFixtureId = fixtureId;

  const wrapper = document.getElementById('refereeScoreSheetWrapper');
  wrapper.innerHTML = `
    <div class="py-12 text-center text-slate-400">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-emerald-400 mb-2"></i>
      <p class="text-xs">Loading live digital score sheet...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/fixtures/${fixtureId}/scoreboard`);
    if (!res.ok) throw new Error('Scoreboard data unavailable');
    const data = await res.json();
    const fix = data.fixture;
    const scores = data.scores || [];

    renderRefereeScoreboard(fix, scores);
  } catch (err) {
    wrapper.innerHTML = `<div class="p-6 text-center text-red-400">${err.message}</div>`;
  }
}

function openScoreboardForFixture(fixtureId) {
  openOfficialScoreSheet(fixtureId);
}

function renderRefereeScoreboard(fixture, scores) {
  const wrapper = document.getElementById('refereeScoreSheetWrapper');
  if (!wrapper) return;

  const currentSetScore = scores.find(s => s.set_number === activeSetNumber) || {
    player_1_points: 0,
    player_2_points: 0,
    is_set_completed: 0
  };

  const isSetLocked = Boolean(currentSetScore.is_set_completed);
  const isMatchCompleted = fixture.match_status === 'completed';
  const isOrganizer = activeRole === 'organizer' || activeRole === 'help_desk';

  wrapper.innerHTML = `
    <div class="space-y-6">
      
      <!-- Top Match Banner -->
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Board #${fixture.board_number || 'TBA'}
            </span>
            <span class="text-xs text-slate-400">${fixture.tournament_title}</span>
          </div>
          <h2 class="text-xl md:text-2xl font-black text-white">
            ${fixture.p1_name} <span class="text-amber-500 font-normal">vs</span> ${fixture.p2_name}
          </h2>
          <div class="text-xs text-slate-400 mt-1 flex items-center gap-3">
            <span>Rules: Max ${fixture.max_points_per_set} Pts &bull; ${fixture.boards_per_set} Boards Limit</span>
            <span>Referee: <strong class="text-slate-200">${fixture.referee_name || 'Official Referee'}</strong></span>
          </div>
        </div>

        <!-- Set Selector Tabs -->
        <div class="flex items-center gap-2">
          ${[1, 2, 3].map(setNum => {
            const setObj = scores.find(s => s.set_number === setNum);
            const isCompleted = setObj && Boolean(setObj.is_set_completed);
            return `
              <button onclick="changeActiveSet(${setNum})" class="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                activeSetNumber === setNum
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/40'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }">
                Set ${setNum}
                ${isCompleted ? '<i class="fa-solid fa-lock text-[10px] text-amber-300"></i>' : ''}
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Real-Time Score Locking Alert Box -->
      ${isSetLocked ? `
        <div class="p-4 rounded-xl bg-amber-950/40 border border-amber-600/40 text-amber-300 text-xs flex items-center justify-between">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-lock text-base text-amber-400"></i>
            <div>
              <strong class="font-bold">REAL-TIME SCORE LOCKED:</strong> Set ${activeSetNumber} is officially locked and finalized. Referees cannot modify scores.
            </div>
          </div>
          ${isOrganizer ? `
            <button onclick="openOrganizerOverrideModal(${activeSetNumber}, ${currentSetScore.player_1_points}, ${currentSetScore.player_2_points})" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow transition">
              <i class="fa-solid fa-unlock mr-1"></i> Organizer Override
            </button>
          ` : `
            <span class="text-[10px] text-slate-400 italic">Organizer override required</span>
          `}
        </div>
      ` : ''}

      <!-- Interactive Carrom Board Visualizer & ICF Shot Clock Control Bar -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <!-- Shot Clock Timer -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between items-center text-center space-y-3">
          <div class="flex items-center justify-between w-full text-xs text-slate-400">
            <span class="font-bold text-amber-400"><i class="fa-solid fa-stopwatch mr-1"></i> ICF 15s Shot Clock</span>
            <span class="text-[10px] text-emerald-400 live-pulse">Synced Live</span>
          </div>
          
          <div class="relative w-24 h-24 flex items-center justify-center">
            <svg class="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" stroke="#1e293b" stroke-width="8" fill="none" />
              <circle id="shotClockRing" cx="50" cy="50" r="42" stroke="#10b981" stroke-width="8" stroke-dasharray="264" stroke-dashoffset="0" stroke-linecap="round" fill="none" class="transition-all duration-300" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span id="shotClockSeconds" class="text-3xl font-black font-mono text-white">15</span>
              <span class="text-[9px] uppercase tracking-wider text-slate-400">Sec</span>
            </div>
          </div>

          <!-- Timer Controls -->
          <div class="flex items-center gap-2 w-full">
            <button onclick="toggleShotClock()" id="shotClockToggleBtn" class="flex-1 py-1.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition">
              <i class="fa-solid fa-play mr-1"></i> Start
            </button>
            <button onclick="resetShotClock()" class="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition" title="Reset to 15 seconds">
              <i class="fa-solid fa-rotate-right"></i> 15s
            </button>
          </div>
        </div>

        <!-- Real-Time Board Coins Tracker -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span class="font-bold text-amber-400"><i class="fa-solid fa-bullseye mr-1"></i> Board Coins Tracker</span>
            <span id="boardQueenBadge" class="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">Queen: In Play</span>
          </div>

          <div class="grid grid-cols-2 gap-3 text-center">
            <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div class="text-[10px] text-slate-400 uppercase font-semibold">White Coins (P1)</div>
              <div id="visualWhiteCoins" class="text-2xl font-black text-slate-100 font-mono mt-1">${Math.max(0, 9 - Math.min(9, Math.floor((currentSetScore.player_1_points || 0) / 1)))} <span class="text-xs font-normal text-slate-500">left</span></div>
            </div>
            <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div class="text-[10px] text-slate-400 uppercase font-semibold">Black Coins (P2)</div>
              <div id="visualBlackCoins" class="text-2xl font-black text-slate-400 font-mono mt-1">${Math.max(0, 9 - Math.min(9, Math.floor((currentSetScore.player_2_points || 0) / 1)))} <span class="text-xs font-normal text-slate-500">left</span></div>
            </div>
          </div>

          <div class="flex items-center justify-between pt-1 text-[11px] text-slate-400 border-t border-slate-800">
            <span>Dues / Fouls: <strong id="visualFoulsCount" class="text-amber-400">0</strong></span>
            <button onclick="resetBoardCoins()" class="text-slate-500 hover:text-slate-300 text-[10px] underline">Reset Coins</button>
          </div>
        </div>

        <!-- Live Crowd Reactions & Quick Actions -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span class="font-bold text-amber-400"><i class="fa-solid fa-heart mr-1"></i> Live Crowd Reactions</span>
            <span class="text-[10px] text-slate-500">Tap to cheer</span>
          </div>

          <!-- Reaction Emojis -->
          <div class="flex items-center justify-around py-1">
            <button onclick="sendSpectatorReaction('👏')" class="text-2xl hover:scale-125 transition transform active:scale-95" title="Clap">👏</button>
            <button onclick="sendSpectatorReaction('🎯')" class="text-2xl hover:scale-125 transition transform active:scale-95" title="Bullseye">🎯</button>
            <button onclick="sendSpectatorReaction('🔥')" class="text-2xl hover:scale-125 transition transform active:scale-95" title="Fire">🔥</button>
            <button onclick="sendSpectatorReaction('👑')" class="text-2xl hover:scale-125 transition transform active:scale-95" title="Queen">👑</button>
            <button onclick="sendSpectatorReaction('💪')" class="text-2xl hover:scale-125 transition transform active:scale-95" title="Strong">💪</button>
          </div>

          <!-- Match Actions: Dispute & Print -->
          <div class="flex items-center gap-2 pt-2 border-t border-slate-800">
            <button onclick="openDisputeModal('${fixture.fixture_id}')" class="flex-1 py-1.5 px-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-xs font-semibold flex items-center justify-center gap-1 transition">
              <i class="fa-solid fa-triangle-exclamation"></i> Dispute
            </button>
            <button onclick="openPrintableScoreSheet('${fixture.fixture_id}')" class="flex-1 py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1 transition">
              <i class="fa-solid fa-print"></i> Scorecard
            </button>
          </div>
        </div>

      </div>

      <!-- Interactive Digital Scoreboard Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        <!-- Player 1 Scoreboard Card -->
        <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 relative overflow-hidden">
          <div class="flex items-center justify-between">
            <span class="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400">Player 1</span>
            <span class="text-xs text-slate-400">${fixture.p1_phone}</span>
          </div>
          <div class="text-lg font-black text-white">${fixture.p1_name}</div>

          <!-- Large Point Display -->
          <div class="py-4 text-center rounded-xl bg-slate-950 border border-slate-800">
            <span id="p1ScoreNumber" class="text-5xl font-black text-amber-400 font-mono tracking-tight">
              ${currentSetScore.player_1_points || 0}
            </span>
            <span class="text-xs text-slate-500 block mt-1">/ ${fixture.max_points_per_set} points max</span>
          </div>

          <!-- Carrom Action Buttons -->
          <div class="space-y-2 pt-2">
            <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Log Carrom Coins / Points:</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_1', 1, 'White Coin')" class="coin-btn coin-white py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow">
                <i class="fa-solid fa-circle"></i> White (+1)
              </button>
              <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_1', 1, 'Black Coin')" class="coin-btn coin-black py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow">
                <i class="fa-regular fa-circle"></i> Black (+1)
              </button>
              <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_1', 3, 'Queen + Cover')" class="coin-btn coin-queen py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow">
                <i class="fa-solid fa-crown"></i> Queen (+3)
              </button>
              <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_1', -1, 'Due / Foul Penalty')" class="coin-btn coin-penalty py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow">
                <i class="fa-solid fa-triangle-exclamation"></i> Due (-1)
              </button>
            </div>
            <!-- Regulation Striker Action -->
            <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_1', -1, 'Striker Pocketed Foul')" class="w-full py-2 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-xs flex items-center justify-center gap-2 transition disabled:opacity-40">
              <span class="w-4 h-4 rounded-full bg-slate-200 border border-slate-400 inline-block"></span>
              Striker Pocketed Foul (-1 Due)
            </button>
          </div>
        </div>

        <!-- Player 2 Scoreboard Card -->
        <div class="wooden-trim-card p-6 space-y-4 relative overflow-hidden">
          <div class="flex items-center justify-between">
            <span class="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400">Player 2</span>
            <span class="text-xs text-slate-400 font-mono">${fixture.p2_phone}</span>
          </div>
          <div class="text-lg font-black text-white">${fixture.p2_name}</div>

          <!-- Large Point Display -->
          <div class="py-4 text-center rounded-xl bg-slate-950 border border-slate-800">
            <span id="p2ScoreNumber" class="text-5xl font-black text-amber-400 font-mono tracking-tight">
              ${currentSetScore.player_2_points || 0}
            </span>
            <span class="text-xs text-slate-500 block mt-1">/ ${fixture.max_points_per_set} points max</span>
          </div>

          <!-- Carrom Action Buttons -->
          <div class="space-y-2 pt-2">
            <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Log Carrom Coins / Points:</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_2', 1, 'White Coin')" class="coin-btn coin-white py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow">
                <i class="fa-solid fa-circle"></i> White (+1)
              </button>
              <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_2', 1, 'Black Coin')" class="coin-btn coin-black py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow">
                <i class="fa-regular fa-circle"></i> Black (+1)
              </button>
              <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_2', 3, 'Queen + Cover')" class="coin-btn coin-queen py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow">
                <i class="fa-solid fa-crown"></i> Queen (+3)
              </button>
              <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_2', -1, 'Due / Foul Penalty')" class="coin-btn coin-penalty py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow">
                <i class="fa-solid fa-triangle-exclamation"></i> Due (-1)
              </button>
            </div>
            <!-- Regulation Striker Action -->
            <button ${isSetLocked ? 'disabled' : ''} onclick="submitScoreAction('player_2', -1, 'Striker Pocketed Foul')" class="w-full py-2 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-xs flex items-center justify-center gap-2 transition disabled:opacity-40">
              <span class="w-4 h-4 rounded-full bg-slate-200 border border-slate-400 inline-block"></span>
              Striker Pocketed Foul (-1 Due)
            </button>
          </div>
        </div>

      </div>

      <!-- Set Completion & Score Locking Controls -->
      <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="text-xs text-slate-400">
          <i class="fa-solid fa-shield-halved text-emerald-400 mr-1"></i>
          Official rule: Completing a set locks it against further changes. Only the Organizer can unlock.
        </div>
        <div class="flex items-center gap-2">
          ${!isSetLocked ? `
            <button onclick="lockCurrentSet()" class="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg transition flex items-center gap-1.5">
              <i class="fa-solid fa-lock"></i> Finalize & Lock Set ${activeSetNumber}
            </button>
          ` : `
            <span class="px-4 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-semibold flex items-center gap-1.5">
              <i class="fa-solid fa-check text-emerald-400"></i> Set ${activeSetNumber} Finalized
            </span>
          `}
        </div>
      </div>

    </div>
  `;
}

function renderScoreboardNumbers(p1, p2) {
  const el1 = document.getElementById('p1ScoreNumber');
  const el2 = document.getElementById('p2ScoreNumber');
  if (el1) el1.innerText = p1;
  if (el2) el2.innerText = p2;
}

function changeActiveSet(setNum) {
  activeSetNumber = setNum;
  loadRefereeFixtureScore(activeFixtureId);
}

/**
 * Referee logs point action
 */
async function submitScoreAction(playerSlot, delta, actionName) {
  try {
    const res = await fetch(`/api/fixtures/${activeFixtureId}/score-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({
        setNumber: activeSetNumber,
        player: playerSlot,
        pointDelta: delta,
        carromAction: actionName
      })
    });

    const data = await res.json();
    if (res.ok) {
      renderScoreboardNumbers(data.player_1_points, data.player_2_points);

      // Trigger realistic audio and update coin tracker
      if (actionName.includes('White')) {
        playStrikerSound();
        boardCoinsState.white = Math.max(0, boardCoinsState.white - 1);
      } else if (actionName.includes('Black')) {
        playStrikerSound();
        boardCoinsState.black = Math.max(0, boardCoinsState.black - 1);
      } else if (actionName.includes('Queen')) {
        playQueenSound();
        boardCoinsState.queen = 'captured';
      } else if (actionName.includes('Due') || actionName.includes('Foul')) {
        playBuzzerSound();
        boardCoinsState.fouls++;
      } else {
        playStrikerSound();
      }

      // Reset turn shot clock upon coin pocketing
      resetShotClock();
      updateBoardCoinsUI();
      broadcastBoardCoins();
    } else {
      alert(data.error || 'Failed to update score');
    }
  } catch (err) {
    alert(err.message);
  }
}

/**
 * Lock Set
 */
async function lockCurrentSet() {
  if (!confirm(`Are you sure you want to finalize and lock Set ${activeSetNumber}? Once locked, referee editing is disabled.`)) return;

  try {
    const res = await fetch(`/api/fixtures/${activeFixtureId}/lock-set`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({ setNumber: activeSetNumber })
    });

    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      loadRefereeFixtureScore(activeFixtureId);
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// VIEW 4: HELP DESK ADMIN PORTAL
// -------------------------------------------------------------

async function loadHelpDeskQueue() {
  const tbody = document.getElementById('helpDeskTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/tournaments');
    const data = await res.json();
    const list = data.tournaments || [];

    tbody.innerHTML = list.map(t => {
      const isVerified = Boolean(t.verified_by_helpdesk);
      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-2.5 px-3">
            <div class="font-bold text-white">${t.title}</div>
            <div class="text-[10px] text-slate-400 font-mono">${t.tournament_id}</div>
          </td>
          <td class="py-2.5 px-3 text-slate-300">
            <div>${t.organizer_name}</div>
            <div class="text-[10px] text-slate-500">${t.organizer_phone}</div>
          </td>
          <td class="py-2.5 px-3 text-slate-400 max-w-xs truncate">${t.venue_address}</td>
          <td class="py-2.5 px-3 font-semibold text-slate-300 uppercase">${t.format} (${t.total_boards} bds)</td>
          <td class="py-2.5 px-3 text-amber-400 font-bold">₹${t.entry_fee}</td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isVerified ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}">
              ${isVerified ? 'Verified' : 'Pending'}
            </span>
          </td>
          <td class="py-2.5 px-3 text-right">
            ${!isVerified ? `
              <button onclick="verifyTournamentHelpDesk('${t.tournament_id}', true)" class="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] transition">
                <i class="fa-solid fa-certificate mr-1"></i> Verify & Publish
              </button>
            ` : `
              <button onclick="verifyTournamentHelpDesk('${t.tournament_id}', false)" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px]">
                Revoke
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');

    // Load active disputes queue
    loadHelpDeskDisputes();
  } catch (err) {
    console.error('Error in helpdesk queue:', err);
  }
}

async function verifyTournamentHelpDesk(tournamentId, approve) {
  try {
    const res = await fetch(`/api/tournaments/${tournamentId}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({ approved: approve })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      loadHelpDeskQueue();
      fetchTournaments();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// VIEW 5: PLAYER DASHBOARD & NOTIFICATIONS
// -------------------------------------------------------------

async function loadPlayerSchedule() {
  const container = document.getElementById('playerMatchesList');
  if (!container) return;

  try {
    const res = await fetch('/api/notifications/my', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    const notifs = data.notifications || [];

    // Also get scheduled matches
    const tourRes = await fetch(`/api/tournaments/${currentTournamentId}/fixtures`);
    const tourData = await tourRes.json();
    const fixtures = (tourData.fixtures || []).filter(f => {
      return (currentUser && (f.p1_user_id === currentUser.userId || f.p2_user_id === currentUser.userId));
    });

    if (fixtures.length === 0 && notifs.length === 0) {
      container.innerHTML = `
        <div class="py-8 text-center text-slate-500">
          <i class="fa-solid fa-calendar-check text-3xl mb-2 text-slate-600"></i>
          <p class="text-xs">No scheduled matches for you currently in "${currentTournamentId}".</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="space-y-3">
        ${fixtures.map(f => {
          const isP1 = f.p1_user_id === currentUser.userId;
          const oppName = isP1 ? f.player_2_name : f.player_1_name;
          return `
            <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold text-[10px]">
                    Board #${f.board_number || 'TBA'}
                  </span>
                  <span class="text-xs text-slate-400">${new Date(f.scheduled_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="text-sm font-bold text-white">vs ${oppName || 'Opponent'}</div>
                <div class="text-[11px] text-slate-400">Match Status: <strong class="text-slate-200 uppercase">${f.match_status}</strong></div>
              </div>
              <button onclick="openScoreboardForFixture('${f.fixture_id}')" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-semibold">
                View Board
              </button>
            </div>
          `;
        }).join('')}

        <!-- Notification History -->
        <div class="pt-4 border-t border-slate-800">
          <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Pre-Match Notification Log</h3>
          ${notifs.map(n => `
            <div class="p-3 rounded-lg bg-amber-950/20 border border-amber-800/30 text-xs text-slate-300 mb-2">
              <div class="flex items-center justify-between text-[10px] text-amber-400 mb-1">
                <span><i class="fa-solid fa-bell mr-1"></i> Board #${n.board_number}</span>
                <span>${new Date(n.dispatched_at).toLocaleTimeString()}</span>
              </div>
              <p>${n.message}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error in player schedule:', err);
  }
}

// -------------------------------------------------------------
// VIEW 6: BACKGROUND WORKER MONITOR
// -------------------------------------------------------------

async function loadWorkerDashboard() {
  try {
    const res = await fetch('/api/notifications/worker-status');
    const status = await res.json();

    document.getElementById('workerStateBadge').innerText = status.isActive ? 'ACTIVE (60s)' : 'STOPPED';
    document.getElementById('workerAlertsCount').innerText = `${status.totalDbNotifications || 0} Alerts`;
    document.getElementById('workerLastScanTime').innerText = status.lastScanTime ? new Date(status.lastScanTime).toLocaleTimeString() : 'Never';

    // Alerts history
    const alertsRes = await fetch('/api/notifications/recent-alerts');
    const alertsData = await alertsRes.json();
    const alerts = alertsData.alerts || [];

    const tbody = document.getElementById('workerAlertsTableBody');
    if (alerts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500">No pre-match alerts logged yet.</td></tr>';
      return;
    }

    tbody.innerHTML = alerts.map(a => `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-2.5 px-3 text-slate-400 font-mono text-[11px]">${new Date(a.dispatched_at).toLocaleTimeString()}</td>
        <td class="py-2.5 px-3 font-bold text-white">${a.recipient_name}</td>
        <td class="py-2.5 px-3 text-slate-400">${a.recipient_phone}</td>
        <td class="py-2.5 px-3 font-bold text-amber-400">Board #${a.board_number || 'TBA'}</td>
        <td class="py-2.5 px-3 text-slate-300">${a.opponent_name}</td>
        <td class="py-2.5 px-3 text-slate-400 max-w-xs truncate">${a.message}</td>
        <td class="py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 uppercase">
            ${a.status}
          </span>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading worker stats:', err);
  }
}

async function triggerManualWorkerScan() {
  try {
    const res = await fetch('/api/notifications/trigger-worker', { method: 'POST' });
    const data = await res.json();
    alert(`Worker scan triggered: ${data.message} Dispatched: ${data.result.dispatchedCount}`);
    loadWorkerDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function startWorkerCountdownTimer() {
  setInterval(() => {
    workerCountdown--;
    if (workerCountdown <= 0) workerCountdown = 60;
    const el = document.getElementById('workerNextScanTime');
    if (el) el.innerText = `in ~${workerCountdown}s`;
  }, 1000);
}

// -------------------------------------------------------------
// PUSH ALERTS & NOTIFICATIONS
// -------------------------------------------------------------

function triggerNotificationAlert(alertData) {
  // 1. Play audio chime
  try {
    const audio = document.getElementById('notifChime');
    if (audio) audio.play().catch(() => {});
  } catch (e) {}

  // 2. Display top banner
  const banner = document.getElementById('liveAlertBanner');
  const text = document.getElementById('liveAlertText');
  if (banner && text) {
    text.innerText = alertData.message;
    banner.classList.remove('hidden');
  }

  // 3. Increment badge
  const badge = document.getElementById('notifBadge');
  if (badge) {
    const count = parseInt(badge.innerText, 10) || 0;
    badge.innerText = count + 1;
    badge.classList.remove('hidden');
  }

  // 4. Try browser notification
  if (Notification && Notification.permission === 'granted') {
    new Notification('🔔 CarromX Match Alert!', {
      body: alertData.message,
      icon: '/img/icon.png'
    });
  }
}

function dismissLiveAlert() {
  document.getElementById('liveAlertBanner').classList.add('hidden');
}

function toggleNotificationDrawer() {
  const drawer = document.getElementById('notifDrawer');
  drawer.classList.toggle('hidden');
  if (!drawer.classList.contains('hidden')) {
    loadDrawerNotifications();
  }
}

async function loadDrawerNotifications() {
  const list = document.getElementById('drawerNotifList');
  try {
    const res = await fetch('/api/notifications/my', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    const notifs = data.notifications || [];

    if (notifs.length === 0) {
      list.innerHTML = '<div class="py-8 text-center text-slate-500 text-xs">No notifications yet.</div>';
      return;
    }

    list.innerHTML = notifs.map(n => `
      <div class="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
        <div class="flex items-center justify-between text-[10px] text-amber-400">
          <span>Board #${n.board_number || 'TBA'}</span>
          <span>${new Date(n.dispatched_at).toLocaleTimeString()}</span>
        </div>
        <p class="text-slate-300">${n.message}</p>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<div class="text-xs text-red-400">Failed to load alerts</div>';
  }
}

// -------------------------------------------------------------
// MODALS LOGIC
// -------------------------------------------------------------

function openAuthModal() {
  document.getElementById('authModal').classList.remove('hidden');
  document.getElementById('authStepPhone').classList.remove('hidden');
  document.getElementById('authStepOtp').classList.add('hidden');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.add('hidden');
}

/**
 * Switch Auth Modal Portal Tabs (Player/Organiser vs Super Admin)
 */
function switchAuthPortalTab(tab) {
  const btnRegular = document.getElementById('authTabBtnRegular');
  const btnAdmin = document.getElementById('authTabBtnAdmin');
  const panelRegular = document.getElementById('authPanelRegular');
  const panelAdmin = document.getElementById('authPanelAdmin');
  const panelForgot = document.getElementById('authPanelForgotPassword');

  panelForgot?.classList.add('hidden');

  if (tab === 'regular') {
    btnRegular?.classList.add('bg-amber-600', 'text-white', 'shadow');
    btnRegular?.classList.remove('text-slate-400');
    btnAdmin?.classList.remove('bg-purple-600', 'text-white', 'shadow');
    btnAdmin?.classList.add('text-slate-400');
    panelRegular?.classList.remove('hidden');
    panelAdmin?.classList.add('hidden');
  } else {
    btnAdmin?.classList.add('bg-purple-600', 'text-white', 'shadow');
    btnAdmin?.classList.remove('text-slate-400');
    btnRegular?.classList.remove('bg-amber-600', 'text-white', 'shadow');
    btnRegular?.classList.add('text-slate-400');
    panelAdmin?.classList.remove('hidden');
    panelRegular?.classList.add('hidden');
  }
}

/**
 * Forgot Password Flow Handlers
 */
function openForgotPasswordView() {
  const panelRegular = document.getElementById('authPanelRegular');
  const panelAdmin = document.getElementById('authPanelAdmin');
  const panelForgot = document.getElementById('authPanelForgotPassword');
  const forgotStepEmail = document.getElementById('forgotStepEmail');
  const forgotStepReset = document.getElementById('forgotStepReset');

  panelRegular?.classList.add('hidden');
  panelAdmin?.classList.add('hidden');
  panelForgot?.classList.remove('hidden');

  forgotStepEmail?.classList.remove('hidden');
  forgotStepReset?.classList.add('hidden');

  const emailVal = document.getElementById('authEmailInput')?.value || document.getElementById('adminPhoneInput')?.value || '';
  if (emailVal && emailVal.includes('@')) {
    const forgotEmail = document.getElementById('forgotEmailInput');
    if (forgotEmail) forgotEmail.value = emailVal;
  }
}

function backToLoginView() {
  const panelForgot = document.getElementById('authPanelForgotPassword');
  panelForgot?.classList.add('hidden');
  switchAuthPortalTab('admin');
}

function backToForgotEmailStep() {
  document.getElementById('forgotStepEmail')?.classList.remove('hidden');
  document.getElementById('forgotStepReset')?.classList.add('hidden');
}

async function requestPasswordResetOtp() {
  const email = (document.getElementById('forgotEmailInput')?.value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    alert('Please enter a valid email address to receive your password reset code');
    return;
  }

  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('forgotStepEmail')?.classList.add('hidden');
      document.getElementById('forgotStepReset')?.classList.remove('hidden');
      const targetEl = document.getElementById('forgotTargetEmailDisplay');
      if (targetEl) targetEl.innerText = data.targetEmail || email;

      if (data.devOtp) {
        const helperEl = document.getElementById('forgotDevHelper');
        const codeEl = document.getElementById('forgotDevOtpCode');
        if (codeEl) codeEl.innerText = data.devOtp;
        if (helperEl) helperEl.classList.remove('hidden');
      }

      showToastNotification(data.message || 'Password reset code sent to your email!');
    } else {
      alert(data.error || 'Failed to send password reset code');
    }
  } catch (err) {
    alert(err.message);
  }
}

function autofillForgotOtp() {
  const code = document.getElementById('forgotDevOtpCode')?.innerText;
  if (code) {
    const otpInput = document.getElementById('forgotOtpInput');
    if (otpInput) otpInput.value = code;
  }
}

async function submitPasswordReset() {
  const email = (document.getElementById('forgotEmailInput')?.value || '').trim().toLowerCase();
  const otp = (document.getElementById('forgotOtpInput')?.value || '').trim();
  const newPassword = (document.getElementById('forgotNewPasswordInput')?.value || '').trim();
  const confirmPassword = (document.getElementById('forgotConfirmPasswordInput')?.value || '').trim();

  if (!otp) {
    alert('Please enter the 6-digit reset code');
    return;
  }
  if (!newPassword || newPassword.length < 6) {
    alert('New password must be at least 6 characters long');
    return;
  }
  if (newPassword !== confirmPassword) {
    alert('Passwords do not match. Please re-enter.');
    return;
  }

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        otp,
        newPassword
      })
    });
    const data = await res.json();
    if (res.ok) {
      currentToken = data.token;
      currentUser = data.user;
      activeRole = currentUser.role || 'super_admin';
      localStorage.setItem('carromx_token', currentToken);
      localStorage.setItem('carromx_role', activeRole);
      closeAuthModal();
      updateHeaderProfile();
      playStrikerSound();
      showToastNotification(data.message || 'Password reset successfully! Welcome!');

      if (activeRole === 'super_admin' || activeRole === 'help_desk') {
        navigateTo('superadmin');
      } else if (activeRole === 'organizer' || activeRole === 'organiser') {
        navigateTo('organizer');
      } else {
        navigateTo('tournaments');
      }
    } else {
      alert(data.error || 'Failed to reset password');
    }
  } catch (err) {
    alert(err.message);
  }
}

/**
 * Select Desired Role in Registration Flow (Player vs Organiser)
 */
function selectDesiredRole(role) {
  const desiredRoleInput = document.getElementById('authDesiredRole');
  if (desiredRoleInput) desiredRoleInput.value = role;

  const cardPlayer = document.getElementById('roleCardPlayer');
  const cardOrganizer = document.getElementById('roleCardOrganizer');
  const checkPlayer = document.getElementById('roleCheckPlayer');
  const checkOrganizer = document.getElementById('roleCheckOrganizer');

  if (role === 'organizer') {
    cardOrganizer?.classList.add('border-2', 'border-blue-500');
    cardOrganizer?.classList.remove('border-slate-800');
    if (checkOrganizer) {
      checkOrganizer.className = 'w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold';
      checkOrganizer.innerText = '✓';
    }

    cardPlayer?.classList.remove('border-2', 'border-amber-500');
    cardPlayer?.classList.add('border-slate-800');
    if (checkPlayer) {
      checkPlayer.className = 'w-4 h-4 rounded-full bg-slate-800 text-slate-500 text-[10px] flex items-center justify-center font-bold';
      checkPlayer.innerText = '';
    }
  } else {
    cardPlayer?.classList.add('border-2', 'border-amber-500');
    cardPlayer?.classList.remove('border-slate-800');
    if (checkPlayer) {
      checkPlayer.className = 'w-4 h-4 rounded-full bg-amber-500 text-slate-950 text-[10px] flex items-center justify-center font-bold';
      checkPlayer.innerText = '✓';
    }

    cardOrganizer?.classList.remove('border-2', 'border-blue-500');
    cardOrganizer?.classList.add('border-slate-800');
    if (checkOrganizer) {
      checkOrganizer.className = 'w-4 h-4 rounded-full bg-slate-800 text-slate-500 text-[10px] flex items-center justify-center font-bold';
      checkOrganizer.innerText = '';
    }
  }
}

async function requestOtp() {
  const phone = (document.getElementById('authPhoneInput')?.value || '').trim();
  const email = (document.getElementById('authEmailInput')?.value || '').trim().toLowerCase();
  const name = (document.getElementById('authNameInput')?.value || '').trim();

  if (!email || !email.includes('@')) {
    alert('Please enter a valid email address to receive your verification code');
    return;
  }
  if (!phone || phone.length < 8) {
    alert('Please enter your 10-digit mobile phone number');
    return;
  }

  const cleanPhone = phone.startsWith('+') ? phone : (phone.length === 10 ? `+91${phone}` : phone);

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: cleanPhone,
        email: email,
        fullName: name
      })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('authStepPhone').classList.add('hidden');
      document.getElementById('authStepOtp').classList.remove('hidden');

      const targetEmailEl = document.getElementById('otpTargetEmail');
      if (targetEmailEl) targetEmailEl.innerText = data.targetEmail || email;
      const targetPhoneEl = document.getElementById('otpTargetPhone');
      if (targetPhoneEl) targetPhoneEl.innerText = `Mobile: ${data.targetPhone || cleanPhone}`;

      if (data.devOtp) {
        const helperEl = document.getElementById('devOtpHelper');
        const codeEl = document.getElementById('devOtpCode');
        if (codeEl) codeEl.innerText = data.devOtp;
        if (helperEl) helperEl.classList.remove('hidden');
      }

      showToastNotification(data.message || 'Verification code sent to your email!');
    } else {
      alert(data.error || 'Failed to send verification code');
    }
  } catch (err) {
    alert(err.message);
  }
}

function autofillDevOtp() {
  const code = document.getElementById('devOtpCode').innerText;
  document.getElementById('authOtpInput').value = code;
}

function backToPhoneStep() {
  document.getElementById('authStepPhone').classList.remove('hidden');
  document.getElementById('authStepOtp').classList.add('hidden');
}

async function submitVerifyOtp() {
  const phone = (document.getElementById('authPhoneInput')?.value || '').trim();
  const email = (document.getElementById('authEmailInput')?.value || '').trim().toLowerCase();
  const otp = (document.getElementById('authOtpInput')?.value || '').trim();
  const name = (document.getElementById('authNameInput')?.value || '').trim();
  const desiredRole = document.getElementById('authDesiredRole')?.value || 'player';

  if (!otp) {
    alert('Please enter the 6-digit verification code');
    return;
  }

  const cleanPhone = phone.startsWith('+') ? phone : (phone.length === 10 ? `+91${phone}` : phone);

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: cleanPhone,
        email: email,
        otp,
        fullName: name,
        desiredRole
      })
    });

    const data = await res.json();
    if (res.ok) {
      currentToken = data.token;
      currentUser = data.user;
      activeRole = currentUser.role || desiredRole;
      localStorage.setItem('carromx_token', currentToken);
      localStorage.setItem('carromx_role', activeRole);
      closeAuthModal();
      updateHeaderProfile();
      playStrikerSound();
      showToastNotification(`Welcome, ${currentUser.fullName} (${activeRole.toUpperCase()})!`);

      if (activeRole === 'super_admin' || activeRole === 'help_desk') {
        navigateTo('superadmin');
      } else if (activeRole === 'organizer' || activeRole === 'organiser') {
        navigateTo('organizer');
      } else {
        navigateTo('tournaments');
      }
    } else {
      alert(data.error || 'Invalid verification code');
    }
  } catch (err) {
    alert(err.message);
  }
}

async function submitSuperAdminLogin() {
  const phoneOrEmail = document.getElementById('adminPhoneInput')?.value.trim();
  const key = document.getElementById('adminKeyInput')?.value.trim();

  if (!phoneOrEmail || !key) {
    alert('Please enter your administrator email/phone and master password');
    return;
  }

  try {
    // Try direct credentials login first
    let res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: phoneOrEmail,
        password: key
      })
    });

    // Fallback to OTP verification route if needed
    if (!res.ok) {
      res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneOrEmail,
          otp: key,
          desiredRole: 'super_admin'
        })
      });
    }

    const data = await res.json();
    if (res.ok) {
      currentToken = data.token;
      currentUser = data.user;
      activeRole = 'super_admin';
      localStorage.setItem('carromx_token', currentToken);
      localStorage.setItem('carromx_role', activeRole);
      closeAuthModal();
      updateHeaderProfile();
      playStrikerSound();
      showToastNotification(`👑 Super Admin Signed In: ${currentUser.fullName || 'CarromX Admin'}`);
      navigateTo('superadmin');
    } else {
      alert(data.error || 'Invalid Super Admin credentials');
    }
  } catch (err) {
    console.error('Super Admin login error:', err);
    alert('Failed to connect to authentication server');
  }
}

// Direct GPay / Phone Call Application Modal
function openRegisterModal(tourId, fee, orgName, orgPhone) {
  document.getElementById('registerModal')?.classList.remove('hidden');
  document.getElementById('regTournamentId').value = tourId;
  const feeEl = document.getElementById('regModalFee');
  if (feeEl) feeEl.innerText = `₹${fee || 0}`;

  const orgNameEl = document.getElementById('regModalOrgName');
  if (orgNameEl) orgNameEl.innerText = orgName || 'Tournament Organiser';

  const orgPhoneEl = document.getElementById('regModalOrgPhone');
  if (orgPhoneEl) orgPhoneEl.innerText = orgPhone || 'Contact Organiser';

  const cleanPhone = (orgPhone || '').replace(/[^0-9+]/g, '');
  const callBtn = document.getElementById('regModalCallBtn');
  if (callBtn) callBtn.href = `tel:${cleanPhone}`;

  const waBtn = document.getElementById('regModalWaBtn');
  if (waBtn) {
    const waNumber = cleanPhone.replace(/^\+/, '');
    waBtn.href = `https://wa.me/${waNumber}?text=${encodeURIComponent('Hi, I want to participate in the Carrom tournament. Please confirm my entry.')}`;
  }
}

function closeRegisterModal() {
  document.getElementById('registerModal')?.classList.add('hidden');
}

async function submitTournamentApplication() {
  if (!currentToken) {
    alert('Please sign in as a Player first to apply for this tournament.');
    openAuthModal();
    return;
  }

  const tourId = document.getElementById('regTournamentId').value;
  const note = document.getElementById('regPlayerNote')?.value.trim() || 'Direct GPay / Phone Call';

  try {
    const res = await fetch(`/api/tournaments/${tourId}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ paymentReferenceId: note })
    });

    const data = await res.json();
    if (res.ok) {
      closeRegisterModal();
      playStrikerSound();
      showToastNotification('✓ Application submitted! Please call or GPay the organiser to confirm your spot.');
      await viewTournamentDetail(tourId);
    } else {
      alert(data.error || 'Failed to submit application');
    }
  } catch (err) {
    alert(err.message);
  }
}

// Backward compatibility alias
const submitUpiRegistration = submitTournamentApplication;

// Create Tournament Modal
function openCreateTournamentModal() {
  const modal = document.getElementById('createTournamentModal');
  if (modal) modal.classList.remove('hidden');
  const startTimeInput = document.getElementById('newTourStartTime');
  if (startTimeInput && !startTimeInput.value) {
    startTimeInput.value = formatDateTimeLocal(new Date(Date.now() + 15 * 60 * 1000));
  }
}

function closeCreateTournamentModal() {
  document.getElementById('createTournamentModal')?.classList.add('hidden');
}

async function handleCreateTournament(e) {
  e.preventDefault();

  const title = document.getElementById('newTourTitle').value.trim();
  const venue_address = document.getElementById('newTourVenue').value.trim();
  const format = document.getElementById('newTourFormat').value;
  const total_boards = document.getElementById('newTourBoards').value;
  const max_points_per_set = document.getElementById('newTourMaxPoints').value;
  const boards_per_set = document.getElementById('newTourBoardsPerSet').value;
  const total_sets = document.getElementById('newTourSets').value;
  const set_time_limit_minutes = document.getElementById('newTourSetTimeLimit')?.value || '25';
  const match_duration_minutes = document.getElementById('newTourMatchDuration')?.value || '45';
  const startTime = document.getElementById('newTourStartTime')?.value;
  const entry_fee = document.getElementById('newTourFee').value;
  const upi_id = document.getElementById('newTourUpi').value.trim();

  try {
    const res = await fetch('/api/tournaments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({
        title,
        venue_address,
        format,
        total_boards,
        max_points_per_set,
        boards_per_set,
        total_sets,
        set_time_limit_minutes,
        match_duration_minutes,
        startTime,
        entry_fee,
        upi_id
      })
    });

    const data = await res.json();
    if (res.ok) {
      closeCreateTournamentModal();
      showToastNotification(`🏆 Tournament "${title}" created with ${set_time_limit_minutes}m set limit!`);
      alert(`${data.message}\nPublic URL: ${data.publicUrl}`);
      fetchTournaments();
      loadOrganizerSuite();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (err) {
    alert(err.message);
  }
}

// Organizer Score Override Modal
function openOrganizerOverrideModal(setNum, p1, p2) {
  document.getElementById('organizerOverrideModal').classList.remove('hidden');
  document.getElementById('overrideSetSelect').value = setNum;
  document.getElementById('overrideP1Points').value = p1;
  document.getElementById('overrideP2Points').value = p2;
}

function closeOrganizerOverrideModal() {
  document.getElementById('organizerOverrideModal').classList.add('hidden');
}

async function submitOrganizerScoreOverride() {
  const setNum = document.getElementById('overrideSetSelect').value;
  const p1 = document.getElementById('overrideP1Points').value;
  const p2 = document.getElementById('overrideP2Points').value;
  const unlock = document.getElementById('overrideUnlockCheckbox').checked;

  try {
    const res = await fetch(`/api/fixtures/${activeFixtureId}/organizer-override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({
        setNumber: parseInt(setNum, 10),
        p1Points: parseInt(p1, 10),
        p2Points: parseInt(p2, 10),
        unlock
      })
    });

    const data = await res.json();
    if (res.ok) {
      closeOrganizerOverrideModal();
      alert(data.message);
      loadRefereeFixtureScore(activeFixtureId);
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Switch PM Board Sub-Tabs: Tasks, ERD, Roles, DoD
 */
function switchPmTab(tabName) {
  const tabs = ['tasks', 'erd', 'roles', 'dod'];
  tabs.forEach(t => {
    const section = document.getElementById(`pmSub${capitalize(t)}`);
    const btn = document.getElementById(`pmTab-${t}`);
    if (section) section.classList.add('hidden');
    if (btn) {
      btn.classList.remove('bg-emerald-600', 'text-white');
      btn.classList.add('bg-slate-800', 'text-slate-300');
    }
  });

  const activeSection = document.getElementById(`pmSub${capitalize(tabName)}`);
  const activeBtn = document.getElementById(`pmTab-${tabName}`);
  if (activeSection) activeSection.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.remove('bg-slate-800', 'text-slate-300');
    activeBtn.classList.add('bg-emerald-600', 'text-white');
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// =============================================================
// WEB AUDIO API REALISTIC CARROM SOUND SYNTHESIZER (ZERO ASSETS)
// =============================================================
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// 1. Crisp Carrom Striker / Coin Strike (wood impact: decaying tone + short noise)
function playStrikerSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.7, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// 2. Queen Pocketed / Royal Chime (melodic arpeggio)
function playQueenSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + (idx * 0.09);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0, t);
      gain.linearRampToValueAtTime ? gain.gain.linearRampToValueAtTime(0.4, t + 0.02) : gain.gain.setValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// 3. Foul / Penalty Buzzer (dual discordant saw/square)
function playBuzzerSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// 4. ICF Shot Clock Tick (click / pulse)
function playTickSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.03);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// 5. Crowd Cheer / Clap sound
function playCheerSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    [0, 0.08, 0.16].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + delay;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440 + (Math.random() * 200), t);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    });
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// =============================================================
// ICF 15-SECOND TURN SHOT CLOCK & MATCH TIMER
// =============================================================
let shotClockTimer = 15;
let shotClockInterval = null;
let shotClockRunning = false;

function updateShotClockUI(seconds) {
  const textEl = document.getElementById('shotClockSeconds');
  const circleEl = document.getElementById('shotClockProgressCircle');
  if (textEl) textEl.innerText = seconds;

  if (circleEl) {
    const total = 251.2;
    const fraction = Math.max(0, Math.min(15, seconds)) / 15;
    const offset = total - (fraction * total);
    circleEl.style.strokeDashoffset = offset;

    if (seconds <= 3 && seconds > 0) {
      circleEl.classList.remove('stroke-amber-500');
      circleEl.classList.add('stroke-rose-500');
      if (textEl) textEl.classList.add('text-rose-500');
    } else {
      circleEl.classList.remove('stroke-rose-500');
      circleEl.classList.add('stroke-amber-500');
      if (textEl) textEl.classList.remove('text-rose-500');
    }
  }
}

function toggleShotClock() {
  if (shotClockRunning) {
    clearInterval(shotClockInterval);
    shotClockRunning = false;
    const btn = document.getElementById('shotClockToggleBtn');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Start';
    broadcastShotClock();
  } else {
    shotClockRunning = true;
    const btn = document.getElementById('shotClockToggleBtn');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-pause mr-1"></i> Pause';
    broadcastShotClock();

    shotClockInterval = setInterval(() => {
      shotClockTimer--;
      if (shotClockTimer <= 3 && shotClockTimer > 0) {
        playTickSound();
      }
      if (shotClockTimer <= 0) {
        shotClockTimer = 0;
        clearInterval(shotClockInterval);
        shotClockRunning = false;
        updateShotClockUI(0);
        playBuzzerSound();
        if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate-right mr-1"></i> 15s';
        broadcastShotClock();
        return;
      }
      updateShotClockUI(shotClockTimer);
    }, 1000);
  }
}

function resetShotClock() {
  clearInterval(shotClockInterval);
  shotClockRunning = false;
  shotClockTimer = 15;
  updateShotClockUI(15);
  const btn = document.getElementById('shotClockToggleBtn');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Start';
  broadcastShotClock();
}

function broadcastShotClock() {
  if (ws && ws.readyState === WebSocket.OPEN && activeFixtureId) {
    ws.send(JSON.stringify({
      type: 'SHOT_CLOCK_SYNC',
      fixtureId: activeFixtureId,
      timeLeft: shotClockTimer,
      isRunning: shotClockRunning
    }));
  }
}

function applyRemoteShotClock(timeLeft, isRunning) {
  shotClockTimer = timeLeft;
  updateShotClockUI(timeLeft);
  const btn = document.getElementById('shotClockToggleBtn');
  if (isRunning) {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-pause mr-1"></i> Pause';
  } else {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Start';
  }
}

// =============================================================
// REAL-TIME BOARD COINS TRACKER
// =============================================================
let boardCoinsState = {
  white: 9,
  black: 9,
  queen: 'in_play',
  fouls: 0
};

function updateBoardCoinsUI() {
  const wEl = document.getElementById('visualWhiteCoins');
  const bEl = document.getElementById('visualBlackCoins');
  const qEl = document.getElementById('boardQueenBadge');
  const fEl = document.getElementById('visualFoulsCount');

  if (wEl) wEl.innerHTML = `${boardCoinsState.white} <span class="text-xs font-normal text-slate-500">left</span>`;
  if (bEl) bEl.innerHTML = `${boardCoinsState.black} <span class="text-xs font-normal text-slate-500">left</span>`;
  if (qEl) {
    if (boardCoinsState.queen === 'captured') {
      qEl.className = 'text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30';
      qEl.innerText = 'Queen: Pocketed';
    } else {
      qEl.className = 'text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30';
      qEl.innerText = 'Queen: In Play';
    }
  }
  if (fEl) fEl.innerText = boardCoinsState.fouls;
}

function resetBoardCoins() {
  boardCoinsState = { white: 9, black: 9, queen: 'in_play', fouls: 0 };
  updateBoardCoinsUI();
  broadcastBoardCoins();
}

function broadcastBoardCoins() {
  if (ws && ws.readyState === WebSocket.OPEN && activeFixtureId) {
    ws.send(JSON.stringify({
      type: 'BOARD_COINS_SYNC',
      fixtureId: activeFixtureId,
      whiteCoins: boardCoinsState.white,
      blackCoins: boardCoinsState.black,
      queenState: boardCoinsState.queen,
      fouls: boardCoinsState.fouls
    }));
  }
}

function applyRemoteBoardCoins(w, b, q, f) {
  boardCoinsState = {
    white: w !== undefined ? w : 9,
    black: b !== undefined ? b : 9,
    queen: q || 'in_play',
    fouls: f !== undefined ? f : 0
  };
  updateBoardCoinsUI();
}

// =============================================================
// LIVE SPECTATOR CROWD REACTIONS
// =============================================================
function sendSpectatorReaction(emoji) {
  showFloatingReaction(emoji);
  playCheerSound();
  if (ws && ws.readyState === WebSocket.OPEN && activeFixtureId) {
    ws.send(JSON.stringify({
      type: 'SPECTATOR_REACTION',
      fixtureId: activeFixtureId,
      emoji
    }));
  }
}

function showFloatingReaction(emoji) {
  const container = document.getElementById('floatingReactionsContainer');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.innerText = emoji;
  const randomX = Math.floor(Math.random() * 60) + 20;
  el.style.left = `${randomX}%`;
  container.appendChild(el);

  setTimeout(() => {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }, 2200);
}

// =============================================================
// MATCH DISPUTE SYSTEM & HELP DESK QUEUE
// =============================================================
function openDisputeModal(fixtureId) {
  document.getElementById('disputeModal').classList.remove('hidden');
  document.getElementById('disputeFixtureId').value = fixtureId;
  document.getElementById('disputeNotesInput').value = '';
}

function closeDisputeModal() {
  document.getElementById('disputeModal').classList.add('hidden');
}

async function submitDispute() {
  const fixtureId = document.getElementById('disputeFixtureId').value;
  const reasonSelect = document.getElementById('disputeReasonSelect').value;
  const notes = document.getElementById('disputeNotesInput').value.trim();
  const fullReason = notes ? `${reasonSelect}: ${notes}` : reasonSelect;

  try {
    const res = await fetch(`/api/fixtures/${fixtureId}/dispute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ reason: fullReason })
    });
    const data = await res.json();
    if (res.ok) {
      closeDisputeModal();
      alert(`⚠️ Dispute raised successfully!\n${data.message}`);
      loadRefereeFixtureScore(fixtureId);
    } else {
      alert(data.error || 'Failed to raise dispute');
    }
  } catch (err) {
    alert(err.message);
  }
}

async function loadHelpDeskDisputes() {
  const container = document.getElementById('helpDeskDisputesContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/tournaments');
    const tData = await res.json();
    const tours = tData.tournaments || [];
    let disputedFixtures = [];

    for (const t of tours) {
      try {
        const fixRes = await fetch(`/api/tournaments/${t.tournament_id}/fixtures`);
        const fixData = await fixRes.json();
        const disputed = (fixData.fixtures || []).filter(f => f.match_status === 'disputed');
        disputed.forEach(df => { df.tournamentTitle = t.title; });
        disputedFixtures.push(...disputed);
      } catch (err) {}
    }

    if (disputedFixtures.length === 0) {
      container.innerHTML = `
        <div class="py-6 text-center text-slate-500 text-xs">
          <i class="fa-solid fa-shield-check text-2xl mb-1 text-emerald-500/50 block"></i>
          <p>No active disputes reported. All matches running under ICF fair play rules.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = disputedFixtures.map(df => `
      <div class="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold text-[10px] uppercase border border-rose-500/30">DISPUTED</span>
            <span class="text-xs text-slate-300 font-bold">${df.tournamentTitle} &bull; Board #${df.board_number || 'TBA'}</span>
          </div>
          <div class="text-sm font-bold text-white">${df.player_1_name} vs ${df.player_2_name}</div>
          <div class="text-xs text-rose-300 mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Escalated to Help Desk Admin for resolution ruling</div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="resolveDisputeHelpDesk('${df.fixture_id}', 'live')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">
            <i class="fa-solid fa-play mr-1"></i> Resume Live
          </button>
          <button onclick="resolveDisputeHelpDesk('${df.fixture_id}', 'completed', '${df.player_1_id}')" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition">
            P1 Win
          </button>
          <button onclick="resolveDisputeHelpDesk('${df.fixture_id}', 'completed', '${df.player_2_id}')" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition">
            P2 Win
          </button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Error loading disputes:', e);
  }
}

async function resolveDisputeHelpDesk(fixtureId, resolutionStatus, winnerId) {
  const notes = prompt('Enter Help Desk resolution ruling notes:', resolutionStatus === 'live' ? 'Board cleared and fair play confirmed. Match resumed.' : 'Official review concluded. Winner declared.');
  if (notes === null) return;

  try {
    const res = await fetch(`/api/fixtures/${fixtureId}/resolve-dispute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({
        resolutionStatus,
        notes,
        winnerParticipantId: winnerId || null
      })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      loadHelpDeskDisputes();
      if (currentTournamentId) loadTournamentDetailData(currentTournamentId);
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

// =============================================================
// OFFICIAL PRINTABLE ICF SCORE SHEET
// =============================================================
async function openPrintableScoreSheet(fixtureId) {
  const modal = document.getElementById('printableScoreModal');
  const container = document.getElementById('printableScoreSheet');
  if (!modal || !container) return;

  modal.classList.remove('hidden');
  container.innerHTML = `
    <div class="py-8 text-center text-slate-500 text-xs">
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-amber-500 mb-2"></i>
      <p>Generating Official ICF Score Sheet...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/fixtures/${fixtureId}/scoreboard`);
    if (!res.ok) throw new Error('Fixture score data unavailable');
    const data = await res.json();
    const fix = data.fixture;
    const scores = data.scores || [];

    const s1 = scores.find(s => s.set_number === 1) || { player_1_points: 0, player_2_points: 0 };
    const s2 = scores.find(s => s.set_number === 2) || { player_1_points: 0, player_2_points: 0 };
    const s3 = scores.find(s => s.set_number === 3) || { player_1_points: 0, player_2_points: 0 };

    const totalP1 = (s1.player_1_points || 0) + (s2.player_1_points || 0) + (s3.player_1_points || 0);
    const totalP2 = (s1.player_2_points || 0) + (s2.player_2_points || 0) + (s3.player_2_points || 0);

    const winnerName = fix.winner_name || (totalP1 > totalP2 ? fix.p1_name : (totalP2 > totalP1 ? fix.p2_name : 'Pending Completion'));

    container.innerHTML = `
      <div class="space-y-4 text-slate-900">
        <!-- Header -->
        <div class="border-b-2 border-slate-900 pb-3 flex items-start justify-between">
          <div>
            <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">International Carrom Federation (ICF) Rules</div>
            <h1 class="text-xl font-black text-slate-900 tracking-tight">OFFICIAL MATCH SCORE SHEET</h1>
            <div class="text-xs font-semibold text-slate-700 mt-0.5">${fix.tournament_title || 'CarromX Local Championship'}</div>
          </div>
          <div class="text-right text-xs">
            <div class="font-mono font-bold text-slate-800">Match ID: ${fix.fixture_id}</div>
            <div class="text-slate-500">Date: ${new Date().toLocaleDateString()}</div>
            <div class="text-slate-500 font-semibold uppercase">Status: ${fix.match_status}</div>
          </div>
        </div>

        <!-- Meta Grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 border border-slate-300 rounded text-xs">
          <div>
            <span class="text-slate-500 uppercase text-[10px] block">Round</span>
            <span class="font-bold text-slate-800">Round ${fix.round_number}</span>
          </div>
          <div>
            <span class="text-slate-500 uppercase text-[10px] block">Assigned Board</span>
            <span class="font-bold text-slate-800">Board #${fix.board_number || 'TBA'}</span>
          </div>
          <div>
            <span class="text-slate-500 uppercase text-[10px] block">Appointed Referee</span>
            <span class="font-bold text-slate-800">${fix.referee_name || 'Chief Referee'}</span>
          </div>
          <div>
            <span class="text-slate-500 uppercase text-[10px] block">Rule System</span>
            <span class="font-bold text-slate-800">Best of ${fix.total_sets || 3} / ${fix.max_points_per_set || 25} pts</span>
          </div>
        </div>

        <!-- Score Breakdown Table -->
        <table class="w-full text-xs text-left border-collapse border border-slate-400">
          <thead>
            <tr class="bg-slate-200 text-slate-900 font-bold border-b border-slate-400">
              <th class="p-2 border-r border-slate-400">Player</th>
              <th class="p-2 border-r border-slate-400">Contact</th>
              <th class="p-2 border-r border-slate-400 text-center">Set 1</th>
              <th class="p-2 border-r border-slate-400 text-center">Set 2</th>
              <th class="p-2 border-r border-slate-400 text-center">Set 3</th>
              <th class="p-2 text-center font-black bg-slate-300">Total Points</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-slate-300">
              <td class="p-2 border-r border-slate-300 font-bold flex items-center gap-1.5">
                <span class="w-3 h-3 rounded-full bg-slate-100 border border-slate-400 inline-block"></span>
                ${fix.p1_name} (White)
              </td>
              <td class="p-2 border-r border-slate-300 font-mono text-[11px]">${fix.p1_phone || 'N/A'}</td>
              <td class="p-2 border-r border-slate-300 text-center font-mono font-bold">${s1.player_1_points || 0}</td>
              <td class="p-2 border-r border-slate-300 text-center font-mono font-bold">${s2.player_1_points || 0}</td>
              <td class="p-2 border-r border-slate-300 text-center font-mono font-bold">${s3.player_1_points || 0}</td>
              <td class="p-2 text-center font-black font-mono text-sm bg-slate-100">${totalP1}</td>
            </tr>
            <tr>
              <td class="p-2 border-r border-slate-300 font-bold flex items-center gap-1.5">
                <span class="w-3 h-3 rounded-full bg-slate-900 border border-slate-900 inline-block"></span>
                ${fix.p2_name} (Black)
              </td>
              <td class="p-2 border-r border-slate-300 font-mono text-[11px]">${fix.p2_phone || 'N/A'}</td>
              <td class="p-2 border-r border-slate-300 text-center font-mono font-bold">${s1.player_2_points || 0}</td>
              <td class="p-2 border-r border-slate-300 text-center font-mono font-bold">${s2.player_2_points || 0}</td>
              <td class="p-2 border-r border-slate-300 text-center font-mono font-bold">${s3.player_2_points || 0}</td>
              <td class="p-2 text-center font-black font-mono text-sm bg-slate-100">${totalP2}</td>
            </tr>
          </tbody>
        </table>

        <!-- Winner Box -->
        <div class="p-3 bg-amber-50 border border-amber-300 rounded flex items-center justify-between">
          <div class="text-xs">
            <span class="font-bold text-amber-900 uppercase">Match Result / Winner:</span>
            <span class="font-black text-sm text-slate-900 ml-2">${winnerName}</span>
          </div>
          <div class="text-xs font-mono font-bold text-slate-600">
            Final Score: ${totalP1} - ${totalP2}
          </div>
        </div>

        <!-- Official Signatures Block -->
        <div class="pt-6 border-t border-slate-300 mt-6 grid grid-cols-3 gap-6 text-center text-xs">
          <div>
            <div class="border-b border-slate-400 pb-8 mb-1"></div>
            <div class="font-semibold text-slate-700">${fix.p1_name} (P1 Signature)</div>
          </div>
          <div>
            <div class="border-b border-slate-400 pb-8 mb-1"></div>
            <div class="font-semibold text-slate-700">${fix.p2_name} (P2 Signature)</div>
          </div>
          <div>
            <div class="border-b border-slate-400 pb-8 mb-1"></div>
            <div class="font-semibold text-slate-700">${fix.referee_name || 'Chief Referee'} (Official Sign)</div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="p-6 text-center text-rose-500 font-semibold">${err.message}</div>`;
  }
}

function closePrintableScoreModal() {
  const modal = document.getElementById('printableScoreModal');
  if (modal) modal.classList.add('hidden');
}

// =============================================================
// OFFICIAL TOURNAMENT FIXTURES PDF EXPORT & SOCIAL SHARING ENGINE
// =============================================================

let activePrintableTourData = null;
let activePrintableFixtures = null;

async function openPrintableFixturesModal(tourId) {
  const targetId = tourId || currentTournamentId || document.getElementById('organizerTournamentSelect')?.value;
  if (!targetId) {
    alert('Please select or create a tournament first.');
    return;
  }

  const modal = document.getElementById('printableFixturesModal');
  const container = document.getElementById('officialFixturesPrintChart');
  if (!modal || !container) return;

  modal.classList.remove('hidden');
  container.innerHTML = `
    <div class="py-12 text-center text-slate-500 text-xs">
      <i class="fa-solid fa-circle-notch fa-spin text-3xl text-rose-500 mb-3"></i>
      <p class="font-bold text-slate-700">Compiling Official Fixtures Chart &amp; Board Allocations...</p>
    </div>
  `;

  try {
    const tourRes = await fetch(`/api/tournaments/${targetId}`);
    if (!tourRes.ok) throw new Error('Tournament not found');
    const tourData = await tourRes.json();
    const tournament = tourData.tournament;
    const fixtures = tourData.fixtures || [];

    activePrintableTourData = tournament;
    activePrintableFixtures = fixtures;

    if (fixtures.length === 0) {
      container.innerHTML = `
        <div class="py-12 text-center space-y-3">
          <i class="fa-solid fa-chess-board text-4xl text-slate-400"></i>
          <h3 class="font-bold text-slate-800 text-base">No match fixtures generated yet for "${escapeHtml(tournament.title)}".</h3>
          <p class="text-xs text-slate-500 max-w-md mx-auto">Please generate fixtures using "Random Shuffle Draw" first before downloading or sharing the fixtures chart.</p>
          <div class="pt-2">
            <button onclick="closePrintableFixturesModal(); executeDirectRandomShuffle('${tournament.tournament_id}')" class="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-xs shadow">
              <i class="fa-solid fa-shuffle mr-1"></i> 🎲 Random Shuffle Draw Now
            </button>
          </div>
        </div>
      `;
      return;
    }

    const dateStr = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    container.innerHTML = `
      <div class="border-2 border-slate-900 p-4 sm:p-6 bg-white text-black space-y-5 rounded">
        <!-- Official Association Header -->
        <div class="text-center border-b-2 border-slate-900 pb-4 space-y-1">
          <div class="text-[10px] tracking-widest uppercase font-extrabold text-slate-600">
            TAMIL NADU / ALL INDIA CARROM FEDERATION COMPLIANT FORMAT
          </div>
          <h1 class="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-900 leading-tight">
            ${escapeHtml(tournament.title)}
          </h1>
          <div class="text-xs font-semibold text-slate-700 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1">
            <span><strong>Venue:</strong> ${escapeHtml(tournament.venue_address)}</span>
            <span class="text-slate-400">&bull;</span>
            <span><strong>Format:</strong> Knockout (${escapeHtml(tournament.format)})</span>
            <span class="text-slate-400">&bull;</span>
            <span><strong>Total Boards:</strong> ${tournament.total_boards} Active Boards</span>
            <span class="text-slate-400">&bull;</span>
            <span><strong>Draw Date:</strong> ${dateStr}</span>
          </div>
          <div class="inline-block mt-2 px-3 py-1 bg-slate-900 text-white text-[11px] font-black uppercase tracking-wider rounded">
            OFFICIAL TOURNAMENT MATCH FIXTURES &amp; BOARD ALLOCATION CHART
          </div>
        </div>

        <!-- Fixtures Tabular Grid -->
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
              ${fixtures.map((f, idx) => {
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
                      ${escapeHtml(f.referee_name || f.umpire_name || 'Assigned Referee')}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Official Signatures Box -->
        <div class="pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-center text-xs">
          <div class="space-y-8">
            <div class="h-10 border-b border-dashed border-slate-400"></div>
            <div>
              <div class="font-bold uppercase text-[11px] text-slate-900">Chief Referee / Umpire</div>
              <div class="text-[10px] text-slate-500">Official Signature &amp; Date</div>
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
              <div class="text-[10px] text-slate-500">TNCA / AICF Sanction</div>
            </div>
          </div>
        </div>

        <!-- Document Footer & Validation -->
        <div class="text-center pt-2 text-[10px] text-slate-500 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <span>Generated by CarromX Platform &bull; http://${window.location.host}</span>
          <span>Laws of Carrom: Best of ${tournament.total_sets || 3} Sets &bull; 25 Points Limit</span>
          <span>Printed on: ${new Date().toLocaleString()}</span>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="p-6 text-center text-rose-500 font-semibold">${err.message}</div>`;
  }
}

function closePrintableFixturesModal() {
  const modal = document.getElementById('printableFixturesModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Download High-Definition PDF via html2pdf
 */
async function downloadFixturesPDFNow() {
  const container = document.getElementById('officialFixturesPrintChart');
  if (!container) return;

  const title = activePrintableTourData?.title || 'Carrom_Tournament';
  const cleanTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Carrom_Fixtures_${cleanTitle}.pdf`;

  if (typeof html2pdf !== 'undefined') {
    showToastNotification('Generating PDF document...');
    const opt = {
      margin: [8, 8, 8, 8],
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
      await html2pdf().set(opt).from(container).save();
      playStrikerSound();
      showToastNotification(`✓ PDF Downloaded: ${filename}`);
    } catch (err) {
      console.error('html2pdf generation error:', err);
      printOfficialFixturesChart();
    }
  } else {
    printOfficialFixturesChart();
  }
}

/**
 * Direct Download Wrapper
 */
function downloadFixturesPDF(tourId) {
  openPrintableFixturesModal(tourId);
}

/**
 * Print to Paper or Native Save-as-PDF
 */
function printOfficialFixturesChart() {
  document.body.classList.add('printing-fixtures');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('printing-fixtures');
  }, 1000);
}

/**
 * Compile Clean WhatsApp Message with Match Pairings & Link
 */
function compileFixturesWhatsAppText(tournament, fixtures) {
  if (!tournament || !fixtures || fixtures.length === 0) return '';

  const dateStr = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  let lines = [];
  lines.push(`🏆 *${tournament.title.toUpperCase()}*`);
  lines.push(`📍 *Venue:* ${tournament.venue_address}`);
  lines.push(`🎲 *Format:* Knockout (Fisher-Yates Blind Draw)`);
  lines.push(`📅 *Draw Date:* ${dateStr}`);
  lines.push(``);
  lines.push(`📋 *ROUND 1 MATCH PAIRINGS & BOARD ALLOCATIONS:*`);

  fixtures.forEach((f, idx) => {
    const isBye = !f.player_2_id;
    if (isBye) {
      lines.push(`• *Match ${idx + 1} (Bye Round):* ${f.p1_name} ➔ _Advance on Bye_`);
    } else {
      const timeStr = new Date(f.scheduled_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      lines.push(`• *Match ${idx + 1} [Board #${f.board_number || 1}]:* *${f.p1_name}* VS *${f.p2_name}* (${timeStr})`);
    }
  });

  lines.push(``);
  lines.push(`⏱️ *Rules:* Best of ${tournament.total_sets || 3} Sets | 25 Pts Limit`);
  lines.push(`📲 *Live Scores & Real-Time Sync:*`);
  lines.push(`${window.location.origin}/tournament/${tournament.tournament_id}`);
  lines.push(``);
  lines.push(`_Organised via CarromX Platform_ 🎯`);

  return lines.join('\n');
}

/**
 * Share Fixtures on WhatsApp
 */
async function shareFixturesWhatsApp(tourId) {
  const targetId = tourId || currentTournamentId || document.getElementById('organizerTournamentSelect')?.value;
  if (!targetId) {
    alert('Please select a tournament first.');
    return;
  }

  let tournament = activePrintableTourData;
  let fixtures = activePrintableFixtures;

  if (!tournament || !fixtures || tournament.tournament_id !== targetId) {
    try {
      const res = await fetch(`/api/tournaments/${targetId}`);
      if (res.ok) {
        const data = await res.json();
        tournament = data.tournament;
        fixtures = data.fixtures || [];
      }
    } catch (e) {}
  }

  if (!fixtures || fixtures.length === 0) {
    alert('No fixtures generated yet to share. Click "Random Shuffle Draw" first!');
    return;
  }

  const text = compileFixturesWhatsAppText(tournament, fixtures);

  // Copy to clipboard
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  } catch (e) {}

  showToastNotification('✓ Match pairings copied & WhatsApp opened!');
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function shareFixturesWhatsAppNow() {
  if (activePrintableTourData) {
    shareFixturesWhatsApp(activePrintableTourData.tournament_id);
  }
}

/**
 * Native Mobile Share Sheet (Web Share API)
 */
async function shareFixturesNativeNow() {
  const tournament = activePrintableTourData;
  const fixtures = activePrintableFixtures;
  if (!tournament || !fixtures || fixtures.length === 0) return;

  const text = compileFixturesWhatsAppText(tournament, fixtures);
  const shareData = {
    title: `${tournament.title} - Match Fixtures`,
    text: text,
    url: `${window.location.origin}/tournament/${tournament.tournament_id}`
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      showToastNotification('✓ Shared successfully!');
    } catch (err) {
      if (err.name !== 'AbortError') {
        shareFixturesWhatsAppNow();
      }
    }
  } else {
    shareFixturesWhatsAppNow();
  }
}

// =============================================================
// TOAST NOTIFICATION HELPER
// =============================================================
function showToastNotification(message, duration = 3000) {
  let toast = document.getElementById('appToastBox');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToastBox';
    toast.className = 'fixed bottom-16 sm:bottom-6 right-4 sm:right-6 z-50 px-4 py-2.5 rounded-xl bg-slate-900/95 text-white text-xs font-semibold border border-amber-500/40 shadow-2xl flex items-center gap-2 backdrop-blur-md transition-all duration-300 transform translate-y-10 opacity-0';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<i class="fa-solid fa-circle-check text-amber-400"></i> <span>${escapeHtml(message)}</span>`;
  toast.classList.remove('translate-y-10', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-10', 'opacity-0');
  }, duration);
}

// =============================================================
// MODULE 1: SUPER ADMIN MASTER SUITE & USER DIRECTORY
// =============================================================
let allUsersCache = [];

async function loadSuperAdminSuite() {
  await loadUserDirectory();
  await loadHelpDeskQueue();
}

async function loadUserDirectory() {
  try {
    const res = await fetch('/api/auth/users', {
      headers: currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      allUsersCache = data.users || [];
      renderUserDirectory(allUsersCache);
    }
  } catch (err) {
    console.error('Error loading users:', err);
  }
}

function renderUserDirectory(users) {
  const tbody = document.getElementById('userDirectoryTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 text-center text-slate-500">
          <i class="fa-solid fa-users text-2xl mb-2 block"></i>
          No users matching current filter. Click "+ Add Anyone at Any Role" to create one.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = users.map(u => {
    const roleColors = {
      super_admin: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      organizer: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      umpire: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      player: 'bg-amber-500/20 text-amber-300 border-amber-500/30'
    };

    const roleLabels = {
      super_admin: '👑 Super Admin',
      organizer: '📋 Organiser',
      umpire: '⚖️ Umpire',
      player: '🎯 Player'
    };

    const badgeClass = roleColors[u.displayRole] || roleColors.player;
    const label = roleLabels[u.displayRole] || u.displayRole;

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-2.5 px-3">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-amber-400">
              ${u.full_name ? u.full_name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div>
              <div class="font-bold text-white text-xs">${escapeHtml(u.full_name)}</div>
              <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(u.user_id)}</div>
            </div>
          </div>
        </td>
        <td class="py-2.5 px-3 font-mono text-slate-300 text-xs">${escapeHtml(u.phone_number)}</td>
        <td class="py-2.5 px-3 text-slate-400 text-xs">${escapeHtml(u.email || '-')}</td>
        <td class="py-2.5 px-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badgeClass}">
            ${label}
          </span>
        </td>
        <td class="py-2.5 px-3 text-right">
          <div class="flex items-center justify-end gap-2">
            <select onchange="changeUserRole('${u.user_id}', this.value)" class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500" title="Change Role">
              <option value="super_admin" ${u.displayRole === 'super_admin' ? 'selected' : ''}>👑 Super Admin</option>
              <option value="organizer" ${u.displayRole === 'organizer' ? 'selected' : ''}>📋 Organiser</option>
              <option value="umpire" ${u.displayRole === 'umpire' ? 'selected' : ''}>⚖️ Umpire</option>
              <option value="player" ${u.displayRole === 'player' ? 'selected' : ''}>🎯 Player</option>
            </select>
            ${u.user_id !== 'usr_help_1' ? `
              <button onclick="deleteUser('${u.user_id}')" class="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs transition" title="Delete User">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterUserDirectory() {
  const role = document.getElementById('userRoleFilter')?.value || 'all';
  const q = document.getElementById('userSearchInput')?.value.toLowerCase().trim() || '';

  const filtered = allUsersCache.filter(u => {
    const matchesRole = (role === 'all') || (u.displayRole === role);
    const matchesQuery = !q || (
      (u.full_name && u.full_name.toLowerCase().includes(q)) ||
      (u.phone_number && u.phone_number.includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
    return matchesRole && matchesQuery;
  });

  renderUserDirectory(filtered);
}

async function changeUserRole(userId, newRole) {
  try {
    const res = await fetch(`/api/auth/users/${userId}/role`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ role: newRole })
    });

    if (res.ok) {
      playStrikerSound();
      showToastNotification(`Role updated to ${newRole.toUpperCase()}!`);
      await loadUserDirectory();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to update role');
    }
  } catch (e) {
    console.error('Error changing role:', e);
  }
}

function openAddUserModal() {
  document.getElementById('addUserModal')?.classList.remove('hidden');
}
function closeAddUserModal() {
  document.getElementById('addUserModal')?.classList.add('hidden');
}

async function handleAddUserSubmit(e) {
  e.preventDefault();
  const fullName = document.getElementById('addUserName').value;
  const phoneNumber = document.getElementById('addUserPhone').value;
  const email = document.getElementById('addUserEmail').value;
  const role = document.getElementById('addUserRole').value;

  try {
    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ fullName, phoneNumber, email, role })
    });

    if (res.ok) {
      playQueenSound();
      closeAddUserModal();
      document.getElementById('addUserForm').reset();
      showToastNotification(`User ${fullName} created as ${role.toUpperCase()}!`);
      await loadUserDirectory();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to create user');
    }
  } catch (err) {
    console.error('Error adding user:', err);
  }
}

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  try {
    const res = await fetch(`/api/auth/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      showToastNotification('User removed successfully.');
      await loadUserDirectory();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to delete user');
    }
  } catch (e) {
    console.error(e);
  }
}

function switchSuperAdminTab(tab) {
  ['users', 'tournaments', 'disputes'].forEach(t => {
    const btn = document.getElementById(`sa-tab-${t}`);
    const view = document.getElementById(`sa-view-${t}`);
    if (btn) {
      if (t === tab) btn.className = 'sa-tab-btn active px-3.5 py-1.5 rounded-lg bg-purple-600 text-white';
      else btn.className = 'sa-tab-btn px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white';
    }
    if (view) {
      if (t === tab) view.classList.remove('hidden');
      else view.classList.add('hidden');
    }
  });
}

// =============================================================
// MODULE 2: DEDICATED PLAYER ENTRY & ROSTER MANAGEMENT
// =============================================================
let currentRosterParticipants = [];

async function loadPlayerEntryView() {
  const select = document.getElementById('playerEntryTourSelect');
  if (!select) return;

  try {
    const res = await fetch('/api/tournaments');
    const data = await res.json();
    let list = data.tournaments || [];

    const isSuperAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'help_desk';
    if (!isSuperAdmin && currentUser) {
      list = list.filter(t => t.organizer_id === currentUser.userId);
    }

    if (list.length === 0) {
      select.innerHTML = `<option value="">No tournaments created by you yet</option>`;
      renderPlayerRoster([]);
      const totalEl = document.getElementById('peTotalPlayers');
      const approvedEl = document.getElementById('peApprovedPlayers');
      if (totalEl) totalEl.innerText = '0';
      if (approvedEl) approvedEl.innerText = '0';
      return;
    }

    select.innerHTML = list.map(t => `
      <option value="${t.tournament_id}" ${t.tournament_id === currentTournamentId ? 'selected' : ''}>
        ${t.title} (${t.status.toUpperCase()})
      </option>
    `).join('');

    if (!list.some(t => t.tournament_id === currentTournamentId) && list.length > 0) {
      currentTournamentId = list[0].tournament_id;
      select.value = currentTournamentId;
    }

    if (select.value) {
      currentTournamentId = select.value;
      await loadPlayerEntryTournamentData();
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadPlayerEntryTournamentData() {
  const select = document.getElementById('playerEntryTourSelect');
  if (select && select.value) currentTournamentId = select.value;

  try {
    const res = await fetch(`/api/tournaments/${currentTournamentId}`);
    if (res.ok) {
      const tour = await res.json();
      currentRosterParticipants = tour.participants || [];
      
      const totalEl = document.getElementById('peTotalPlayers');
      const approvedEl = document.getElementById('peApprovedPlayers');
      if (totalEl) totalEl.innerText = currentRosterParticipants.length;
      if (approvedEl) approvedEl.innerText = currentRosterParticipants.filter(p => p.payment_status === 'approved').length;

      renderPlayerRoster(currentRosterParticipants);
    }
  } catch (e) {
    console.error(e);
  }
}

function renderPlayerRoster(participants) {
  const tbody = document.getElementById('playerRosterTableBody');
  if (!tbody) return;

  if (participants.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 text-center text-slate-500">
          <i class="fa-solid fa-users text-2xl mb-2 block"></i>
          No players registered yet. Add a player entry above or click "Quick Seed 8 Sample Players".
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = participants.map((p, idx) => {
    const isApproved = p.payment_status === 'approved';
    const statusBadge = isApproved
      ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"><i class="fa-solid fa-check"></i> Approved</span>'
      : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30"><i class="fa-solid fa-clock"></i> Pending</span>';

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-2.5 px-3">
          <span class="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 font-bold text-amber-400 inline-flex items-center justify-center text-xs">
            #${p.seeding_rank && p.seeding_rank > 0 ? p.seeding_rank : idx + 1}
          </span>
        </td>
        <td class="py-2.5 px-3">
          <div class="font-bold text-white text-xs">${escapeHtml(p.full_name)}</div>
          <div class="text-[10px] text-slate-400">${escapeHtml(p.email || p.user_id)}</div>
        </td>
        <td class="py-2.5 px-3 font-mono text-slate-300 text-xs">${escapeHtml(p.phone_number)}</td>
        <td class="py-2.5 px-3">${statusBadge}</td>
        <td class="py-2.5 px-3 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="toggleParticipantPaymentStatus('${p.participant_id}', '${isApproved ? 'pending' : 'approved'}')" class="px-2 py-1 rounded text-[11px] font-semibold ${isApproved ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'}" title="${isApproved ? 'Mark Pending' : 'Approve Payment'}">
              ${isApproved ? 'Mark Pending' : 'Approve'}
            </button>
            <button onclick="editParticipantSeed('${p.participant_id}', ${p.seeding_rank || 0})" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]" title="Edit Seed">
              Seed
            </button>
            <button onclick="removeParticipant('${currentTournamentId}', '${p.participant_id}')" class="p-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs" title="Remove Player">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterPlayerRoster() {
  const q = document.getElementById('peSearchInput')?.value.toLowerCase().trim() || '';
  const filtered = currentRosterParticipants.filter(p => {
    return !q || (p.full_name && p.full_name.toLowerCase().includes(q)) || (p.phone_number && p.phone_number.includes(q));
  });
  renderPlayerRoster(filtered);
}

async function handlePlayerEntrySubmit(e) {
  e.preventDefault();
  const fullName = document.getElementById('peFullName').value;
  const phoneNumber = document.getElementById('pePhone').value;
  const email = document.getElementById('peEmail').value;
  const seedingRank = document.getElementById('peSeed').value;
  const paymentStatus = document.getElementById('pePaymentStatus').value;

  try {
    const res = await fetch(`/api/tournaments/${currentTournamentId}/players/entry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ fullName, phoneNumber, email, seedingRank, paymentStatus })
    });

    if (res.ok) {
      playStrikerSound();
      document.getElementById('playerEntryForm').reset();
      showToastNotification(`Player entry added: ${fullName}!`);
      await loadPlayerEntryTournamentData();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to add player entry');
    }
  } catch (err) {
    console.error('Error submitting player entry:', err);
  }
}

async function quickAddSamplePlayers() {
  const sampleRoster = [
    { fullName: 'Rahul Verma', phoneNumber: '+919876543210', seedingRank: 1 },
    { fullName: 'Vikram Singh', phoneNumber: '+919876543215', seedingRank: 2 },
    { fullName: 'Anita Desai', phoneNumber: '+919876543214', seedingRank: 3 },
    { fullName: 'Karthik Nair', phoneNumber: '+919876543216', seedingRank: 4 },
    { fullName: 'Deepak Joshi', phoneNumber: '+919876543217', seedingRank: 5 },
    { fullName: 'Sneha Kulkarni', phoneNumber: '+919876543218', seedingRank: 6 },
    { fullName: 'Rohan Mehta', phoneNumber: '+919876543219', seedingRank: 7 },
    { fullName: 'Meera Reddy', phoneNumber: '+919876543220', seedingRank: 8 }
  ];

  showToastNotification('Adding 8 tournament players...');
  playStrikerSound();

  for (const p of sampleRoster) {
    try {
      await fetch(`/api/tournaments/${currentTournamentId}/players/entry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          fullName: p.fullName,
          phoneNumber: p.phoneNumber,
          seedingRank: p.seedingRank,
          paymentStatus: 'approved'
        })
      });
    } catch (e) {}
  }

  playQueenSound();
  showToastNotification('8-player roster loaded and ready for Random Shuffle Draw!');
  await loadPlayerEntryTournamentData();
}

async function toggleParticipantPaymentStatus(participantId, newStatus) {
  try {
    const res = await fetch(`/api/participants/${participantId}/payment`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ paymentStatus: newStatus })
    });
    if (res.ok) {
      playStrikerSound();
      await loadPlayerEntryTournamentData();
    }
  } catch (e) {
    console.error(e);
  }
}

async function editParticipantSeed(participantId, currentSeed) {
  const newSeed = prompt('Enter new seeding rank (1 is highest seed, 0 for unseeded):', currentSeed);
  if (newSeed === null) return;
  try {
    const res = await fetch(`/api/participants/${participantId}/seed`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ seedingRank: parseInt(newSeed, 10) || 0 })
    });
    if (res.ok) {
      await loadPlayerEntryTournamentData();
    }
  } catch (e) {
    console.error(e);
  }
}

async function removeParticipant(tournamentId, participantId) {
  if (!confirm('Remove this player from the tournament?')) return;
  try {
    const res = await fetch(`/api/tournaments/${tournamentId}/participants/${participantId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      showToastNotification('Player removed from tournament.');
      await loadPlayerEntryTournamentData();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to remove player');
    }
  } catch (e) {
    console.error(e);
  }
}

// =============================================================
// MODULE 3: RANDOM SHUFFLE FIXTURES GENERATION & REEL ANIMATION
// =============================================================
function openGenerateFixturesModal(tourId) {
  if (tourId) currentTournamentId = tourId;
  document.getElementById('generateFixturesModal')?.classList.remove('hidden');
}

function closeGenerateFixturesModal() {
  document.getElementById('generateFixturesModal')?.classList.add('hidden');
}

function toggleDrawModeUI(mode) {
  const randomCard = document.getElementById('drawModeRandomCard');
  const seededCard = document.getElementById('drawModeSeededCard');
  if (mode === 'random') {
    randomCard?.classList.add('border-2', 'border-blue-500');
    randomCard?.classList.remove('border-slate-700');
    seededCard?.classList.remove('border-2', 'border-blue-500');
    seededCard?.classList.add('border-slate-700');
  } else {
    seededCard?.classList.add('border-2', 'border-amber-500');
    seededCard?.classList.remove('border-slate-700');
    randomCard?.classList.remove('border-2', 'border-blue-500');
    randomCard?.classList.add('border-slate-700');
  }
}

/**
 * Direct Random Shuffle Draw Engine
 * Shuffles player pairings immediately across active boards with interactive reel animation
 */
async function executeDirectRandomShuffle(targetTourId = null) {
  const sel = document.getElementById('organizerTournamentSelect');
  if (targetTourId) {
    currentTournamentId = targetTourId;
  } else if (sel && sel.value) {
    currentTournamentId = sel.value;
  }

  // If no tournament ID selected, fetch available tournaments
  if (!currentTournamentId) {
    try {
      const res = await fetch('/api/tournaments');
      const data = await res.json();
      if (data.tournaments && data.tournaments.length > 0) {
        currentTournamentId = data.tournaments[0].tournament_id;
        if (sel) sel.value = currentTournamentId;
      }
    } catch (e) {}
  }

  if (!currentTournamentId) {
    alert('Please select or create a tournament first.');
    return;
  }

  // Ensure organizer token
  await ensureOrganizerAuthToken();

  // Inspect tournament and approved participants
  let participants = [];
  let tournamentTitle = 'Championship';
  try {
    const tourRes = await fetch(`/api/tournaments/${currentTournamentId}`);
    if (tourRes.ok) {
      const tourData = await tourRes.json();
      participants = tourData.participants || [];
      if (tourData.tournament?.title) {
        tournamentTitle = tourData.tournament.title;
      }
    }
  } catch (e) {
    console.warn('Error checking participants:', e);
  }

  const approved = participants.filter(p => p.payment_status === 'approved');
  const pending = participants.filter(p => p.payment_status === 'pending');

  if (approved.length < 2 && pending.length > 0) {
    const doApprove = confirm(
      `"${tournamentTitle}" has ${pending.length} pending player application(s) and only ${approved.length} approved player(s).\n\nWould you like to approve all pending players now and proceed with the Random Shuffle Draw?`
    );
    if (doApprove) {
      for (const p of pending) {
        try {
          await fetch(`/api/participants/${p.participant_id}/payment`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ paymentStatus: 'approved' })
          });
        } catch (e) {}
      }
      showToastNotification(`✓ Approved ${pending.length} player(s)! Starting shuffle...`);
    } else {
      return;
    }
  } else if (approved.length < 2 && participants.length < 2) {
    const doSeed = confirm(
      `"${tournamentTitle}" currently has fewer than 2 players.\n\nWould you like to auto-populate 8 tournament players now to test the Random Shuffle Draw immediately?`
    );
    if (doSeed) {
      const sampleNames = [
        'A. Selvam', 'B. Dinakaran', 'C. Vignesh', 'D. Saravanan',
        'E. Manikandan', 'F. Karthik', 'G. Ravi Sharma', 'H. Anthony Dass'
      ];
      for (let i = 0; i < sampleNames.length; i++) {
        try {
          await fetch(`/api/tournaments/${currentTournamentId}/players/entry`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
              fullName: sampleNames[i],
              phoneNumber: `+91984099887${i}`,
              seedingRank: i + 1,
              paymentStatus: 'approved'
            })
          });
        } catch (e) {}
      }
      showToastNotification(`Added 8 test players to "${tournamentTitle}"!`);
    } else {
      navigateTo('playerentry');
      return;
    }
  }

  // Display Interactive Shuffle Reel Animation
  const overlay = document.getElementById('shuffleAnimationOverlay');
  const reel = document.getElementById('shuffleReelDisplay');
  if (overlay) overlay.classList.remove('hidden');

  // Grab player names for reel display
  let reelNames = ['Rahul Verma', 'Vikram Singh', 'Anita Desai', 'Karthik Nair'];
  try {
    const tourRes = await fetch(`/api/tournaments/${currentTournamentId}`);
    if (tourRes.ok) {
      const tourData = await tourRes.json();
      const approvedList = (tourData.participants || []).filter(p => p.payment_status === 'approved');
      if (approvedList.length > 0) {
        reelNames = approvedList.map(p => p.full_name || 'Player');
      }
    }
  } catch (e) {}

  let shuffleTicks = 0;
  const interval = setInterval(() => {
    shuffleTicks++;
    playStrikerSound();
    if (reel) {
      const i1 = Math.floor(Math.random() * reelNames.length);
      let i2 = Math.floor(Math.random() * reelNames.length);
      if (reelNames.length > 1) {
        while (i2 === i1) i2 = Math.floor(Math.random() * reelNames.length);
      }
      reel.innerHTML = `
        <div class="space-y-1">
          <div class="text-[10px] uppercase tracking-widest text-slate-400">Randomizing Slot Draw</div>
          <div class="text-sm font-black text-amber-400 font-mono">
            ${escapeHtml(reelNames[i1])} <span class="text-rose-400">VS</span> ${escapeHtml(reelNames[i2])}
          </div>
        </div>
      `;
    }
    if (shuffleTicks > 8) {
      clearInterval(interval);
    }
  }, 140);

  // Send API Request
  setTimeout(async () => {
    try {
      const startTimeVal = document.getElementById('fixturesMatchStartTime')?.value;
      const setTimeLimit = parseInt(document.getElementById('fixturesSetTimingLimit')?.value, 10) || 25;
      const matchDuration = parseInt(document.getElementById('fixturesRoundDuration')?.value, 10) || 45;

      const res = await fetch(`/api/tournaments/${currentTournamentId}/fixtures/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          drawMode: 'random',
          shuffle: true,
          startTime: startTimeVal ? new Date(startTimeVal).toISOString() : new Date().toISOString(),
          matchDurationMinutes: matchDuration,
          setTimeLimitMinutes: setTimeLimit
        })
      });

      if (overlay) overlay.classList.add('hidden');

      if (res.ok) {
        const data = await res.json();
        playQueenSound();
        showToastNotification(`🎲 Random Shuffle Draw complete! Generated ${data.fixtureCount} matches across boards with ${setTimeLimit}m set limit.`);
        navigateTo('organizer');
        await loadOrganizerTournamentData();
        document.getElementById('orgFixturesSection')?.scrollIntoView({ behavior: 'smooth' });
      } else {
        const err = await res.json();
        if (err.error && err.error.includes('need at least 2 approved participants')) {
          alert(`${err.error}\n\n👉 Tip: Go to "Player Entry" tab to add players directly, or click "Approve" on pending applications below.`);
        } else {
          alert(err.error || 'Failed to generate fixtures');
        }
      }
    } catch (e) {
      if (overlay) overlay.classList.add('hidden');
      console.error('executeDirectRandomShuffle API error:', e);
      alert('Error during fixture generation: ' + e.message);
    }
  }, 1300);
}

async function executeGenerateFixtures() {
  const drawModeInput = document.querySelector('input[name="fixtureDrawMode"]:checked');
  const drawMode = drawModeInput ? drawModeInput.value : 'random';
  const duration = parseInt(document.getElementById('fixtureDurationInput')?.value, 10) || 45;
  const startTimeVal = document.getElementById('fixturesMatchStartTime')?.value;
  const setTimeLimit = parseInt(document.getElementById('fixturesSetTimingLimit')?.value, 10) || 25;

  closeGenerateFixturesModal();

  if (drawMode === 'random') {
    executeDirectRandomShuffle();
  } else {
    // Seeded Bracket Draw
    try {
      await ensureOrganizerAuthToken();
      const res = await fetch(`/api/tournaments/${currentTournamentId}/fixtures/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({
          drawMode: 'seeded',
          shuffle: false,
          startTime: startTimeVal ? new Date(startTimeVal).toISOString() : new Date().toISOString(),
          matchDurationMinutes: duration,
          setTimeLimitMinutes: setTimeLimit
        })
      });

      if (res.ok) {
        const data = await res.json();
        playStrikerSound();
        showToastNotification(`Seeded Bracket generated with ${data.fixtureCount} matches.`);
        navigateTo('organizer');
        await loadOrganizerTournamentData();
        document.getElementById('orgFixturesSection')?.scrollIntoView({ behavior: 'smooth' });
      } else {
        const err = await res.json();
        if (err.error && err.error.includes('need at least 2 approved participants')) {
          alert(`${err.error}\n\n👉 Tip: Go to "Player Entry" tab above to add players directly, or click "Approve" on pending applications below.`);
        } else {
          alert(err.error || 'Failed to generate fixtures');
        }
      }
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  }
}

async function triggerAdvanceBracket() {
  const sel = document.getElementById('organizerTournamentSelect');
  const tourId = sel?.value || currentTournamentId;
  if (!tourId) {
    alert('Please select a tournament first.');
    return;
  }

  try {
    await ensureOrganizerAuthToken();
    const res = await fetch(`/api/tournaments/${tourId}/fixtures/advance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      }
    });

    const data = await res.json();
    if (res.ok) {
      playQueenSound();
      showToastNotification(`🏆 Next Round Bracket created! ${data.result?.newFixtures || 0} new matches generated.`);
      await loadOrganizerTournamentData();
    } else {
      alert(data.error || 'Failed to advance bracket');
    }
  } catch (err) {
    alert(err.message);
  }
}

// =============================================================
// OFFICIAL CARROM SCORE SHEET & MOBILE QUICK-TOUCH ENGINE
// Exact reproduction of Official Chennai / Tamil Nadu / AICF Paper Format
// =============================================================

let currentScoreSheetFixture = null;
let currentScoreSheetData = null;
let currentScoreSheetCanEdit = false;
let scoreSheetTheme = 'paper'; // 'paper' or 'dark'

// Quick Touch Mobile Referee State
let quickTouchActiveGame = 0; // 0 = Game 1, 1 = Game 2, 2 = Game 3
let quickTouchActiveBoard = 0; // 0..7 (Boards 1..6, TB, SD)
let quickTouchSelectedPlayer = 'player_1';
let quickTouchHasQueen = false;
let quickTouchCmValue = 0;

/**
 * Open score sheet from top nav: picks active fixture or first fixture of tournament
 */
async function openScoreSheetNav() {
  navigateTo('scoresheet');
  if (activeFixtureId) {
    await loadOfficialScoreSheet(activeFixtureId);
  } else {
    try {
      const res = await fetch(`/api/tournaments/${currentTournamentId}`);
      if (res.ok) {
        const data = await res.json();
        const fixtures = data.fixtures || [];
        if (fixtures.length > 0) {
          activeFixtureId = fixtures[0].fixture_id;
          await loadOfficialScoreSheet(activeFixtureId);
        } else {
          const paperEl = document.getElementById('officialScoreSheetPaper');
          if (paperEl) {
            paperEl.innerHTML = `
              <div class="p-12 text-center text-slate-500">
                <i class="fa-solid fa-file-circle-xmark text-4xl mb-3 text-slate-600"></i>
                <p class="font-bold text-white text-base">No match fixtures found for this tournament.</p>
                <p class="text-xs text-slate-400 mt-1">Please select a tournament with active fixtures to view its official score sheet.</p>
              </div>
            `;
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * Open official score sheet for a specific fixture
 */
async function openOfficialScoreSheet(fixtureId) {
  activeFixtureId = fixtureId;
  navigateTo('scoresheet');
  await loadOfficialScoreSheet(fixtureId);
}

/**
 * Load score sheet data from backend
 */
async function loadOfficialScoreSheet(fixtureId) {
  if (!fixtureId) return;
  activeFixtureId = fixtureId;

  const paperEl = document.getElementById('officialScoreSheetPaper');
  if (paperEl) {
    paperEl.innerHTML = `
      <div class="p-12 text-center text-slate-500">
        <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-amber-500"></i>
        <p class="text-xs font-semibold text-slate-300">Loading Official Chennai Score Sheet...</p>
      </div>
    `;
  }

  try {
    const headers = {};
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const res = await fetch(`/api/fixtures/${fixtureId}/score-sheet`, { headers });
    if (!res.ok) throw new Error('Could not load official score sheet');

    const data = await res.json();
    currentScoreSheetFixture = data.fixture;
    currentScoreSheetData = data.sheet;
    currentScoreSheetCanEdit = Boolean(data.canEdit);

    // Populate fixture select in the score sheet top bar
    await populateScoreSheetFixtureSelect(currentScoreSheetFixture.tournament_id);

    // Update permission badge and save buttons
    const badgeEl = document.getElementById('scoreSheetRoleBadge');
    const badgeTextEl = document.getElementById('scoreSheetRoleText');
    const saveBtn = document.getElementById('saveScoreSheetBtn');
    const completeBtn = document.getElementById('completeMatchBtn');

    if (currentScoreSheetCanEdit) {
      if (badgeEl) badgeEl.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 shadow-sm';
      if (badgeTextEl) badgeTextEl.innerText = 'Official Scorer (Full Edit & Sign)';
      saveBtn?.classList.remove('hidden');
      completeBtn?.classList.remove('hidden');
    } else {
      if (badgeEl) badgeEl.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1';
      if (badgeTextEl) badgeTextEl.innerText = 'Official Record (Live Spectator / Read-Only)';
      saveBtn?.classList.add('hidden');
      completeBtn?.classList.add('hidden');
    }

    // Render Paper Sheet
    renderOfficialScoreSheet(currentScoreSheetFixture, currentScoreSheetData, currentScoreSheetCanEdit);

    // Render Quick Touch Scorer Drawer
    renderQuickTouchDrawer();

    // Initialize Official AICF Set Countdown Timer
    initScoreSheetSetTimer(currentScoreSheetFixture.set_time_limit_minutes !== undefined && currentScoreSheetFixture.set_time_limit_minutes !== null ? currentScoreSheetFixture.set_time_limit_minutes : 25);

  } catch (err) {
    console.error('Failed to load official score sheet:', err);
    if (paperEl) {
      paperEl.innerHTML = `
        <div class="p-8 text-center text-rose-500">
          <i class="fa-solid fa-triangle-exclamation text-3xl mb-2"></i>
          <p class="font-bold">${err.message}</p>
        </div>
      `;
    }
  }
}

/**
 * Populate score sheet match dropdown
 */
async function populateScoreSheetFixtureSelect(tournamentId) {
  const sel = document.getElementById('sheetFixtureSelect');
  if (!sel || !tournamentId) return;

  try {
    const res = await fetch(`/api/tournaments/${tournamentId}`);
    if (res.ok) {
      const data = await res.json();
      const fixtures = data.fixtures || [];
      sel.innerHTML = fixtures.map(f => `
        <option value="${f.fixture_id}" ${f.fixture_id === activeFixtureId ? 'selected' : ''}>
          Board #${f.board_number || 'TBA'}: ${f.player_1_name || 'TBD'} vs ${f.player_2_name || 'TBD'} (${f.match_status})
        </option>
      `).join('');
    }
  } catch (e) {
    console.warn(e);
  }
}

/**
 * Toggle Score Sheet Paper / Dark Theme
 */
function toggleScoreSheetTheme() {
  const paperEl = document.getElementById('officialScoreSheetPaper');
  const toggleText = document.getElementById('sheetThemeToggleText');
  if (!paperEl) return;

  if (scoreSheetTheme === 'paper') {
    scoreSheetTheme = 'dark';
    paperEl.classList.remove('score-sheet-paper');
    paperEl.classList.add('score-sheet-dark');
    if (toggleText) toggleText.innerText = 'Paper Theme';
  } else {
    scoreSheetTheme = 'paper';
    paperEl.classList.remove('score-sheet-dark');
    paperEl.classList.add('score-sheet-paper');
    if (toggleText) toggleText.innerText = 'Dark Theme';
  }
}

/**
 * Print Official Score Sheet (Direct to Paper / PDF)
 */
function printOfficialScoreSheet() {
  const paperEl = document.getElementById('officialScoreSheetPaper');
  const wasDark = scoreSheetTheme === 'dark';
  if (wasDark) {
    toggleScoreSheetTheme();
  }
  window.print();
  if (wasDark) {
    setTimeout(toggleScoreSheetTheme, 1000);
  }
}

/**
 * Render The Official Carrom Score Sheet
 * Exactly replicating Tamil Nadu School Games / Chennai Official Score Sheet
 */
function renderOfficialScoreSheet(fixture, sheet, canEdit) {
  const container = document.getElementById('officialScoreSheetPaper');
  if (!container || !fixture || !sheet) return;

  const p1Name = fixture.p1_name || fixture.player_1_name || 'Player 1';
  const p2Name = fixture.p2_name || fixture.player_2_name || 'Player 2';
  const disabledAttr = canEdit ? '' : 'disabled';

  const formatPoints = (pts) => pts || '0 - 0';

  let gamesHtml = (sheet.games || []).map((game, gIdx) => {
    const bannerClass = gIdx === 0 ? 'game-banner-1' : gIdx === 1 ? 'game-banner-2' : 'game-banner-3';
    
    const setTargetPoints = fixture.max_points_per_set || 25;
    const setTimeLimit = fixture.set_time_limit_minutes || 25;

    return `
      <div id="gameSetCard_${gIdx}" class="mb-6 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm transition-all duration-300">
        
        <!-- Game Sub-Header -->
        <div class="${bannerClass} px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold border-b border-slate-700">
          <div class="flex items-center gap-2">
            <span class="text-sm font-black uppercase">SET / GAME NO: ${game.gameNo}</span>
            <span class="text-[11px] font-normal opacity-80">(Target: ${setTargetPoints} pts &bull; 6 Boards + Tie-Break)</span>
          </div>
          <div class="flex items-center gap-4 text-xs font-semibold">
            <div class="flex items-center gap-1.5">
              <span>Start:</span>
              <input type="time" value="${game.startTime || ''}" ${disabledAttr} onchange="onSheetTimeChange(${gIdx}, 'startTime', this.value)" class="sheet-input w-24 bg-white/30 dark:bg-black/30 rounded px-1.5 py-0.5 text-xs font-bold">
            </div>
            <div class="flex items-center gap-1.5">
              <span>Finish:</span>
              <input type="time" value="${game.finishTime || ''}" ${disabledAttr} onchange="onSheetTimeChange(${gIdx}, 'finishTime', this.value)" class="sheet-input w-24 bg-white/30 dark:bg-black/30 rounded px-1.5 py-0.5 text-xs font-bold">
            </div>
          </div>
        </div>

        <!-- Dynamic Set Winner & Move to Next Set Banner -->
        ${game.wonBy ? `
          <div class="px-3 py-2 bg-gradient-to-r from-emerald-950 via-teal-950 to-emerald-950 border-b border-emerald-500/40 flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
              <span class="font-extrabold text-emerald-300">
                🎉 Set ${game.gameNo} Won by: <strong class="text-white font-black underline">${game.wonBy === 'player_1' ? escapeHtml(p1Name) : escapeHtml(p2Name)}</strong> (Points: ${game.points})
              </span>
            </div>
            ${gIdx < 2 && !sheet.result?.matchWonBy ? `
              <button onclick="scrollToGameSet(${gIdx + 1})" class="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black shadow-md flex items-center gap-1.5 transition transform active:scale-95">
                <span>Move to Set ${gIdx + 2}</span>
                <i class="fa-solid fa-arrow-down"></i>
              </button>
            ` : ''}
          </div>
        ` : `
          <div class="px-3 py-1.5 bg-slate-900/60 border-b border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span>Set ${game.gameNo} in progress (Target: ${setTargetPoints} pts to win this set)</span>
            </span>
            <span class="font-mono text-amber-400 font-bold">${setTimeLimit} min countdown limit</span>
          </div>
        `}

        <!-- 8-Board Scores Table -->
        <div class="overflow-x-auto">
          <table class="sheet-table">
            <thead>
              <tr>
                <th rowspan="2" class="w-20">Board No</th>
                <th rowspan="2" class="w-16">Break By</th>
                <th colspan="4" class="bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200">
                  <div class="font-black text-xs">${escapeHtml(p1Name)}</div>
                  <div class="text-[10px] font-normal opacity-75">${escapeHtml(game.p1State || 'Tamil Nadu')}</div>
                </th>
                <th colspan="4" class="bg-amber-50/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200">
                  <div class="font-black text-xs">${escapeHtml(p2Name)}</div>
                  <div class="text-[10px] font-normal opacity-75">${escapeHtml(game.p2State || 'Karnataka')}</div>
                </th>
              </tr>
              <tr>
                <!-- Player 1 Columns -->
                <th class="w-14">Queen</th>
                <th class="w-14">C/M</th>
                <th class="w-14">Total</th>
                <th class="w-16 bg-blue-100/50 dark:bg-blue-900/30">Cum.</th>
                <!-- Player 2 Columns -->
                <th class="w-14">Queen</th>
                <th class="w-14">C/M</th>
                <th class="w-14">Total</th>
                <th class="w-16 bg-amber-100/50 dark:bg-amber-900/30">Cum.</th>
              </tr>
            </thead>
            <tbody>
              ${(game.boards || []).map((b, bIdx) => `
                <tr class="${bIdx % 2 === 0 ? 'bg-slate-50/30 dark:bg-slate-900/30' : ''}">
                  <td class="font-bold text-xs">${b.boardNo}</td>
                  <td class="font-semibold text-xs font-mono">${b.breakBy === 'player_1' ? 'P1' : 'P2'}</td>
                  
                  <!-- Player 1 Cells -->
                  <td>
                    <input type="number" min="0" max="3" step="3" value="${b.p1Queen || 0}" ${disabledAttr} onchange="onSheetCellChange(${gIdx}, ${bIdx}, 'p1Queen', this.value)" class="sheet-input ${b.p1Queen ? 'text-red-600 font-black' : ''}">
                  </td>
                  <td>
                    <input type="number" min="0" max="9" value="${b.p1Cm || 0}" ${disabledAttr} onchange="onSheetCellChange(${gIdx}, ${bIdx}, 'p1Cm', this.value)" class="sheet-input">
                  </td>
                  <td class="font-bold text-xs">${b.p1Total || 0}</td>
                  <td class="font-black font-mono text-xs bg-blue-100/30 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">${b.p1Cum || 0}</td>

                  <!-- Player 2 Cells -->
                  <td>
                    <input type="number" min="0" max="3" step="3" value="${b.p2Queen || 0}" ${disabledAttr} onchange="onSheetCellChange(${gIdx}, ${bIdx}, 'p2Queen', this.value)" class="sheet-input ${b.p2Queen ? 'text-red-600 font-black' : ''}">
                  </td>
                  <td>
                    <input type="number" min="0" max="9" value="${b.p2Cm || 0}" ${disabledAttr} onchange="onSheetCellChange(${gIdx}, ${bIdx}, 'p2Cm', this.value)" class="sheet-input">
                  </td>
                  <td class="font-bold text-xs">${b.p2Total || 0}</td>
                  <td class="font-black font-mono text-xs bg-amber-100/30 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">${b.p2Cum || 0}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr class="font-bold text-xs bg-slate-100 dark:bg-slate-800">
                <td colspan="2" class="text-right pr-3 uppercase">Game ${game.gameNo} Result:</td>
                <td colspan="4" class="text-left pl-3 text-blue-700 dark:text-blue-300 font-black">
                  Won By: ${game.wonBy === 'player_1' ? escapeHtml(p1Name) : game.wonBy === 'player_2' ? escapeHtml(p2Name) : 'In Progress'}
                </td>
                <td colspan="4" class="text-right pr-3 text-amber-700 dark:text-amber-300 font-black">
                  Points: ${formatPoints(game.points)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

      </div>
    `;
  }).join('');

  container.innerHTML = `
    <!-- Top Official Header (Exact Chennai / TN / AICF Format) -->
    <div class="border-b-2 border-slate-900 pb-4 mb-5 text-center">
      <div class="text-[11px] font-black tracking-widest uppercase text-amber-600 dark:text-amber-400">
        TAMIL NADU STATE CARROM ASSOCIATION &bull; CHENNAI DISTRICT
      </div>
      <h2 class="text-xl md:text-2xl font-black uppercase tracking-tight text-slate-950 dark:text-white mt-0.5">
        OFFICIAL MATCH SCORE SHEET
      </h2>
      <div class="text-xs font-semibold text-slate-600 dark:text-slate-400">
        ${escapeHtml(fixture.tournament_title || 'Bangalore Open Carrom Championship 2026')}
      </div>

      <!-- Match Metadata Table Grid -->
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-left text-xs">
        
        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Match No</span>
          <input type="text" value="${sheet.matchNo || ''}" ${disabledAttr} onchange="onSheetMetaChange('matchNo', this.value)" class="sheet-input text-left font-bold" placeholder="M-01">
        </div>

        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Pool / Group</span>
          <input type="text" value="${sheet.pool || ''}" ${disabledAttr} onchange="onSheetMetaChange('pool', this.value)" class="sheet-input text-left font-bold" placeholder="Pool A">
        </div>

        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Age Group / Event</span>
          <input type="text" value="${sheet.ageGroup || ''}" ${disabledAttr} onchange="onSheetMetaChange('ageGroup', this.value)" class="sheet-input text-left font-bold" placeholder="Men Singles">
        </div>

        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Game Type</span>
          <input type="text" value="${sheet.gameType || 'Singles'}" ${disabledAttr} onchange="onSheetMetaChange('gameType', this.value)" class="sheet-input text-left font-bold" placeholder="Singles">
        </div>

        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Board No</span>
          <span class="font-extrabold text-sm block mt-0.5">Board #${sheet.boardNumber || fixture.board_number || 1}</span>
        </div>

        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Round</span>
          <span class="font-extrabold text-sm block mt-0.5">${sheet.round || 'Round 1'}</span>
        </div>

      </div>

      <!-- Toss & Official Assignee Row -->
      <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-left text-xs">
        
        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Toss Won By</span>
          <select ${disabledAttr} onchange="onSheetMetaChange('tossWonBy', this.value)" class="sheet-input text-left font-bold">
            <option value="player_1" ${sheet.tossWonBy === 'player_1' ? 'selected' : ''}>${escapeHtml(p1Name)}</option>
            <option value="player_2" ${sheet.tossWonBy === 'player_2' ? 'selected' : ''}>${escapeHtml(p2Name)}</option>
          </select>
        </div>

        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Choice</span>
          <select ${disabledAttr} onchange="onSheetMetaChange('tossChoice', this.value)" class="sheet-input text-left font-bold">
            <option value="break" ${sheet.tossChoice === 'break' ? 'selected' : ''}>Break (White Coins)</option>
            <option value="side" ${sheet.tossChoice === 'side' ? 'selected' : ''}>Side (Black Coins)</option>
          </select>
        </div>

        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Umpire (Referee)</span>
          <input type="text" value="${sheet.umpireName || fixture.referee_name || ''}" ${disabledAttr} onchange="onSheetMetaChange('umpireName', this.value)" class="sheet-input text-left font-bold" placeholder="Umpire Name">
        </div>

        <div class="p-2 border border-slate-400/80 rounded bg-slate-50/50 dark:bg-slate-900/50">
          <span class="block text-[10px] font-bold text-slate-500 uppercase">Chief Referee</span>
          <input type="text" value="${sheet.chiefRefereeName || ''}" ${disabledAttr} onchange="onSheetMetaChange('chiefRefereeName', this.value)" class="sheet-input text-left font-bold" placeholder="Chief Referee Name">
        </div>

      </div>
    </div>

    <!-- The 3 Games (Sets) Tables -->
    <div class="space-y-4">
      ${gamesHtml}
    </div>

    <!-- Match Summary & Official Signatures Section -->
    <div class="mt-6 border-2 border-slate-900 dark:border-slate-700 rounded-xl p-4 bg-slate-50/80 dark:bg-slate-900/80 space-y-4">
      
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-300 dark:border-slate-700 pb-3">
        <div>
          <span class="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 block">Overall Match Result</span>
          <div class="text-base font-black text-slate-900 dark:text-white mt-0.5 flex items-center gap-2">
            <span>Match Won By:</span>
            <span class="text-amber-600 dark:text-amber-400 text-lg">
              ${sheet.result?.matchWonBy === 'player_1' ? escapeHtml(p1Name) : sheet.result?.matchWonBy === 'player_2' ? escapeHtml(p2Name) : '<span class="text-slate-500 font-semibold text-sm">Match in Progress</span>'}
            </span>
          </div>
        </div>
        
        <div class="text-right text-xs">
          <span class="font-bold text-slate-500 dark:text-slate-400 block uppercase">Sets Points Breakdown</span>
          <span class="font-mono font-bold text-sm text-slate-800 dark:text-slate-200">
            ${(sheet.games || []).map((g, i) => `G${i+1}: ${g.points || '0-0'}`).join(' &bull; ')}
          </span>
        </div>
      </div>

      <!-- 4 Signatures Grid (Winner, Loser, Umpire, Chief Referee) -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs pt-2">
        
        <div class="border border-slate-400/80 rounded-lg p-2.5 text-center bg-white dark:bg-slate-950">
          <input type="text" value="${sheet.result?.winnerSignature || ''}" ${disabledAttr} onchange="onSheetResultChange('winnerSignature', this.value)" class="sheet-input border-b border-dashed border-slate-400 pb-1 mb-1 font-semibold italic" placeholder="Sign / Full Name">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">Winner's Signature</span>
        </div>

        <div class="border border-slate-400/80 rounded-lg p-2.5 text-center bg-white dark:bg-slate-950">
          <input type="text" value="${sheet.result?.loserSignature || ''}" ${disabledAttr} onchange="onSheetResultChange('loserSignature', this.value)" class="sheet-input border-b border-dashed border-slate-400 pb-1 mb-1 font-semibold italic" placeholder="Sign / Full Name">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">Loser's Signature</span>
        </div>

        <div class="border border-slate-400/80 rounded-lg p-2.5 text-center bg-white dark:bg-slate-950">
          <input type="text" value="${sheet.result?.umpireSignature || ''}" ${disabledAttr} onchange="onSheetResultChange('umpireSignature', this.value)" class="sheet-input border-b border-dashed border-slate-400 pb-1 mb-1 font-semibold italic" placeholder="Sign / Full Name">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">Umpire's Signature</span>
        </div>

        <div class="border border-slate-400/80 rounded-lg p-2.5 text-center bg-white dark:bg-slate-950">
          <input type="text" value="${sheet.result?.chiefRefereeSignature || ''}" ${disabledAttr} onchange="onSheetResultChange('chiefRefereeSignature', this.value)" class="sheet-input border-b border-dashed border-slate-400 pb-1 mb-1 font-semibold italic" placeholder="Sign / Full Name">
          <span class="text-[10px] font-bold text-slate-500 uppercase block">Chief Referee Signature</span>
        </div>

      </div>

    </div>
  `;
}

/**
 * Handle Board Cell Points Change
 */
function onSheetCellChange(gameIdx, boardIdx, field, value) {
  if (!currentScoreSheetData) return;
  const numVal = parseInt(value, 10) || 0;
  const board = currentScoreSheetData.games[gameIdx].boards[boardIdx];
  board[field] = numVal;

  // Carrom Rule: Only one player scores in a given board
  if (field === 'p1Queen' || field === 'p1Cm') {
    if (numVal > 0) {
      board.p2Queen = 0;
      board.p2Cm = 0;
    }
  } else if (field === 'p2Queen' || field === 'p2Cm') {
    if (numVal > 0) {
      board.p1Queen = 0;
      board.p1Cm = 0;
    }
  }

  recalculateSheetTotals();
  renderOfficialScoreSheet(currentScoreSheetFixture, currentScoreSheetData, currentScoreSheetCanEdit);
}

/**
 * Recalculate Totals, Cumulative Scores, Game Winners, and Sets
 */
function recalculateSheetTotals() {
  if (!currentScoreSheetData || !currentScoreSheetData.games) return;

  let p1GamesWon = 0;
  let p2GamesWon = 0;

  currentScoreSheetData.games.forEach((g) => {
    let p1Cum = 0;
    let p2Cum = 0;

    (g.boards || []).forEach(b => {
      const p1Q = parseInt(b.p1Queen, 10) || 0;
      const p1C = parseInt(b.p1Cm, 10) || 0;
      b.p1Total = p1Q + p1C;
      p1Cum += b.p1Total;
      b.p1Cum = p1Cum;

      const p2Q = parseInt(b.p2Queen, 10) || 0;
      const p2C = parseInt(b.p2Cm, 10) || 0;
      b.p2Total = p2Q + p2C;
      p2Cum += b.p2Total;
      b.p2Cum = p2Cum;
    });

    if (p1Cum > 0 || p2Cum > 0) {
      if (p1Cum > p2Cum) {
        g.wonBy = 'player_1';
        g.points = `${p1Cum} - ${p2Cum}`;
        p1GamesWon++;
      } else if (p2Cum > p1Cum) {
        g.wonBy = 'player_2';
        g.points = `${p2Cum} - ${p1Cum}`;
        p2GamesWon++;
      }
    }
  });

  currentScoreSheetData.result = currentScoreSheetData.result || {};
  if (p1GamesWon >= 2) {
    currentScoreSheetData.result.matchWonBy = 'player_1';
    currentScoreSheetData.result.winnerName = currentScoreSheetFixture?.p1_name || currentScoreSheetFixture?.player_1_name || 'Player 1';
  } else if (p2GamesWon >= 2) {
    currentScoreSheetData.result.matchWonBy = 'player_2';
    currentScoreSheetData.result.winnerName = currentScoreSheetFixture?.p2_name || currentScoreSheetFixture?.player_2_name || 'Player 2';
  } else {
    currentScoreSheetData.result.matchWonBy = '';
    currentScoreSheetData.result.winnerName = '';
  }
}

function scrollToGameSet(gameIdx) {
  const target = document.getElementById(`gameSetCard_${gameIdx}`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('ring-4', 'ring-amber-500');
    setTimeout(() => target.classList.remove('ring-4', 'ring-amber-500'), 2500);
  }
}

function onSheetTimeChange(gameIdx, field, val) {
  if (!currentScoreSheetData) return;
  currentScoreSheetData.games[gameIdx][field] = val;
}

function onSheetMetaChange(field, val) {
  if (!currentScoreSheetData) return;
  currentScoreSheetData[field] = val;
}

function onSheetResultChange(field, val) {
  if (!currentScoreSheetData) return;
  currentScoreSheetData.result = currentScoreSheetData.result || {};
  currentScoreSheetData.result[field] = val;
}

/**
 * Render Quick Touch Drawer for Mobile Referees
 */
function renderQuickTouchDrawer() {
  const drawer = document.getElementById('quickTouchDrawer');
  if (!drawer) return;

  if (!currentScoreSheetCanEdit) {
    drawer.classList.add('hidden');
    return;
  }
  drawer.classList.remove('hidden');

  const p1Name = currentScoreSheetFixture?.p1_name || currentScoreSheetFixture?.player_1_name || 'Player 1';
  const p2Name = currentScoreSheetFixture?.p2_name || currentScoreSheetFixture?.player_2_name || 'Player 2';
  const boardLabels = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'TB', 'SD'];

  drawer.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 live-pulse"></span>
        <span class="text-xs font-bold uppercase text-white tracking-wider flex items-center gap-1.5">
          <i class="fa-solid fa-mobile-screen text-amber-500"></i> Referee Quick-Touch Scorer
        </span>
        <span class="text-[10px] text-slate-400 hidden sm:inline">&bull; 1-Tap Thumb Input for Mobile Officials</span>
      </div>

      <!-- Game Selector Pills -->
      <div class="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
        ${[0, 1, 2].map(gIdx => `
          <button onclick="setQuickTouchGame(${gIdx})" class="px-3 py-1 rounded-lg text-xs font-bold transition ${quickTouchActiveGame === gIdx ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}">
            Game ${gIdx + 1}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Active Board Selector & Winner Selection -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      
      <!-- Board Selector -->
      <div>
        <label class="block text-[11px] font-semibold text-slate-400 mb-1">Select Board:</label>
        <div class="grid grid-cols-4 sm:grid-cols-8 gap-1">
          ${boardLabels.map((lbl, idx) => `
            <button onclick="setQuickTouchBoard(${idx})" class="py-1.5 rounded-lg text-xs font-bold transition border ${quickTouchActiveBoard === idx ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md font-black' : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'}">
              ${lbl}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Who Won This Board? -->
      <div>
        <label class="block text-[11px] font-semibold text-slate-400 mb-1">Board Winner (Scoring Player):</label>
        <div class="grid grid-cols-2 gap-2">
          <button onclick="setQuickTouchPlayer('player_1')" class="p-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${quickTouchSelectedPlayer === 'player_1' ? 'bg-blue-600 text-white border-blue-400 shadow-md' : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'}">
            <span class="w-2 h-2 rounded-full bg-white"></span>
            <span class="truncate">${escapeHtml(p1Name)}</span>
          </button>
          <button onclick="setQuickTouchPlayer('player_2')" class="p-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${quickTouchSelectedPlayer === 'player_2' ? 'bg-amber-600 text-white border-amber-400 shadow-md' : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'}">
            <span class="w-2 h-2 rounded-full bg-slate-900 border border-white"></span>
            <span class="truncate">${escapeHtml(p2Name)}</span>
          </button>
        </div>
      </div>

      <!-- Queen Bonus & Carrom Men Selection -->
      <div class="flex flex-col justify-between">
        <label class="block text-[11px] font-semibold text-slate-400 mb-1">Coins Pocketed (Queen + C/M):</label>
        <div class="flex items-center gap-2">
          <!-- Queen Toggle Button -->
          <button onclick="toggleQuickTouchQueen()" class="px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 border ${quickTouchHasQueen ? 'bg-red-600 text-white border-red-400 shadow-lg animate-pulse' : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-600'}">
            <i class="fa-solid fa-crown text-yellow-300"></i>
            <span>Queen (+3)</span>
          </button>

          <!-- C/M Quick Pills -->
          <div class="flex-1 flex items-center gap-1 overflow-x-auto">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => `
              <button onclick="setQuickTouchCm(${num})" class="w-8 h-8 rounded-lg text-xs font-extrabold transition flex items-center justify-center border ${quickTouchCmValue === num ? 'bg-emerald-600 text-white border-emerald-400 shadow' : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'}">
                ${num}
              </button>
            `).join('')}
          </div>

          <!-- Apply Button -->
          <button onclick="applyQuickTouchBoard()" class="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs shadow-lg transition flex items-center gap-1.5">
            <i class="fa-solid fa-check"></i> Apply
          </button>
        </div>
      </div>

    </div>
  `;
}

function setQuickTouchGame(idx) {
  quickTouchActiveGame = idx;
  renderQuickTouchDrawer();
}

function setQuickTouchBoard(idx) {
  quickTouchActiveBoard = idx;
  renderQuickTouchDrawer();
}

function setQuickTouchPlayer(playerKey) {
  quickTouchSelectedPlayer = playerKey;
  renderQuickTouchDrawer();
}

function toggleQuickTouchQueen() {
  quickTouchHasQueen = !quickTouchHasQueen;
  renderQuickTouchDrawer();
}

function setQuickTouchCm(cm) {
  quickTouchCmValue = cm;
  renderQuickTouchDrawer();
}

/**
 * Apply Quick Touch Board Entry
 */
function applyQuickTouchBoard() {
  if (!currentScoreSheetData) return;
  const game = currentScoreSheetData.games[quickTouchActiveGame];
  if (!game) return;
  const board = game.boards[quickTouchActiveBoard];
  if (!board) return;

  const queenVal = quickTouchHasQueen ? 3 : 0;
  const cmVal = quickTouchCmValue || 0;

  if (quickTouchSelectedPlayer === 'player_1') {
    board.p1Queen = queenVal;
    board.p1Cm = cmVal;
    board.p2Queen = 0;
    board.p2Cm = 0;
  } else {
    board.p2Queen = queenVal;
    board.p2Cm = cmVal;
    board.p1Queen = 0;
    board.p1Cm = 0;
  }

  recalculateSheetTotals();
  renderOfficialScoreSheet(currentScoreSheetFixture, currentScoreSheetData, currentScoreSheetCanEdit);

  if (quickTouchHasQueen) {
    playQueenSound();
  } else {
    playStrikerSound();
  }

  showToastNotification(`✓ Logged Board #${quickTouchActiveBoard + 1} (${board.p1Total || board.p2Total} pts) in Game ${quickTouchActiveGame + 1}`);

  // Automatically advance to next board
  if (quickTouchActiveBoard < 7) {
    quickTouchActiveBoard++;
  } else if (quickTouchActiveGame < 2) {
    quickTouchActiveGame++;
    quickTouchActiveBoard = 0;
  }
  // Reset coin inputs
  quickTouchHasQueen = false;
  quickTouchCmValue = 0;
  renderQuickTouchDrawer();
}

/**
 * Save Official Score Sheet via API
 */
async function saveOfficialScoreSheet(isComplete = false) {
  if (!currentScoreSheetFixture || !currentScoreSheetData) return;
  if (!currentToken) {
    alert('Please sign in as tournament organizer or super admin to save this score sheet.');
    return;
  }

  const saveBtn = document.getElementById('saveScoreSheetBtn');
  const completeBtn = document.getElementById('completeMatchBtn');

  if (saveBtn) saveBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...`;
  if (completeBtn) completeBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Locking...`;

  try {
    const res = await fetch(`/api/fixtures/${activeFixtureId}/score-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        sheet: currentScoreSheetData,
        matchStatus: isComplete ? 'completed' : 'live'
      })
    });

    if (res.ok) {
      const data = await res.json();
      currentScoreSheetData = data.sheet;
      renderOfficialScoreSheet(currentScoreSheetFixture, currentScoreSheetData, currentScoreSheetCanEdit);

      if (isComplete) {
        playQueenSound();
        showToastNotification(`🏆 Match Completed & Locked! Final Winner: ${data.sheet?.result?.winnerName || 'Winner'}`);
      } else {
        playStrikerSound();
        showToastNotification('✓ Official Score Sheet saved successfully!');
      }
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to save official score sheet');
    }
  } catch (e) {
    console.error(e);
    alert('Network error while saving score sheet');
  } finally {
    if (saveBtn) saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Sheet`;
    if (completeBtn) completeBtn.innerHTML = `<i class="fa-solid fa-trophy"></i> Lock & Complete`;
  }
}

// =============================================================
// MOBILE PWA INSTALL ENGINE (1-Click Install Experience)
// =============================================================

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('installAppBtn');
  if (btn) btn.classList.remove('hidden');
});

async function installPWA() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      showToastNotification('🎉 CarromX installed successfully! Open from your mobile app launcher.');
    }
    deferredInstallPrompt = null;
  } else {
    showInstallModal();
  }
}

function showInstallModal() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const alertText = isIos
    ? '📱 To install CarromX on iPhone / iPad:\n1. Tap the "Share" button at the bottom of Safari.\n2. Scroll down and tap "Add to Home Screen".'
    : '📱 To install CarromX on Android / Chrome:\n1. Tap the 3 dots (⋮) in Google Chrome.\n2. Tap "Install App" or "Add to Home Screen".';
  alert(alertText);
}

// =============================================================
// TOURNAMENT MATCH TIMING & SET DURATION MANAGEMENT ENGINE
// =============================================================

let activeTournamentFixtures = [];
let activeTournamentBoards = [];
let activeTournamentData = null;

function formatDateTimeLocal(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Organizer saves tournament-level timing rules
 */
async function saveActiveTournamentTiming() {
  if (!currentTournamentId) {
    alert('Please select an active tournament first.');
    return;
  }
  const setTimeLimit = parseInt(document.getElementById('fixturesSetTimingLimit')?.value, 10);
  const matchDuration = parseInt(document.getElementById('fixturesRoundDuration')?.value, 10);

  try {
    const res = await fetch(`/api/tournaments/${currentTournamentId}/timing`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({
        set_time_limit_minutes: isNaN(setTimeLimit) ? 25 : setTimeLimit,
        match_duration_minutes: isNaN(matchDuration) ? 45 : matchDuration
      })
    });
    if (res.ok) {
      playStrikerSound();
      showToastNotification(`⏱️ Saved Tournament Rules: ${setTimeLimit}m per set, ${matchDuration}m match slots!`);
      await loadOrganizerTournamentData();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to update tournament timing rules');
    }
  } catch (e) {
    console.error(e);
    alert('Error saving tournament timing: ' + e.message);
  }
}

/**
 * Open modal to edit a specific match's timing and board assignment
 */
function openEditMatchTimingModal(fixtureId) {
  const f = (activeTournamentFixtures || []).find(x => x.fixture_id === fixtureId);
  if (!f) {
    alert('Match details not found in cache. Refreshing data...');
    loadOrganizerTournamentData();
    return;
  }

  const p1 = f.p1_name || f.player_1_name || 'Player 1';
  const p2 = f.p2_name || f.player_2_name || 'Player 2';
  const modal = document.getElementById('editMatchTimingModal');
  const matchLabel = document.getElementById('editModalMatchLabel');
  const playersLabel = document.getElementById('editModalPlayersLabel');
  const fixIdInput = document.getElementById('editModalFixtureId');
  const startTimeInput = document.getElementById('editModalStartTime');
  const boardSelect = document.getElementById('editModalBoardSelect');
  const setLimitSelect = document.getElementById('editModalSetTimeLimit');

  const matchIndex = (activeTournamentFixtures || []).indexOf(f) + 1;
  if (matchLabel) matchLabel.innerText = `Match #${matchIndex} • Round ${f.round_number || 1}`;
  if (playersLabel) playersLabel.innerText = `${p1} VS ${p2}`;
  if (fixIdInput) fixIdInput.value = fixtureId;

  if (startTimeInput) {
    startTimeInput.value = formatDateTimeLocal(f.scheduled_start_time || new Date());
  }

  if (boardSelect) {
    const boards = activeTournamentBoards && activeTournamentBoards.length > 0 
      ? activeTournamentBoards 
      : [{ board_id: f.board_id, board_number: f.board_number || 1 }];
    boardSelect.innerHTML = boards.map(b => `
      <option value="${b.board_id}" ${b.board_id === f.board_id ? 'selected' : ''}>
        Board #${b.board_number}
      </option>
    `).join('');
  }

  if (setLimitSelect) {
    setLimitSelect.value = String(f.set_time_limit_minutes !== undefined && f.set_time_limit_minutes !== null ? f.set_time_limit_minutes : 25);
  }

  if (modal) modal.classList.remove('hidden');
}

function closeEditMatchTimingModal() {
  document.getElementById('editMatchTimingModal')?.classList.add('hidden');
}

function setQuickMatchTime(offsetMinutes) {
  const startTimeInput = document.getElementById('editModalStartTime');
  if (!startTimeInput) return;
  const target = new Date(Date.now() + offsetMinutes * 60 * 1000);
  startTimeInput.value = formatDateTimeLocal(target);
}

/**
 * Handle saving updated timing & board for a match
 */
async function handleSaveFixtureTiming(e) {
  e.preventDefault();
  const fixtureId = document.getElementById('editModalFixtureId')?.value;
  const startTimeVal = document.getElementById('editModalStartTime')?.value;
  const boardId = document.getElementById('editModalBoardSelect')?.value;
  const setTimeLimit = parseInt(document.getElementById('editModalSetTimeLimit')?.value, 10);

  if (!fixtureId || !startTimeVal) return;

  try {
    const res = await fetch(`/api/fixtures/${fixtureId}/reassign`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
        'x-carromx-active-role': activeRole
      },
      body: JSON.stringify({
        boardId: boardId || null,
        scheduledStartTime: new Date(startTimeVal).toISOString(),
        setTimeLimitMinutes: isNaN(setTimeLimit) ? 25 : setTimeLimit
      })
    });

    if (res.ok) {
      closeEditMatchTimingModal();
      playStrikerSound();
      showToastNotification(`⏰ Match updated: Start at ${new Date(startTimeVal).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (Set: ${setTimeLimit}m)!`);
      await loadOrganizerTournamentData();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to update match timing');
    }
  } catch (err) {
    console.error(err);
    alert('Network error while updating match timing: ' + err.message);
  }
}

// =============================================================
// OFFICIAL AICF SCORE SHEET COUNTDOWN TIMER ENGINE
// =============================================================

let setTimerInterval = null;
let setTimerTotalSeconds = 25 * 60;
let setTimerRemainingSeconds = 25 * 60;
let setTimerIsRunning = false;

function initScoreSheetSetTimer(minutes) {
  stopSetTimer();
  const mins = parseInt(minutes, 10);
  const badge = document.getElementById('scoreSheetSetLimitBadge');
  const statusText = document.getElementById('setTimerStatusText');
  const disp = document.getElementById('setTimerDisplay');

  if (mins === 0) {
    setTimerTotalSeconds = 0;
    setTimerRemainingSeconds = 0;
    if (disp) disp.innerText = 'NO LIMIT';
    if (badge) badge.innerText = 'Points Only';
    if (statusText) statusText.innerText = 'Unlimited Time';
    return;
  }

  setTimerTotalSeconds = mins * 60;
  setTimerRemainingSeconds = setTimerTotalSeconds;
  setTimerIsRunning = false;
  updateSetTimerUI();
  if (badge) badge.innerText = `${mins} Mins Limit`;
}

function updateSetTimerUI() {
  const disp = document.getElementById('setTimerDisplay');
  const btn = document.getElementById('setTimerToggleBtn');
  const statusText = document.getElementById('setTimerStatusText');
  if (!disp) return;

  const m = Math.floor(setTimerRemainingSeconds / 60);
  const s = setTimerRemainingSeconds % 60;
  disp.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  if (setTimerRemainingSeconds <= 60 && setTimerRemainingSeconds > 0) {
    disp.className = 'font-mono text-2xl md:text-3xl font-black text-rose-500 animate-pulse tracking-wider';
    if (statusText) statusText.innerText = 'Final Minute!';
  } else if (setTimerRemainingSeconds === 0) {
    disp.className = 'font-mono text-2xl md:text-3xl font-black text-rose-600 tracking-wider';
    if (statusText) statusText.innerText = '⏰ TIME EXPIRED!';
  } else {
    disp.className = 'font-mono text-2xl md:text-3xl font-black text-amber-400 tracking-wider';
    if (statusText) statusText.innerText = setTimerIsRunning ? 'Clock Running' : 'Ready / Paused';
  }

  if (btn) {
    if (setTimerIsRunning) {
      btn.innerHTML = `<i class="fa-solid fa-pause"></i> <span>Pause Clock</span>`;
      btn.className = 'px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow transition flex items-center gap-1.5 active:scale-95';
    } else {
      btn.innerHTML = `<i class="fa-solid fa-play"></i> <span>Start Set Clock</span>`;
      btn.className = 'px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-bold text-xs shadow transition flex items-center gap-1.5 active:scale-95';
    }
  }
}

function toggleSetTimer() {
  if (setTimerTotalSeconds === 0) return;
  if (setTimerIsRunning) {
    pauseSetTimer();
  } else {
    startSetTimer();
  }
}

function startSetTimer() {
  if (setTimerRemainingSeconds <= 0) {
    setTimerRemainingSeconds = setTimerTotalSeconds;
  }
  setTimerIsRunning = true;
  updateSetTimerUI();
  playStrikerSound();

  // Stamp start time into active game on score sheet if not set
  autoStampActiveGameTime('startTime');

  if (setTimerInterval) clearInterval(setTimerInterval);
  setTimerInterval = setInterval(() => {
    if (setTimerRemainingSeconds > 0) {
      setTimerRemainingSeconds--;
      updateSetTimerUI();
      if (setTimerRemainingSeconds === 0) {
        onSetTimerExpired();
      }
    } else {
      stopSetTimer();
    }
  }, 1000);
}

function pauseSetTimer() {
  setTimerIsRunning = false;
  if (setTimerInterval) clearInterval(setTimerInterval);
  updateSetTimerUI();
}

function stopSetTimer() {
  setTimerIsRunning = false;
  if (setTimerInterval) clearInterval(setTimerInterval);
}

function resetSetTimer() {
  stopSetTimer();
  setTimerRemainingSeconds = setTimerTotalSeconds;
  updateSetTimerUI();
}

function adjustSetTimer(seconds) {
  setTimerRemainingSeconds = Math.max(0, setTimerRemainingSeconds + seconds);
  updateSetTimerUI();
}

function onSetTimerExpired() {
  stopSetTimer();
  updateSetTimerUI();
  playBuzzerSound();
  autoStampActiveGameTime('finishTime');
  showToastNotification('⏰ Set Time Limit Reached (25 Minutes)! Official Set Ended.');
}

function autoStampActiveGameTime(field) {
  try {
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const gIdx = typeof quickTouchActiveGame !== 'undefined' ? quickTouchActiveGame : 0;
    const input = document.querySelector(`input[onchange*="onSheetTimeChange(${gIdx}, '${field}'"]`);
    if (input && !input.value) {
      input.value = nowStr;
      if (typeof onSheetTimeChange === 'function') {
        onSheetTimeChange(gIdx, field, nowStr);
      }
    }
  } catch (e) {}
}


