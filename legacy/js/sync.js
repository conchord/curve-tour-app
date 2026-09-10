// sync.js — cross-tab / cross-device live sync via Firebase Realtime
// Database. See "Cross-tab / cross-device live sync" in HANDOFF.md for the
// full design writeup and threat model.
//
// Two modes, decided at page load from the URL — but VIEWER, unlike before,
// is not permanent:
//  - WRITER (no "?t=" param, or a "?t=" tab that has unlocked Admin — see
//    promotion below): pushes T to Firebase, debounced, every time
//    saveState() runs, AND listens for updates from every OTHER writer tab
//    so several admins can safely work on the same tournament at once — see
//    "Multiple concurrent admins" in HANDOFF.md.
//  - VIEWER (opened via a shared "?t=<tournamentId>" link, not yet
//    unlocked): read-only, never touches localStorage or the real T
//    persistence path — purely mirrors whatever a writer last pushed.
//
// A viewer tab that successfully unlocks Admin (the SAME shared password,
// entered via the SAME prompt every tab uses) is PROMOTED to a writer for
// that exact tournamentId — see promoteViewerToWriter() below. This is the
// actual join flow for a second admin's device: they open the organiser's
// live link, then unlock Admin, and become a full co-admin from that point
// on. Writer authorization itself is unified with the Admin password (see
// "Admin access" in HANDOFF.md) rather than a separate per-tournament key —
// any browser that unlocks Admin caches a proof hash (ADMIN_PROOF_HASH_KEY,
// core.js) it can immediately use to push to ANY tournament.
//
// Two simultaneous writers editing the exact same field is still last-
// write-wins (no operational-transform/CRDT machinery here) — but two
// writers editing DIFFERENT fields no longer clobber each other, via the
// dirty-key tracking in pushSyncUpdate()/applyRemoteWriterUpdate() below.
// ═══════════════════════════════════════════════════════════════

var SYNC_VIEW_TID = new URLSearchParams(location.search).get('t');
// A tab that already proved it knows the admin secret in THIS browser
// (e.g. it was promoted in an earlier visit) skips viewer mode entirely,
// even if it was opened via a "?t=" link — see the init branch in
// index.html's trailing script, which adopts SYNC_VIEW_TID as T.tournamentId
// in that case.
var SYNC_IS_VIEWER = !!SYNC_VIEW_TID && !isAdminUnlocked();

// Public client config — not a secret; the Realtime Database security rules
// (see HANDOFF.md) are what actually gate access, not hiding this object.
var SYNC_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzbwk2ZJj2jmtKRFjzDJyPk4ePmF3Q04M",
  authDomain: "curve-tour-app.firebaseapp.com",
  databaseURL: "https://curve-tour-app-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "curve-tour-app",
  storageBucket: "curve-tour-app.firebasestorage.app",
  messagingSenderId: "840551568118",
  appId: "1:840551568118:web:40e3c22de01e2587e8d2d7"
};

// Guarded, not assumed — an ad-blocker, offline load, or a firewall can all
// keep the Firebase script tags from ever defining `firebase`. The whole
// app (including the organiser's own local-only workflow) must keep working
// exactly as before regardless, so every function below no-ops cleanly if
// this is null rather than throwing.
var SYNC_DB = null;
try {
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp(SYNC_FIREBASE_CONFIG);
    SYNC_DB = firebase.database();
  }
} catch (e) { console.warn('Live sync unavailable — Firebase failed to initialize', e); }

var syncPushTimer = null;
var syncLastError = null;
var syncHasPushedOnce = false;

// Keys locally mutated but not yet confirmed pushed — see pushSyncUpdate()/
// applyRemoteWriterUpdate() below. Without this, a remote update arriving
// mid-typing would wholesale-replace T.scores with the (older, from this
// tab's perspective) remote copy, silently discarding whatever this admin
// just typed but hasn't pushed yet — worse than the problem being solved.
var syncDirtyScoreKeys = new Set();
var syncDirtyFinalScoreKeys = new Set();

// ═══════════════════════════════════════════════════════════════
// WRITER SIDE
// ═══════════════════════════════════════════════════════════════

// Called once at load for a writer tab — resumes the shareable URL/status
// panel for an already-generated tournament restored from localStorage, so
// the organiser doesn't have to regenerate just to get their link back —
// and (re)subscribes to live updates from other writers on that tournament.
//
// Gated on T.started, not just T.tournamentId — matching the #sync-status-
// panel container itself, which lives inside #panel-running and is already
// only ever shown once a tournament is started (see index.html). Without
// this, T.tournamentId (set the moment a schedule is generated, long before
// Start, and never cleared except by Reset) would rewrite the address bar
// on EVERY plain visit to the bare root URL from any browser that has ever
// generated so much as an unstarted preview — a real, reported bug: opening
// the plain root URL silently redirected to an old, never-started test
// tournament's ?t= link, which then rendered as a near-empty, unseeded
// bracket that looked like "an old version of the site" even though the
// code being served was current the whole time.
function initWriterMode() {
  if (T.tournamentId && T.started) updateSyncUrlBar();
  renderSyncStatusPanel();
  startWriterListener();
}

function updateSyncUrlBar() {
  if (!T.tournamentId) return;
  history.replaceState(null, '', location.pathname + '?t=' + T.tournamentId);
}

function clearSyncUrlBar() {
  history.replaceState(null, '', location.pathname);
}

// Firebase Realtime Database prunes any key — including an array element —
// whose value is null; that's fundamental to how it stores data, not a
// configurable behavior. Harmless almost everywhere in T (a missing key
// already means the same thing as an explicit null wherever it's read —
// see getUnitScore()'s undefined-or-null fallback convention), but for
// anything where POSITION matters — team.members[mi], keyed to score
// fields like "-m{mi}" — losing a null array element doesn't just drop it,
// it shifts every later element down an index, silently misattributing
// whoever was at a later position (see "Fix: Firebase live-sync silently
// drops null array elements" in HANDOFF_LOG.md — this is the actual root
// cause of a real, reported "team.members is undefined" crash). Marshaled
// right before every Firebase write and reversed right after every
// Firebase read, so nothing else in this app — not T, not any render or
// mutation function — ever needs to know this happens.
var FIREBASE_NULL_SENTINEL_KEY = '__ffaNull';
function marshalNullsForFirebase(value) {
  if (value === null) { var s = {}; s[FIREBASE_NULL_SENTINEL_KEY] = true; return s; }
  if (Array.isArray(value)) return value.map(marshalNullsForFirebase);
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = marshalNullsForFirebase(value[k]); });
    return out;
  }
  return value;
}
function unmarshalNullsFromFirebase(value) {
  if (value && typeof value === 'object' && value[FIREBASE_NULL_SENTINEL_KEY]) return null;
  if (Array.isArray(value)) return value.map(unmarshalNullsFromFirebase);
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = unmarshalNullsFromFirebase(value[k]); });
    return out;
  }
  return value;
}

// Debounced — saveState() runs on every real mutation (and every tab
// switch), so without this a quick run of score entries would fire one
// Firebase write per keystroke/click instead of one per pause. Snapshots
// each dirty key's VALUE right before the write (not just its name) so
// that, if a newer keystroke lands on the same key during the in-flight
// request itself, that key correctly stays dirty rather than being cleared
// out from under a change the server hasn't actually seen yet.
function pushSyncUpdate() {
  if (SYNC_IS_VIEWER || !SYNC_DB || !T.tournamentId || !isAdminUnlocked()) return;
  var proofHash = localStorage.getItem(ADMIN_PROOF_HASH_KEY);
  if (!proofHash) return; // shouldn't happen once unlocked, but never push without proof
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(function () {
    var payload;
    try { payload = marshalNullsForFirebase(JSON.parse(JSON.stringify(T))); } catch (e) { return; }
    payload.adminProof = proofHash; // read by the security rules — see HANDOFF.md
    var pushedScores = {}, pushedFinalScores = {};
    syncDirtyScoreKeys.forEach(function (k) { pushedScores[k] = T.scores[k]; });
    syncDirtyFinalScoreKeys.forEach(function (k) { pushedFinalScores[k] = T.finalScores[k]; });
    SYNC_DB.ref('tournaments/' + T.tournamentId).set(payload).then(function () {
      Object.keys(pushedScores).forEach(function (k) { if (T.scores[k] === pushedScores[k]) syncDirtyScoreKeys.delete(k); });
      Object.keys(pushedFinalScores).forEach(function (k) { if (T.finalScores[k] === pushedFinalScores[k]) syncDirtyFinalScoreKeys.delete(k); });
      syncLastError = null;
      syncHasPushedOnce = true;
      renderSyncStatusPanel();
    }).catch(function (e) {
      // Push failed — every snapshotted key stays dirty (correctly: none of
      // it actually reached the server), so the next successful push retries it.
      syncLastError = (e && e.message) ? e.message : String(e);
      renderSyncStatusPanel();
    });
  }, 400);
}

// This tab's live subscription to every OTHER writer's changes on the same
// tournament — the actual fix for "several admins active at once silently
// overwriting each other." Idempotent: always tears down any prior
// subscription first, so regenerating a schedule on an already-running
// tournament (no Reset in between) never leaves two callbacks firing.
var syncWriterListenerRef = null;

function startWriterListener() {
  stopWriterListener();
  if (SYNC_IS_VIEWER || !SYNC_DB || !T.tournamentId) return;
  syncWriterListenerRef = SYNC_DB.ref('tournaments/' + T.tournamentId);
  syncWriterListenerRef.on('value', function (snapshot) {
    var payload = unmarshalNullsFromFirebase(snapshot.val());
    if (payload) applyRemoteWriterUpdate(payload);
  }, function (error) {
    console.warn('Live sync (writer) connection lost', error);
  });
}

function stopWriterListener() {
  if (syncWriterListenerRef) { syncWriterListenerRef.off(); syncWriterListenerRef = null; }
}

// Adopts a remote value for a key only if THIS tab has no unpushed local
// edit for it — see the dirty-key comment above. Deliberately scoped to
// scores/finalScores only (the fields that get rapid, per-keystroke local
// edits); every other field in T changes via rarer, singular actions, so a
// coarser whole-field remote-wins replacement (below) is an acceptable,
// much simpler tradeoff for those.
function mergeRemoteScoreField(remoteObj, localObj, dirtySet) {
  if (!remoteObj) return;
  Object.keys(remoteObj).forEach(function (k) {
    if (!dirtySet.has(k)) localObj[k] = remoteObj[k];
  });
}

function applyRemoteWriterUpdate(payload) {
  delete payload.adminProof;
  mergeRemoteScoreField(payload.scores, T.scores, syncDirtyScoreKeys);
  mergeRemoteScoreField(payload.finalScores, T.finalScores, syncDirtyFinalScoreKeys);
  // Already merged in place above — must not let the blanket Object.assign
  // below clobber T.scores/T.finalScores with the raw (un-merged) remote
  // object references.
  delete payload.scores;
  delete payload.finalScores;
  Object.assign(T, payload);
  normalizeTeamRosters(T); // repairs any team already corrupted before the null-array fix shipped — see js/formats-and-primitives.js
  updateTitleDisplay();
  var hdrRound = document.getElementById('hdr-round');
  if (hdrRound) hdrRound.textContent = (T.rounds && T.rounds[T.curRound]) ? T.rounds[T.curRound].roundNum : '—';
  // renderAdminRound() itself defers if a score input is currently focused
  // (see js/render-admin.js) — safe to call unconditionally here.
  var activeTab = getActiveTab();
  if (activeTab === 'admin') {
    // Mirrors loadState()'s own panel-setup/panel-running toggle (core.js) —
    // needed here too, since a promoted-from-viewer tab never ran loadState()
    // and starts with whichever panel the static HTML defaults to; also
    // handles a promoted admin watching T.started flip live if a different
    // admin clicks "Confirm & Start" while they're on the preview.
    document.getElementById('panel-setup').style.display = T.started ? 'none' : 'block';
    document.getElementById('panel-running').style.display = T.started ? 'block' : 'none';
    if (T.started) renderAdminRound();
    else if (T.rounds && T.rounds.length) { renderPreview(); document.getElementById('preview-wrap').style.display = 'block'; }
  }
  else if (activeTab === 'scoreboard') renderScoreboard();
  else if (activeTab === 'bracket') renderBracket();
  else if (activeTab === 'rankings') renderRankings();
}

function copyLiveLink() {
  if (!T.tournamentId) { alert('Generate and start a tournament first.'); return; }
  var url = location.origin + location.pathname + '?t=' + T.tournamentId;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () {
      var el = document.getElementById('sync-copy-status');
      if (el) { el.textContent = 'Copied!'; setTimeout(function () { el.textContent = ''; }, 2000); }
    }).catch(function () { prompt('Copy this link:', url); });
  } else {
    prompt('Copy this link:', url);
  }
}

// Small status card in the running Admin panel — link to share, plus a
// coarse "is this actually reaching viewers" indicator. Re-rendered after
// every push attempt (success or failure) rather than on a timer, since
// pushSyncUpdate() already tells us exactly when state changes.
function renderSyncStatusPanel() {
  var el = document.getElementById('sync-status-panel');
  if (!el) return;
  if (!T.tournamentId) { el.innerHTML = ''; return; }
  var url = location.origin + location.pathname + '?t=' + T.tournamentId;
  var statusHtml;
  if (!SYNC_DB) {
    statusHtml = '<span style="color:var(--red)">⚪ Live sync unavailable (couldn\'t reach the sync service) — viewers need to refresh manually, same as before.</span>';
  } else if (syncLastError) {
    statusHtml = '<span style="color:var(--red)">🔴 Sync error — viewers may be seeing stale data (' + esc(syncLastError) + ')</span>';
  } else if (syncHasPushedOnce) {
    statusHtml = '<span style="color:var(--green)">🟢 Live sync active</span>';
  } else {
    statusHtml = '<span style="color:var(--muted)">🔄 Connecting…</span>';
  }
  el.innerHTML =
    '<div class="card-title">Live Sync — viewer link</div>' +
    '<div class="field" style="margin-bottom:8px"><input type="text" readonly value="' + esc(url) + '" onclick="this.select()"></div>' +
    '<div class="btn-row" style="align-items:center;gap:10px">' +
      '<button class="btn btn-secondary" onclick="copyLiveLink()">📋 Copy Live Link</button>' +
      '<span id="sync-copy-status" style="font-size:12px;color:var(--green)"></span>' +
    '</div>' +
    '<div style="margin-top:8px;font-size:12px">' + statusHtml + '</div>';
}

// ═══════════════════════════════════════════════════════════════
// VIEWER SIDE
// ═══════════════════════════════════════════════════════════════

function initViewerMode() {
  // Admin nav stays visible even here — clicking it prompts for the shared
  // password same as everywhere else, and a correct entry promotes this tab
  // to a writer (see promoteViewerToWriter() below). Archive stays hidden:
  // it's genuinely local-device-only data, meaningless until (and even
  // briefly after) promotion.
  var archiveBtn = document.querySelector('nav button[data-tab="archive"]');
  if (archiveBtn) archiveBtn.style.display = 'none';
  showSyncViewerOverlay('Connecting…', 'Loading the live tournament.');
  switchTab('bracket', document.querySelector('nav button[data-tab="bracket"]'));
  startViewerListener();
}

var syncViewerListenerRef = null;

function startViewerListener() {
  if (!SYNC_DB) {
    showSyncViewerOverlay('Live sync unavailable', 'The live-sync library couldn\'t load — check your connection and reload the page.');
    return;
  }
  syncViewerListenerRef = SYNC_DB.ref('tournaments/' + SYNC_VIEW_TID);
  syncViewerListenerRef.on('value', function (snapshot) {
    var payload = snapshot.val();
    if (!payload) {
      showSyncViewerOverlay('Waiting for the tournament to start…', 'This link is valid, but the organiser hasn\'t generated a schedule yet. This page updates automatically once they do.');
      return;
    }
    payload = unmarshalNullsFromFirebase(payload);
    delete payload.adminProof;
    Object.assign(T, payload);
    normalizeTeamRosters(T); // repairs any team already corrupted before the null-array fix shipped — see js/formats-and-primitives.js
    hideSyncViewerOverlay();
    hideSyncStaleBanner();
    renderTabForViewerSync();
  }, function (error) {
    showSyncStaleBanner(); // data already on screen stays visible — only a banner, not a blocking overlay, see HANDOFF.md
    console.warn('Live sync connection lost', error);
  });
}

function stopViewerListener() {
  if (syncViewerListenerRef) { syncViewerListenerRef.off(); syncViewerListenerRef = null; }
}

// The actual join flow for a second admin's device: they open the
// organiser's live link (viewer mode, read-only), then unlock Admin with
// the shared password — submitAdminPasswordPrompt() calls this on success
// when the tab was in viewer mode. Swaps the read-only viewer subscription
// for a full writer one on the SAME tournamentId, and this tab behaves
// exactly like any other writer from this point on.
function promoteViewerToWriter() {
  stopViewerListener();
  hideSyncViewerOverlay();
  hideSyncStaleBanner();
  SYNC_IS_VIEWER = false;
  T.tournamentId = SYNC_VIEW_TID;
  var archiveBtn = document.querySelector('nav button[data-tab="archive"]');
  if (archiveBtn) archiveBtn.style.display = '';
  updateSyncUrlBar();
  renderSyncStatusPanel();
  startWriterListener();
}

function showSyncViewerOverlay(title, msg) {
  document.getElementById('sync-viewer-title').textContent = title;
  document.getElementById('sync-viewer-msg').textContent = msg;
  document.getElementById('sync-viewer-overlay').style.display = 'flex';
}

function hideSyncViewerOverlay() {
  document.getElementById('sync-viewer-overlay').style.display = 'none';
}

function showSyncStaleBanner() {
  var el = document.getElementById('sync-stale-banner');
  if (el) el.style.display = 'block';
}

function hideSyncStaleBanner() {
  var el = document.getElementById('sync-stale-banner');
  if (el) el.style.display = 'none';
}

// Re-renders whichever tab a viewer is actually looking at, plus the header
// (title/round), which normally only renderAdminRound() keeps in sync — a
// viewer tab never calls that, since it never touches the Admin view at all.
function renderTabForViewerSync() {
  updateTitleDisplay();
  var hdrRound = document.getElementById('hdr-round');
  if (hdrRound) hdrRound.textContent = (T.rounds && T.rounds[T.curRound]) ? T.rounds[T.curRound].roundNum : '—';
  var activeTab = getActiveTab();
  if (activeTab === 'scoreboard') renderScoreboard();
  else if (activeTab === 'bracket') renderBracket();
  else if (activeTab === 'rankings') renderRankings();
}
