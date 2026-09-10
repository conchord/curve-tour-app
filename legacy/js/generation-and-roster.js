// generation-and-roster.js — schedule generation, roster parsing/loading,
// setup-panel field handlers, and reserve/player/team management.

function togglePoolingPhaseField() {
  var phase = document.getElementById('cfg-pooling-phase').value;
  var isGroupStage = phase === 'group-stage';
  // "Advance to bracket" (a single global number) and "Qualifiers per
  // group" (a per-group number the total is computed from) are mutually
  // exclusive — Group Stage shows the latter, every other pooling phase
  // (including "None") shows the former only when pooling is active.
  document.getElementById('field-qual-adv').style.display = (phase !== 'none' && !isGroupStage) ? 'block' : 'none';
  document.getElementById('field-qualifiers-per-group').style.display = isGroupStage ? 'block' : 'none';
  document.getElementById('field-group-size').style.display = isGroupStage ? 'block' : 'none';
  document.getElementById('field-round-robin-mode').style.display = isGroupStage ? 'block' : 'none';
  document.getElementById('group-stage-preview').style.display = isGroupStage ? 'block' : 'none';
  if (isGroupStage) updateGroupStagePreview();
}

// Double-elimination's grand final is a continuous games-until-someone-wins
// race, not the fixed-numGames/cumulative-score match every other schedule
// logic's Final uses (see "Grand-final race format" in HANDOFF.md) — the
// two field groups are mutually exclusive, same pattern as
// togglePoolingPhaseField()'s "Advance to bracket" vs "Qualifiers per group".
function toggleScheduleLogicFields() {
  var scheduleLogic = document.getElementById('cfg-schedule-logic').value;
  var isDoubleElim = scheduleLogic === 'double-elimination';
  var isSharedFinal = scheduleLogic === 'double-elimination-shared-final';
  var isSingleElim = scheduleLogic === 'single-elimination';
  // Grand-Final race fields only apply to 'double-elimination' (1v1/3v3's
  // continuous-race Grand Final) — the shared-final generalization merges
  // WB+LB survivors directly into an ordinary fixed-numGames Final, so it
  // uses "Finals format" (like single-elimination) instead, not a race.
  document.getElementById('field-grand-final-targets').style.display = isDoubleElim ? 'block' : 'none';
  document.getElementById('field-finals-games').style.display = isDoubleElim ? 'none' : 'block';
  // Semis headcount override — only singleEliminationBracketPhase actually
  // reads gamemodeConfig.semisSize (see js/bracket-phases.js); neither
  // double-elimination variant has a "Semis" round concept at all, so the
  // field would do nothing there and is hidden to avoid implying otherwise.
  document.getElementById('field-semis-override').style.display = isSingleElim ? 'block' : 'none';
  // Semis format (2026-09-08, "Multi-game Semis" in HANDOFF_LOG.md) — same
  // gate as the override just above, for the same reason (Semis only exists
  // under single-elimination).
  document.getElementById('field-semis-games').style.display = isSingleElim ? 'block' : 'none';
  // Final headcount override — meaningful for single-elimination AND the
  // shared-final generalization (both read gamemodeConfig.finalSize); NOT
  // for 'double-elimination', whose Grand Final is sized by the race targets
  // above instead.
  document.getElementById('field-final-override').style.display = (isSingleElim || isSharedFinal) ? 'block' : 'none';
  // LB qualifiers — only meaningful for the shared-final generalization.
  document.getElementById('field-lb-qualifiers').style.display = isSharedFinal ? 'block' : 'none';
}

// Keeps exactly ONE "Double elimination" option visible in the Schedule
// Logic dropdown at a time, matching whichever Game Format (+ Odd-count
// strategy) combination is currently selected — surfacing the compatibility
// rule as decluttering (an irrelevant option isn't just disabled, it's
// hidden from the list entirely) rather than making the organiser read past
// a greyed-out entry that will never apply to what they've already chosen
// (2026-09-08, in response to organiser feedback that seeing both variants
// simultaneously read as confusing clutter).
// 'double-elimination' (the original race-format Grand Final) is compatible
// only when format.idealRoomSize === 2 and oddCountStrategy !== 'flex' —
// mirrors the two hard throws in doubleEliminationBracketPhase
// (js/bracket-phases.js) exactly, just surfaced at selection time instead of
// failing at Generate-Schedule time. 'double-elimination-shared-final' (the
// FFA/Team generalization) is structurally compatible with EVERY format,
// including 1v1/3v3 — but is deliberately hidden there anyway, since 1v1/3v3
// keep the original race-format Grand Final as their intended double-
// elimination experience (see "Explicitly out of scope" in the plan this
// build shipped from — exposing the shared-final variant as a second
// opt-in option for those two formats was left as a low-priority follow-up,
// not built here). The two options are therefore always exact mirror images
// of each other's visibility — never both shown, never both hidden.
// Single elimination is NEVER gated here (2026-09-08 rename — it's the old
// "Classic elimination" mechanism, format-agnostic by construction). Called
// from the end of toggleFormatFields() (covers a format change and the
// loadState() restore path, since that already calls toggleFormatFields())
// and directly from cfg-odd-count-strategy's own onchange (the one edge
// case where format stays fixed — team-3v3 is the only format offering
// 'flex' at all — but availability still changes). Preserves the current
// selection when it's still valid rather than force-resetting on every
// rebuild (unlike the odd-count-strategy dropdown's own rebuild above,
// which always defaults back to 'none') — schedule-logic's value only
// matters on the NEXT Generate Schedule click, not on an already-running
// tournament, so there's no correctness reason to disturb an already-valid
// choice, e.g. loadState() restoring a saved double-elimination team-3v3
// setup.
// NOTE: index.html's static default bakes in the SAME compatibility rule for
// the default Game Format (FFA — Individual, incompatible) — a genuinely
// fresh page load never calls this function at all (loadState() returns
// immediately when there's no saved localStorage state), so first paint
// depends entirely on that static default, not on this function ever
// running. Keep the two in sync by hand if the default format ever changes.
function refreshScheduleLogicAvailability() {
  var format = GAME_FORMATS[document.getElementById('cfg-game-format').value];
  var oddCountStrategy = document.getElementById('cfg-odd-count-strategy').value;
  var compatible = format.idealRoomSize === 2 && oddCountStrategy !== 'flex';
  var select = document.getElementById('cfg-schedule-logic');
  var classicOpt = select.querySelector('option[value="double-elimination"]');
  var sharedOpt = select.querySelector('option[value="double-elimination-shared-final"]');
  if (classicOpt) { classicOpt.hidden = !compatible; classicOpt.disabled = !compatible; }
  if (sharedOpt) { sharedOpt.hidden = compatible; sharedOpt.disabled = compatible; }
  var selectedOpt = select.querySelector('option[value="' + select.value + '"]');
  if (selectedOpt && (selectedOpt.disabled || selectedOpt.hidden)) {
    select.value = 'single-elimination';
    toggleScheduleLogicFields();
  }
}

// Live-updating preview for the Group Stage pooling phase (Part 1 of
// "Group stage" in HANDOFF.md) — recomputes on every group-size/round-
// robin-mode/qualifiers-per-group edit, showing the group breakdown and
// the round-count tradeoff between single and double round-robin directly,
// so the organiser sees the consequence of their override before
// generating. Generation itself always reads whatever is currently in
// these fields — there is no separate "auto" vs. "override" code path,
// this preview is purely informational. Requires T.confirmedCount to
// already be set (same precondition "Registered players"/the floor check
// already have) rather than inventing a second, raw-textarea-driven live
// count just for this preview — shows a prompt to load the roster first
// instead of silently showing nothing.
function updateGroupStagePreview() {
  var wrap = document.getElementById('group-stage-preview');
  if (!wrap || document.getElementById('cfg-pooling-phase').value !== 'group-stage') return;
  if (T.confirmedCount === null || T.confirmedCount === undefined) {
    wrap.innerHTML = '<div class="msg msg-err">Load a roster first (see "Load roster & reserves" below) to see the group breakdown.</div>';
    return;
  }
  var groupSize = parseInt(document.getElementById('cfg-group-size').value) || IDEAL_GROUP_SIZE;
  var qpg = parseInt(document.getElementById('cfg-qualifiers-per-group').value) || 2;
  var roundRobinMode = document.getElementById('cfg-round-robin-mode').value;

  if (groupSize < GROUP_SIZE_BOUNDS.min) {
    wrap.innerHTML = '<div class="msg msg-err">Group size must be at least ' + GROUP_SIZE_BOUNDS.min + ' — round-robin below that is degenerate.</div>';
    return;
  }
  if (groupSize <= qpg) {
    wrap.innerHTML = '<div class="msg msg-err">Group size (' + groupSize + ') must be greater than qualifiers per group (' + qpg + ') — a group can\'t qualify more finishers than it contains.</div>';
    return;
  }

  var groupSizes = distributeRooms(T.confirmedCount, { min: GROUP_SIZE_BOUNDS.min, max: GROUP_SIZE_BOUNDS.max, ideal: groupSize });
  var maxRoundsSingle = groupSizes.reduce((m, s) => Math.max(m, circleMethodSchedule(s).numRounds), 0);
  var maxRoundsDouble = maxRoundsSingle * 2;
  var activeRounds = roundRobinMode === 'double' ? maxRoundsDouble : maxRoundsSingle;
  var totalAdvancing = groupSizes.length * qpg;

  wrap.innerHTML = '<div class="msg" style="background:var(--surface2);border:1px solid var(--border);line-height:1.7">' +
    '<strong>' + groupSizes.length + '</strong> group' + (groupSizes.length === 1 ? '' : 's') +
    ' (sizes: ' + groupSizes.join(', ') + ')<br>' +
    'Round-robin length: <strong>' + maxRoundsSingle + '</strong> rounds single / <strong>' + maxRoundsDouble + '</strong> rounds double' +
    ' — currently using <strong>' + activeRounds + '</strong><br>' +
    'Advancing to bracket: <strong>' + totalAdvancing + '</strong> (' + groupSizes.length + ' × ' + qpg + ' per group)' +
    '</div>';
}

// Swaps the Roster/Reserves labels, placeholders, and the individual-
// reserves field's visibility to match the selected game format — called on
// format change and once at load time so a restored team-format setup shows
// the right hints immediately.
function toggleFormatFields() {
  var format = GAME_FORMATS[document.getElementById('cfg-game-format').value];
  var isTeam = !!format.teamSize;
  // Member-count placeholders built from the actual format.teamSize rather
  // than hardcoded for 2 — 2v2v2v2's roster line still reads exactly as
  // before, but team-3v3 (teamSize 3) now correctly hints at 3 members
  // instead of silently under-representing what parseTeamLines() expects.
  var memberPlaceholders = [];
  for (var mi = 0; mi < (format.teamSize || 0); mi++) memberPlaceholders.push('Player' + (mi + 1));
  var memberHint = memberPlaceholders.join(', ');
  document.getElementById('roster-title-hint').textContent = isTeam
    ? '— confirmed teams, one per line: TeamName, ' + memberHint
    : '— confirmed players, one per line';
  document.getElementById('reserves-title-hint').textContent = isTeam
    ? '— reserve teams, one per line: TeamName, ' + memberHint
    : '— one per line';
  document.getElementById('cfg-roster').placeholder = isTeam
    ? 'Team Rocket, ' + memberPlaceholders.map((p,i)=>i===0?'Ash (uid_ash01)':i===1?'Misty (uid_misty02)':p).join(', ') +
      '\nGary\'s Gang, ' + memberPlaceholders.map((p,i)=>i===0?'Gary (uid_gary03)':i===1?'Brock':p).join(', ') + '\n...'
    : 'Harald\nLagtop\nArisu\n...';
  document.getElementById('cfg-reserves').placeholder = isTeam
    ? 'Reserve Squad, ' + memberHint + '\n...'
    : 'ReservePlayer1\nReservePlayer2\n...';
  document.getElementById('field-reserve-individuals').style.display = isTeam ? 'block' : 'none';

  // Odd-count strategy dropdown — only shown for a format that declares more
  // than one supported strategy (today: just team-3v3). Options are rebuilt
  // from the format's own declared list every time (not a fixed 3-option
  // HTML select) so a future format supporting a narrower subset works
  // without touching this function. Defaults to 'none' per the organiser's
  // stated expectation that registrations are typically kept even.
  var oddStrategies = format.supportedOddCountStrategies;
  var oddWrap = document.getElementById('field-odd-count-strategy');
  if (oddStrategies && oddStrategies.length > 1) {
    document.getElementById('cfg-odd-count-strategy').innerHTML = oddStrategies.map(key =>
      `<option value="${key}"${key === 'none' ? ' selected' : ''}>${esc(ODD_COUNT_STRATEGIES[key].label)}</option>`
    ).join('');
    oddWrap.style.display = 'block';
  } else {
    oddWrap.style.display = 'none';
  }

  // Team scoring rule — only meaningful (and only shown) for a team format;
  // built from TEAM_SCORING_RULES itself, same "options rebuilt from the
  // registry" pattern as the odd-count-strategy dropdown just above, so a
  // future third rule needs no changes here. Defaults to 'sum-members'.
  var scoringWrap = document.getElementById('field-team-scoring-rule');
  if (isTeam) {
    document.getElementById('cfg-team-scoring-rule').innerHTML = Object.keys(TEAM_SCORING_RULES).map(key =>
      `<option value="${key}"${key === 'sum-members' ? ' selected' : ''}>${esc(TEAM_SCORING_RULES[key].label)}</option>`
    ).join('');
    scoringWrap.style.display = 'block';
  } else {
    scoringWrap.style.display = 'none';
  }
  refreshScheduleLogicAvailability();
}

// ═══════════════════════════════════════════════════════════════
// ROSTER & PLAYER MANAGEMENT — Tournament Title
//  Editable from Admin at any time (setup screen pre-start, running
//  screen once started); header shows a read-only mirror. Two
//  physical inputs share one T.title, kept in sync here.
// ═══════════════════════════════════════════════════════════════
function titleChanged(value) {
  T.title = value;
  updateTitleDisplay();
  markDirty();
  saveState();
}

function updateTitleDisplay() {
  var hdr = document.getElementById('hdr-title');
  if (hdr) {
    if (T.title) { hdr.textContent = T.title; hdr.classList.remove('placeholder'); }
    else { hdr.textContent = 'Unnamed Tournament — click to name'; hdr.classList.add('placeholder'); }
    hdr.title = T.title || '';
  }
  var setupInput = document.getElementById('cfg-title');
  var runningInput = document.getElementById('cfg-title-running');
  if (setupInput && document.activeElement !== setupInput) setupInput.value = T.title || '';
  if (runningInput && document.activeElement !== runningInput) runningInput.value = T.title || '';
}

function focusTitleInput() {
  switchTab('admin', document.querySelector('nav button[data-tab="admin"]'));
  var input = document.getElementById(T.started ? 'cfg-title-running' : 'cfg-title');
  if (input) input.focus();
}

// Parses "Name (userID)" — userID is optional, for disambiguation only, not
// a required identity. Used for both team-member segments and the
// individual-reserves textarea.
function parseMemberLine(s) {
  var m = s.trim().match(/^(.*?)(?:\s*\(([^)]*)\))?$/);
  var name = (m ? m[1] : s).trim();
  var userId = (m && m[2]) ? m[2].trim() : undefined;
  return userId ? { name, userId } : { name };
}

// Parses "TeamName, Player1, Player2" lines into team objects with a
// stable teamId (generated the same way T.tournamentId is — timestamp-based,
// with an index suffix so a whole batch parsed in the same millisecond still
// gets unique ids). members is always exactly `teamSize` long, padded with
// null for a line with fewer segments than expected (rather than force-
// blocking the whole roster load on one malformed line) — null is exactly
// what Manage Teams' "vacant slot" UI already expects for a member removed
// mid-tournament, so a short line at load time behaves the same way.
function parseTeamLines(raw, idPrefix, teamSize) {
  var lines = raw ? raw.split('\n').map(s => s.trim()).filter(Boolean) : [];
  return lines.map((line, idx) => {
    var parts = line.split(',').map(s => s.trim());
    var teamName = parts[0] || ('Unnamed Team ' + (idx + 1));
    var rawMembers = parts.slice(1).filter(Boolean).map(parseMemberLine);
    var members = [];
    for (var mi = 0; mi < teamSize; mi++) members.push(rawMembers[mi] || null);
    return { teamId: idPrefix + '_' + Date.now() + '_' + idx, teamName, members };
  });
}

// --- Roster & Player Management: initial roster load ---
// Branches on the selected format's teamSize: team formats parse roster/
// reserve lines as "TeamName, P1, P2" into team objects (see
// parseTeamLines) and additionally load the individual-reserves textarea;
// individual formats parse flat one-name-per-line exactly as before.
function loadRoster() {
  var raw = document.getElementById('cfg-roster').value.trim();
  var rawR = document.getElementById('cfg-reserves').value.trim();
  var format = GAME_FORMATS[document.getElementById('cfg-game-format').value];

  if (format.teamSize) {
    var parsedPlayers  = parseTeamLines(raw, 'team', format.teamSize);
    var parsedReserves = parseTeamLines(rawR, 'reserveteam', format.teamSize);
    // A team with NO real players at all (every slot vacant) is nonsensical
    // on its own terms, and is also exactly the shape that triggers Firebase's
    // null-array pruning (see marshalNullsForFirebase() in js/sync.js) —
    // refuse the whole load rather than silently accepting it. A partially-
    // filled team (some real members, some deliberately vacant — the
    // existing "fill later" flow) is untouched.
    var emptyTeams = parsedPlayers.concat(parsedReserves).filter(t => t.members.every(m => !m));
    if (emptyTeams.length) {
      alert('These team(s) have no players listed at all — add at least one "TeamName, Player1, ..." member, or remove the line:\n\n' + emptyTeams.map(t => t.teamName).join('\n'));
      return;
    }
    T.players  = parsedPlayers;
    T.reserves = parsedReserves;
    T.reserveIndividuals = document.getElementById('cfg-reserve-individuals').value.trim()
      .split('\n').map(s => s.trim()).filter(Boolean).map(parseMemberLine);
  } else {
    T.players  = raw  ? raw.split('\n').map(s => s.trim()).filter(Boolean) : [];
    T.reserves = rawR ? rawR.split('\n').map(s => s.trim()).filter(Boolean) : [];
    T.reserveIndividuals = [];
  }
  T.confirmedCount = T.players.length;
  updateRegCountDisplay();
  document.getElementById('roster-status').textContent =
    T.players.length + ' confirmed, ' + T.reserves.length + ' reserves' +
    (format.teamSize ? ', ' + T.reserveIndividuals.length + ' individual reserves' : '');
  document.getElementById('generate-error').style.display = 'none';
  updateGroupStagePreview(); // no-op unless Group Stage is the selected pooling phase
  saveState();
}

function updateRegCountDisplay() {
  var el = document.getElementById('cfg-n-display');
  if (!el) return;
  if (T.confirmedCount === null || T.confirmedCount === undefined) { el.textContent = '—'; return; }
  var reserveCount = T.reserves.length;
  el.innerHTML = T.confirmedCount + (reserveCount
    ? ` <span style="color:var(--muted)">(+ ${reserveCount} reserve${reserveCount === 1 ? '' : 's'})</span>`
    : '');
}

// ═══════════════════════════════════════════════════════════════
// ROOM DISTRIBUTION & PROGRESSION
//  distributeRooms handles any N. Rooms stay within roomSize.min–max
//  whenever that's mathematically possible for N; roomSize.max is treated
//  as a hard constraint here — but it's each FORMAT's own configured
//  ceiling (a competitive-design choice, e.g. FFA's preferred max of 8
//  players), NOT the game's actual technical per-room limit (10 players —
//  see HARD_ROOM_PLAYER_CAP and "Room cap correction" in HANDOFF.md for the
//  full story of that distinction, and validateRoomCap() below for the
//  genuine runtime check against the real number). So a handful of "gap"
//  values (e.g. 17 with FFA's 6–8) that can't hit roomSize's own min–max at
//  all fall back to a room below roomSize.min rather than one above
//  roomSize.max — a deliberate choice to stay inside the format's own
//  preferred range, not a technical necessity.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// ROUND RENDERING — Generate + Start
// ═══════════════════════════════════════════════════════════════
function generateSchedule() {
  if (hasUnsavedChanges()) {
    confirmUnsavedChanges('generating a new schedule', 'start new', proceedGenerateSchedule, teardownRunningTournament);
    return;
  }
  proceedGenerateSchedule();
}

function proceedGenerateSchedule() {
  var errEl = document.getElementById('generate-error');
  if (T.confirmedCount === null || T.confirmedCount === undefined) {
    errEl.textContent = 'Load a roster first — click "Load roster & reserves" before generating a schedule.';
    errEl.style.display = 'block';
    return;
  }
  // Floor check runs before gamemodeConfig exists for this generation, so it
  // derives the same numbers directly from the currently-selected format's
  // own idea of its room size, and builds its message from that format's
  // unitLabelPlural rather than hardcoding "players" — FFA's defaults
  // reproduce the original literal message exactly. A format with a static
  // defaultRoomSize (FFA, 2v2v2v2) uses its .ideal directly; a format that
  // instead declares idealRoomSize (e.g. team-3v3, whose actual roomSize
  // depends on the odd-count strategy picked — see deriveRoomSize()) uses
  // that instead — the two are equivalent for this purpose, since
  // deriveRoomSize()'s roomSize.ideal is always exactly idealRoomSize
  // regardless of which of None/Bye/Flex ends up chosen.
  //
  // The minimum itself comes from the *active bracket phase*
  // (BRACKET_PHASE_MIN_UNITS) rather than always assuming single-
  // elimination's semisSize (2 * ideal) universally applies — semisSize
  // genuinely means nothing for double-elimination (no Semis round concept
  // at all).
  var selectedFormat = GAME_FORMATS[document.getElementById('cfg-game-format').value];
  var selectedScheduleLogic = document.getElementById('cfg-schedule-logic').value;
  var floorRoomIdeal = selectedFormat.defaultRoomSize ? selectedFormat.defaultRoomSize.ideal : selectedFormat.idealRoomSize;
  var floorMinUnits = BRACKET_PHASE_MIN_UNITS[selectedScheduleLogic]({ ideal: floorRoomIdeal });
  var unitPl = selectedFormat.unitLabelPlural.toLowerCase();
  if (T.confirmedCount < floorMinUnits) {
    var floorReason = selectedScheduleLogic === 'single-elimination'
      ? ' (Semis is fixed at ' + floorMinUnits + ' ' + unitPl + ' in 2 rooms of ' + floorRoomIdeal + ')'
      : '';
    errEl.textContent = 'This format needs at least ' + floorMinUnits + ' confirmed ' + unitPl +
      floorReason + '. Confirmed: ' + T.confirmedCount + '.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  var cfg = {
    n: T.confirmedCount,
    poolingPhase: document.getElementById('cfg-pooling-phase').value,
    qualAdv: parseInt(document.getElementById('cfg-qual-adv').value) || 24,
    groupSize: parseInt(document.getElementById('cfg-group-size').value) || IDEAL_GROUP_SIZE,
    roundRobinMode: document.getElementById('cfg-round-robin-mode').value,
    qualifiersPerGroup: parseInt(document.getElementById('cfg-qualifiers-per-group').value) || 2,
    scoring: document.getElementById('cfg-scoring').value,
    finalsGames: parseInt(document.getElementById('cfg-finals-games').value) || 3,
    // Default 1 (Single game), NOT finalsGames' own default of 3 — this is
    // a new opt-in capability, and 1 reproduces today's exact behaviour for
    // anyone who never touches the field (2026-09-08, "Multi-game Semis" in
    // HANDOFF_LOG.md).
    semisGames: parseInt(document.getElementById('cfg-semis-games').value) || 1
  };
  // Group stage's own two explicit requirements (Part 1 of "Group stage" in
  // HANDOFF.md): a group below 3 can't round-robin meaningfully, and a
  // group can't be asked to qualify more finishers than it actually
  // contains. Checked here, generation-time, in addition to the live
  // preview's own inline validation (the organiser could in principle type
  // past the preview and hit Generate directly, so this can't be the only
  // guard).
  if (cfg.poolingPhase === 'group-stage') {
    if (cfg.groupSize < GROUP_SIZE_BOUNDS.min) {
      errEl.textContent = 'Group size must be at least ' + GROUP_SIZE_BOUNDS.min + ' — round-robin below that is degenerate. Got ' + cfg.groupSize + '.';
      errEl.style.display = 'block';
      return;
    }
    if (cfg.groupSize <= cfg.qualifiersPerGroup) {
      errEl.textContent = 'Group size (' + cfg.groupSize + ') must be greater than qualifiers per group (' + cfg.qualifiersPerGroup + ') — a group can\'t qualify more finishers than it contains.';
      errEl.style.display = 'block';
      return;
    }
  }
  // qualAdv can't exceed the actual field, and must leave room to reach
  // whatever the active bracket phase's own minimum is — genuinely fixed
  // here (previously a hardcoded 16, FFA's own floor applied to every
  // format regardless; noted as a real bug found in passing during the
  // phase-composability refactor, deliberately left unfixed there as out of
  // scope — see "True single-elimination bracket phase" in HANDOFF.md).
  // Reuses the exact same floorMinUnits computed above, so FFA's own
  // behaviour (floorMinUnits === 16 either way) is unchanged. Applies
  // equally to Qualification Table and Swiss — both cut the pooled field to
  // cfg.qualAdv the same way (see "Swiss pooling phase" in HANDOFF.md).
  if (cfg.poolingPhase !== 'none') cfg.qualAdv = Math.min(Math.max(cfg.qualAdv, floorMinUnits), cfg.n);

  // "None" odd-count strategy: refuse to generate rather than let the active
  // bracket phase eventually hand distributeRooms a genuinely un-splittable
  // remainder (a room of 1, or worse). The no-elim/qual warm-up phases never
  // change the count, so the count that actually feeds the bracket phase is
  // post-qual-cut (cfg.qualAdv) when qual mode is combined with this, else
  // the registered count itself (cfg.n).
  if (selectedFormat.supportedOddCountStrategies && document.getElementById('cfg-odd-count-strategy').value === 'none') {
    var ideal = selectedFormat.idealRoomSize;
    // The pooling phase's OWN rounds (if any) always play the full
    // registered field (cfg.n) — qualTablePoolingPhase/swissPoolingPhase
    // never halve or cut mid-phase, so "None" mode's requirement there is
    // just a clean multiple of idealRoomSize, independent of whatever the
    // bracket phase requires below (checked against cfg.qualAdv, not
    // cfg.n, once pooling is active). Missing this check let an odd cfg.n
    // (e.g. 37) through whenever pooling was active, silently generating a
    // pooling round with a room of 1 — a player with no opponent — since
    // distributeRoomsWithBye forces byeCount:0 under "None". Found during
    // Swiss verification (see "Swiss pooling phase" in HANDOFF.md); the
    // same gap already existed for qual-table pooling too, just never
    // exercised with an odd cfg.n before Swiss's own testing hit it.
    // Group stage is deliberately excluded from this specific check — its
    // own matches never read oddCountStrategy/roomSize at all (every match
    // is a circle-method pair, and the circle method's own phantom-position
    // bye handles any group size, odd or even, intrinsically), so it can
    // always pair cfg.n cleanly regardless of what "None" would otherwise
    // require for a room-based pooling round.
    if (cfg.poolingPhase !== 'none' && cfg.poolingPhase !== 'group-stage' && cfg.n % ideal !== 0) {
      var otherStrategiesPooling = selectedFormat.supportedOddCountStrategies.filter(s => s !== 'none')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('/');
      errEl.textContent = 'With "None" selected as the odd-count strategy, the confirmed ' + unitPl +
        ' must be an exact multiple of ' + ideal + ' (this format\'s room size) so the pooling phase itself can pair everyone cleanly — got ' + cfg.n + '.' +
        (otherStrategiesPooling ? ' Adjust the count, or pick ' + otherStrategiesPooling + ' instead.' : ' Adjust the count.');
      errEl.style.display = 'block';
      return;
    }
    // Group stage's own seedTotal is groups x qualifiersPerGroup, not
    // cfg.qualAdv (that field doesn't even apply to this pooling phase —
    // see the UI's field-swap in togglePoolingPhaseField()) — computed the
    // same way groupStagePoolingPhase() itself will compute it, so this
    // check validates the actual number that will feed the bracket phase.
    var elimEntryCount = cfg.poolingPhase === 'group-stage'
      ? distributeRooms(cfg.n, { min: GROUP_SIZE_BOUNDS.min, max: GROUP_SIZE_BOUNDS.max, ideal: cfg.groupSize }).length * cfg.qualifiersPerGroup
      : (cfg.poolingPhase !== 'none' ? cfg.qualAdv : cfg.n);
    var isMultiple = elimEntryCount % ideal === 0;
    // single-elimination only needs a clean multiple of idealRoomSize — its
    // own computeTargets/snapFriendly machinery keeps every LATER round's
    // target a clean multiple too, once the first one is (verified during
    // team-3v3's own build). double-elimination's winners bracket has no
    // such snapping/clamping protecting it — its halving-every-round shape
    // means an even-but-not-power-of-2 count (e.g. 20) would pass a bare
    // multiple-of-2 check today but still hit exactly the "room of 1"
    // problem a couple of rounds later (20 -> 10 -> 5, and 5 is odd). None
    // mode has zero tolerance for that ever happening, so double-
    // elimination's real requirement here is strictly stronger: an exact
    // power of 2, not merely an even count. (This used to also apply to the
    // old, narrower "Single elimination" mechanism — retired in the
    // 2026-09-08 rename; today's single-elimination is the old "Classic
    // elimination" mechanism, which never needed this.)
    var isPowerOf2 = elimEntryCount > 0 && (elimEntryCount & (elimEntryCount - 1)) === 0;
    var needsPowerOf2 = selectedScheduleLogic === 'double-elimination';
    var noneModeValid = needsPowerOf2 ? (isMultiple && isPowerOf2) : isMultiple;
    if (!noneModeValid) {
      var otherStrategies = selectedFormat.supportedOddCountStrategies.filter(s => s !== 'none')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('/');
      var requirement = needsPowerOf2
        ? 'must be an exact power of 2 (double elimination halves the field every round)'
        : 'must be an exact multiple of ' + ideal + ' (this format\'s room size)';
      errEl.textContent = 'With "None" selected as the odd-count strategy, the ' +
        (cfg.poolingPhase !== 'none' ? 'number advancing to the bracket' : 'confirmed ' + unitPl) +
        ' ' + requirement + ' — got ' + elimEntryCount + '.' +
        (otherStrategies ? ' Adjust the count, or pick ' + otherStrategies + ' instead.' : ' Adjust the count.');
      errEl.style.display = 'block';
      return;
    }
  }

  // Semis/Final headcount override — Semis is only meaningful for single-
  // elimination (the only bracket phase with a "Semis" round concept at
  // all); Final is meaningful for single-elimination AND the shared-final
  // double-elimination generalization (both read gamemodeConfig.finalSize).
  // Unlike this function's other conditional fields (grand-final targets,
  // group-stage settings), these are deliberately read only when they
  // actually apply, not unconditionally — a stray leftover value sitting in
  // a hidden field from an earlier setup must never block generation for a
  // schedule logic that can't validate an override against anything.
  // A headcount only — distributeRooms() still figures out the actual room
  // shape within the format's normal bounds, same as every other round
  // already works. validateRoomCap() (below, after buildProgression()) is
  // what catches an oversized Final override (always exactly 1 room); the
  // two checks here catch the cases nothing else would — an override that's
  // internally inconsistent, or leaves nothing to eliminate down to.
  var semisOverride = null, finalOverride = null;
  if (selectedScheduleLogic === 'single-elimination') {
    semisOverride = parseInt(document.getElementById('cfg-semis-override').value) || null;
  }
  if (selectedScheduleLogic === 'single-elimination' || selectedScheduleLogic === 'double-elimination-shared-final') {
    finalOverride = parseInt(document.getElementById('cfg-final-override').value) || null;
  }
  var elimEntryCountForOverride = cfg.poolingPhase !== 'none' ? cfg.qualAdv : cfg.n;
  if (semisOverride && finalOverride && finalOverride > semisOverride) {
    errEl.textContent = 'Final size override (' + finalOverride + ') can\'t exceed the Semis size override (' + semisOverride + ') — there can\'t be more finalists than Semis participants.';
    errEl.style.display = 'block';
    return;
  }
  if (semisOverride && semisOverride > elimEntryCountForOverride) {
    errEl.textContent = 'Semis size override (' + semisOverride + ') can\'t exceed the ' +
      (cfg.poolingPhase !== 'none' ? 'number advancing to the bracket (' : 'confirmed count (') + elimEntryCountForOverride + ') — there\'d be nothing left to eliminate down to it.';
    errEl.style.display = 'block';
    return;
  }

  // LB qualifiers into the shared Final — only meaningful for the shared-
  // final double-elimination generalization. Validated here, before any T
  // mutation below, matching every other check in this function; the
  // un-overridden Final size isn't computed into T.gamemodeConfig until
  // further down, so it's recomputed locally via deriveRoomSize() (the same
  // function that computation will itself call) rather than waiting for it.
  var lbQualifiers = null;
  if (selectedScheduleLogic === 'double-elimination-shared-final') {
    var oddCountStrategyForValidation = selectedFormat.supportedOddCountStrategies && selectedFormat.supportedOddCountStrategies.length > 1
      ? document.getElementById('cfg-odd-count-strategy').value : undefined;
    var roomSizeForValidation = deriveRoomSize(selectedFormat, oddCountStrategyForValidation);
    var prospectiveFinalSize = finalOverride || roomSizeForValidation.ideal;
    lbQualifiers = parseInt(document.getElementById('cfg-lb-qualifiers').value) || 0;
    if (!(lbQualifiers >= 1) || !(lbQualifiers < prospectiveFinalSize)) {
      errEl.textContent = 'LB qualifiers into the Final (' + lbQualifiers + ') must be at least 1 and less than the Final size (' + prospectiveFinalSize + ').';
      errEl.style.display = 'block';
      return;
    }
  }

  T.cfg = cfg;
  // Set before buildProgression() runs, since its dispatcher reads these via
  // getGamemodeDescriptor(). gamemodeConfig is populated fresh from the
  // chosen format's defaults each generation, not carried over from a
  // previous tournament, so a stale room-size override can't leak forward.
  T.scheduleLogic = document.getElementById('cfg-schedule-logic').value;
  T.gameFormat = document.getElementById('cfg-game-format').value;
  var genFormat = GAME_FORMATS[T.gameFormat];
  T.gamemodeConfig = {
    qualRounds: QUAL_ROUNDS,
    swissRounds: computeSwissRoundCount(cfg.n),
    // Read from the "Team scoring" dropdown for a team format (see "Designated-
    // player team scoring rule" in HANDOFF_LOG.md); meaningless and left at
    // the default for an individual format, which never shows that field.
    teamScoringRule: genFormat.teamSize ? document.getElementById('cfg-team-scoring-rule').value : 'sum-members'
  };
  // Only set for a format that actually declared the dropdown (see
  // toggleFormatFields()) — a format that doesn't support odd-count
  // strategies (FFA, 2v2v2v2) never gets this field at all, same as
  // teamScoringRule is meaningless (and simply present but unread) for FFA.
  // Computed before roomSize below, since deriveRoomSize() for a format
  // without a static defaultRoomSize needs to know the chosen strategy.
  if (genFormat.supportedOddCountStrategies && genFormat.supportedOddCountStrategies.length > 1) {
    T.gamemodeConfig.oddCountStrategy = document.getElementById('cfg-odd-count-strategy').value;
  }
  T.gamemodeConfig.roomSize = deriveRoomSize(genFormat, T.gamemodeConfig.oddCountStrategy);
  // Stored as explicit fields (not recomputed inline wherever needed) so a
  // future manual-override feature can simply overwrite these two values
  // before generation, rather than restructuring where they come from.
  T.gamemodeConfig.semisSize = 2 * T.gamemodeConfig.roomSize.ideal;
  T.gamemodeConfig.finalSize = 1 * T.gamemodeConfig.roomSize.ideal;
  // Admin-facing override (see "Semis/Final headcount override" in
  // HANDOFF_LOG.md) — already validated above (internal consistency, and
  // that there's actually enough field to eliminate down to it);
  // validateRoomCap() further below catches an oversized Final override.
  if (semisOverride) T.gamemodeConfig.semisSize = semisOverride;
  if (finalOverride) T.gamemodeConfig.finalSize = finalOverride;
  // lbQualifiers is the only new tunable the shared-final generalization
  // needs beyond what every other bracket phase already reads — WB
  // qualifiers is derived inside doubleEliminationSharedFinalBracketPhase()
  // itself as finalSize - lbQualifiers (js/bracket-phases.js), not stored
  // separately here. Already validated above (>= 1 and < finalSize).
  if (selectedScheduleLogic === 'double-elimination-shared-final') T.gamemodeConfig.lbQualifiers = lbQualifiers;
  // Phase composability (see POOLING_PHASES/BRACKET_PHASES and "Phase
  // composability refactor" in HANDOFF.md) — poolingPhase is now a direct,
  // real organiser choice (the "Pooling phase" dropdown — None/Qualification
  // Table/Swiss, see "Swiss pooling phase" in HANDOFF.md) rather than a
  // binary checkbox standing in for one; bracketPhase is derived from the
  // "Schedule logic" dropdown (T.scheduleLogic itself, already set above) —
  // the two registries share key names 1:1 today ('single-elimination',
  // 'double-elimination'), so the schedule-logic choice directly determines
  // which bracket phase composedBuildProgression() runs. finalsGames is
  // copied in alongside them so a bracket phase can read it from
  // descriptor.config like every other tunable, rather than needing cfg
  // threaded into a function whose contract is (seedTotal, startRoundNum,
  // descriptor) only.
  T.gamemodeConfig.poolingPhase = cfg.poolingPhase;
  T.gamemodeConfig.bracketPhase = T.scheduleLogic;
  T.gamemodeConfig.finalsGames = cfg.finalsGames;
  T.gamemodeConfig.semisGames = cfg.semisGames;
  // Double-elimination's grand-final race targets (see "Grand-final race
  // format" in HANDOFF.md) — read regardless of whether double-elimination
  // is actually selected, same "harmless, unused otherwise" pattern as
  // groupSize/roundRobinMode/qualifiersPerGroup just below.
  T.gamemodeConfig.grandFinalWbTarget = parseInt(document.getElementById('cfg-grand-final-wb-target').value) || 2;
  T.gamemodeConfig.grandFinalLbTarget = parseInt(document.getElementById('cfg-grand-final-lb-target').value) || 3;
  // Group stage's own three tunables — read regardless of whether group
  // stage is actually selected (harmless, unused otherwise), same pattern
  // qualRounds/swissRounds already follow.
  T.gamemodeConfig.groupSize = cfg.groupSize;
  T.gamemodeConfig.roundRobinMode = cfg.roundRobinMode;
  T.gamemodeConfig.qualifiersPerGroup = cfg.qualifiersPerGroup;
  // Reset before buildProgression() runs so groupStagePoolingPhase() (called
  // from inside it, when group stage is the active pooling phase) can set
  // this fresh — a previous group-stage tournament's membership must never
  // leak into a new generation, group-stage or otherwise.
  T.groups = [];
  // Same "must never leak into a new generation" reasoning as T.groups just
  // above — a previous tournament's defender-change history (see "Defender
  // history" in HANDOFF.md) must never carry forward into a fresh one.
  T.defenderChanges = {};
  // Bracket's per-browser round-collapse state (js/render-viewer.js) is
  // keyed by round index — a fresh generation can have a different round
  // count/shape, so stale indices must not carry over.
  if (typeof bracketCollapseOverride !== 'undefined') bracketCollapseOverride = {};
  T.rounds = buildProgression(cfg);
  // Real runtime safety net (see validateRoomCap() / HARD_ROOM_PLAYER_CAP
  // above) — checked once, right after generation, against every room the
  // whole schedule would actually produce. Should never trigger for any
  // format registered today; if it ever does, refuse cleanly rather than
  // let a genuinely unplayable schedule reach the preview.
  var roomCapError = validateRoomCap(T.rounds, genFormat);
  if (roomCapError) {
    errEl.textContent = roomCapError;
    errEl.style.display = 'block';
    return;
  }
  T.scores = {}; T.finalScores = {};
  T.qualTable = rosterKeys(T.players).map(key => ({ name: key, totalFP:null, totalScore:0, played:0 }));
  // Same "not yet played" row per member, per group — matches T.qualTable's
  // own initialization above so a group-stage round's standings table shows
  // real (if empty) rows immediately, before any score exists, rather than
  // an empty table until the first updateGroupStandings() call. T.groups
  // itself is reset earlier, before buildProgression() runs, so
  // groupStagePoolingPhase() can set it fresh without this line immediately
  // wiping it back out again.
  T.groupStandings = {};
  T.groups.forEach(g => {
    T.groupStandings[g.label] = g.members.map(key => ({ name: key, totalFP:null, totalScore:0, played:0 }));
  });
  T.assignments = [];
  T.tieResolutions = {};
  T.luckyLosers = T.rounds.map(() => []);
  T.byes = T.rounds.map(() => []);
  // Reset whenever a new pooling phase begins (i.e. every generation) — see
  // "Fair bye rotation during pooling phases" in HANDOFF.md. Deliberately
  // NOT populated for group stage's own round-robin bye (Part 3 there
  // confirmed that mechanism is already fair as an inherent property of the
  // circle method, so nothing reads this for group-stage selection — see
  // T.assignments[0] below).
  T.poolingByeCounts = {};
  T.pendingBracketSeeds = {};
  T.reserveOpen = true;
  T.needsSave = false;
  T.autoSaved = false;
  T.tournamentId = String(Date.now());
  // Fresh shareable link for this specific generation — see js/sync.js.
  // Writability itself no longer comes from a per-tournament key; any
  // browser that has unlocked Admin (proven the shared secret) can push to
  // any tournament, this one included — see "Admin access" in HANDOFF.md.
  if (typeof updateSyncUrlBar === 'function') updateSyncUrlBar();
  if (typeof startWriterListener === 'function') startWriterListener();
  // "Bye" odd-count strategy, Round 1 only: every later round's bye (if any)
  // is handled live in advanceRound(), but Round 1 has no prior round to
  // compute a live advancing pool from — it's seeded directly from the
  // roster here. "Highest-seeded" has no real meaning for a round that
  // hasn't been played yet, so the first unit in registration order is the
  // deterministic stand-in (same spirit as randomSeed() itself receiving the
  // roster in that order before shuffling).
  // Group stage: Round 1's pairing (like every group-stage round) was
  // already fully determined at generation time — a seeded group
  // assignment, not a random draw — so it's read directly off T.rounds[0]
  // rather than going through randomSeed() at all. This is the one place
  // group stage's "no live dependency" property actually changes the
  // existing generation-time-seeding code path, not just adds a new
  // pooling-phase registry entry.
  var initialPool = rosterKeys(T.players);
  if (T.gamemodeConfig.poolingPhase === 'group-stage') {
    T.assignments[0] = seedFromGroupStageRound(T.rounds[0]);
    T.byes[0] = T.rounds[0].groupByes.slice();
  } else if (T.gamemodeConfig.oddCountStrategy === 'bye' && initialPool.length % T.gamemodeConfig.roomSize.ideal !== 0) {
    var round1Bye = initialPool[0];
    T.byes[0] = [round1Bye];
    T.poolingByeCounts[round1Bye] = 1;
    T.assignments[0] = randomSeed(initialPool.slice(1), T.rounds[0].rooms);
    T.assignments[0].push({ name: round1Bye, room: null, isLucky: false });
  } else {
    T.assignments[0] = randomSeed(initialPool, T.rounds[0].rooms);
  }
  renderPreview();
  document.getElementById('preview-wrap').style.display = 'block';
  document.getElementById('preview-wrap').scrollIntoView({ behavior:'smooth', block:'nearest' });
  saveState();
}

function startTournament() {
  document.getElementById('panel-setup').style.display = 'none';
  document.getElementById('panel-running').style.display = 'block';
  T.curRound = 0;
  T.started = true;
  renderAdminRound();
  if (typeof renderSyncStatusPanel === 'function') renderSyncStatusPanel();
  saveState();
}

// Adds one individual player (or reserve, or a walk-up not pre-listed) into
// the smallest available room. Room-cap check reads the active format's
// roomSize.max rather than a hardcoded 8, so a team-format's smaller
// per-room team-unit cap (e.g. 4) warns at the right threshold too.
function addReserve(name) {
  if (!T.reserveOpen) { alert('Reserve window has closed — eliminations have begun.'); return; }
  // Group stage's groups/round-robin schedule is fixed membership set once at
  // generation, not a headcount-derived rooms array like every other pooling
  // phase — recomputeFutureRounds() below has no sound way to fold a new unit
  // into it. See "Fix: future-round structure goes stale when reserves join
  // mid-tournament" in HANDOFF_LOG.md.
  if (T.cfg.poolingPhase === 'group-stage') { alert('Reserves can\'t be added during Group Stage — group membership and the round-robin schedule are fixed once the tournament starts. Wait until the bracket phase begins.'); return; }
  var slot = smallestRoomInCurrentRound();
  var descriptor = getGamemodeDescriptor();
  var roomMax = descriptor.config.roomSize.max;
  if (slot.count >= roomMax) {
    // "None" odd-count strategy has zero tolerance for an over-cap room —
    // same precedent as addTeamReserve()'s own fix (see "Small flagged-gap
    // fixes" in HANDOFF_LOG.md). FFA has no oddCountStrategy concept at all
    // (descriptor.config.oddCountStrategy is undefined for it), so this
    // branch can only ever fire for individual-1v1 — FFA's confirm-and-
    // proceed behavior below is untouched by construction.
    if (descriptor.config.oddCountStrategy === 'none') {
      alert('Can\'t add this reserve — with "None" selected as the odd-count strategy, every room must stay at exactly ' + roomMax + ' ' + descriptor.format.unitLabelPlural.toLowerCase() + '. Adding this reserve would create a ' + (roomMax + 1) + '-' + descriptor.format.unitLabel.toLowerCase() + ' room. Consider a different odd-count strategy, or wait until a room has an open slot.');
      return;
    }
    if (!confirm('All rooms have ' + roomMax + ' ' + descriptor.format.unitLabelPlural.toLowerCase() +
      '. Adding this reserve will create a ' + (roomMax + 1) + '-' + descriptor.format.unitLabel.toLowerCase() + ' room. Proceed?')) return;
  }
  T.assignments[T.curRound].push({ name, room: slot.rm, isLucky: false });
  T.players.push(name);
  T.reserves = T.reserves.filter(r => r !== name);
  // Re-derive every not-yet-reached round's structure from the new live
  // headcount — see recomputeFutureRounds() in advancement.js. Refuses (rolls
  // back) rather than proceed if the new total would break the game's hard
  // room cap.
  if (!recomputeFutureRounds()) {
    T.assignments[T.curRound].pop();
    T.players.pop();
    T.reserves.push(name);
    alert('Can\'t add this reserve — it would push a future round over the game\'s hard room cap. Try a different Semis/Final override, or don\'t add this reserve.');
    return;
  }
  renderAdminRound();
  markDirty();
  saveState();
}

function removeReserve(name) {
  T.reserves = T.reserves.filter(r => r !== name);
  renderAdminRound();
  markDirty();
  saveState();
}

// Team-format equivalent of addReserve(): a whole reserve TEAM joins the
// smallest available room as a unit, same gating/placement rule, just
// working in team-units (a room's roomSize.max is already team-units for a
// team format). This is genuinely a different mechanic from an individual
// substitute (see fillVacantSlot()) — the team isn't replacing a missing
// member of an existing team, it's a brand-new team taking a room slot.
function addTeamReserve(teamId) {
  if (!T.reserveOpen) { alert('Reserve window has closed — eliminations have begun.'); return; }
  // See the matching guard in addReserve() above — group stage's groups/
  // round-robin schedule is fixed membership, not something a new team can
  // be folded into live.
  if (T.cfg.poolingPhase === 'group-stage') { alert('Reserves can\'t be added during Group Stage — group membership and the round-robin schedule are fixed once the tournament starts. Wait until the bracket phase begins.'); return; }
  var team = T.reserves.find(t => t.teamId === teamId);
  if (!team) return;
  var slot = smallestRoomInCurrentRound();
  var descriptor = getGamemodeDescriptor();
  var roomMax = descriptor.config.roomSize.max;
  if (slot.count >= roomMax) {
    // "None" odd-count strategy has zero tolerance for an over-cap room, same
    // philosophy as removeTeam()'s live-count guard below — refuse outright
    // rather than let the organiser click through into an invalid shape.
    // Every other case (Bye, Flex, or a format with no odd-count strategy at
    // all) keeps the original proceed-anyway confirm.
    if (descriptor.config.oddCountStrategy === 'none') {
      alert('Can\'t add this reserve — with "None" selected as the odd-count strategy, every room must stay at exactly ' + roomMax + ' teams. Adding "' + team.teamName + '" would create a ' + (roomMax + 1) + '-team room. Consider a different odd-count strategy, or wait until a room has an open slot.');
      return;
    }
    if (!confirm('All rooms have ' + roomMax + ' teams. Adding this reserve will create a ' + (roomMax + 1) + '-team room. Proceed?')) return;
  }
  T.assignments[T.curRound].push({ name: teamId, room: slot.rm, isLucky: false });
  T.players.push(team);
  T.reserves = T.reserves.filter(t => t.teamId !== teamId);
  if (!recomputeFutureRounds()) {
    T.assignments[T.curRound].pop();
    T.players.pop();
    T.reserves.push(team);
    alert('Can\'t add this reserve — it would push a future round over the game\'s hard room cap. Try a different Semis/Final override, or don\'t add this reserve.');
    return;
  }
  renderAdminRound();
  markDirty();
  saveState();
}

function removeTeamReserve(teamId) {
  T.reserves = T.reserves.filter(t => t.teamId !== teamId);
  renderAdminRound();
  markDirty();
  saveState();
}

function addNewPlayer() {
  var input = document.getElementById('new-player-name');
  var name = (input.value || '').trim();
  if (!name) return;
  if (T.players.includes(name) || T.reserves.includes(name)) {
    alert('"' + name + '" is already in the tournament.');
    return;
  }
  input.value = '';
  addReserve(name);
}

// ═══════════════════════════════════════════════════════════════
// ROSTER & PLAYER MANAGEMENT — Manage Players (rename/remove, mid-tournament)
// ═══════════════════════════════════════════════════════════════
// Dispatcher — team formats get the Manage Teams panel below instead.
function renderManagePlayers() {
  if (getGamemodeDescriptor().format.teamSize) { renderManageTeams(); return; }
  var wrap = document.getElementById('admin-manage-players');
  if (!wrap) return;
  var ri = T.curRound;
  var activeNames = new Set((T.assignments[ri] || []).map(a => a.name));

  if (!T.players.length) { wrap.innerHTML = ''; return; }

  var html = '<div class="card"><div class="card-title">Manage Players ' +
    '<span style="color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">' +
    '— rename to fix a spelling mistake, or remove a player entirely</span></div><div class="seed-grid">';
  T.players.slice().sort((a, b) => a.localeCompare(b)).forEach(name => {
    html += managePlayerRow(name, activeNames.has(name) ? 'Currently in the round' : 'Not in the current round');
  });
  html += '</div></div>';
  wrap.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// ROSTER & PLAYER MANAGEMENT — Manage Teams (team formats' equivalent of
//  Manage Players). Each team is a block: team name (✎/✕ for the whole
//  team) plus its member slots, each with its own ✎/✕ — removing a member
//  opens a vacant slot, fillable either from T.reserveIndividuals or a
//  typed walk-up name, gated by the same reserve window as everything else.
//  Removing an entire team frees its room slot for a team reserve to fill
//  via addTeamReserve(), mirroring FFA's individual remove/re-pack pattern.
// ═══════════════════════════════════════════════════════════════
function renderManageTeams() {
  var wrap = document.getElementById('admin-manage-players');
  if (!wrap) return;
  if (!T.players.length) { wrap.innerHTML = ''; return; }
  var teamSize = getGamemodeDescriptor().format.teamSize;
  var isDefenderRule = getGamemodeDescriptor().config.teamScoringRule === 'designated-player';

  var html = '<div class="card"><div class="card-title">Manage Teams ' +
    '<span style="color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">' +
    '— rename or remove a team, or manage its individual members</span></div><div class="seed-grid">';
  T.players.slice().sort((a, b) => a.teamName.localeCompare(b.teamName)).forEach(team => {
    html += `<div class="seed-card" style="flex-direction:column;align-items:stretch;gap:6px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="seed-player" style="font-weight:600">${esc(team.teamName)}</span>
        <span>
          <button class="btn btn-secondary btn-sm" onclick="promptRenameTeam('${escAttr(team.teamId)}')" title="Rename team">✎</button>
          <button class="btn btn-secondary btn-sm" onclick="swapTeam('${escAttr(team.teamId)}')" title="Swap team — replace with a reserve or walk-up team, in this exact room slot">⇄</button>
          <button class="btn btn-secondary btn-sm" onclick="removeTeam('${escAttr(team.teamId)}')" title="Remove team">✕</button>
        </span>
      </div>`;
    var defenderIdx = isDefenderRule ? getDefenderIndex(T, team.teamId, T.curRound) : -1;
    var members = team.members || []; // never let one malformed team blank the whole Admin panel below it
    for (var mi = 0; mi < teamSize; mi++) {
      var member = members[mi];
      if (member) {
        var isDefender = mi === defenderIdx;
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding-left:10px">
          <span style="font-size:12px">${esc(member.name)}${member.userId ? ' <span style="color:var(--muted)">(' + esc(member.userId) + ')</span>' : ''}${isDefender ? ' <span style="color:var(--amber)" title="The defender — this member\'s score is the team\'s score">🛡 Defender</span>' : ''}</span>
          <span>
            ${isDefenderRule && !isDefender ? `<button class="btn btn-secondary btn-sm" onclick="setDefender('${escAttr(team.teamId)}',${mi})" title="Make defender">🛡</button>` : ''}
            <button class="btn btn-secondary btn-sm" onclick="promptRenameMember('${escAttr(team.teamId)}',${mi})" title="Rename">✎</button>
            <button class="btn btn-secondary btn-sm" onclick="removeMember('${escAttr(team.teamId)}',${mi})" title="Remove">✕</button>
          </span>
        </div>`;
      } else {
        // Stacked (not a single row) — a seed-card is only ~200px wide, too
        // narrow to fit a label + dropdown + button on one line without
        // overflowing into the next grid column.
        html += `<div style="padding-left:10px">
          <div style="font-size:11px;color:var(--muted);font-style:italic;margin-bottom:4px">Vacant slot</div>`;
        if (T.reserveOpen) {
          html += `<div style="display:flex;gap:6px;flex-wrap:wrap">`;
          if (T.reserveIndividuals.length) {
            html += `<select style="width:auto;max-width:100%;font-size:11px;padding:3px 6px" onchange="fillVacantSlotFromReserve('${escAttr(team.teamId)}',${mi},this.value)">
              <option value="">— pick a reserve —</option>
              ${T.reserveIndividuals.map((r, idx) => `<option value="${idx}">${esc(r.name)}</option>`).join('')}
            </select>`;
          }
          html += `<button class="btn btn-amber btn-sm" style="white-space:nowrap" onclick="fillVacantSlotWalkup('${escAttr(team.teamId)}',${mi})">＋ New</button></div>`;
        }
        html += `</div>`;
      }
    }
    html += '</div>';
  });
  html += '</div></div>';
  wrap.innerHTML = html;
}

function promptRenameTeam(teamId) {
  var team = T.players.find(t => t.teamId === teamId);
  if (!team) return;
  var newName = prompt('Rename team "' + team.teamName + '" to:', team.teamName);
  if (newName === null) return;
  newName = newName.trim();
  if (!newName || newName === team.teamName) return;
  team.teamName = newName; // teamId is the stable identity everywhere else — no propagation needed
  renderAdminRound();
  markDirty();
  saveState();
}

function promptRenameMember(teamId, mi) {
  var team = T.players.find(t => t.teamId === teamId);
  var member = team && team.members[mi];
  if (!member) return;
  var newName = prompt('Rename "' + member.name + '" to:', member.name);
  if (newName === null) return;
  newName = newName.trim();
  if (!newName) return;
  member.name = newName; // display-only — no identity remapping needed (scores are keyed by team position, not member name)
  renderAdminRound();
  markDirty();
  saveState();
}

// Opens a vacant slot — score/round history for that position is untouched
// (past rounds' member scores stay under whoever played them), same rule
// FFA's removePlayer() already establishes.
function removeMember(teamId, mi) {
  var team = T.players.find(t => t.teamId === teamId);
  var member = team && team.members[mi];
  if (!member) return;
  if (!confirm('Remove "' + member.name + '" from team "' + team.teamName + '"? This cannot be undone.')) return;
  team.members[mi] = null;
  renderAdminRound();
  markDirty();
  saveState();
}

// 'designated-player' team scoring rule only — makes member `mi` the
// defender for `teamId`, starting THIS round. Appends-or-updates
// (never duplicates) a single {round, memberIdx} entry in
// T.defenderChanges[teamId] for T.curRound specifically — a past round's
// own already-recorded entry is never touched, which is what keeps that
// round's score fixed even after a later change (see getDefenderIndex() in
// js/formats-and-primitives.js and "Defender history" in HANDOFF.md). Not
// gated by the reserve window, same reasoning removePlayer()/rename already
// use — this manages the roster, it doesn't confer a competitive advantage.
function setDefender(teamId, mi) {
  var team = T.players.find(t => t.teamId === teamId);
  if (!team || !team.members[mi]) return; // can't designate a vacant slot
  T.defenderChanges = T.defenderChanges || {};
  var changes = T.defenderChanges[teamId] = T.defenderChanges[teamId] || [];
  var existingForRound = changes.find(c => c.round === T.curRound);
  if (existingForRound) existingForRound.memberIdx = mi;
  else changes.push({ round: T.curRound, memberIdx: mi });
  renderAdminRound();
  markDirty();
  saveState();
}

function fillVacantSlotFromReserve(teamId, mi, idxStr) {
  if (idxStr === '') return;
  if (!T.reserveOpen) { alert('Reserve window has closed — eliminations have begun.'); return; }
  var idx = parseInt(idxStr);
  var reserve = T.reserveIndividuals[idx];
  if (!reserve) return;
  var team = T.players.find(t => t.teamId === teamId);
  if (!team || team.members[mi]) return; // slot must actually be vacant — never clobber an occupied one
  team.members[mi] = reserve;
  T.reserveIndividuals.splice(idx, 1);
  renderAdminRound();
  markDirty();
  saveState();
}

function fillVacantSlotWalkup(teamId, mi) {
  if (!T.reserveOpen) { alert('Reserve window has closed — eliminations have begun.'); return; }
  var name = prompt('Name of the new/walk-up player filling this slot:');
  if (name === null) return;
  name = name.trim();
  if (!name) return;
  var team = T.players.find(t => t.teamId === teamId);
  if (!team || team.members[mi]) return; // slot must actually be vacant — never clobber an occupied one
  team.members[mi] = { name };
  renderAdminRound();
  markDirty();
  saveState();
}

// Whole-team removal — parallels FFA's removePlayer() re-packing, but shifts
// every member-suffixed score key (r{ri}-rm{rm}-p{k}-m{mi}) for each
// position after the removed team, since a team's score storage has one
// extra index level (member) that an individual player's doesn't.
function removeTeam(teamId) {
  var team = T.players.find(t => t.teamId === teamId);
  if (!team) return;

  // "None" odd-count strategy has zero tolerance for an uneven room, at any
  // point — generation-time validation above only checks the count at
  // generation; a mid-tournament withdrawal can reintroduce exactly the
  // problem that check exists to prevent. Deliberately a blanket "the live
  // count this round must stay a multiple of idealRoomSize" rule, checked
  // for ANY round (elimination or not) rather than trying to predict whether
  // this specific round's advPerRoom/lucky-loser cushion would happen to
  // absorb the oddness — that depends on scores that may not be final yet,
  // and "None" mode's whole philosophy is to refuse rather than guess (same
  // reasoning as the generation-time check). A team no longer live this
  // round (already eliminated earlier) is exempt — removing their roster
  // record doesn't touch any future room's distribution.
  var descriptor = getGamemodeDescriptor();
  if (descriptor.config.oddCountStrategy === 'none') {
    var liveAsgn = T.assignments[T.curRound] || [];
    if (liveAsgn.some(a => a.name === teamId)) {
      var ideal = descriptor.format.idealRoomSize;
      var remaining = liveAsgn.length - 1;
      if (remaining % ideal !== 0) {
        alert('Can\'t remove "' + team.teamName + '" — with "None" selected as the odd-count strategy, every room must always have exactly ' + ideal + ' teams. Removing this team would leave ' + remaining + ' teams live this round, which can\'t split evenly into rooms of ' + ideal + '. Add a reserve or walk-up team first (if the reserve window is still open), or reconsider the removal.');
        return;
      }
    }
  }

  if (!confirm('Remove team "' + team.teamName + '" from the tournament? This cannot be undone.')) return;
  var teamSize = getGamemodeDescriptor().format.teamSize;

  if (T.rounds.length) {
    var ri = T.curRound;
    var asgn = T.assignments[ri] || [];
    var roomOfTeam = asgn.find(a => a.name === teamId);
    if (roomOfTeam) {
      var room = roomOfTeam.room;
      var roomTeams = asgn.filter(a => a.room === room);
      var pi = roomTeams.findIndex(a => a.name === teamId);
      // scoreKeysForPosition() (js/formats-and-primitives.js) covers every
      // game of a multi-game Semis round, not just one key per member — a
      // plain single-key shift here would silently strand games 2+'s scores
      // under the old position once this round can be multi-game (2026-09-08,
      // "Multi-game Semis" in HANDOFF_LOG.md).
      var round = T.rounds[ri];
      for (var k = pi + 1; k < roomTeams.length; k++) {
        var fromKeys = scoreKeysForPosition(ri, room, k, round, teamSize);
        var toKeys = scoreKeysForPosition(ri, room, k - 1, round, teamSize);
        for (var ki = 0; ki < fromKeys.length; ki++) {
          if (T.scores[fromKeys[ki]] !== undefined) T.scores[toKeys[ki]] = T.scores[fromKeys[ki]];
          else delete T.scores[toKeys[ki]];
        }
      }
      scoreKeysForPosition(ri, room, roomTeams.length - 1, round, teamSize).forEach(k => delete T.scores[k]);
      T.assignments[ri] = asgn.filter(a => a.name !== teamId);
      invalidateStaleTieResolutions(ri, room);
    }
  }

  T.players = T.players.filter(t => t.teamId !== teamId);
  T.qualTable = T.qualTable.filter(p => p.name !== teamId);
  T.luckyLosers = T.luckyLosers.map(arr => arr ? arr.filter(n => n !== teamId) : arr);
  Object.keys(T.tieResolutions).forEach(k => {
    var list = tieResolutionList(T, k);
    if (list.indexOf(teamId) !== -1) T.tieResolutions[k] = list.filter(n => n !== teamId);
  });

  renderAdminRound();
  markDirty();
  saveState();
}

function managePlayerRow(name, statusLabel) {
  var safe = escAttr(name);
  return `<div class="seed-card" title="${esc(statusLabel)}">
    <span class="seed-player">${esc(name)}</span>
    <button class="btn btn-secondary btn-sm" onclick="promptRename('${safe}')" title="Rename">✎</button>
    <button class="btn btn-secondary btn-sm" onclick="swapPlayer('${safe}')" title="Swap — replace with a reserve or walk-up, in this exact room slot">⇄</button>
    <button class="btn btn-secondary btn-sm" onclick="removePlayer('${safe}')" title="Remove">✕</button>
  </div>`;
}

function promptRename(oldName) {
  var newName = prompt('Rename "' + oldName + '" to:', oldName);
  if (newName === null) return;
  renamePlayer(oldName, newName.trim());
}

function renamePlayer(oldName, newName) {
  if (!newName || newName === oldName) return;
  if (T.players.includes(newName) || T.reserves.includes(newName)) {
    alert('A player named "' + newName + '" already exists.');
    return;
  }
  var rename = n => n === oldName ? newName : n;
  T.players  = T.players.map(rename);
  T.reserves = T.reserves.map(rename);
  T.assignments.forEach(asgn => (asgn || []).forEach(p => { if (p.name === oldName) p.name = newName; }));
  T.qualTable.forEach(p => { if (p.name === oldName) p.name = newName; });
  T.luckyLosers = T.luckyLosers.map(arr => arr ? arr.map(rename) : arr);
  Object.keys(T.tieResolutions).forEach(k => {
    var list = tieResolutionList(T, k);
    if (list.indexOf(oldName) !== -1) T.tieResolutions[k] = list.map(n => n === oldName ? newName : n);
  });
  var remappedFinals = {};
  Object.keys(T.finalScores).forEach(key => {
    var m = key.match(/^(game\d+)-(.*)$/);
    remappedFinals[m && m[2] === oldName ? m[1] + '-' + newName : key] = T.finalScores[key];
  });
  T.finalScores = remappedFinals;
  renderAdminRound();
  markDirty();
  saveState();
}

// One-click swap — the true "same exact slot" operation removePlayer()+
// addReserve() together don't give you (see "One-click player swap" in
// HANDOFF_LOG.md): the replacement lands in EXACTLY the outgoing player's
// room+position, in place — unlike removePlayer(), nobody else's position
// re-packs, and unlike addReserve(), there's no smallest-room search. Scoped
// to individual formats only this pass; a team-format whole-team swap is a
// natural follow-up, not built here. Reuses the prompt() interaction
// pattern already established for renaming rather than a bespoke picker —
// the entered name can be an existing reserve (promoted, same as
// addReserve()) or a fresh walk-up name, indistinguishable to T.players
// either way.
//
// Deliberately NOT gated by T.reserveOpen, unlike addReserve() — this
// substitutes one already-live slot's occupant rather than adding a new
// competitor past the fairness cutoff the reserve window protects against,
// same reasoning removePlayer() itself already uses for being ungated. Only
// ever touches the CURRENT round's assignment; past rounds are untouched,
// same precedent as remove/rename.
function swapPlayer(oldName) {
  var ri = T.curRound;
  var asgn = T.assignments[ri] || [];
  var entryIdx = asgn.findIndex(a => a.name === oldName);
  if (entryIdx === -1) {
    alert('"' + oldName + '" is not in the current round — use Remove instead.');
    return;
  }

  var newName = prompt('Swap out "' + oldName + '". Enter the replacement\'s name (an existing reserve\'s name, or a new walk-up name):');
  if (newName === null) return; // cancelled
  newName = newName.trim();
  if (!newName) return;
  if (T.players.includes(newName)) { alert('"' + newName + '" is already an active player.'); return; }

  var room = asgn[entryIdx].room;
  var posInRoom = asgn.filter(a => a.room === room).findIndex(a => a.name === oldName);

  // Same slot, in place — the assignment entry is mutated, not removed and
  // re-added, so nobody else in the room shifts position.
  asgn[entryIdx].name = newName;
  // Reserves don't inherit scores from players they replace (see "Reserve
  // players" in HANDOFF.md) — the same rule applies to a swap: the outgoing
  // player's already-entered score at this position, if any, is cleared
  // rather than silently becoming the replacement's score. Every game of a
  // multi-game Semis round, not just game 1's key (2026-09-08, "Multi-game
  // Semis" in HANDOFF_LOG.md) — scoreKeysForPosition() (js/formats-and-
  // primitives.js) covers both.
  scoreKeysForPosition(ri, room, posInRoom, T.rounds[ri], 0).forEach(k => delete T.scores[k]);
  invalidateStaleTieResolutions(ri, room);

  T.players = T.players.filter(p => p !== oldName).concat([newName]);
  T.reserves = T.reserves.filter(r => r !== newName);

  // T.qualTable self-heals during the pooling/standings phase itself
  // (updateQualTable() rebuilds it from scratch off the live roster on every
  // score entry), so this is only ever load-bearing for a swap during the
  // BRACKET phase, once that rebuild has permanently stopped running —
  // otherwise the outgoing name's row lingers forever in the Qualification
  // Table/Swiss Standings display (which never turns back off once shown,
  // see isStandingsPhase in js/render-admin.js), same cleanup removePlayer()
  // already does.
  T.qualTable = T.qualTable.filter(p => p.name !== oldName);

  // T.byes[ri] is a SEPARATE array of raw names that advanceRound() reads
  // directly to auto-advance whoever had a bye this round (js/advancement.js)
  // — completely independent of T.assignments[ri]. Without this remap, a
  // swap on a unit whose room is null (a bye recipient) leaves the OLD name
  // sitting in T.byes[ri]: on the next Next Round click, the outgoing unit
  // ghost-advances (it's still what T.byes[ri] names) while the incoming
  // unit — sitting right there in the assignment — silently never advances.
  // Remap, don't clear: the slot genuinely IS on a bye this round, and
  // carrying the bye count forward keeps fair-bye-rotation (js/pooling-
  // phases.js) honest instead of handing the incoming unit an undeserved
  // "zero byes so far" advantage.
  if (T.byes[ri]) T.byes[ri] = T.byes[ri].map(n => n === oldName ? newName : n);
  if (T.poolingByeCounts[oldName] !== undefined) {
    T.poolingByeCounts[newName] = T.poolingByeCounts[oldName];
    delete T.poolingByeCounts[oldName];
  }

  renderAdminRound();
  markDirty();
  saveState();
}

// Team-format counterpart to swapPlayer() above — same same-slot semantics,
// generalized for the extra -m{mi} score-key dimension teams have. Modeled
// on swapPlayer(), NOT on removeTeam(): nothing re-packs, the assignment
// entry's .name is mutated in place. See "Whole-team swap" in
// HANDOFF_LOG.md for the full design reasoning — walk-up entry reuses
// parseTeamLines() rather than a per-member prompt loop; the name-collision
// guard below is a soft confirm() rather than swapPlayer()'s hard refuse,
// since promptRenameTeam() already permits duplicate team names with no
// check at all — a hard refuse here would be inconsistent with that
// established rule, not an improvement on it.
function swapTeam(oldTeamId) {
  var ri = T.curRound;
  var asgn = T.assignments[ri] || [];
  var entryIdx = asgn.findIndex(a => a.name === oldTeamId);
  var oldTeam = T.players.find(t => t.teamId === oldTeamId);
  if (!oldTeam) return;
  if (entryIdx === -1) {
    alert('"' + oldTeam.teamName + '" is not in the current round — use Remove instead.');
    return;
  }
  var teamSize = getGamemodeDescriptor().format.teamSize;

  var newTeam = null;
  if (T.reserves.length) {
    var menu = 'Swap out "' + oldTeam.teamName + '".\n\n  0 — type a brand-new walk-up team\n' +
      T.reserves.map((t, i) => '  ' + (i + 1) + ' — ' + t.teamName + ' (' + t.members.filter(Boolean).map(m => m.name).join(', ') + ')').join('\n') +
      '\n\nEnter a number:';
    var choice = prompt(menu);
    if (choice === null) return; // cancelled
    choice = choice.trim();
    if (!choice) return; // blank deliberately means abort, not "start walk-up" — 0 is the explicit opt-in
    if (!/^\d+$/.test(choice)) { alert('"' + choice + '" isn\'t one of the listed numbers.'); return; }
    var n = parseInt(choice, 10);
    if (n === 0) {
      newTeam = promptWalkupTeam(teamSize);
      if (!newTeam) return;
    } else if (n >= 1 && n <= T.reserves.length) {
      newTeam = T.reserves[n - 1];
    } else {
      alert('"' + choice + '" isn\'t one of the listed numbers.');
      return;
    }
  } else {
    newTeam = promptWalkupTeam(teamSize);
    if (!newTeam) return;
  }

  if (T.players.some(t => t.teamName === newTeam.teamName) &&
      !confirm('A team called "' + newTeam.teamName + '" is already competing. Two teams with the same name will be hard to tell apart on the Bracket and Scoreboard. Add it anyway?')) {
    return;
  }

  var room = asgn[entryIdx].room;
  var posInRoom = asgn.filter(a => a.room === room).findIndex(a => a.name === oldTeamId);

  // Same slot, in place — mirrors swapPlayer() exactly, not removeTeam()'s
  // repack-the-room behavior.
  asgn[entryIdx].name = newTeam.teamId;
  // Current round's scores at this position only — every member, every game
  // of a multi-game Semis round (2026-09-08, "Multi-game Semis" in
  // HANDOFF_LOG.md), same "cleared, never transferred" rule as swapPlayer()'s
  // own delete.
  scoreKeysForPosition(ri, room, posInRoom, T.rounds[ri], teamSize).forEach(k => delete T.scores[k]);
  invalidateStaleTieResolutions(ri, room);

  T.players = T.players.filter(t => t.teamId !== oldTeamId).concat([newTeam]);
  T.reserves = T.reserves.filter(t => t.teamId !== newTeam.teamId); // correct no-op on the walk-up path

  // Same T.qualTable staleness swapPlayer() fixes above, worse here for team
  // formats specifically: unitDisplay() falls back to showing the raw
  // teamId string once teamMap() can no longer find the removed team
  // (js/formats-and-primitives.js:214) — so a stale row here doesn't just
  // linger under an outdated but readable name, it renders as ugly
  // "team_1234567_0" text in the Qualification Table/Swiss Standings.
  T.qualTable = T.qualTable.filter(p => p.name !== oldTeamId);

  // Same T.byes[ri]/T.poolingByeCounts ghost-advancement bug swapPlayer()
  // had until this same build fixed it there too (see the comment on that
  // fix, above) — identical remap, teamId instead of a plain name.
  if (T.byes[ri]) T.byes[ri] = T.byes[ri].map(n => n === oldTeamId ? newTeam.teamId : n);
  if (T.poolingByeCounts[oldTeamId] !== undefined) {
    T.poolingByeCounts[newTeam.teamId] = T.poolingByeCounts[oldTeamId];
    delete T.poolingByeCounts[oldTeamId];
  }
  // Group-stage membership is a separate fixed key list. A same-slot swap
  // preserves the group's membership COUNT exactly — only the key changes —
  // so remapping (not refusing, unlike addTeamReserve()'s group-stage
  // refusal, which exists because an ADD changes headcount) is both
  // sufficient and correct here.
  (T.groups || []).forEach(g => { g.members = g.members.map(k => k === oldTeamId ? newTeam.teamId : k); });

  // T.defenderChanges[oldTeamId] is deliberately left untouched — the
  // incoming team's fresh teamId finds no entry, so getDefenderIndex()
  // naturally defaults to member 0, exactly mirroring how swapPlayer()
  // also lets an incoming individual start with no score history rather
  // than transferring any. Never resurfaces: teamIds are never recycled,
  // and T.defenderChanges is already wiped on both regenerate and reset.

  renderAdminRound();
  markDirty();
  saveState();
}

// Shared by swapTeam()'s walk-up path — one prompt() using the exact
// "TeamName, P1, P2" syntax already taught at setup (toggleFormatFields()),
// parsed via the same parseTeamLines() setup itself uses, rather than a
// per-member prompt loop: one cancel point instead of teamSize+1, and zero
// new parsing/ID-generation code to get wrong. A short line pads with null
// per parseTeamLines()'s own documented behavior — exactly what Manage
// Teams' vacant-slot UI already expects, so "leave a member blank" already
// has a well-defined, precedented meaning without any new rule here.
function promptWalkupTeam(teamSize) {
  var memberPlaceholders = [];
  for (var mi = 0; mi < teamSize; mi++) memberPlaceholders.push('Player' + (mi + 1));
  var memberHint = memberPlaceholders.join(', ');
  var line = prompt('Enter the replacement team, same format as the roster:\n\nTeamName, ' + memberHint, 'Team name, ' + memberHint);
  if (line === null) return null;
  line = line.trim();
  if (!line) return null;
  var parsed = parseTeamLines(line, 'team', teamSize)[0];
  if (!parsed) return null;
  // Same all-vacant refusal as loadRoster() — see the comment there and
  // "Fix: Firebase live-sync silently drops null array elements" in
  // HANDOFF_LOG.md.
  if (parsed.members.every(m => !m)) {
    alert('"' + parsed.teamName + '" has no players listed — add at least one member.');
    return null;
  }
  // Belt-and-braces uniqueness, walk-up path only — parseTeamLines()'s
  // Date.now()-based scheme makes a real collision practically impossible,
  // but a fresh id colliding with an EXISTING team/reserve is at least
  // theoretically possible, unlike a picked reserve (whose id is expected
  // and meant to already exist in T.reserves — this check must never run on
  // that path, or it would strip a legitimately-picked reserve of its own
  // identity). teamMap() already covers both T.players and T.reserves.
  var known = teamMap(T), bump = 0;
  while (known[parsed.teamId]) parsed.teamId = 'team_' + Date.now() + '_' + (++bump);
  return parsed;
}

function removePlayer(name) {
  if (!confirm('Remove "' + name + '" from the tournament? This cannot be undone.')) return;

  // If they're in the round currently being scored, remove them from the
  // room and re-pack that room's score keys so everyone else's already
  // entered scores stay attached to the right player (scores are keyed by
  // position within the room, not by name).
  if (T.rounds.length) {
    var ri = T.curRound;
    var asgn = T.assignments[ri] || [];
    var roomOfPlayer = asgn.find(a => a.name === name);
    if (roomOfPlayer) {
      var room = roomOfPlayer.room;
      var roomPlayers = asgn.filter(a => a.room === room);
      var pi = roomPlayers.findIndex(a => a.name === name);
      // Every game of a multi-game Semis round, not just game 1's key
      // (2026-09-08, "Multi-game Semis" in HANDOFF_LOG.md) — see
      // removeTeam()'s identical fix for the team-format equivalent.
      var round = T.rounds[ri];
      for (var k = pi + 1; k < roomPlayers.length; k++) {
        var fromKeys = scoreKeysForPosition(ri, room, k, round, 0);
        var toKeys = scoreKeysForPosition(ri, room, k - 1, round, 0);
        for (var ki = 0; ki < fromKeys.length; ki++) {
          if (T.scores[fromKeys[ki]] !== undefined) T.scores[toKeys[ki]] = T.scores[fromKeys[ki]];
          else delete T.scores[toKeys[ki]];
        }
      }
      scoreKeysForPosition(ri, room, roomPlayers.length - 1, round, 0).forEach(k => delete T.scores[k]);
      T.assignments[ri] = asgn.filter(a => a.name !== name);
      invalidateStaleTieResolutions(ri, room);
    }
  }

  T.players  = T.players.filter(p => p !== name);
  T.reserves = T.reserves.filter(p => p !== name);
  T.qualTable = T.qualTable.filter(p => p.name !== name);
  T.luckyLosers = T.luckyLosers.map(arr => arr ? arr.filter(n => n !== name) : arr);
  Object.keys(T.tieResolutions).forEach(k => {
    var list = tieResolutionList(T, k);
    if (list.indexOf(name) !== -1) T.tieResolutions[k] = list.filter(n => n !== name);
  });

  renderAdminRound();
  markDirty();
  saveState();
}

function goBack() {
  if (T.curRound > 0) { T.curRound--; renderAdminRound(); saveState(); }
}

function resetTournament() {
  if (hasUnsavedChanges()) {
    confirmUnsavedChanges('resetting', 'reset', proceedReset);
    return;
  }
  if (!confirm('Reset the full tournament? All scores will be lost.')) return;
  proceedReset();
}
