'use strict';

// ── State ─────────────────────────────────────────────────────
const appState = {
  currentPage: 'home',
  prevPage:    'home',
  searchQuery: '', searchPage: 1, isLoading: false, hasMore: true, totalGames: 0,
  currentGame: null,
  gamePageInfo: null,
  downloads: {},
  library: [],
  libTab: 'downloading',
  settings: {},
  dlStartTimes: {},
};

const $ = id => document.getElementById(id);
const q = (sel, ctx) => (ctx || document).querySelector(sel);

function openCarouselFullscreen(src, allSrcs) {
  let idx = allSrcs.indexOf(src);
  const overlay = document.createElement('div');
  overlay.id = 'fs-overlay';

  function render() {
    overlay.innerHTML = `
      <button class="fs-nav fs-prev">&#8249;</button>
      <img src="${allSrcs[idx]}" alt="Screenshot"/>
      <button class="fs-nav fs-next">&#8250;</button>
      <button id="fs-close">&#10005;</button>
      <div id="fs-counter">${idx + 1} / ${allSrcs.length}</div>`;
    overlay.querySelector('.fs-prev').addEventListener('click', e => { e.stopPropagation(); idx = (idx - 1 + allSrcs.length) % allSrcs.length; render(); });
    overlay.querySelector('.fs-next').addEventListener('click', e => { e.stopPropagation(); idx = (idx + 1) % allSrcs.length; render(); });
    overlay.querySelector('#fs-close').addEventListener('click', () => cleanup());
  }

  function onKey(e) {
    if (e.key === 'ArrowLeft')  { idx = (idx - 1 + allSrcs.length) % allSrcs.length; render(); }
    if (e.key === 'ArrowRight') { idx = (idx + 1) % allSrcs.length; render(); }
    if (e.key === 'Escape') cleanup();
  }

  function cleanup() { overlay.remove(); document.removeEventListener('keydown', onKey); }

  overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  render();
}

const btnMin   = $('btn-min');
const btnMax   = $('btn-max');
const btnClose = $('btn-close');
const sbBtns   = document.querySelectorAll('.sb-btn');
const searchInput  = $('search-input');
const searchBtn    = $('search-btn');
const gameGrid     = $('game-grid');
const resultsLabel = $('results-label');
const loadMoreBtn  = $('load-more-btn');
const loadMoreSpin = $('load-more-spin');
const allLoaded    = $('all-loaded');
const libGrid    = $('lib-grid');
const libEmpty   = $('lib-empty');
const libCount   = $('lib-count');
const detailBannerBg   = $('detail-banner-bg');
const detailCover      = $('detail-cover');
const detailTitle      = $('detail-title');
const detailVersion    = $('detail-version');
const detailDesc       = $('detail-desc');
const detailSizeSpan   = q('#detail-size span');
const detailBack       = $('detail-back');
const detailWish       = $('detail-wish');
const dlBtn            = $('dl-btn');
const dlCancelBtn      = $('dl-cancel-btn');
const dlCancelBtn2     = $('dl-cancel-btn2');
const dlPauseBtn       = $('dl-pause-btn');
const dlRetryBtn       = $('dl-retry-btn');
const openFolderBtn    = $('open-folder-btn');
const openFolderBtn2   = $('open-folder-btn2');
const openPageBtn      = $('open-page-btn');
const dlBarFill        = $('dl-bar-fill');
const dlProgressPct    = $('dl-progress-pct');
const dlProgressBytes  = $('dl-progress-bytes');
const dlSpeedBadge     = $('dl-speed-badge');
const dlEtaBadge       = $('dl-eta-badge');
const dlProgressTitle  = $('dl-progress-title');
const dlStatusMsg      = $('dl-status-msg');
const dlExtractMsg     = $('dl-extract-msg');
const actionErrorRetry = $('action-error-retry');
const statusText       = $('status-text');
const launchBtn        = $('launch-btn');
const launchBtn2       = $('launch-btn2');
const uninstallBtn     = $('uninstall-btn');

function setStatus(msg) { statusText.innerHTML = msg; }

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function gameIdFromUrl(url) {
  const su = url.match(/steamunlocked\.org\/([^/?#]+)/);
  if (su) return su[1].replace(/-free-download.*$/, '').replace(/-+$/, '');
  const sr = url.match(/steamrip\.com\/([^/?#]+)/);
  if (sr) return 'sr-' + sr[1].replace(/-free-download.*$/, '').replace(/-+$/, '');
  const ag = url.match(/ankergames\.net\/game\/([^/?#]+)/);
  if (ag) return 'ag-' + ag[1].replace(/-+$/, '');
  return url;
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function fmtSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 100) return '';
  if (bytesPerSec > 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSec > 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

function fmtEta(recv, total, speed) {
  if (!speed || !total || recv >= total) return '';
  const secs = (total - recv) / speed;
  if (secs < 60) return `~${Math.ceil(secs)}s left`;
  if (secs < 3600) return `~${Math.ceil(secs / 60)}m left`;
  return `~${(secs / 3600).toFixed(1)}h left`;
}

// ── Discovery layout ──────────────────────────────────────────
// Discovery data is loaded live — no hardcoded games

function makeDiscGameCard(game) {
  const card = document.createElement('div');
  card.className = 'rail-card';
  card.innerHTML = `
    <div class="rail-cover">
      ${game.image
        ? `<img src="${escapeHtml(game.image)}" alt="${escapeHtml(game.title)}" loading="lazy"/>`
        : `<div class="rail-cover-ph"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" opacity=".25"><rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor"/><rect x="12" y="2" width="8" height="8" rx="1" fill="currentColor"/><rect x="2" y="12" width="8" height="8" rx="1" fill="currentColor"/><rect x="12" y="12" width="8" height="8" rx="1" fill="currentColor"/></svg></div>`}
      <div class="rail-hover-overlay">
        <span class="rail-play-btn">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2.5l8 4.5-8 4.5V2.5z" fill="currentColor"/></svg>
          View
        </span>
      </div>
    </div>
    <div class="rail-info">
      <div class="rail-title">${escapeHtml(game.title)}</div>
      ${game.version ? `<div class="rail-version">${escapeHtml(game.version)}</div>` : ''}
    </div>`;
  if (game.url) {
    card.addEventListener('click', () => openGameDetail({ url: game.url, title: game.title, image: game.image, version: game.version || null }));
  }
  return card;
}

function makeCoverListItem(item, rank) {
  const el = document.createElement('div');
  el.className = 'cover-list-item';
  el.innerHTML = `
    ${rank != null ? `<span class="cover-list-num">${rank}</span>` : ''}
    ${item.image
      ? `<img class="cover-list-img" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy"/>`
      : `<div class="cover-list-ph"></div>`}
    <div class="cover-list-info">
      <span class="cover-list-date">${escapeHtml(item.date || '')}</span>
      <div class="cover-list-title">${escapeHtml(item.title)}</div>
    </div>`;
  if (item.url) {
    el.addEventListener('click', () => openGameDetail({ url: item.url, title: item.title, image: item.image, version: null }));
  }
  return el;
}

function makeUpcomingCard(game) {
  const el = document.createElement('div');
  el.className = 'upcoming-list-item';
  if (game.url) el.style.cursor = 'pointer';
  el.innerHTML = `
    ${game.image
      ? `<img class="upcoming-list-cover" src="${escapeHtml(game.image)}" alt="${escapeHtml(game.title)}" loading="lazy"/>`
      : `<div class="upcoming-list-ph"></div>`}
    <div class="upcoming-list-info">
      <div class="upcoming-list-title">${escapeHtml(game.title)}</div>
      <div class="upcoming-list-date">${escapeHtml(game.date || 'TBA')}</div>
    </div>
    <span class="upcoming-soon-badge">SOON</span>`;
  if (game.url) {
    el.addEventListener('click', () => window.api.openExternal(game.url));
  }
  return el;
}



function renderUpcomingSection(games) {
  const upcomingGrid = $('grid-upcoming');
  if (!upcomingGrid) return;
  upcomingGrid.innerHTML = '';
  const badge = $('upcoming-badge');
  const count = $('upcoming-count');
  if (!games || games.length === 0) {
    upcomingGrid.innerHTML = '<div class="disc-error">Could not load upcoming games.</div>';
    if (badge) badge.classList.add('hidden');
    return;
  }
  games.slice(0, 5).forEach(g => upcomingGrid.appendChild(makeUpcomingCard(g)));
  if (badge && count) {
    count.innerHTML = games.length;
    badge.classList.remove('hidden');
  }
}

async function renderDiscovery() {
  // Show loading skeletons while fetching
  const skeletonCard = () => {
    const el = document.createElement('div');
    el.className = 'game-card disc-skeleton';
    el.innerHTML = '<div class="gc-cover"><div class="gc-placeholder"></div></div><div class="gc-info"><div class="gc-title" style="background:var(--surface-3,#333);border-radius:4px;height:12px;width:70%;margin-top:6px;"></div></div>';
    return el;
  };
  const skeletonListItem = () => {
    const el = document.createElement('div');
    el.className = 'cover-list-item disc-skeleton';
    el.innerHTML = '<span class="cover-list-num"></span><div class="cover-list-ph"></div><div class="cover-list-info"><div style="background:var(--surface-3,#333);border-radius:4px;height:11px;width:80%;"></div></div>';
    return el;
  };

  // Populate skeletons immediately
  const trendGrid = $('grid-trending');
  if (trendGrid) { trendGrid.innerHTML = ''; for (let i = 0; i < 6; i++) { const s = document.createElement('div'); s.className = 'skel-rail-card disc-skeleton'; trendGrid.appendChild(s); } }
  const latestGrid = $('grid-latest');
  if (latestGrid) { latestGrid.innerHTML = ''; for (let i = 0; i < 6; i++) { const s = document.createElement('div'); s.className = 'skel-rail-card disc-skeleton'; latestGrid.appendChild(s); } }
  const recentList = $('list-recent');
  if (recentList) { recentList.innerHTML = ''; for (let i = 0; i < 5; i++) recentList.appendChild(skeletonListItem()); }
  const popularList = $('list-popular');
  if (popularList) { popularList.innerHTML = ''; for (let i = 0; i < 5; i++) popularList.appendChild(skeletonListItem()); }

  // Hide upcoming badge, show it loading
  const upcomingGrid = $('grid-upcoming');
  const upcomingBadge = $('upcoming-badge');
  if (upcomingBadge) upcomingBadge.classList.add('hidden');

  // Helper: attach live indicator to a section head
  function addLiveNotice(grid) {
    const head = grid?.closest('.disc-section')?.querySelector('.disc-section-head');
    if (head && !head.querySelector('.disc-live-notice')) {
      const live = document.createElement('span');
      live.className = 'disc-live-notice';
      live.innerHTML = `<span class="disc-live-dot"></span>Live`;
      head.appendChild(live);
    }
  }

  // Fetch discovery data (AnkerGames + SteamUnlocked homepages) and upcoming in parallel
  const [discResult, upcomingResult] = await Promise.allSettled([
    window.api.fetchDiscovery(),
    window.api.fetchUpcoming(),
  ]);

  const disc = discResult.status === 'fulfilled' ? discResult.value : {};
  const upcomingGames = upcomingResult.status === 'fulfilled' ? upcomingResult.value.games : [];

  // ── Trending (AnkerGames carousel) ───────────────────────────
  if (trendGrid) {
    trendGrid.innerHTML = '';
    const games = disc.trending || [];
    if (games.length) {
      games.forEach((g, i) => {
        const card = makeDiscGameCard(g);
        if (i === 0) // first card: no special treatment in new rail layout
        trendGrid.appendChild(card);
      });
      addLiveNotice(trendGrid);
    } else {
      trendGrid.innerHTML = '<div class="disc-error">Could not load trending games.</div>';
    }
  }

  // ── Latest (AnkerGames homepage grid) ────────────────────────
  if (latestGrid) {
    latestGrid.innerHTML = '';
    const games = disc.latest || [];
    if (games.length) {
      games.forEach(g => latestGrid.appendChild(makeDiscGameCard(g)));
      addLiveNotice(latestGrid);
    } else {
      latestGrid.innerHTML = '<div class="disc-error">Could not load latest games.</div>';
    }
  }

  // ── Upcoming (AnkerGames /upcoming) ──────────────────────────
  renderUpcomingSection(upcomingGames);
  if (upcomingGrid) {
    const head = upcomingGrid.closest('.disc-section')?.querySelector('.disc-section-head');
    if (head && !head.querySelector('.disc-live-notice')) {
      const live = document.createElement('span');
      live.className = 'disc-live-notice';
      live.innerHTML = `<span class="disc-live-dot"></span>Live`;
      head.appendChild(live);
    }
  }

  // ── Recently Added (SteamUnlocked homepage) ──────────────────
  if (recentList) {
    recentList.innerHTML = '';
    const games = disc.recent || [];
    if (games.length) {
      games.forEach((g, i) => recentList.appendChild(makeCoverListItem(g, i + 1)));
      addLiveNotice(recentList);
    } else {
      recentList.innerHTML = '<div class="disc-error">Could not load recent games.</div>';
    }
  }

  // ── Popular (SteamUnlocked homepage) ─────────────────────────
  if (popularList) {
    popularList.innerHTML = '';
    const games = disc.popular || [];
    if (games.length) {
      games.forEach((g, i) => popularList.appendChild(makeCoverListItem(g, i + 1)));
      addLiveNotice(popularList);
    } else {
      popularList.innerHTML = '<div class="disc-error">Could not load popular games.</div>';
    }
  }
}

// ── Scanned game fix system ────────────────────────────────────
const gameFixMappings = JSON.parse(localStorage.getItem('nino-fix-mappings') || '{}');

function saveFixMappings() {
  localStorage.setItem('nino-fix-mappings', JSON.stringify(gameFixMappings));
}

// ── Library layout ────────────────────────────────────────────
let libLayout = localStorage.getItem('nino-lib-layout') || 'list';

function applyLibLayout() {
  libGrid.classList.remove('layout-cards', 'layout-list', 'layout-compact');
  if (libLayout !== 'list') libGrid.classList.add('layout-' + libLayout);
  document.querySelectorAll('.lib-layout-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === libLayout);
  });
}

// ── Hidden games system ───────────────────────────────────────
const hiddenGames = new Set(JSON.parse(localStorage.getItem('nino-hidden-games') || '[]'));
let showHiddenGames = false;

function toggleHideGame(id) {
  if (hiddenGames.has(id)) hiddenGames.delete(id);
  else hiddenGames.add(id);
  localStorage.setItem('nino-hidden-games', JSON.stringify([...hiddenGames]));
  refreshLibraryView();
}

function applyFixMapping(entry) {
  const mapping = gameFixMappings[entry.id];
  if (mapping) {
    return { ...entry, title: mapping.title, coverImage: mapping.coverImage, gameUrl: mapping.gameUrl, fixed: true };
  }
  return entry;
}

function openFixGameDialog(entry) {
  const dialog = $('fix-game-dialog');
  const folderInput = $('fix-folder-name');
  const searchInput2 = $('fix-search-input');
  const searchBtn2 = $('fix-search-btn');
  const resultsList = $('fix-search-results');
  const cancelBtn = $('fix-cancel-btn');
  if (!dialog) return;
  folderInput.value = entry.id || entry.title || '';
  searchInput2.value = entry.title || '';
  resultsList.innerHTML = '';
  dialog.classList.remove('hidden');
  searchInput2.focus();
  async function runFixSearch() {
    const q2 = searchInput2.value.trim();
    if (!q2) return;
    resultsList.innerHTML = '<div class="disc-error">Searching…</div>';
    try {
      const source = appState.settings.source || 'steamunlocked';
      const res = await window.api.search(q2, 1, source);
      resultsList.innerHTML = '';
      if (!res.games || !res.games.length) {
        resultsList.innerHTML = '<div class="disc-error">No results found.</div>';
        return;
      }
      res.games.slice(0, 8).forEach(game => {
        const item = document.createElement('div');
        item.className = 'fix-result-item';
        item.innerHTML = `
          ${game.image ? `<img class="fix-result-cover" src="${escapeHtml(game.image)}" loading="lazy"/>` : '<div class="fix-result-cover"></div>'}
          <div>
            <div class="fix-result-title">${escapeHtml(game.title)}</div>
            <div class="fix-result-sub">${escapeHtml(game.version || '')}</div>
          </div>`;
        item.addEventListener('click', () => {
          gameFixMappings[entry.id] = { title: game.title, coverImage: game.image, gameUrl: game.url };
          saveFixMappings();
          dialog.classList.add('hidden');
          refreshLibraryView();
          setStatus(`Fixed: ${entry.id} → ${game.title}`);
        });
        resultsList.appendChild(item);
      });
    } catch {
      resultsList.innerHTML = '<div class="disc-error">Search failed. Check connection.</div>';
    }
  }
  searchBtn2.onclick = runFixSearch;
  searchInput2.onkeydown = e => { if (e.key === 'Enter') runFixSearch(); };
  cancelBtn.onclick = () => dialog.classList.add('hidden');
  dialog.onclick = e => { if (e.target === dialog) dialog.classList.add('hidden'); };
}

// ── Download badge updater ─────────────────────────────────────
function updateDownloadBadge() {
  const badge = $('dl-badge');
  if (!badge) return;
  const active = Object.values(appState.downloads).filter(d => d.state !== 'completed' && d.pct < 100 && d.pct > 0).length;
  const preparing = appState.library ? appState.library.filter(e => ['downloading','preparing','extracting','paused'].includes(e.status)).length : 0;
  const count = Math.max(active, preparing);
  if (count > 0) {
    badge.innerHTML = count > 9 ? '9+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}


const TYPING_GAMES = [];
let typingIdx = 0, typingPos = 0, typingDeleting = false, typingTimer = null;
function runTyping() { /* hero removed — discovery layout used instead */ }

// ── Titlebar ──────────────────────────────────────────────────
btnMin.addEventListener('click', () => window.api.winMinimize());
btnMax.addEventListener('click', () => window.api.winMaximize());
btnClose.addEventListener('click', () => window.api.winClose());
window.api.onWindowState(s => {
  $('icon-max').style.display     = s === 'maximized' ? 'none'  : 'block';
  $('icon-restore').style.display = s === 'maximized' ? 'block' : 'none';
});

// ── Navigation ────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(el => el.classList.add('hidden'));
  const el = $('view-' + page);
  if (el) el.classList.remove('hidden');
  sbBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === page || (page === 'detail' && btn.dataset.view === appState.prevPage));
  });
  appState.currentPage = page;
  if (page === 'library') refreshLibraryView();
  if (page === 'settings') loadSettings();
  if (page === 'wishlist') refreshWishlistView();
  if (page === 'home') {
    // If there are already rendered results in the grid, just show them
    if (appState.searchQuery && gameGrid.children.length > 0) {
      showHomeState('results');
    } else if (appState.searchQuery) {
      // Results were cleared (e.g. source changed) — re-run the search
      searchInput.value = appState.searchQuery;
      doSearch(appState.searchQuery);
    } else if ($('st-welcome') && !$('st-welcome').classList.contains('hidden')) {
      if (!typingTimer) runTyping();
    }
  }
}

sbBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    appState.prevPage = btn.dataset.view;
    navigateTo(btn.dataset.view);
  });
});

function showHomeState(name) {
  ['welcome','loading','empty','error','results'].forEach(s => {
    $('st-' + s).classList.toggle('hidden', s !== name);
  });
  // Explicitly hide/show disc sections so they never bleed through
  ['sec-trending','sec-latest','sec-recent','sec-popular','sec-upcoming'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('hidden', name !== 'welcome');
  });
  if (name === 'welcome') { if (!typingTimer) runTyping(); }
  else { clearTimeout(typingTimer); typingTimer = null; }
}

function showActionState(name) {
  ['loading','error','download','preparing','progress','extracting','done','failed','no-link','already-installed'].forEach(s => {
    const el = $('action-' + s);
    if (el) el.classList.add('hidden');
  });
  const el = $('action-' + name);
  if (el) el.classList.remove('hidden');
}

document.querySelectorAll('.lib-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    appState.libTab = tab.dataset.tab;
    refreshLibraryView();
  });
});

$('lib-scan-btn').addEventListener('click', async () => {
  const btn = $('lib-scan-btn');
  btn.disabled = true;
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:5px"><path d="M11 6A5 5 0 1 1 8.5 1.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 1h3v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Scanning…';
  setStatus('Scanning games folder…');
  try {
    const result = await window.api.scanLibrary();
    appState.library = await window.api.getLibrary();
    // Switch to installed tab to show results
    document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.lib-tab[data-tab="installed"]').classList.add('active');
    appState.libTab = 'installed';
    refreshLibraryView();
    if (result.added > 0) {
      setStatus(`Scan complete — ${result.added} new game${result.added !== 1 ? 's' : ''} added.`);
    } else {
      setStatus('Scan complete — no new games found.');
    }
  } catch (err) {
    setStatus('Scan failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:5px"><path d="M11 6A5 5 0 1 1 8.5 1.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 1h3v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Scan Folder';
  }
});

$('lib-clear-failed-btn').addEventListener('click', async () => {
  const failed = appState.library.filter(e => e.status === 'failed' || e.status === 'cancelled');
  if (!failed.length) return;
  for (const entry of failed) {
    await window.api.removeGame(entry.id);
  }
  appState.library = await window.api.getLibrary();
  refreshLibraryView();
  setStatus(`Cleared ${failed.length} failed download${failed.length !== 1 ? 's' : ''}.`);
});


async function doSearch(query) {
  if (!query.trim()) return;
  appState.searchQuery = query.trim();
  appState.searchPage  = 1;
  appState.totalGames  = 0;
  appState.hasMore     = true;
  appState.isLoading   = true;
  showHomeState('loading');
  setStatus(`Searching "${appState.searchQuery}"…`);
  searchInput.blur();
  try {
    const result = await window.api.search(appState.searchQuery, 1, appState.settings.source || 'steamunlocked');
    if (result.error) { $('error-msg').innerHTML = `Error: ${result.error}`; showHomeState('error'); setStatus('Search error.'); return; }
    if (!result.games.length) { $('empty-msg').innerHTML = `No games found for "${appState.searchQuery}"`; showHomeState('empty'); setStatus('No results.'); return; }
    showHomeState('results');
    renderSearchResults(result.games, false);
    appState.hasMore = result.hasMore;
    updatePaginationUI();
    setStatus(`Results for "${appState.searchQuery}"`);
  } catch (err) {
    $('error-msg').innerHTML = 'Unexpected error. Check your connection.';
    showHomeState('error'); setStatus('Error.');
  } finally {
    appState.isLoading = false;
    updatePaginationUI();
  }
}

async function loadMoreResults() {
  if (appState.isLoading || !appState.hasMore) return;
  appState.searchPage++;
  appState.isLoading = true;
  updatePaginationUI();
  try {
    const result = await window.api.search(appState.searchQuery, appState.searchPage, appState.settings.source || 'steamunlocked');
    if (!result.games.length) appState.hasMore = false;
    else { renderSearchResults(result.games, true); appState.hasMore = result.hasMore; }
    setStatus(`${appState.totalGames} games loaded`);
  } catch { appState.searchPage--; }
  finally { appState.isLoading = false; updatePaginationUI(); }
}

function updatePaginationUI() {
  loadMoreBtn.classList.toggle('hidden', appState.isLoading || !appState.hasMore);
  loadMoreSpin.classList.toggle('hidden', !appState.isLoading);
  allLoaded.classList.toggle('hidden', appState.isLoading || appState.hasMore);
}

function renderSearchResults(games, append) {
  if (!append) { gameGrid.innerHTML = ''; appState.totalGames = 0; }
  const frag = document.createDocumentFragment();
  games.forEach((game, i) => {
    appState.totalGames++;
    const card = document.createElement('div');
    card.className = 'game-card';
    card.style.setProperty('--delay', `${i * 22}ms`);
    card.innerHTML = `
      <div class="gc-cover">
        ${game.image
          ? `<img src="${escapeHtml(game.image)}" alt="${escapeHtml(game.title)}" loading="lazy"/>`
          : `<div class="gc-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" opacity=".3"><rect x="2" y="2" width="9" height="9" rx="1" fill="currentColor"/><rect x="13" y="2" width="9" height="9" rx="1" fill="currentColor" opacity=".5"/><rect x="2" y="13" width="9" height="9" rx="1" fill="currentColor" opacity=".5"/><rect x="13" y="13" width="9" height="9" rx="1" fill="currentColor" opacity=".25"/></svg></div>`}
        <div class="gc-overlay"><span class="gc-view-label">VIEW</span></div>
      </div>
      <div class="gc-info">
        <div class="gc-title">${escapeHtml(game.title)}</div>
        ${game.version ? `<div class="gc-version">${escapeHtml(game.version)}</div>` : ''}
      </div>`;
    card.addEventListener('click', () => openGameDetail(game));
    frag.appendChild(card);
  });
  gameGrid.appendChild(frag);
  resultsLabel.innerHTML = `${appState.totalGames} game${appState.totalGames !== 1 ? 's' : ''} loaded`;
}

// ── Game detail ───────────────────────────────────────────────
async function openGameDetail(game) {
  appState.prevPage    = appState.currentPage;
  appState.currentGame = game;
  appState.gamePageInfo = null;
  detailTitle.textContent    = game.title;
  detailVersion.textContent  = game.version || '';
  detailDesc.innerHTML       = '';
  detailSizeSpan.innerHTML = '—';
  $('detail-screenshots').innerHTML = '';
  $('detail-screenshots').classList.add('hidden');
  $('detail-sysreq').classList.add('hidden');
  $('detail-sysreq-content').innerHTML = '';
  if (game.image) {
    detailCover.src = game.image;
    detailCover.style.display = 'block';
    $('detail-cover-placeholder').style.display = 'none';
    detailBannerBg.style.backgroundImage = `url('${game.image}')`;
  } else {
    detailCover.style.display = 'none';
    $('detail-cover-placeholder').style.display = 'flex';
    detailBannerBg.style.backgroundImage = '';
  }
  await updateWishlistBtn(game);
  navigateTo('detail');
  const gameId = gameIdFromUrl(game.url);
  const lib    = appState.library.find(e => e.id === gameId);
  if (lib && lib.status === 'installed' && lib.installDir) {
    showActionState('already-installed');
    if (openFolderBtn2) openFolderBtn2.onclick = () => window.api.openPath(lib.installDir);
    if (launchBtn2) launchBtn2.onclick = () => window.api.launchGame(gameId);
    if (uninstallBtn) uninstallBtn.onclick = () => confirmUninstall(gameId, game.title);
    setupExtraButtons(gameId, lib.installDir, lib.execPath, 2);
    setStatus(`${game.title} — installed`);
  } else if (lib && (lib.status === 'downloading' || lib.status === 'preparing' || lib.status === 'paused')) {
    const dl = appState.downloads[gameId];
    if (dl) showDownloadProgress(dl);
    else showActionState('preparing');
    setStatus(`${game.title} — downloading…`);
  } else if (lib && lib.status === 'extracting') {
    showActionState('extracting');
    setStatus(`${game.title} — extracting…`);
  } else {
    showActionState('loading');
    setStatus(`Loading info for "${game.title}"…`);
    await loadGamePageInfo(game);
  }
}

function setupExtraButtons(gameId, installDir, execPath, suffix) {
  const s = suffix ? suffix : '';
  const steamBtn    = $('add-steam-btn' + s);
  const shortcutBtn = $('add-shortcut-btn' + s);
  if (steamBtn) steamBtn.onclick = () => openAddToSteamDialog(gameId, execPath, appState.currentGame?.title);
  if (shortcutBtn) {
    shortcutBtn.onclick = async () => {
      shortcutBtn.disabled = true;
      shortcutBtn.innerHTML = `<span class="btn-spinner"></span> Desktop Shortcut`;
      const result = await window.api.addDesktopShortcut({ gameId, execPath, title: appState.currentGame?.title });
      if (result && result.ok) shortcutBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Desktop Shortcut`;
      else { shortcutBtn.innerHTML = 'Desktop Shortcut'; shortcutBtn.disabled = false; }
    };
  }
}

// ── Add to Steam dialog ───────────────────────────────────────
function openAddToSteamDialog(gameId, execPath, title) {
  const existing = $('steam-dialog');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'steam-dialog';
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <div class="dialog-title">Add to Steam</div>
      <div class="dialog-field">
        <label>Game Name</label>
        <input type="text" id="steam-name" value="${escapeHtml(title || gameId)}" autocomplete="off"/>
      </div>
      <div class="dialog-field">
        <label>Executable</label>
        <input type="text" id="steam-exec" value="${escapeHtml(execPath || '')}" autocomplete="off"/>
      </div>
      <div class="dialog-field">
        <label>Launch Arguments <span class="dialog-optional">(optional)</span></label>
        <input type="text" id="steam-args" placeholder="-fullscreen -noborder" autocomplete="off"/>
      </div>
      <div class="dialog-field">
        <label>Start Directory <span class="dialog-optional">(optional)</span></label>
        <input type="text" id="steam-startdir" value="${escapeHtml(execPath ? execPath.replace(/[^\\/]+$/, '') : '')}" autocomplete="off"/>
      </div>
      <div class="dialog-actions">
        <button id="steam-cancel-btn" class="action-btn-secondary">Cancel</button>
        <button id="steam-confirm-btn" class="dl-button" style="padding:8px 20px;font-size:13px;">Add to Steam</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  $('steam-cancel-btn').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  $('steam-confirm-btn').onclick = async () => {
    const confirmBtn = $('steam-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<span class="btn-spinner"></span> Adding…`;
    const opts = {
      gameId,
      execPath:   $('steam-exec').value.trim() || execPath,
      title:      $('steam-name').value.trim() || title,
      launchArgs: $('steam-args').value.trim(),
      startDir:   $('steam-startdir').value.trim(),
    };
    const result = await window.api.addToSteam(opts);
    if (result && result.ok) {
      confirmBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Added!`;
      setTimeout(() => overlay.remove(), 1200);
    } else {
      confirmBtn.innerHTML = 'Add to Steam';
      confirmBtn.disabled = false;
      if (result && result.error) setStatus(`Steam error: ${result.error}`);
    }
  };
}

async function loadGamePageInfo(game) {
  try {
    const info = await window.api.getGamePage(game.url);
    appState.gamePageInfo = info;
    if (info.error) { showActionState('error'); setStatus('Failed to load game info.'); return; }
    if (info.bannerImage) detailBannerBg.style.backgroundImage = `url('${info.bannerImage}')`;
    if (info.size) detailSizeSpan.innerHTML = info.size;
    if (info.description) {
      detailDesc.innerHTML = info.description;
    }

    // ── Screenshots carousel ──────────────────────────────────
    const ssEl = $('detail-screenshots');
    if (info.screenshots && info.screenshots.length > 0) {
      const shots = info.screenshots;
      const n = shots.length;
      ssEl.innerHTML = `
        <div class="ss-carousel">
          <div class="ss-track-wrap">
            <button class="ss-arrow ss-prev" id="ss-prev" aria-label="Previous">&#8249;</button>
            <div class="ss-track" id="ss-track" style="width:${n * 100}%">
              ${shots.map((src, idx) => `
                <div class="ss-slide" style="width:${100 / n}%">
                  <img src="${escapeHtml(src)}" alt="Screenshot ${idx + 1}" loading="lazy"
                       onerror="this.closest('.ss-slide').style.display='none'"
                       data-src="${escapeHtml(src)}"/>
                </div>`).join('')}
            </div>
            <button class="ss-arrow ss-next" id="ss-next" aria-label="Next">&#8250;</button>
          </div>
          <div class="ss-dots" id="ss-dots">
            ${shots.map((_, i) => `<button class="ss-dot ${i === 0 ? 'active' : ''}" data-i="${i}"></button>`).join('')}
          </div>
        </div>`;
      ssEl.classList.remove('hidden');

      let current = 0;
      const dots  = ssEl.querySelectorAll('.ss-dot');
      const track = ssEl.querySelector('#ss-track');

      function goTo(idx) {
        dots[current].classList.remove('active');
        current = (idx + n) % n;
        dots[current].classList.add('active');
        track.style.transform = `translateX(-${(current / n) * 100}%)`;
      }

      ssEl.querySelector('#ss-prev').addEventListener('click', () => goTo(current - 1));
      ssEl.querySelector('#ss-next').addEventListener('click', () => goTo(current + 1));
      dots.forEach(d => d.addEventListener('click', () => goTo(+d.dataset.i)));

      ssEl.querySelector('.ss-track-wrap').addEventListener('click', e => {
        const img = e.target.closest('img[data-src]');
        if (img) openCarouselFullscreen(img.dataset.src, shots);
      });
    } else {
      ssEl.innerHTML = '';
      ssEl.classList.add('hidden');
    }

    // ── System Requirements ───────────────────────────────────
    const sysreqEl = $('detail-sysreq');
    if (info.sysReqItems && info.sysReqItems.length > 0) {
      const rows = info.sysReqItems.map(item => {
        if (item.label) {
          return `<div class="sysreq-row"><span class="sysreq-label">${escapeHtml(item.label)}</span><span class="sysreq-value">${escapeHtml(item.value)}</span></div>`;
        }
        return `<div class="sysreq-note">${escapeHtml(item.value)}</div>`;
      }).join('');
      $('detail-sysreq-content').innerHTML = `<div class="sysreq-grid">${rows}</div>`;
      sysreqEl.classList.remove('hidden');
    } else {
      sysreqEl.classList.add('hidden');
    }
    if (!info.downloadUrl) {
      showActionState('no-link');
      openPageBtn.onclick = () => window.api.openExternal(game.url);
      setStatus(`No download link found for "${game.title}".`);
      return;
    }

    showActionState('download');
    setStatus(`Ready to install "${game.title}"`);
    dlBtn.onclick = () => startDownload(game, info.downloadUrl);
  } catch (err) {
    showActionState('error');
    setStatus('Error loading game info.');
  }
}

// ── Wishlist ──────────────────────────────────────────────────
async function updateWishlistBtn(game) {
  const id = gameIdFromUrl(game.url);
  const isListed = await window.api.isWishlisted(id);
  detailWish.classList.toggle('wishlisted', isListed);
}

detailWish.addEventListener('click', async () => {
  const game = appState.currentGame;
  if (!game) return;
  const id = gameIdFromUrl(game.url);
  const result = await window.api.toggleWishlist({ id, title: game.title, coverImage: game.image, gameUrl: game.url });
  detailWish.classList.toggle('wishlisted', result);
});

async function refreshWishlistView() {
  const list = await window.api.getWishlist();
  const wishCount = $('wish-count');
  const wishEmpty = $('wish-empty');
  const wishGrid  = $('wish-grid');
  wishCount.innerHTML = list.length ? `${list.length} game${list.length !== 1 ? 's' : ''}` : '';
  wishEmpty.classList.toggle('hidden', list.length > 0);
  wishGrid.innerHTML = '';
  if (!list.length) return;
  const frag = document.createDocumentFragment();
  list.forEach((entry, i) => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.style.setProperty('--delay', `${i * 22}ms`);
    card.innerHTML = `
      <div class="gc-cover">
        ${entry.coverImage
          ? `<img src="${escapeHtml(entry.coverImage)}" alt="${escapeHtml(entry.title)}" loading="lazy"/>`
          : `<div class="gc-placeholder"></div>`}
        <div class="gc-overlay"><span class="gc-view-label">VIEW</span></div>
      </div>
      <div class="gc-info">
        <div class="gc-title">${escapeHtml(entry.title || entry.id)}</div>
      </div>`;
    card.addEventListener('click', () => {
      if (entry.gameUrl) openGameDetail({ url: entry.gameUrl, title: entry.title, image: entry.coverImage, version: null });
    });
    frag.appendChild(card);
  });
  wishGrid.appendChild(frag);
}

// ── Download ──────────────────────────────────────────────────
async function startDownload(game, downloadUrl) {
  const gameId = gameIdFromUrl(game.url);
  showActionState('preparing');
  dlProgressTitle.innerHTML = game.title;
  setStatus(`Starting install for "${game.title}"…`);
  appState.library = await window.api.getLibrary();
  appState.dlStartTimes[gameId] = { startTime: Date.now(), startBytes: 0 };
  const source = appState.settings.source || 'steamunlocked';

  const result = await window.api.startDownload({
    downloadUrl, gameUrl: game.url,
    gameId, title: game.title, coverImage: game.image, source,
  });
  if (result.error) {
    showActionState('failed');
    dlRetryBtn.onclick = () => loadGamePageInfo(game);
    setStatus(`Install failed: ${result.error}`);
  }
}

function showDownloadProgress(dl) {
  if (q('#action-progress.hidden') !== null && !q('#action-progress:not(.hidden)')) showActionState('progress');
  dlProgressTitle.innerHTML = appState.currentGame?.title || '';
  dlProgressPct.textContent   = `${dl.pct || 0}%`;
  dlBarFill.style.width       = `${dl.pct || 0}%`;
  dlProgressBytes.innerHTML = dl.msg || '';
  const speed = fmtSpeed(dl.speed);
  dlSpeedBadge.textContent    = speed;
  dlSpeedBadge.style.display  = speed ? '' : 'none';
  if (dl.recv && dl.total && dl.speed) {
    dlEtaBadge.innerHTML = fmtEta(dl.recv, dl.total, dl.speed);
    dlEtaBadge.style.display = '';
  } else {
    dlEtaBadge.style.display = 'none';
  }
  if (dlPauseBtn) dlPauseBtn.innerHTML = dl.paused ? 'Resume' : 'Pause';
}

if (dlPauseBtn) {
  dlPauseBtn.addEventListener('click', async () => {
    const game = appState.currentGame;
    if (!game) return;
    const gameId = gameIdFromUrl(game.url);
    const dl = appState.downloads[gameId];
    if (dl && dl.paused) {
      await window.api.resumeDownload(gameId);
      dl.paused = false;
      dlPauseBtn.innerHTML = 'Pause';
    } else {
      await window.api.pauseDownload(gameId);
      if (dl) dl.paused = true;
      dlPauseBtn.innerHTML = 'Resume';
    }
  });
}

[dlCancelBtn, dlCancelBtn2].forEach(btn => {
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const game = appState.currentGame;
    if (!game) return;
    const gameId = gameIdFromUrl(game.url);
    await window.api.cancelDownload(gameId);
    delete appState.downloads[gameId];
    showActionState('download');
    setStatus('Download cancelled.');
  });
});

if (dlRetryBtn) dlRetryBtn.addEventListener('click', () => {
  if (appState.currentGame && appState.gamePageInfo?.downloadUrl)
    startDownload(appState.currentGame, appState.gamePageInfo.downloadUrl);
});

if (actionErrorRetry) actionErrorRetry.addEventListener('click', () => {
  if (appState.currentGame) loadGamePageInfo(appState.currentGame);
});

async function confirmUninstall(gameId, title) {
  if (!confirm(`Uninstall ${title}? This will delete the game files.`)) return;
  await window.api.uninstallGame(gameId);
  showActionState('download');
  if (appState.gamePageInfo?.downloadUrl)
    dlBtn.onclick = () => startDownload(appState.currentGame, appState.gamePageInfo.downloadUrl);
  setStatus(`${title} uninstalled.`);
}

// ── Download events ───────────────────────────────────────────
window.api.onDownloadProgress(({ gameId, recv, total, pct, state, msg, speed }) => {
  appState.downloads[gameId] = { ...(appState.downloads[gameId] || {}), pct, msg, state, speed, recv, total };
  if (appState.currentPage === 'detail' && appState.currentGame &&
      gameIdFromUrl(appState.currentGame.url) === gameId) {
    // At 100% the file is done — switch to extracting immediately so the UI
    // doesn't freeze on "100%" while the archive is being unpacked.
    if (pct >= 100) {
      showActionState('extracting');
      dlExtractMsg.innerHTML = 'Extracting files…';
    } else {
      const progressVisible = !$('action-progress').classList.contains('hidden');
      if (progressVisible) {
        // Update in-place, no animation re-trigger
        dlProgressPct.textContent   = `${pct || 0}%`;
        dlBarFill.style.width       = `${pct || 0}%`;
        dlProgressBytes.innerHTML = msg || '';
        const speedStr = fmtSpeed(speed);
        dlSpeedBadge.textContent    = speedStr;
        dlSpeedBadge.style.display  = speedStr ? '' : 'none';
        if (recv && total && speed) { dlEtaBadge.innerHTML = fmtEta(recv, total, speed); dlEtaBadge.style.display = ''; }
        else dlEtaBadge.style.display = 'none';
      } else {
        showDownloadProgress(appState.downloads[gameId]);
      }
    }
  }
  setStatus(msg);
  updateDownloadBadge();
  if (appState.currentPage === 'library') {
    // Always update in-place — never full-rebuild during active download
    // (full rebuild replays CSS entrance animations on every progress tick)
    const barFill = libGrid.querySelector(`[data-lid="${gameId}"] .lib-bar-fill`);
    if (barFill) {
      barFill.style.width = `${pct}%`;
      const pctEl = barFill.closest('.lib-bar-wrap')?.querySelector('.lib-bar-pct');
      if (pctEl) pctEl.innerHTML = `${pct}%`;
      const bytesEl = barFill.closest('.lib-card-progress')?.querySelector('.lib-bar-bytes');
      if (bytesEl) bytesEl.innerHTML = msg || '';
      const speedEl = barFill.closest('.lib-card-info')?.querySelector('.lib-speed');
      if (speedEl) {
        const sp = fmtSpeed(speed);
        const eta = (recv && total && speed) ? fmtEta(recv, total, speed) : '';
        speedEl.innerHTML = sp ? (eta ? `${sp} · ${eta}` : sp) : '';
      }
    } else if (appState.libTab !== 'installed') {
      // Card not rendered yet and we're on downloading tab — build it once
      refreshLibraryView();
    }
    // On installed tab: no rebuild needed — installed cards are unaffected by downloads
  }
});

window.api.onDownloadDone(({ gameId, state, installDir, execPath }) => {
  if (state === 'completed') {
    // Keep temporarily so detail page can read installDir/execPath, then clean up
    appState.downloads[gameId] = { pct: 100, state: 'completed', installDir, execPath };
    if (appState.currentPage === 'detail' && appState.currentGame &&
        gameIdFromUrl(appState.currentGame.url) === gameId) {
      showActionState('done');
      if (openFolderBtn) openFolderBtn.onclick = () => window.api.openPath(installDir);
      if (launchBtn) launchBtn.onclick = () => window.api.launchGame(gameId);
      setupExtraButtons(gameId, installDir, execPath, '');
    }
    setStatus('Install complete!');
    // Remove from active downloads so library-updated guard doesn't block rebuilds
    delete appState.downloads[gameId];
  } else {
    delete appState.downloads[gameId];
    if (appState.currentPage === 'detail' && appState.currentGame &&
        gameIdFromUrl(appState.currentGame.url) === gameId) {
      if (state !== 'cancelled') showActionState('failed');
      else showActionState('download');
    }
    setStatus(state === 'cancelled' ? 'Download cancelled.' : 'Download failed.');
  }
  updateDownloadBadge();
  refreshLibraryView();
});

window.api.onDownloadStatus(({ gameId, msg }) => {
  if (appState.currentPage === 'detail' && appState.currentGame &&
      gameIdFromUrl(appState.currentGame.url) === gameId) {
    showActionState('preparing');
    dlStatusMsg.innerHTML = msg;
  }
  setStatus(msg);
});

window.api.onExtractProgress(({ gameId, msg }) => {
  if (appState.currentPage === 'detail' && appState.currentGame &&
      gameIdFromUrl(appState.currentGame.url) === gameId) {
    showActionState('extracting');
    dlExtractMsg.innerHTML = msg;
  }
  setStatus(msg);
  // Update library card extract message in-place without full rebuild
  if (appState.currentPage === 'library') {
    const bytesEl = libGrid.querySelector(`[data-lid="${gameId}"] .lib-bar-bytes`);
    if (bytesEl) bytesEl.innerHTML = msg;
  }
});

window.api.onLibraryUpdated(async () => {
  appState.library = await window.api.getLibrary();
  if (appState.currentPage === 'library') {
    // Skip full rebuild only while a download is truly in-progress (pct 1–99, not completed).
    // aria2 downloads don't set d.state, so check pct only.
    const hasActiveDownload = Object.values(appState.downloads).some(
      d => d.state !== 'completed' && d.pct > 0 && d.pct < 100
    );
    if (hasActiveDownload) return;
    refreshLibraryView();
  }
});

// ── Library view ──────────────────────────────────────────────
async function refreshLibraryView() {
  appState.library = await window.api.getLibrary();
  const activeStatuses = appState.libTab === 'installed'
    ? ['installed']
    : ['downloading', 'preparing', 'paused', 'extracting', 'failed', 'cancelled'];
  const games = appState.library.filter(e => activeStatuses.includes(e.status))
    .filter(e => showHiddenGames || !hiddenGames.has(e.id) || e.status !== 'installed');
  const hiddenCount = appState.library.filter(e => e.status === 'installed' && hiddenGames.has(e.id)).length;
  const hiddenBtn = $('lib-show-hidden-btn');
  if (hiddenBtn) {
    hiddenBtn.classList.toggle('active', showHiddenGames);
    hiddenBtn.innerHTML = showHiddenGames
      ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="6" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg> Hide Hidden`
      : `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="6" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg> Show Hidden${hiddenCount > 0 ? ` (${hiddenCount})` : ''}`;
    hiddenBtn.style.display = appState.libTab === 'installed' ? '' : 'none';
  }
  libCount.innerHTML = appState.library.length
    ? `${appState.library.length} game${appState.library.length !== 1 ? 's' : ''}` : '';
  // Show "Clear Failed" button only on downloading tab when there are failed/cancelled entries
  const clearFailedBtn = $('lib-clear-failed-btn');
  if (clearFailedBtn) {
    const failedCount = appState.library.filter(e => e.status === 'failed' || e.status === 'cancelled').length;
    clearFailedBtn.style.display = (appState.libTab !== 'installed' && failedCount > 0) ? '' : 'none';
    clearFailedBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:middle;margin-right:5px"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Clear Failed (${failedCount})`;
  }
  $('lib-empty-msg').innerHTML = appState.libTab === 'installed' ? 'No installed games yet.' : 'No active downloads.';
  libEmpty.classList.toggle('hidden', games.length > 0);
  libGrid.innerHTML = '';
  const frag = document.createDocumentFragment();
  games.forEach((rawEntry, i) => {
    const entry = applyFixMapping(rawEntry);
    const isUnrecognised = !entry.coverImage && !entry.fixed && entry.status === 'installed';
    const card = document.createElement('div');
    card.className = 'lib-card';
    card.dataset.lid = entry.id;
    // Installed cards never animate — only downloading tab cards get entrance animation
    if (appState.libTab !== 'installed') card.style.setProperty('--delay', `${i * 30}ms`);
    else card.classList.add('no-anim');
    const dl = appState.downloads[entry.id];
    const pct      = dl?.pct ?? entry.percent ?? 0;
    const speed    = dl?.speed ?? 0;
    const speedStr = fmtSpeed(speed);
    const paused   = dl?.paused;
    const recv     = dl?.recv ?? entry.receivedBytes ?? 0;
    const total    = dl?.total ?? entry.totalBytes ?? 0;
    const etaStr   = speedStr ? fmtEta(recv, total, speed) : '';
    const isDownloading = ['downloading','preparing'].includes(entry.status);
    const isPaused      = entry.status === 'paused';
    const isExtracting  = entry.status === 'extracting';
    const isInstalled   = entry.status === 'installed';
    const isFailed      = ['failed','cancelled'].includes(entry.status);
    const statusLabel = {
      installed: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Installed', downloading: 'Downloading…', preparing: 'Preparing…',
      paused: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor"/><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor"/></svg>Paused', extracting: 'Extracting…', failed: 'Failed', cancelled: 'Cancelled',
    }[entry.status] || entry.statusMsg || entry.status;

    card.innerHTML = `
      <div class="lib-card-top">
        ${entry.coverImage
          ? `<img class="lib-card-cover" src="${escapeHtml(entry.coverImage)}" alt="" loading="lazy"/>`
          : `<div class="lib-card-cover-ph"></div>`}
        <div class="lib-card-info">
          <div class="lib-card-title">${escapeHtml(entry.title || entry.id)}</div>
          <div class="lib-card-status ${entry.status}">${statusLabel}</div>
          ${speedStr ? `<div class="lib-speed">${escapeHtml(speedStr)}${etaStr ? ` · ${etaStr}` : ''}</div>` : ''}
          <div class="lib-card-actions-row">
            ${isInstalled ? `<button class="lib-btn success" data-action="launch" data-id="${escapeHtml(entry.id)}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:5px"><polygon points="2.5,1.5 10.5,6 2.5,10.5" fill="currentColor"/></svg>Launch</button>` : ''}
            ${isInstalled && entry.installDir ? `<button class="lib-btn primary" data-action="open" data-path="${escapeHtml(entry.installDir)}">Open Folder</button>` : ''}
            ${isInstalled ? `<button class="lib-btn" data-action="steam" data-id="${escapeHtml(entry.id)}">Add to Steam</button>` : ''}
            ${isInstalled ? `<button class="lib-btn" data-action="shortcut" data-id="${escapeHtml(entry.id)}">Desktop Shortcut</button>` : ''}
            ${isInstalled ? `<button class="lib-btn verify-btn" data-action="verify" data-id="${escapeHtml(entry.id)}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>Verify</button>` : ''}
            ${isInstalled ? `<button class="lib-btn hide-btn" data-action="hide" data-id="${escapeHtml(entry.id)}" title="${hiddenGames.has(entry.id) ? 'Unhide game' : 'Hide from library'}">${hiddenGames.has(entry.id) ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg>Unhide' : '<svg width=\"12\" height=\"12\" viewBox=\"0 0 12 12\" fill=\"none\" style=\"vertical-align:middle;margin-right:4px\"><path d=\"M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z\" stroke=\"currentColor\" stroke-width=\"1.2\"/><circle cx=\"6\" cy=\"6\" r=\"1.5\" stroke=\"currentColor\" stroke-width=\"1.2\"/><line x1=\"2\" y1=\"2\" x2=\"10\" y2=\"10\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linecap=\"round\"/></svg>Hide'}</button>` : ''}
            ${isInstalled ? `<button class="lib-btn danger" data-action="uninstall" data-id="${escapeHtml(entry.id)}" data-title="${escapeHtml(entry.title || '')}">Uninstall</button>` : ''}
            ${isDownloading || isPaused ? `<button class="lib-btn" data-action="pause" data-id="${escapeHtml(entry.id)}">${isPaused || paused ? 'Resume' : 'Pause'}</button>` : ''}
            ${isDownloading || isPaused ? `<button class="lib-btn danger" data-action="cancel" data-id="${escapeHtml(entry.id)}">Cancel</button>` : ''}
            ${isFailed ? `<button class="lib-btn danger" data-action="remove" data-id="${escapeHtml(entry.id)}">Remove</button>` : ''}
          </div>
          <div class="lib-verify-result hidden" data-verify-id="${escapeHtml(entry.id)}"></div>
          ${isUnrecognised ? `<button class="fix-unrecognised-btn" data-action="fix" data-id="${escapeHtml(entry.id)}"><svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M6.5 1.5L12 11.5H1L6.5 1.5Z" stroke="#f59e0b" stroke-width="1.3" stroke-linejoin="round"/><line x1="6.5" y1="5" x2="6.5" y2="8.5" stroke="#f59e0b" stroke-width="1.3" stroke-linecap="round"/><circle cx="6.5" cy="10" r="0.7" fill="#f59e0b"/></svg>Unrecognised Game — Click Here to Fix</button>` : ''}
        </div>
      </div>
      ${(isDownloading || isPaused) ? `
        <div class="lib-card-progress">
          <div class="lib-bar-wrap">
            <div class="lib-bar-track"><div class="lib-bar-fill" style="width:${pct}%"></div></div>
            <div class="lib-bar-pct">${pct}%</div>
          </div>
          <div class="lib-bar-bytes">${escapeHtml(entry.statusMsg || '')}</div>
        </div>` : ''}
      ${isExtracting ? `
        <div class="lib-card-progress">
          <div class="lib-bar-wrap">
            <div class="lib-bar-track"><div class="lib-bar-fill" style="width:100%;animation:pulse 1.2s infinite;background:linear-gradient(90deg,var(--green),#86efac)"></div></div>
          </div>
          <div class="lib-bar-bytes" style="color:var(--green)">Extracting…</div>
        </div>` : ''}`;

    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id     = btn.dataset.id;
        const libEntry = appState.library.find(e2 => e2.id === id);
        if (action === 'launch')   { window.api.launchGame(id); }
        if (action === 'open')     { window.api.openPath(btn.dataset.path); }
        if (action === 'steam')    { openAddToSteamDialog(id, libEntry?.execPath, libEntry?.title); }
        if (action === 'shortcut') {
          btn.disabled = true;
          btn.innerHTML = `<span class="btn-spinner"></span> Desktop Shortcut`;
          const result = await window.api.addDesktopShortcut({ gameId: id, execPath: libEntry?.execPath, title: libEntry?.title });
          if (result && result.ok) btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Desktop Shortcut`;
          else { btn.innerHTML = 'Desktop Shortcut'; btn.disabled = false; }
        }
        if (action === 'uninstall') {
          if (!confirm(`Uninstall ${btn.dataset.title}? This will delete the game files.`)) return;
          await window.api.uninstallGame(id);
          refreshLibraryView();
        }
        if (action === 'hide') {
          toggleHideGame(id);
        }
        if (action === 'verify') {
          btn.disabled = true;
          btn.innerHTML = `<span class="btn-spinner"></span> Verifying…`;
          const resultEl = btn.closest('.lib-card-info')?.querySelector(`[data-verify-id="${id}"]`);
          try {
            const r = await window.api.verifyInstall(id);
            btn.disabled = false;
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>Verify';
            if (resultEl) {
              resultEl.classList.remove('hidden', 'verify-ok', 'verify-warn', 'verify-error');
              if (r.error) {
                resultEl.classList.add('verify-error');
                resultEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M6.5 1.5L12 11.5H1L6.5 1.5Z" stroke="#f59e0b" stroke-width="1.3" stroke-linejoin="round"/><line x1="6.5" y1="5" x2="6.5" y2="8.5" stroke="#f59e0b" stroke-width="1.3" stroke-linecap="round"/><circle cx="6.5" cy="10" r="0.7" fill="#f59e0b"/></svg>${r.error}`;
              } else if (r.verdict === 'ok') {
                const diskStr   = fmtBytes(r.diskSize);
                const serverStr = r.serverZipSize ? fmtBytes(r.serverZipSize) : '?';
                resultEl.classList.add('verify-ok');
                resultEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><polyline points="1.5,6 4.5,9.5 10.5,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Files OK — ${diskStr} on disk, ${serverStr} on server`;
              } else if (r.verdict === 'outdated') {
                const diskStr   = fmtBytes(r.diskSize);
                const storedStr = fmtBytes(r.storedZipSize);
                const serverStr = fmtBytes(r.serverZipSize);
                resultEl.classList.add('verify-warn');
                resultEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M6 10V2M2 6l4-4 4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Update available — server file changed (was ${storedStr}, now ${serverStr}, ${diskStr} on disk)`;
              } else if (r.verdict === 'corrupt') {
                const diskStr   = fmtBytes(r.diskSize);
                const storedStr = r.storedZipSize ? fmtBytes(r.storedZipSize) : '?';
                resultEl.classList.add('verify-error');
                resultEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><line x1="1" y1="1" x2="11" y2="11" stroke="#FF6B6B" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="1" x2="1" y2="11" stroke="#FF6B6B" stroke-width="1.5" stroke-linecap="round"/></svg>Possibly corrupt — only ${diskStr} on disk, expected ~${storedStr}`;
              } else if (r.verdict === 'missing') {
                resultEl.classList.add('verify-error');
                resultEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><line x1="1" y1="1" x2="11" y2="11" stroke="#FF6B6B" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="1" x2="1" y2="11" stroke="#FF6B6B" stroke-width="1.5" stroke-linecap="round"/></svg>Install folder missing — ${r.installDir}`;
              }
              if (r.headError) {
                const note = document.createElement('div');
                note.style.cssText = 'font-size:10px;opacity:0.6;margin-top:2px';
                note.innerHTML = `(Server check failed: ${r.headError})`;
                resultEl.appendChild(note);
              }
            }
          } catch (err) {
            btn.disabled = false;
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:middle;margin-right:4px"><circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>Verify';
            if (resultEl) {
              resultEl.classList.remove('hidden');
              resultEl.classList.add('verify-error');
              resultEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="vertical-align:middle;margin-right:4px"><path d="M6.5 1.5L12 11.5H1L6.5 1.5Z" stroke="#f59e0b" stroke-width="1.3" stroke-linejoin="round"/><line x1="6.5" y1="5" x2="6.5" y2="8.5" stroke="#f59e0b" stroke-width="1.3" stroke-linecap="round"/><circle cx="6.5" cy="10" r="0.7" fill="#f59e0b"/></svg>Error: ${err.message}`;
            }
          }
        }
        if (action === 'cancel') { await window.api.cancelDownload(id); refreshLibraryView(); }
        if (action === 'remove') { await window.api.removeGame(id); refreshLibraryView(); }
        if (action === 'fix') { openFixGameDialog(rawEntry); }
        if (action === 'pause') {
          const dl2 = appState.downloads[id];
          if (libEntry && (libEntry.status === 'paused' || dl2?.paused)) {
            await window.api.resumeDownload(id);
            if (dl2) dl2.paused = false;
          } else {
            await window.api.pauseDownload(id);
            if (dl2) dl2.paused = true;
          }
          refreshLibraryView();
        }
      });
    });

    if (entry.gameUrl) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', e => {
        if (e.target.closest('[data-action]')) return;
        openGameDetail({ url: entry.gameUrl, title: entry.title, image: entry.coverImage, version: null });
      });
    }
    // Apply hidden dim
    if (hiddenGames.has(entry.id)) card.classList.add('is-hidden');
    frag.appendChild(card);
  });
  libGrid.appendChild(frag);
  applyLibLayout();
}

detailBack.addEventListener('click', () => navigateTo(appState.prevPage));
searchBtn.addEventListener('click', () => doSearch(searchInput.value));
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(searchInput.value); });
loadMoreBtn.addEventListener('click', loadMoreResults);

document.addEventListener('click', e => {
  if (e.target.closest('#lib-show-hidden-btn')) {
    showHiddenGames = !showHiddenGames;
    refreshLibraryView();
  }
  const layoutBtn = e.target.closest('.lib-layout-btn');
  if (layoutBtn) {
    libLayout = layoutBtn.dataset.layout;
    localStorage.setItem('nino-lib-layout', libLayout);
    applyLibLayout();
  }
});

async function loadSettings() {
  appState.settings = await window.api.getSettings();
  $('install-path-display').innerHTML = appState.settings.installPath || 'Default (~/NinoGames)';
  const themeInput = $('theme-toggle-input');
  if (themeInput) themeInput.checked = document.body.classList.contains('light');
  // Source picker
  const source = appState.settings.source || 'steamunlocked';
  document.querySelectorAll('.source-radio').forEach(r => {
    r.classList.toggle('active', r.dataset.source === source);
  });
  // Aria2 toggle
  const aria2Input = $('aria2-toggle-input');
  if (aria2Input) aria2Input.checked = !!appState.settings.aria2Enabled;
  // 7-Zip toggle (default on)
  const sevenZipInput = $('sevenzip-toggle-input');
  if (sevenZipInput) sevenZipInput.checked = appState.settings.sevenZipEnabled !== false;
}

$('btn-pick-folder').addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (folder) {
    appState.settings.installPath = folder;
    await window.api.saveSettings({ installPath: folder });
    $('install-path-display').innerHTML = folder;
    setStatus(`Install path set to: ${folder}`);
  }
});

$('btn-reset-path').addEventListener('click', async () => {
  appState.settings.installPath = null;
  await window.api.saveSettings({ installPath: null });
  $('install-path-display').innerHTML = 'Default (~/NinoGames)';
  setStatus('Install path reset to default.');
});

document.querySelectorAll('.source-radio').forEach(btn => {
  btn.addEventListener('click', async () => {
    const src = btn.dataset.source;
    appState.settings.source = src;
    await window.api.saveSettings({ source: src });
    document.querySelectorAll('.source-radio').forEach(r => r.classList.toggle('active', r.dataset.source === src));
    setStatus(`Search source set to ${btn.textContent.trim()}`);

    if (appState.searchQuery) {
      // Clear old results so navigateTo triggers a fresh search
      gameGrid.innerHTML = '';
      appState.totalGames = 0;
      // Navigate to home (which will re-run the search since grid is now empty)
      navigateTo('home');
    } else {
      showHomeState('welcome');
    }
  });
});

(async () => {
  appState.library  = await window.api.getLibrary();
  appState.settings = await window.api.getSettings();
  searchInput.focus();
  setStatus('Ready');
  applyLibLayout();
  await renderDiscovery();
  updateDownloadBadge();
})();

// ── Theme (dark/light) ────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('ninogames-theme');
  if (saved === 'light') document.body.classList.add('light');
  const input = document.getElementById('theme-toggle-input');
  if (input) input.checked = saved === 'light';
})();

document.getElementById('aria2-toggle-input')?.addEventListener('change', async function () {
  appState.settings.aria2Enabled = this.checked;
  await window.api.saveSettings({ aria2Enabled: this.checked });
  setStatus(this.checked ? 'Aria2 downloader enabled.' : 'Aria2 downloader disabled.');
});

document.getElementById('sevenzip-toggle-input')?.addEventListener('change', async function () {
  appState.settings.sevenZipEnabled = this.checked;
  await window.api.saveSettings({ sevenZipEnabled: this.checked });
  setStatus(this.checked ? '7-Zip extractor enabled.' : '7-Zip extractor disabled (using PowerShell fallback).');
});

document.getElementById('theme-toggle-input')?.addEventListener('change', function () {
  if (this.checked) {
    document.body.classList.add('light');
    localStorage.setItem('ninogames-theme', 'light');
  } else {
    document.body.classList.remove('light');
    localStorage.setItem('ninogames-theme', 'dark');
  }
});

// ── DevTools Panel ─────────────────────────────────────────────
(function initDevToolsPanel() {
  const overlay       = document.getElementById('devtools-overlay');
  const closeBtn      = document.getElementById('devtools-close-btn');
  const refreshBtn    = document.getElementById('devtools-refresh-btn');
  const nativeBtn     = document.getElementById('devtools-native-btn');
  const captureBtn    = document.getElementById('devtools-capture-btn');
  const tabs          = document.querySelectorAll('.devtools-tab');
  const tabContents   = document.querySelectorAll('.devtools-tab-content');

  // ── Visibility ───────────────────────────────────────────────
  let isOpen = false;

  function openPanel() {
    if (isOpen) return;
    isOpen = true;
    overlay.classList.remove('devtools-hidden');
    loadInfo();
  }

  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.add('devtools-hidden');
  }

  function togglePanel() {
    isOpen ? closePanel() : openPanel();
  }

  // Keyboard shortcut (renderer-side fallback + native via main)
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      togglePanel();
    }
  });

  // IPC toggle from main (global shortcut)
  if (window.api?.onToggleDevtoolsPanel) {
    window.api.onToggleDevtoolsPanel(togglePanel);
  }

  closeBtn.addEventListener('click', closePanel);
  nativeBtn.addEventListener('click', () => window.api?.openDevTools?.());
  refreshBtn.addEventListener('click', loadInfo);

  // ── Tabs ─────────────────────────────────────────────────────
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(`devtools-tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });

  // ── Info loader ───────────────────────────────────────────────
  async function loadInfo() {
    // Reset aria2 dot to loading
    setAria2Status('loading', 'Checking…', '');

    try {
      const info = await window.api?.getDevtoolsInfo?.();
      if (!info) return;

      // aria2
      const { exists, enabled, path: aria2Path } = info.aria2;
      if (!enabled) {
        setAria2Status('warn', 'Disabled in settings', aria2Path);
      } else if (!exists) {
        setAria2Status('error', 'Not found — binary missing', aria2Path);
      } else {
        setAria2Status('ok', 'Detected & ready', aria2Path);
      }

      // 7-Zip
      if (info.sevenZip) {
        const { exists: szExists, enabled: szEnabled, path: szPath } = info.sevenZip;
        const dot   = document.querySelector('#devtools-7zip-status .devtools-dot');
        const lbl   = document.getElementById('devtools-7zip-label');
        const pathEl = document.getElementById('devtools-7zip-path');
        if (dot && lbl && pathEl) {
          dot.className = 'devtools-dot devtools-dot-' + (
            !szEnabled  ? 'warn' :
            !szExists   ? 'error' : 'ok'
          );
          lbl.textContent  = !szEnabled ? 'Disabled in settings' : !szExists ? 'Not found — place 7za.exe in resources/7zip/' : 'Detected & ready';
          pathEl.innerHTML = szPath || '';
        }
      }

      // Runtime KV
      renderKV('devtools-runtime', {
        Platform: info.platform,
        Electron: info.electron,
        Node:     info.node,
      });

      // Settings KV
      renderKV('devtools-settings-kv', {
        Source:       info.settings.source,
        'Install to': info.settings.installPath,
      });

      // Downloads tab
      renderDownloads(info.activeDownloads);

    } catch (err) {
      setAria2Status('error', 'IPC error: ' + err.message, '');
    }
  }

  function setAria2Status(state, label, pathStr) {
    const dot   = document.querySelector('#devtools-aria2-status .devtools-dot');
    const lbl   = document.getElementById('devtools-aria2-label');
    const pathEl = document.getElementById('devtools-aria2-path');

    dot.className = 'devtools-dot devtools-dot-' + (
      state === 'ok'      ? 'ok' :
      state === 'warn'    ? 'warn' :
      state === 'error'   ? 'error' : 'loading'
    );
    lbl.textContent  = label;
    pathEl.innerHTML = pathStr || '';
  }

  function renderKV(containerId, obj) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    for (const [k, v] of Object.entries(obj)) {
      const key = document.createElement('span');
      key.className   = 'devtools-kv-key';
      key.innerHTML = k;
      const val = document.createElement('span');
      val.className   = 'devtools-kv-val';
      val.innerHTML = v ?? '—';
      el.appendChild(key);
      el.appendChild(val);
    }
  }

  function renderDownloads(list) {
    const container = document.getElementById('devtools-downloads-list');
    if (!container) return;
    if (!list || list.length === 0) {
      container.innerHTML = '<div class="devtools-muted" style="font-size:12px">(none active)</div>';
      return;
    }
    container.innerHTML = '';
    for (const dl of list) {
      const row = document.createElement('div');
      row.className = 'devtools-dl-row';

      const statusColor =
        dl.status === 'downloading' ? '#4ADE80' :
        dl.status === 'failed'      ? '#FF6B6B' :
        dl.status === 'paused'      ? '#FBBF24' : '#aab';

      row.innerHTML = `
        <div class="devtools-dl-id">${escHtml(dl.gameId)}</div>
        <div class="devtools-dl-status" style="color:${statusColor}">${escHtml(dl.status)}${dl.paused ? ' (paused)' : ''}</div>
        ${dl.scraperUrl ? `<div class="devtools-dl-url">${escHtml(dl.scraperUrl)}</div>` : ''}
      `;

      // Capture preview button per download
      if (dl.scraperUrl) {
        const capBtn = document.createElement('button');
        capBtn.className   = 'devtools-btn-sm';
        capBtn.style.cssText = 'margin-top:4px;align-self:flex-start';
        capBtn.innerHTML = 'Capture preview';
        capBtn.addEventListener('click', () => capturePreview(dl.gameId));
        row.appendChild(capBtn);
      }

      container.appendChild(row);
    }
  }

  // ── Scraper Preview ───────────────────────────────────────────
  captureBtn.addEventListener('click', () => capturePreview(null));

  async function capturePreview(gameId) {
    const urlEl   = document.getElementById('devtools-preview-url');
    const img     = document.getElementById('devtools-preview-img');
    const placeholder = document.getElementById('devtools-preview-placeholder');
    const ts      = document.getElementById('devtools-preview-ts');

    urlEl.innerHTML = 'Capturing…';

    // Switch to preview tab
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    document.querySelector('.devtools-tab[data-tab="preview"]').classList.add('active');
    document.getElementById('devtools-tab-preview').classList.add('active');

    try {
      const result = await window.api?.captureScraperPreview?.(gameId);
      if (!result || result.error) {
        urlEl.innerHTML = result?.error || 'No scraper window active';
        placeholder.style.display = 'block';
        img.style.display = 'none';
        return;
      }
      urlEl.innerHTML = result.url || '(unknown URL)';
      img.src = result.snapshot;
      img.style.display = 'block';
      placeholder.style.display = 'none';
      ts.innerHTML = 'Captured at ' + new Date().toLocaleTimeString();
    } catch (err) {
      urlEl.innerHTML = 'Error: ' + err.message;
    }
  }

  // Auto-refresh downloads list every 3s when panel is open
  setInterval(() => {
    if (!isOpen) return;
    window.api?.getDevtoolsInfo?.().then(info => {
      if (info?.activeDownloads) renderDownloads(info.activeDownloads);
      if (info?.aria2) {
        const { exists, enabled, path: p } = info.aria2;
        if (!enabled) setAria2Status('warn', 'Disabled in settings', p);
        else if (!exists) setAria2Status('error', 'Not found — binary missing', p);
        else setAria2Status('ok', 'Detected & ready', p);
      }
    }).catch(() => {});
  }, 3000);

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
