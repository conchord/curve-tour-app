// archive.js — the Tournament Archive: storage, save/auto-save, the list/
// detail views, annotations, and JSON export.

// ═══════════════════════════════════════════════════════════════
// ARCHIVE — DATA LAYER & SAVE FLOWS. Completed (or manually saved)
//  tournaments, stored separately from the live curveFFA_state_v1
//  key so the two never collide. Index (curveFFA_archive_index) holds
//  lightweight summary rows for fast listing; each full snapshot
//  lives at its own curveFFA_archive_{id} key, storing a deep copy
//  of T at save time plus organiser annotations.
//  No DOM rendering below this point until renderArchiveList() —
//  see ARCHIVE RENDERING further down for the read-only views.
// ═══════════════════════════════════════════════════════════════
var ARCHIVE_INDEX_KEY = 'curveFFA_archive_index';

function getArchiveIndex() {
  try { return JSON.parse(localStorage.getItem(ARCHIVE_INDEX_KEY) || '[]'); }
  catch (e) { return []; }
}

function saveArchiveIndex(index) {
  localStorage.setItem(ARCHIVE_INDEX_KEY, JSON.stringify(index));
}

function getArchiveEntry(id) {
  try { return JSON.parse(localStorage.getItem('curveFFA_archive_' + id)); }
  catch (e) { return null; }
}

function saveArchiveEntry(entry) {
  localStorage.setItem('curveFFA_archive_' + entry.id, JSON.stringify(entry));
}

function buildArchiveSummary(id, title, dateSaved, state) {
  state = state || T; // matches computeRankings()'s own state-defaults-to-T idiom
  return {
    id, title, dateSaved,
    tournamentId: state.tournamentId, // identity for de-dup matching — see saveToArchive/archiveSilently
    playerCount: state.players.length,
    roundsPlayed: state.rounds[state.curRound] ? state.rounds[state.curRound].roundNum : 0
  };
}

function showArchiveStatus(msg) {
  var el = document.getElementById('archive-save-status');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showArchiveStatus._t);
  showArchiveStatus._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// Writes the actual archive entry + index update. Shared by the
// interactive Save button, the silent save-and-proceed flows, and the
// Final-completion auto-save — none of those differ in HOW a save
// happens, only in WHETHER they ask the organiser first.
function performArchiveSave(id, title, keepAnnotations) {
  var index = getArchiveIndex();
  var dateSaved = new Date().toISOString();
  var oldEntry = keepAnnotations ? getArchiveEntry(id) : null;
  var entry = {
    id, title, dateSaved,
    tournamentId: T.tournamentId,
    snapshot: JSON.parse(JSON.stringify(T)),
    annotations: (oldEntry && oldEntry.annotations) || []
  };
  saveArchiveEntry(entry);
  var summary = buildArchiveSummary(id, title, dateSaved);
  var idx = index.findIndex(e => e.id === id);
  if (idx === -1) index.push(summary); else index[idx] = summary;
  saveArchiveIndex(index);
  T.needsSave = false;
  saveState();
  if (getActiveTab() === 'archive') renderArchiveList();
}

// "Save as new entry" (here) and "Import as new copy"/"Import all as new
// copies" (js/archive.js's import section) both deliberately keep the SAME
// tournamentId on the duplicate — correct, since it genuinely is another
// snapshot of the same real tournament, not a different one — so more than
// one archive entry can share a tournamentId. Plain index.find() would
// return whichever one happens to sit first in the raw array, which is
// insertion order, not necessarily chronological (a bulk import in
// particular can insert an older-dated entry after a newer one already in
// the index) — an arbitrary, unpredictable "Overwrite" target once there are
// two or more. Picking the most-recently-saved of the matches instead is a
// small, low-stakes call (not surfaced as a design fork): it matches the
// ordinary "continue where I left off" intuition, and is a strict
// improvement over array order with no new UI needed.
function findLatestArchiveEntryForTournament(index, tournamentId) {
  var matches = index.filter(e => e.tournamentId === tournamentId);
  if (!matches.length) return undefined;
  return matches.reduce((latest, e) => new Date(e.dateSaved) > new Date(latest.dateSaved) ? e : latest);
}

// Interactive save — the one path that can prompt. Matches by T.tournamentId
// (stable per-generation identity), not by title — organisers can and do reuse
// titles across genuinely different tournaments (e.g. a recurring weekly event),
// and matching by title alone would silently overwrite an unrelated saved entry.
// A title collision with a *different* tournamentId still prompts (never a
// silent overwrite), it just can't offer "Overwrite" since that would target
// the wrong entry.
function saveToArchive() {
  if (!T.rounds.length) return;
  var title = (T.title || '').trim() || 'Unnamed Tournament';
  var index = getArchiveIndex();
  var sameTournament = T.tournamentId ? findLatestArchiveEntryForTournament(index, T.tournamentId) : undefined;
  function doSave(id, keepAnnotations) {
    performArchiveSave(id, title, keepAnnotations);
    showArchiveStatus('Tournament saved to archive.');
  }

  if (sameTournament) {
    showModal('Tournament already archived',
      'A tournament named "' + title + '" already exists. Overwrite, save as a new entry, or cancel?',
      [
        { label: 'Overwrite existing', className: 'btn-danger', onClick: () => doSave(sameTournament.id, true) },
        { label: 'Save as new entry', className: 'btn-secondary', onClick: () => doSave(String(Date.now()), false) },
        { label: 'Cancel', className: 'btn-secondary' }
      ]);
    return;
  }

  var titleCollision = index.find(e => e.title === title);
  if (titleCollision) {
    showModal('Title already used',
      'A different archived tournament is also named "' + title + '". Save this as a new entry, or cancel to rename it first?',
      [
        { label: 'Save as new entry', className: 'btn-secondary', onClick: () => doSave(String(Date.now()), false) },
        { label: 'Cancel', className: 'btn-secondary' }
      ]);
    return;
  }

  doSave(String(Date.now()), false);
}

// Non-interactive save — always resolves immediately (overwrite on a
// same-title match, otherwise create new), never shows a dialog. Used
// for the real Final-completion auto-save and for the "Save & ..."
// choices inside the unsaved-changes modal, since chaining a second
// interactive prompt from inside a modal callback risks T being
// mutated by whatever comes next before the user responds to it.
function archiveSilently(statusMsg) {
  if (!T.rounds.length) return;
  var title = (T.title || '').trim() || 'Unnamed Tournament';
  // Matches by tournamentId only — never by title, so a title shared with a
  // different tournament can never be silently overwritten here. The most
  // recent match when several share this tournamentId — see
  // findLatestArchiveEntryForTournament()'s comment above.
  var existing = T.tournamentId ? findLatestArchiveEntryForTournament(getArchiveIndex(), T.tournamentId) : undefined;
  performArchiveSave(existing ? existing.id : String(Date.now()), title, !!existing);
  showArchiveStatus(statusMsg);
}

// Fires once per tournament, the moment every finalist has a score for
// every Final game — reuses the exact same completion check Rankings
// already computes, so "Final complete" means the same thing everywhere.
function checkAutoArchive() {
  if (T.autoSaved) return;
  var round = T.rounds[T.curRound];
  if (!round || !round.isFinal) return;
  var data = computeRankings();
  if (data && data.finalComplete) {
    archiveSilently('Tournament archived automatically.');
    T.autoSaved = true;
    saveState();
  }
}

// ═══════════════════════════════════════════════════════════════
// ARCHIVE RENDERING — read-only views over saved snapshots (list,
//  detail Rankings/Bracket, annotations, JSON export). Kept separate
//  from the live-tournament renderers above (Scoreboard, Bracket,
//  Rankings) since the two read from different data sources (a
//  snapshot object vs. the live T) and mixing them up would be a
//  source of bugs. Detail rendering reuses the same pure, DOM-free
//  builders (computeRankings/buildBracketHtml/buildRankingsRows) the
//  live tabs use, just fed an archived snapshot instead of T.
// ═══════════════════════════════════════════════════════════════
function renderArchiveList() {
  document.getElementById('ar-detail-view').style.display = 'none';
  document.getElementById('ar-list-view').style.display = 'block';
  var index = getArchiveIndex().slice().sort((a, b) => new Date(b.dateSaved) - new Date(a.dateSaved));
  var emptyEl = document.getElementById('ar-empty');
  document.getElementById('ar-export-all-wrap').style.display = index.length ? 'block' : 'none';
  if (!index.length) {
    emptyEl.style.display = 'block';
    document.getElementById('ar-list').innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  var html = '';
  index.forEach(entry => {
    var dateStr = new Date(entry.dateSaved).toLocaleString();
    html += `<div class="archive-row" style="cursor:pointer" onclick="openArchiveEntry('${entry.id}')">
      <div class="archive-row-main">
        <div class="archive-row-title">${esc(entry.title)}</div>
        <div class="archive-row-meta">${dateStr} · ${entry.playerCount} players · ${entry.roundsPlayed} round${entry.roundsPlayed === 1 ? '' : 's'} played</div>
      </div>
    </div>`;
  });
  document.getElementById('ar-list').innerHTML = html;
}

// --- Archive detail view: read-only Rankings + Bracket for one saved snapshot ---
var currentArchiveEntry = null;

function openArchiveEntry(id) {
  var entry = getArchiveEntry(id);
  if (!entry) return;
  currentArchiveEntry = entry;
  document.getElementById('ar-list-view').style.display = 'none';
  document.getElementById('ar-detail-view').style.display = 'block';

  var snap = entry.snapshot;
  var snapFormat = GAME_FORMATS[snap.gameFormat] || GAME_FORMATS['ffa-individual']; // pre-gamemode-refactor archives have no gameFormat field
  document.getElementById('ar-detail-summary').innerHTML =
    statEl('Tournament', entry.title, 'cyan') +
    statEl('Saved', new Date(entry.dateSaved).toLocaleString()) +
    statEl(snapFormat.unitLabelPlural, snap.players.length) +
    statEl('Rounds played', snap.rounds[snap.curRound] ? snap.rounds[snap.curRound].roundNum : '—');

  var rankData = computeRankings(snap);
  document.getElementById('ar-rk-list').innerHTML = rankData ? buildRankingsRows(rankData) :
    '<div style="text-align:center;color:var(--muted);padding:20px">No data.</div>';

  document.getElementById('ar-bracket-rounds').innerHTML = buildBracketHtml(snap);

  renderAnnotationsList(entry);
}

function backToArchiveList() {
  currentArchiveEntry = null;
  renderArchiveList();
}

function renderAnnotationsList(entry) {
  var wrap = document.getElementById('ar-annotations-list');
  if (!entry.annotations.length) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:12px;margin-bottom:8px">No annotations yet.</div>';
    return;
  }
  var html = '';
  entry.annotations.forEach((note, i) => {
    html += `<div class="seed-card" style="align-items:flex-start;flex-direction:column;gap:4px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;width:100%;gap:10px">
        <div style="font-size:13px;white-space:pre-wrap;flex:1">${esc(note.text)}</div>
        <button class="btn btn-secondary btn-sm" onclick="deleteAnnotation(${i})" title="Delete">✕</button>
      </div>
      <div style="font-size:10px;color:var(--muted)">${new Date(note.timestamp).toLocaleString()}</div>
    </div>`;
  });
  wrap.innerHTML = html;
}

// Annotations are stored on the archived entry itself and saved back
// immediately — they never touch the index or the live curveFFA_state_v1.
function addAnnotation() {
  if (!currentArchiveEntry) return;
  var input = document.getElementById('ar-note-input');
  var text = input.value.trim();
  if (!text) return;
  currentArchiveEntry.annotations.push({ text, timestamp: new Date().toISOString() });
  saveArchiveEntry(currentArchiveEntry);
  input.value = '';
  renderAnnotationsList(currentArchiveEntry);
}

function deleteAnnotation(index) {
  if (!currentArchiveEntry) return;
  if (!confirm('Delete this annotation? This cannot be undone.')) return;
  currentArchiveEntry.annotations.splice(index, 1);
  saveArchiveEntry(currentArchiveEntry);
  renderAnnotationsList(currentArchiveEntry);
}

function exportEntryAsJson(id) {
  var entry = id ? getArchiveEntry(id) : currentArchiveEntry;
  if (!entry) return;
  var dateStr = new Date(entry.dateSaved).toISOString().slice(0, 10);
  downloadJson(`curve-tournament_${sanitizeFilename(entry.title)}_${dateStr}.json`, entry);
}

function exportFullArchive() {
  var index = getArchiveIndex();
  var entries = index.map(e => getArchiveEntry(e.id)).filter(Boolean);
  var dateStr = new Date().toISOString().slice(0, 10);
  downloadJson(`curve-tournament-archive_${dateStr}.json`, { exportedAt: new Date().toISOString(), tournaments: entries });
}

// ═══════════════════════════════════════════════════════════════
// ARCHIVE — IMPORT. Restores from a file produced by exportEntryAsJson()
//  or exportFullArchive(). Neither export shape carries a version field,
//  so a file is routed structurally: a `tournaments` array means a full-
//  archive bundle, an `id`+`snapshot` pair means a single entry. Operates
//  ONLY on curveFFA_archive_index/curveFFA_archive_{id} — never reads or
//  writes T, never calls saveState() (which would push live T to Firebase
//  as a side effect of a purely local archive operation).
// ═══════════════════════════════════════════════════════════════
var ARCHIVE_IMPORT_MAX_BYTES = 25 * 1024 * 1024;

function handleArchiveImportFile(input) {
  var file = input.files && input.files[0];
  input.value = ''; // so re-selecting the same file still fires change
  if (!file) return;
  if (file.size > ARCHIVE_IMPORT_MAX_BYTES) { alert("That file is too large to be a tournament export — nothing was imported."); return; }
  var reader = new FileReader();
  reader.onerror = function () { alert("Couldn't read that file — it may be unreadable or no longer available."); };
  reader.onload = function () { importArchiveFromText(String(reader.result)); };
  reader.readAsText(file);
}

function importArchiveFromText(text) {
  var data;
  try { data = JSON.parse(text); }
  catch (e) { alert("That file isn't valid JSON — it may be corrupted, or not a Curve tournament export."); return; }

  if (data && Array.isArray(data.tournaments)) {
    if (!data.tournaments.length) { alert("That full-archive file contains no tournaments — nothing to import."); return; }
    startArchiveImport(data.tournaments, true);
  } else if (isValidArchiveImportEntry(data)) {
    startArchiveImport([data], false);
  } else {
    alert("That JSON file isn't a Curve tournament export — expected either a single archived tournament or a full-archive file.");
  }
}

// Minimum shape a snapshot needs to render without throwing: openArchiveEntry()
// dereferences snap.players.length/snap.rounds, and computeRankings() (js/advancement.js)
// dereferences state.assignments.length completely unguarded — a "valid" import must
// never be one that crashes the moment its row is opened.
function isValidArchiveImportEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  if (raw.id === undefined || raw.id === null) return false;
  var s = raw.snapshot;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  return Array.isArray(s.players) && Array.isArray(s.rounds) && Array.isArray(s.assignments);
}

function validArchiveDate(v) {
  if (typeof v !== 'string' || !v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : v;
}

function mintArchiveId(index) {
  // A single import can mint several ids inside one synchronous loop (bulk
  // "import as new copies") — unlike every other String(Date.now()) call site
  // in this file, which only ever mints one id per user interaction, seconds
  // apart, a same-millisecond collision here is the likely case, not the
  // practically-impossible one.
  var id = String(Date.now());
  while (index.some(e => String(e.id) === id) || localStorage.getItem('curveFFA_archive_' + id) !== null) {
    id = String(Number(id) + 1);
  }
  return id;
}

function startArchiveImport(raws, isBundle) {
  var index = getArchiveIndex();
  var existingIds = {};
  index.forEach(e => { existingIds[String(e.id)] = e; });

  var valid = [], invalid = 0;
  raws.forEach(r => { if (isValidArchiveImportEntry(r)) valid.push(r); else invalid++; });

  if (!valid.length) {
    alert(isBundle
      ? "Nothing was imported — none of the " + raws.length + " entries in that file contained usable tournament data."
      : "That file doesn't contain a usable tournament — nothing was imported.");
    return;
  }

  var collisions = valid.filter(r => existingIds[String(r.id)] !== undefined);

  if (!collisions.length) {
    finishArchiveImport(runArchiveImport(valid, 'overwrite'), invalid, isBundle);
    return;
  }

  if (!isBundle) {
    var existingTitle = existingIds[String(valid[0].id)].title;
    showModal('Already in your archive',
      'An archived tournament with this ID already exists ("' + existingTitle + '"). Overwrite it, import it as a separate new entry, or cancel?',
      [
        { label: 'Overwrite existing', className: 'btn-danger', onClick: () => finishArchiveImport(runArchiveImport(valid, 'overwrite'), invalid, isBundle) },
        { label: 'Import as new entry', className: 'btn-secondary', onClick: () => finishArchiveImport(runArchiveImport(valid, 'new'), invalid, isBundle) },
        { label: 'Cancel', className: 'btn-secondary' }
      ]);
    return;
  }

  showModal('Some of these are already archived',
    collisions.length + ' of the ' + valid.length + ' tournaments in this file are already in your archive. How should those be handled? This choice applies to all ' + collisions.length + '.',
    [
      { label: 'Overwrite existing', className: 'btn-danger', onClick: () => finishArchiveImport(runArchiveImport(valid, 'overwrite'), invalid, isBundle) },
      { label: 'Import all as new copies', className: 'btn-secondary', onClick: () => finishArchiveImport(runArchiveImport(valid, 'new'), invalid, isBundle) },
      { label: 'Skip the duplicates', className: 'btn-secondary', onClick: () => finishArchiveImport(runArchiveImport(valid, 'skip'), invalid, isBundle) },
      { label: 'Cancel', className: 'btn-secondary' }
    ]);
}

// The write loop. mode: 'overwrite' (matching ids replace in place), 'new'
// (every entry mints a fresh id, even non-colliding ones stay as-is since
// mintArchiveId is only consulted on an actual id collision below), 'skip'
// (colliding entries are dropped, non-colliding still import).
function runArchiveImport(valid, mode) {
  var index = getArchiveIndex();
  var counts = { added: 0, overwritten: 0, skippedDup: 0, failed: 0, lastTitle: null, mode: mode };

  for (var i = 0; i < valid.length; i++) {
    var raw = valid[i];
    var idx = index.findIndex(e => String(e.id) === String(raw.id));
    var id, isOverwrite = false;
    if (idx === -1) { id = String(raw.id); }
    else if (mode === 'skip') { counts.skippedDup++; continue; }
    else if (mode === 'new') { id = mintArchiveId(index); }
    else { id = String(raw.id); isOverwrite = true; }

    var snapshot = raw.snapshot;
    var title = (typeof raw.title === 'string' ? raw.title.trim() : '') || 'Unnamed Tournament';
    var dateSaved = validArchiveDate(raw.dateSaved) || new Date().toISOString();
    var entry = {
      id, title, dateSaved,
      tournamentId: snapshot.tournamentId !== undefined ? snapshot.tournamentId : (raw.tournamentId != null ? raw.tournamentId : null),
      snapshot,
      annotations: Array.isArray(raw.annotations) ? raw.annotations : []
    };

    try { saveArchiveEntry(entry); }
    catch (e) { counts.failed = valid.length - i; break; }

    var summary = buildArchiveSummary(id, title, dateSaved, snapshot);
    var at = index.findIndex(e => String(e.id) === String(id));
    if (at === -1) index.push(summary); else index[at] = summary;
    if (isOverwrite) counts.overwritten++; else counts.added++;
    counts.lastTitle = title;
  }

  try { saveArchiveIndex(index); } catch (e) {}
  return counts;
}

function describeArchiveImport(counts, invalid, isBundle) {
  var total = counts.added + counts.overwritten;

  if (!isBundle) {
    if (!total) {
      if (counts.failed) return "Couldn't import — your browser's storage is full.";
      return "That file doesn't contain a usable tournament — nothing was imported.";
    }
    var name = 'Imported "' + counts.lastTitle + '"';
    if (counts.overwritten) return name + ' — replaced the copy already in your archive.';
    if (counts.mode === 'new') return name + ' as a second, separate archive entry.';
    return name + '.';
  }

  var parts = [];
  if (counts.overwritten) parts.push(counts.overwritten + ' replaced existing copy' + (counts.overwritten === 1 ? '' : 'ies'));
  if (counts.skippedDup) parts.push(counts.skippedDup + ' skipped — already archived');
  if (invalid) parts.push(invalid + ' skipped — invalid data');

  if (!total) {
    if (counts.failed) return "Couldn't import — your browser's storage is full.";
    var reasons = [];
    if (counts.skippedDup) reasons.push(counts.skippedDup + ' were already archived');
    if (invalid) reasons.push(invalid + ' contained no usable tournament data');
    return reasons.length
      ? "Nothing was imported — of the " + (counts.skippedDup + invalid) + " entries in that file, " + reasons.join(' and ') + "."
      : "Nothing was imported — none of the entries in that file contained usable tournament data.";
  }

  var msg = 'Imported ' + total + ' tournament' + (total === 1 ? '' : 's') + (parts.length ? ' (' + parts.join(', ') + ')' : '') + '.';
  if (counts.failed) msg += ' Ran out of browser storage — the remaining ' + counts.failed + ' were not imported.';
  return msg;
}

function finishArchiveImport(counts, invalid, isBundle) {
  renderArchiveList();
  alert(describeArchiveImport(counts, invalid, isBundle));
}

function deleteArchiveEntry(id) {
  var entry = getArchiveEntry(id);
  if (!confirm('Permanently delete "' + (entry ? entry.title : 'this tournament') + '" from the archive? This cannot be undone.')) return;
  localStorage.removeItem('curveFFA_archive_' + id);
  saveArchiveIndex(getArchiveIndex().filter(e => String(e.id) !== String(id)));
  backToArchiveList();
}
