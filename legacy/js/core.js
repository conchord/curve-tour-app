// core.js — state shape/defaults, persistence, generic utilities.
// Loaded first: nothing else in this app depends on anything before it.

// ═══════════════════════════════════════════════════════════════
// STATE & CONFIGURATION
// ═══════════════════════════════════════════════════════════════
var T = {
  title: '',           // tournament name, editable any time in Admin, persists with the rest of T
  players: [],        // confirmed roster — plain name strings (individual formats) or team objects (team formats)
  reserves: [],       // reserve bench — same shape as players
  reserveIndividuals: [], // team formats only: [{name,userId}] substitutes for one member of a continuing team
  confirmedCount: null, // set by loadRoster() — count generateSchedule() reads from; null = no roster loaded yet
  tournamentId: null, // stable per-generation identity for archive matching (organisers may reuse titles); set fresh by proceedGenerateSchedule(), cleared by proceedReset()
  rounds: [],         // progression
  curRound: 0,
  scores: {},         // "r{ri}-rm{rm}-p{pi}" → number|null
  finalScores: {},    // "game{g}-{name}" → number
  assignments: [],    // per round: [{name, room, isLucky?}]
  luckyLosers: [],    // per round: set of names that came in as lucky losers
  byes: [],           // per round: array of names/teamIds with a bye that round (odd-count strategy "Bye") — empty array = no byes; can hold several recipients at once (see "Concentrate single-elimination's byes" in HANDOFF.md)
  poolingByeCounts: {}, // pooling-phase-only: unitKey -> number of byes received so far in the pooling phase currently in progress — drives "fewest byes so far, tie-broken by seed" bye selection (see "Fair bye rotation during pooling phases" in HANDOFF.md); reset at generation time and by proceedReset(), never touched by bracket-phase bye logic
  pendingBracketSeeds: {}, // double-elimination only: { roundIndex: [{name,isLucky},...] } — units already routed to a round that isn't the very next one played yet (see "Double elimination" in HANDOFF.md, Part 2's winnersTo/losersTo routing); materialized into T.assignments[roundIndex] and cleared the moment T.curRound actually reaches that index. Reset at generation time and by proceedReset(), same as T.poolingByeCounts.
  qualTable: [],
  groups: [],         // group-stage only: [{label, members: [unitKey,...]}, ...] — fixed for the whole phase, set at generation time
  groupStandings: {}, // group-stage only: { A: [{name,totalFP,totalScore,played},...], B: [...], ... } — one table per group, recomputed by updateGroupStandings()
  tieResolutions: {}, // "r{ri}-rm{rm}" → name of resolved winner
  defenderChanges: {}, // 'designated-player' team scoring rule only: { teamId: [{round, memberIdx}, ...] } — an append-only per-team change log, not a per-round snapshot, so a change made later can never affect which member's score a PAST round was already computed from (see getDefenderIndex() in js/formats-and-primitives.js and "Defender history" in HANDOFF.md). Reset at generation time and by proceedReset().
  reserveOpen: true,  // can reserves still join?
  started: false,     // has the organiser confirmed & started the tournament?
  needsSave: false,   // real changes since last archive save (or since generation, if never saved)
  autoSaved: false,   // has the Final-completion auto-save already fired for this tournament?
  cfg: {},
  scheduleLogic: 'single-elimination', // key into SCHEDULE_LOGICS — how rounds are structured & players progress
  gameFormat: 'ffa-individual',         // key into GAME_FORMATS — what's played in each room
  gamemodeConfig: {}  // per-tournament mode parameters (room-size bounds, qual-round count, ...) — set by proceedGenerateSchedule() from the chosen format's defaults
};

// ═══════════════════════════════════════════════════════════════
// ARCHIVE — UNSAVED-CHANGES PROTECTION
//  Only a started, played tournament is ever worth protecting
//  (Generate Schedule's own button is hidden once T.started, so its
//  check here is a defensive no-op today, not a reachable path —
//  Reset is the one that actually matters). Grouped with Archive
//  below since its entire purpose is to offer a save-to-archive
//  before a destructive action (new schedule / reset).
// ═══════════════════════════════════════════════════════════════
function markDirty() { T.needsSave = true; }

function hasUnsavedChanges() { return T.started && T.needsSave; }

// generateSchedule() was only ever designed to run while panel-setup is
// showing; it never touches T.started or panel visibility. The unsaved-
// changes flow can reach it while a tournament is actively running, so
// this tears down the running view first — otherwise panel-running and
// the freshly-generated preview end up visible at the same time.
function teardownRunningTournament() {
  T.started = false;
  document.getElementById('panel-setup').style.display = 'block';
  document.getElementById('panel-running').style.display = 'none';
  document.getElementById('hdr-round').textContent = '—';
}

// Shared "unsaved tournament in progress" 3-option modal used by both
// Generate Schedule and Reset. `messageAction` fills the confirmation
// sentence ("...before generating a new schedule?"); `buttonAction` fills
// the button labels ("Save & reset" / "Discard & reset"). `extraCleanup`
// (optional) runs after the archive save/discard choice but before `proceed`
// — Generate needs it to tear down the running-tournament panels, Reset does not.
function confirmUnsavedChanges(messageAction, buttonAction, proceed, extraCleanup) {
  showModal('Unsaved tournament in progress',
    'The current tournament has unsaved changes. What would you like to do before ' + messageAction + '?',
    [
      { label: 'Save & ' + buttonAction, className: 'btn-success', onClick: () => { archiveSilently('Tournament saved to archive.'); if (extraCleanup) extraCleanup(); proceed(); } },
      { label: 'Discard & ' + buttonAction, className: 'btn-danger', onClick: () => { if (extraCleanup) extraCleanup(); proceed(); } },
      { label: 'Cancel', className: 'btn-secondary' }
    ]);
}

// ═══════════════════════════════════════════════════════════════
//  PERSISTENCE (localStorage)
//  Single-device only for now. Kept as its own thin layer (save /
//  load / clear) so it's a straightforward swap for a backend call
//  once this needs to be shared across devices.
// ═══════════════════════════════════════════════════════════════
var STORAGE_KEY = 'curveFFA_state_v1';

function saveState() {
  // Viewer-mode tabs (opened via a shared "?t=" live link) never persist to
  // this browser's own localStorage — writing here would risk clobbering a
  // real organiser session if the same browser is later used for Admin. See
  // js/sync.js for the writer/viewer mode split.
  if (typeof SYNC_IS_VIEWER !== 'undefined' && SYNC_IS_VIEWER) return;
  try {
    var setup = {
      scheduleLogic: document.getElementById('cfg-schedule-logic').value,
      gameFormat: document.getElementById('cfg-game-format').value,
      scoring: document.getElementById('cfg-scoring').value,
      poolingPhase: document.getElementById('cfg-pooling-phase').value,
      qualAdv: document.getElementById('cfg-qual-adv').value,
      groupSize: document.getElementById('cfg-group-size').value,
      roundRobinMode: document.getElementById('cfg-round-robin-mode').value,
      qualifiersPerGroup: document.getElementById('cfg-qualifiers-per-group').value,
      finalsGames: document.getElementById('cfg-finals-games').value,
      semisGames: document.getElementById('cfg-semis-games').value,
      grandFinalWbTarget: document.getElementById('cfg-grand-final-wb-target').value,
      grandFinalLbTarget: document.getElementById('cfg-grand-final-lb-target').value,
      semisOverride: document.getElementById('cfg-semis-override').value,
      finalOverride: document.getElementById('cfg-final-override').value,
      oddCountStrategy: document.getElementById('cfg-odd-count-strategy').value,
      teamScoringRule: document.getElementById('cfg-team-scoring-rule').value,
      roster: document.getElementById('cfg-roster').value,
      reserves: document.getElementById('cfg-reserves').value,
      reserveIndividuals: document.getElementById('cfg-reserve-individuals').value
    };
    var activeTab = getActiveTab('admin');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ T, setup, activeTab }));
  } catch (e) { console.warn('Could not save tournament state', e); }
  if (typeof pushSyncUpdate === 'function') pushSyncUpdate();
}

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var saved = JSON.parse(raw);
    Object.assign(T, saved.T);
    if (typeof normalizeTeamRosters === 'function') normalizeTeamRosters(T);
    // Backward compat: a schedule generated before tournamentId existed has none —
    // assign one now so archive matching (see saveToArchive/archiveSilently) has
    // something stable to key off going forward.
    if (T.rounds && T.rounds.length && !T.tournamentId) T.tournamentId = String(Date.now());

    var s = saved.setup || {};
    if (s.scheduleLogic !== undefined) document.getElementById('cfg-schedule-logic').value = s.scheduleLogic;
    if (s.gameFormat !== undefined)    document.getElementById('cfg-game-format').value = s.gameFormat;
    if (s.scoring !== undefined)     document.getElementById('cfg-scoring').value = s.scoring;
    // Backward compat: a setup saved before the Pooling-phase dropdown
    // replaced the binary qual checkbox (see "Swiss pooling phase" in
    // HANDOFF.md) only has the old s.qual ('yes'/'no') field — derive the
    // equivalent poolingPhase from it rather than silently losing the
    // organiser's prior choice.
    var poolingPhase = s.poolingPhase !== undefined ? s.poolingPhase : (s.qual === 'yes' ? 'qual-table' : 'none');
    document.getElementById('cfg-pooling-phase').value = poolingPhase;
    if (s.qualAdv !== undefined)     document.getElementById('cfg-qual-adv').value = s.qualAdv;
    if (s.groupSize !== undefined)   document.getElementById('cfg-group-size').value = s.groupSize;
    if (s.roundRobinMode !== undefined) document.getElementById('cfg-round-robin-mode').value = s.roundRobinMode;
    if (s.qualifiersPerGroup !== undefined) document.getElementById('cfg-qualifiers-per-group').value = s.qualifiersPerGroup;
    if (s.finalsGames !== undefined) document.getElementById('cfg-finals-games').value = s.finalsGames;
    if (s.semisGames !== undefined) document.getElementById('cfg-semis-games').value = s.semisGames;
    if (s.grandFinalWbTarget !== undefined) document.getElementById('cfg-grand-final-wb-target').value = s.grandFinalWbTarget;
    if (s.grandFinalLbTarget !== undefined) document.getElementById('cfg-grand-final-lb-target').value = s.grandFinalLbTarget;
    if (s.semisOverride !== undefined) document.getElementById('cfg-semis-override').value = s.semisOverride;
    if (s.finalOverride !== undefined) document.getElementById('cfg-final-override').value = s.finalOverride;
    if (s.roster !== undefined)      document.getElementById('cfg-roster').value = s.roster;
    if (s.reserves !== undefined)    document.getElementById('cfg-reserves').value = s.reserves;
    if (s.reserveIndividuals !== undefined) document.getElementById('cfg-reserve-individuals').value = s.reserveIndividuals;
    togglePoolingPhaseField();
    toggleFormatFields();
    toggleScheduleLogicFields();
    // Restored AFTER toggleFormatFields() rebuilds the odd-count-strategy
    // dropdown's options for the restored format — setting it any earlier
    // would just get clobbered by that rebuild.
    if (s.oddCountStrategy !== undefined && document.getElementById('cfg-odd-count-strategy').querySelector(`option[value="${s.oddCountStrategy}"]`))
      document.getElementById('cfg-odd-count-strategy').value = s.oddCountStrategy;
    // Same reasoning as oddCountStrategy just above — toggleFormatFields()
    // already rebuilt this dropdown's options for the restored format.
    if (s.teamScoringRule !== undefined && document.getElementById('cfg-team-scoring-rule').querySelector(`option[value="${s.teamScoringRule}"]`))
      document.getElementById('cfg-team-scoring-rule').value = s.teamScoringRule;
    updateRegCountDisplay();
    updateTitleDisplay();
    if (T.players.length || T.reserves.length)
      document.getElementById('roster-status').textContent =
        T.players.length + ' confirmed, ' + T.reserves.length + ' reserves';

    if (T.started) {
      document.getElementById('panel-setup').style.display = 'none';
      document.getElementById('panel-running').style.display = 'block';
      renderAdminRound();
    } else if (T.rounds && T.rounds.length) {
      renderPreview();
      document.getElementById('preview-wrap').style.display = 'block';
    }

    if (saved.activeTab && saved.activeTab !== 'admin') {
      var btn = document.querySelector('nav button[data-tab="' + saved.activeTab + '"]');
      if (btn) switchTab(saved.activeTab, btn);
    }
  } catch (e) { console.warn('Could not restore saved tournament state', e); }
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION — tab switching, used by every view (not tied to any
//  single feature area below, so it gets its own small section).
// ═══════════════════════════════════════════════════════════════
function switchTab(id, btn) {
  // Every entry point into Admin (the nav button and the header-title click
  // via focusTitleInput()) routes through here, so this one guard covers
  // both, for a writer OR a viewer-mode tab alike — see "Admin access" in
  // HANDOFF.md. Admin stays on the visible nav deliberately (an admin needs
  // to move between tabs without copy-pasting a URL); this prompt is what
  // actually keeps an unauthorised visitor out. A viewer-mode tab that
  // enters the correct password here is promoted to a full writer for its
  // tournament — see promoteViewerToWriter() in js/sync.js — rather than
  // being turned away; that's the actual join flow for a second admin's
  // device.
  if (id === 'admin' && !isAdminUnlocked()) {
    showAdminPasswordPrompt(function () { switchTab(id, btn); });
    return;
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  btn.classList.add('active');
  if (id === 'scoreboard') renderScoreboard();
  // true = auto-scroll to a followed player, if one is set — landing on
  // Bracket should show "where am I right now" with zero clicks, matching
  // the convenience criterion in "Design intent for viewer-facing tabs"
  // (HANDOFF.md). Every other renderBracket() call site stays zero-arg.
  if (id === 'bracket')    renderBracket(true);
  if (id === 'rankings')   renderRankings();
  if (id === 'archive')    renderArchiveList();
  saveState();
}

// ═══════════════════════════════════════════════════════════════
// ADMIN ACCESS — a single shared secret, distributed by the organiser to
//  trusted admins, verified SERVER-SIDE against Firebase Realtime Database
//  (see js/sync.js and "Admin access" in HANDOFF.md) — not merely compared
//  in this browser's own JS. Replaces the original per-browser self-serve
//  password (anyone's first visit could set their own — which restricted
//  nobody but themselves) with a fixed secret only the organiser can set,
//  bootstrapped once into Firebase and never readable back by any client.
//  This is real access control now, not a deterrent: a wrong guess is
//  rejected by Firebase's own security rules regardless of what a client's
//  devtools claims — see verifyAdminSecret() below.
//
//  ADMIN_UNLOCKED_KEY is a standalone top-level localStorage entry,
//  deliberately NOT part of T — it must survive Generate/Reset (an admin
//  shouldn't have to re-enter the password every regeneration) and must
//  never end up inside an Archive snapshot.
// ═══════════════════════════════════════════════════════════════
var ADMIN_UNLOCKED_KEY = 'curveFFA_admin_unlocked';
// Cached on a successful unlock — this browser's proof that it knows the
// shared admin secret, reused by pushSyncUpdate() (js/sync.js) to authorize
// every tournament write, so ANY device that unlocks Admin can immediately
// co-admin any tournament, new or existing, with no separate per-tournament
// key to share. Not the plaintext password (a SHA-256 hash, same one
// verifyAdminSecret() already computes), but a durable, directly-reusable
// write credential for as long as it sits here — see "Admin access" in
// HANDOFF.md for why that's an accepted, not a new, exposure. Cleared by
// lockAdmin(), same lifecycle as ADMIN_UNLOCKED_KEY.
var ADMIN_PROOF_HASH_KEY = 'curveFFA_admin_proof_hash';

function isAdminUnlocked() { return localStorage.getItem(ADMIN_UNLOCKED_KEY) === 'true'; }

function lockAdmin() {
  localStorage.removeItem(ADMIN_UNLOCKED_KEY);
  localStorage.removeItem(ADMIN_PROOF_HASH_KEY);
  switchTab('bracket', document.querySelector('nav button[data-tab="bracket"]'));
  renderAdminSecurityPanel();
}

async function sha256Hex(str) {
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verifies a guess without the real hash ever being readable by any client
// (the Realtime Database rule for "adminAuth/hash" is .read:false). A write
// to "adminAuth/verify" is only PERMITTED by the rule if the value being
// written equals the real stored hash — so the write's own success/failure
// IS the answer, and the real hash is never exposed either way, right or
// wrong. Throws with e.code === 'OFFLINE' if Firebase itself is
// unreachable (fails closed — never silently grants access just because we
// couldn't check), distinct from a genuine PERMISSION_DENIED (wrong
// password) so the UI can tell the two apart. Returns the computed hash on
// success so the caller can cache it as this browser's write credential.
async function verifyAdminSecret(guess) {
  if (!SYNC_DB) { var e = new Error('Live sync unavailable'); e.code = 'OFFLINE'; throw e; }
  var hash = await sha256Hex(guess);
  await SYNC_DB.ref('adminAuth/verify').set(hash);
  return hash;
}

// Called by switchTab()'s guard above. `onSuccess` is switchTab's own
// retry of the switch it just intercepted — see the call site.
var _adminPwPromptCallback = null;

function showAdminPasswordPrompt(onSuccess) {
  _adminPwPromptCallback = onSuccess;
  document.getElementById('admin-pw-input').value = '';
  document.getElementById('admin-pw-error').style.display = 'none';
  document.getElementById('admin-pw-overlay').style.display = 'flex';
  document.getElementById('admin-pw-input').focus();
}

function submitAdminPasswordPrompt() {
  var input = document.getElementById('admin-pw-input');
  var errEl = document.getElementById('admin-pw-error');
  var btn = document.getElementById('admin-pw-submit');
  errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  verifyAdminSecret(input.value).then(function (hash) {
    localStorage.setItem(ADMIN_UNLOCKED_KEY, 'true');
    localStorage.setItem(ADMIN_PROOF_HASH_KEY, hash);
    if (typeof SYNC_IS_VIEWER !== 'undefined' && SYNC_IS_VIEWER && typeof promoteViewerToWriter === 'function') {
      promoteViewerToWriter();
    }
    document.getElementById('admin-pw-overlay').style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
    renderAdminSecurityPanel();
    var cb = _adminPwPromptCallback;
    _adminPwPromptCallback = null;
    if (cb) cb();
  }).catch(function (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
    errEl.textContent = (e && e.code === 'OFFLINE')
      ? 'Can\'t verify the password right now — check your connection and try again.'
      : 'Incorrect password.';
    errEl.style.display = 'block';
    input.value = '';
    input.focus();
  });
}

function cancelAdminPasswordPrompt() {
  document.getElementById('admin-pw-overlay').style.display = 'none';
  _adminPwPromptCallback = null;
}

// The one always-visible block in #view-admin (sits above panel-setup/
// panel-running, not inside either). Called once on page load and after
// every unlock/lock — in normal use this is only ever actually seen in its
// "unlocked" state, since switchTab()'s guard never lets an unauthenticated
// visitor's browser render #view-admin's contents at all; the "locked"
// branch is a defensive fallback, not a reachable state in the ordinary flow.
function renderAdminSecurityPanel() {
  var el = document.getElementById('admin-security-panel');
  if (!el) return;
  if (isAdminUnlocked()) {
    el.innerHTML = `<div class="card-title">Admin Access</div>
      <div class="msg msg-ok" style="margin-bottom:10px">🔓 Unlocked in this browser.</div>
      <button class="btn btn-amber btn-sm" onclick="lockAdmin()">🔒 Lock Admin</button>`;
  } else {
    el.innerHTML = `<div class="card-title">Admin Access</div>
      <div class="msg msg-info">🔒 Locked — enter the shared admin password to continue.</div>`;
  }
}

// The game's actual, technical per-room player limit — confirmed directly by
// the organiser (2026-09-07), distinct from any individual format's own
// PREFERRED room-size ceiling (e.g. FFA's defaultRoomSize.max of 8, a
// competitive-design choice, not a technical one — see the comment block
// above and "Room cap correction" in HANDOFF.md). Nothing before this
// existed actually checked a format's room math against this real number —
// team-3v3's Flex fallback (3 teams × 3 players = 9) happened to land under
// it by luck, not by any guard catching it. This constant plus
// validateRoomCap() below are that guard, going forward.
var HARD_ROOM_PLAYER_CAP = 10;

// Default number of pooled qualification rounds for single-elimination —
// used to populate T.gamemodeConfig.qualRounds at generation time (see
// proceedGenerateSchedule()). Runtime code reads the per-tournament
// descriptor value, not this constant directly, so a saved tournament keeps
// whatever qualRounds it was generated with even if this default changes later.
var QUAL_ROUNDS = 3;

// Swiss round count: derived from field size, not organiser-set — same
// standing principle as qualRounds having no organiser-facing control (see
// "One important principle" in HANDOFF.md). ceil(log2(N)) is the standard
// real-world Swiss-tournament sizing heuristic (the same doubling logic that
// determines how many rounds a single-elimination bracket of N needs to
// reach one winner — here it's "how many rounds until the standings
// meaningfully separate the field," not "how many rounds until one player
// remains"). Both constants are PROVISIONAL DEFAULTS, not settled numbers —
// same spirit as TARGET_ROUND_SURVIVAL_RATIO/MAX_ELIM_ROUNDS — easy to retune
// once there's real usage to react to; see "Swiss pooling phase" in
// HANDOFF.md for the sweep this was checked against.
var MIN_SWISS_ROUNDS = 3; // real-world Swiss practice rarely runs fewer than this, regardless of field size

var MAX_SWISS_ROUNDS = 7; // cap so a very large field doesn't produce an excessive pooling phase

// Group size: auto-derived default, with a real organiser override (the
// override lives in the setup panel's "Group size" field — see
// togglePoolingPhaseField()/proceedGenerateSchedule()). IDEAL_GROUP_SIZE is
// a PROVISIONAL DEFAULT (standard real-world group-stage convention, e.g.
// World Cup groups of 4), not a settled number — same spirit as
// TARGET_ROUND_SURVIVAL_RATIO/MIN_SWISS_ROUNDS. min/max stay fixed at 3/5
// regardless of the override (round-robin below 3 is degenerate; above 5
// starts trading away the "small, fast group" premise) — only `ideal` is
// ever replaced by the organiser's entered value.
var IDEAL_GROUP_SIZE = 4;

// How many elimination rounds to spread a field's cut over, between the
// no-elim/qual warm-up phase and the fixed Semis floor. Derived from how much
// cutting is actually needed rather than a fixed count, so a field just above
// the floor isn't forced through several rounds that eliminate nobody, and a
// very large field isn't forced through the same handful of rounds as a small
// one. Both constants below are PROVISIONAL DEFAULTS, not settled numbers —
// see HANDOFF.md ("Variable elimination-round count") for the reasoning and
// the sweep this was validated against; retune only with real usage data.
var TARGET_ROUND_SURVIVAL_RATIO = 0.80; // ~20% of the field eliminated per round

var MAX_ELIM_ROUNDS = 8; // hard cap so a huge field doesn't produce an absurdly long tournament

function proceedReset() {
  Object.assign(T, { scores:{}, finalScores:{}, assignments:[], qualTable:[], groupStandings:{}, poolingByeCounts:{}, pendingBracketSeeds:{},
    tieResolutions:{}, luckyLosers:[], byes:[], defenderChanges:{}, curRound:0, reserveOpen:true, started:false, needsSave:false, autoSaved:false, tournamentId:null });
  // Bracket's per-browser round-collapse state (js/render-viewer.js) — clear
  // explicitly for predictability, so replaying the same generation never
  // silently resumes old collapse choices (curRound:0 above already makes
  // any stale override structurally inert, since every round becomes
  // "future" again, but a hygienic clean slate is worth doing anyway).
  if (typeof bracketCollapseOverride !== 'undefined') bracketCollapseOverride = {};
  // Bracket's "Follow a player" choice (js/render-viewer.js) — cleared on a
  // full reset (clearFollow() also blanks the visible input box), but
  // deliberately NOT in proceedGenerateSchedule(): unlike collapse state
  // (tied to one round structure), the same friend group across several
  // generations should keep whoever they like to follow.
  if (typeof clearFollow === 'function') clearFollow();
  document.getElementById('panel-setup').style.display = 'block';
  document.getElementById('panel-running').style.display = 'none';
  document.getElementById('preview-wrap').style.display = 'none';
  document.getElementById('hdr-round').textContent = '—';
  updateTitleDisplay();
  // The old tournament's write key/shareable link must not linger — a stale
  // key pointing at a now-reset tournamentId is meaningless, and a stale "?t="
  // in the address bar would otherwise still point viewers at the old data
  // (which stays live in Firebase, just no longer updated) rather than
  // reflecting that this browser has moved on. See js/sync.js.
  if (typeof stopWriterListener === 'function') stopWriterListener();
  if (typeof clearSyncUrlBar === 'function') clearSyncUrlBar();
  if (typeof renderSyncStatusPanel === 'function') renderSyncStatusPanel();
  saveState();
}

function downloadCanvasAsPng(canvas, filename) {
  return new Promise(function (resolve) {
    canvas.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}

// Live Rankings tab's download button.
async function downloadRankingsImage() {
  var canvas = await buildRankingsImageCanvas(T);
  if (!canvas) { alert('No rankings data yet — start a tournament first.'); return; }
  await downloadCanvasAsPng(canvas, sanitizeFilename((T.title || 'Unnamed Tournament')) + '-rankings.png');
}

// Archive detail view's download button — same builder, fed the archived
// snapshot instead of live T.
async function downloadArchiveRankingsImage() {
  if (!currentArchiveEntry) return;
  var canvas = await buildRankingsImageCanvas(currentArchiveEntry.snapshot);
  if (!canvas) { alert('No rankings data in this saved snapshot.'); return; }
  await downloadCanvasAsPng(canvas, sanitizeFilename(currentArchiveEntry.title) + '-rankings.png');
}

// ═══════════════════════════════════════════════════════════════
// ARCHIVE — Modal (generic reusable 2/3/4-option confirmation dialog;
//  used by Archive's save/unsaved-changes flows and its import collision
//  dialogs (js/archive.js). Buttons
//  are built with real DOM nodes + closures (not inline onclick
//  strings) so titles/labels never need HTML-escaping gymnastics.
// ═══════════════════════════════════════════════════════════════
function showModal(title, message, buttons) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent = message;
  var wrap = document.getElementById('modal-btns');
  wrap.innerHTML = '';
  buttons.forEach(b => {
    var btn = document.createElement('button');
    btn.className = 'btn ' + (b.className || 'btn-secondary');
    btn.textContent = b.label;
    btn.onclick = function () { hideModal(); if (b.onClick) b.onClick(); };
    wrap.appendChild(btn);
  });
  document.getElementById('modal-overlay').style.display = 'flex';
}

function hideModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// --- JSON export: a safety valve against localStorage being cleared. Import lives in js/archive.js. ---
function sanitizeFilename(str) {
  return String(str).trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

function downloadJson(filename, dataObj) {
  var blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS & UTILITIES — small, cross-cutting functions used from
//  several sections above (not specific to any one feature area).
// ═══════════════════════════════════════════════════════════════
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Escapes single quotes for safe interpolation inside an inline onclick='...' attribute.
function escAttr(s) {
  return String(s).replace(/'/g, "\\'");
}

// A room-score cell is empty string/null/undefined until the organiser types a
// number into it; this normalises that into a parsed int or the given fallback.
function scoreOrDefault(raw, fallback) {
  return (raw !== null && raw !== undefined && raw !== '') ? parseInt(raw) : fallback;
}

// Returns the data-tab of whichever nav button currently has .active, or `fallback` if none.
function getActiveTab(fallback) {
  var b = document.querySelector('nav button.active');
  return b ? b.dataset.tab : fallback;
}

function descRooms(rooms) {
  var c = {};
  rooms.forEach(s => { c[s] = (c[s]||0)+1; });
  return Object.keys(c).sort((a,b)=>b-a).map(s=>(c[s]>1?c[s]+'×':'')+s).join(' + ');
}

function roomLabel(n) { return String.fromCharCode(64 + n); }

function statEl(lbl, val, cls) {
  return `<div class="sstat"><div class="lbl">${lbl}</div><div class="val ${cls||''}">${val}</div></div>`;
}

// Auto-refresh interval lives in js/render-viewer.js, not here — this was a
// byte-identical duplicate left over from the "Split into multiple files"
// refactor (both fired every 5s, doubling every Scoreboard/Bracket
// re-render for no reason). Removed 2026-09-06.

// Init (restoring any saved tournament from this browser) happens from
// index.html's own trailing inline <script>, after every js/*.js file has
// loaded — core.js is the FIRST script tag, so calling loadState() from
// here would run before functions it needs (e.g. togglePoolingPhaseField(),
// defined in generation-and-roster.js) exist yet. A stray premature call
// used to sit here; it threw a ReferenceError partway through, silently
// swallowed by loadState()'s own try/catch, and the correct later call from
// index.html just re-did the work — harmless in effect, but wasted every
// load and risked masking a real future bug behind the same silently-caught
// warning. Removed.
