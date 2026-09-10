// formats-and-primitives.js — GAME_FORMATS/team-scoring/odd-count registries,
// the gamemode descriptor, roster/team helpers, and the room-distribution +
// scoring primitives every pooling/bracket phase builds on.

// ═══════════════════════════════════════════════════════════════
// GAMEMODE ARCHITECTURE
//  Two independent dimensions, combinable freely: "schedule logic" (how
//  rounds are structured and players progress — classic elimination today,
//  Kings Valley / Swiss / group-knockout later) and "game format" (what's
//  played in each room — FFA individual today, team formats like 2v2v2v2
//  later). Each registry entry names a function that lives in that
//  function's natural topical section elsewhere in the file (the classic
//  elimination progression builder is with Room Distribution & Progression,
//  its advancement logic is with Round Rendering) — this table is just the
//  lookup, not where the logic lives. Only one entry exists in each registry
//  today; buildProgression()/advanceRound() dispatch through it so adding a
//  second schedule logic or game format later never requires touching their
//  shared plumbing, only registering a new entry here.
// ═══════════════════════════════════════════════════════════════
var GAME_FORMATS = {
  'ffa-individual': {
    label: 'FFA — Individual',
    unitLabel: 'Player',        // singular, used for dynamically-built table headers
    unitLabelPlural: 'Players',
    defaultRoomSize: { min: 6, max: 8, ideal: 8 }
  },
  'team-2v2v2v2': {
    label: '2v2v2v2',
    unitLabel: 'Team',
    unitLabelPlural: 'Teams',
    teamSize: 2,
    // Team-units, not players — mirrors how FFA's defaultRoomSize is in
    // player-units (its "unit" is a player). Same 6-8 physical players/room
    // as FFA, just halved by teamSize.
    defaultRoomSize: { min: 3, max: 4, ideal: 4 }
  },
  'team-3v3': {
    label: '3v3',
    unitLabel: 'Team',
    unitLabelPlural: 'Teams',
    teamSize: 3,
    // No defaultRoomSize — 3v3's natural room shape is strict head-to-head
    // (2 teams/room), too narrow to have the same min-max slack FFA/2v2v2v2
    // rely on, so its actual roomSize is derived fresh every generation from
    // idealRoomSize + whichever odd-count strategy the organiser picks (see
    // deriveRoomSize() and "Odd-count strategy" in HANDOFF.md).
    idealRoomSize: 2,
    supportedOddCountStrategies: ['none', 'bye', 'flex']
  },
  'team-3v3v3': {
    label: '3v3v3',
    unitLabel: 'Team',
    unitLabelPlural: 'Teams',
    teamSize: 3,
    // Static-range pattern (like team-2v2v2v2), not team-3v3's idealRoomSize/
    // oddCountStrategy mechanism — 3v3v3's ideal room genuinely has flex
    // room the same way FFA's and 2v2v2v2's do. The flex direction is a hard
    // requirement, not a preference: ideal:3 teams = 9 players; flexing DOWN
    // to min:2 (6 players) keeps every room at or under 9, but flexing UP to
    // 4 teams would be 12 players — over HARD_ROOM_PLAYER_CAP (10) outright.
    // So min:2/max:3 is the only viable shape here, not a style choice to
    // "correct" back toward a symmetric min/max later.
    defaultRoomSize: { min: 2, max: 3, ideal: 3 }
  },
  'individual-1v1': {
    label: '1v1',
    unitLabel: 'Player',
    unitLabelPlural: 'Players',
    // No teamSize — an individual format, same as FFA: reuses FFA's existing
    // player-management, roster-parsing, and scoring code paths entirely (no
    // Manage Teams, no team-shaped roster lines, no teamScoringRule). The
    // only things different from FFA are its room shape (derived via
    // idealRoomSize/oddCountStrategy, like team-3v3, rather than a static
    // defaultRoomSize) and which bracket phase it runs on (chosen via the
    // "Schedule logic" dropdown, independently of this format entry).
    idealRoomSize: 2,
    supportedOddCountStrategies: ['none', 'bye']
  }
};

// Team scoring is a small pluggable registry, matching the schedule-logic/
// game-format registry pattern: score ENTRY is always per individual member,
// but the team score fed into every generic scored-unit code path
// (orderRoomByScore, lucky-loser %, Fair Points, tie detection) is DERIVED
// via whichever rule gamemodeConfig.teamScoringRule names. Only one rule
// exists today.
var TEAM_SCORING_RULES = {
  'sum-members': {
    // Was "Sum of both members" — hardcoded to 2, already stale for
    // team-3v3v3 (3 members). Harmless while no UI ever showed this label;
    // reworded once a real selector (this build) started displaying it.
    label: 'Sum of all members',
    computeTeamScore: function (individualScores) {
      return individualScores.reduce(function (a, b) { return a + b; }, 0);
    }
  },
  // "Save your Buddy" mode — the team's score is whichever member is
  // currently "the defender," full stop. Defaults to the first-listed
  // member and can be changed by the organiser at any point (see
  // getDefenderIndex()/setDefender() and "Defender history" in
  // HANDOFF_LOG.md) — designatedIdx is resolved PER ROUND by the caller
  // (getUnitScore/getFinalUnitScore), so a later change never affects an
  // already-played round's own score. A vacant defender slot scores 0 for
  // the team, same as every other "genuinely vacant slot never blocks
  // scoring" rule already in place (see getUnitScore's own doc comment).
  'designated-player': {
    label: 'Save your Buddy (defender only)',
    computeTeamScore: function (individualScores, designatedIdx) {
      return individualScores[designatedIdx] || 0;
    }
  }
};

// The defender (designated-player rule only) — an append-only per-team
// change log, not a per-round snapshot (see T.defenderChanges' own doc
// comment in js/core.js for why: a log needs no hooking into every round-
// creation code path to "carry forward" state, since a lookup for round
// `ri` just finds the latest entry with `round <= ri`). Defaults to member
// index 0 when no entry applies — including for a tournament/archive
// snapshot from before this feature existed at all, which simply has no
// `defenderChanges` field, reproducing the original "always first-listed"
// behaviour exactly with zero migration needed.
function getDefenderIndex(state, teamId, ri) {
  var changes = (state.defenderChanges && state.defenderChanges[teamId]) || [];
  var best = 0, bestRound = -1;
  changes.forEach(function (c) {
    if (c.round <= ri && c.round > bestRound) { bestRound = c.round; best = c.memberIdx; }
  });
  return best;
}

// Display-only counterpart to getDefenderIndex() — resolves straight to the
// defending member's current display NAME rather than their index.
// Deliberately name-based, not index-based, for display purposes: Bracket/
// Scoreboard mark a member by matching against unitDisplay()'s already-
// vacant-filtered member-name list, which no longer corresponds 1:1 to raw
// member indices once any slot in the team is vacant — matching by name
// sidesteps that mismatch entirely rather than needing to re-derive it.
function getDefenderName(state, teamId, ri) {
  var team = teamMap(state)[teamId];
  var idx = getDefenderIndex(state, teamId, ri);
  return (team && team.members && team.members[idx]) ? team.members[idx].name : null;
}

// Odd-count strategy: how a format whose ideal room shape is narrow (e.g.
// 3v3's strict 2-teams-per-room) handles a field that doesn't divide evenly
// by idealRoomSize, at generation time or any later round. Only a format that
// declares GAME_FORMATS[x].supportedOddCountStrategies (a subset of these
// keys) shows the setup dropdown at all — FFA and 2v2v2v2 have enough slack
// in their own defaultRoomSize range that this never applies to them.
// Labels here, actual behavior lives with whichever part of the pipeline
// reads gamemodeConfig.oddCountStrategy (room-size derivation, seeding, etc.).
var ODD_COUNT_STRATEGIES = {
  'none': { label: 'None — strict, refuse to generate on an odd count' },
  'bye':  { label: 'Bye — a team can sit out a round when needed' },
  'flex': { label: 'Flex — a room can occasionally hold one extra team' }
};

// The live gamemode descriptor, composed from current state. `schedule` and
// `format` carry per-mode behaviour/fixed facts (functions, labels); `config`
// (= T.gamemodeConfig) carries this tournament's tunable parameters (room
// size, qual-round count) — see proceedGenerateSchedule() for where config
// gets populated from the chosen format's defaults.
function getGamemodeDescriptor() {
  return getGamemodeDescriptorFor(T);
}

// state-parameterised variant — the pure builders (computeRankings,
// buildBracketHtml, etc.) accept either live T or an archived snapshot, and
// an archived team tournament must render as a team tournament even if the
// live T is currently set to a different format, so those callers derive
// the descriptor from `state`, never from the live globals directly.
function getGamemodeDescriptorFor(state) {
  return {
    scheduleLogic: state.scheduleLogic,
    gameFormat: state.gameFormat,
    schedule: SCHEDULE_LOGICS[state.scheduleLogic],
    format: GAME_FORMATS[state.gameFormat],
    config: state.gamemodeConfig
  };
}

// ═══════════════════════════════════════════════════════════════
// TEAM-AWARE ROSTER HELPERS
//  T.players is an array of plain name strings for individual formats, or
//  an array of {teamId, teamName, members:[{name,userId}]} objects for team
//  formats. Every place that treats "the roster" as an opaque list of
//  identity keys (seeding, qual table, rankings, tie-resolutions, finals)
//  goes on keying everything by a single opaque string exactly as before,
//  regardless of format — rosterKey()/rosterKeys() normalise either roster
//  shape into that identity string (a team's teamId, or the name itself).
//  Only the RENDERING layer needs to look a key back up to a human-readable
//  label — see teamMap()/unitDisplay()/renderUnitCell() below.
// ═══════════════════════════════════════════════════════════════
function rosterKey(entry) { return (entry && typeof entry === 'object') ? entry.teamId : entry; }

function rosterKeys(players) { return (players || []).map(rosterKey); }

function teamMap(state) {
  var m = {};
  (state.players || []).concat(state.reserves || []).forEach(function (t) { if (t && t.teamId) m[t.teamId] = t; });
  return m;
}

// Repairs a team object whose .members array is missing or short — exactly
// the shape Firebase's null-array pruning produces (see
// marshalNullsForFirebase() in js/sync.js, and "Fix: Firebase live-sync
// silently drops null array elements" in HANDOFF_LOG.md). Mutates the team
// objects in place, so every consumer — rendering AND the mutation
// handlers a "Vacant slot" row's own buttons call (setDefender(),
// fillVacantSlotFromReserve(), etc.) — sees a real array from this point
// on. The marshal/unmarshal fix in js/sync.js stops NEW corruption from
// happening; this repairs data that was already corrupted before that fix
// shipped, so it stays usable rather than merely non-crashing. Called
// wherever T can be populated from an external source (loadState(), and
// both Firebase merge paths in js/sync.js) — a no-op for an individual
// format (no teamSize) or once every team already has a full-length array.
function normalizeTeamRosters(state) {
  var teamSize = getGamemodeDescriptorFor(state).format.teamSize;
  if (!teamSize) return;
  (state.players || []).concat(state.reserves || []).forEach(function (t) {
    if (!t || typeof t !== 'object') return;
    if (!t.members) t.members = [];
    while (t.members.length < teamSize) t.members.push(null);
  });
}

// Resolves an identity key (a player name, or a team's teamId) to display
// info. `state` supplies both the format (individual formats just echo the
// key back as the label) and the roster (a teamId is looked up fresh each
// time, so a renamed team's history displays under its current name/roster,
// same as an individual player rename already does via renamePlayer()).
function unitDisplay(state, key) {
  var descriptor = getGamemodeDescriptorFor(state);
  if (!descriptor.format || !descriptor.format.teamSize) return { label: key, members: null };
  var t = teamMap(state)[key];
  if (!t) return { label: key, members: null }; // removed/stale team — fall back to the raw key
  return { label: t.teamName, members: (t.members || []).filter(Boolean).map(function (m) { return m.name; }) };
}

// The inverse of unitDisplay(): given free-typed text, finds the roster key
// (a player name, or a team's teamId) it identifies — for individual formats
// the label IS the key, so unitDisplay's forward lookup format-agnostically
// covers both cases with no separate team/individual branch here. A team
// resolves by its team name OR any one member's name (Bracket's "Follow a
// player" feature — following a teammate should work the same as following
// the team itself). Reserves are included on purpose: following an unseeded
// reserve is valid, it just shows a "not in this bracket yet" state.
// Exact matches win over substring matches so e.g. "Al" doesn't get
// shadowed by "Alex" when both are on the roster.
function resolveUnitQuery(state, query) {
  var q = (query || '').trim().toLowerCase();
  if (!q) return null;
  var keys = rosterKeys(state.players).concat(rosterKeys(state.reserves));
  var candidates = keys.map(function (key) { return { key: key, info: unitDisplay(state, key) }; });
  var exactLabel = candidates.find(function (c) { return c.info.label.toLowerCase() === q; });
  if (exactLabel) return exactLabel.key;
  var exactMember = candidates.find(function (c) { return c.info.members && c.info.members.some(function (m) { return m.toLowerCase() === q; }); });
  if (exactMember) return exactMember.key;
  var subLabel = candidates.find(function (c) { return c.info.label.toLowerCase().indexOf(q) !== -1; });
  if (subLabel) return subLabel.key;
  var subMember = candidates.find(function (c) { return c.info.members && c.info.members.some(function (m) { return m.toLowerCase().indexOf(q) !== -1; }); });
  return subMember ? subMember.key : null;
}

// Builds one escaped, defender-marked HTML snippet per member name — shared
// by renderUnitCell() and Bracket's team-row builder so the marking logic
// (and its amber/🛡 styling) lives in exactly one place. Matches by NAME,
// not index — info.members has already had vacant slots filtered out (see
// unitDisplay() above), so a raw member index no longer corresponds 1:1 to
// a position in this list once any slot in the team is vacant. `ri` is
// optional: omit it (or leave the rule as sum-members) to skip marking
// entirely — every call site that doesn't care about the defender (the
// reserve panel, standings tables, Finals total) just doesn't pass it.
function markedMemberNames(state, key, ri, memberNames) {
  var defenderName = null;
  if (ri !== undefined && getGamemodeDescriptorFor(state).config.teamScoringRule === 'designated-player') {
    defenderName = getDefenderName(state, key, ri);
  }
  return memberNames.map(function (name) {
    return name === defenderName ? '<span style="color:var(--amber)" title="The defender — this member\'s score is the team\'s score">🛡 ' + esc(name) + '</span>' : esc(name);
  });
}

// Shared HTML for a "unit" table cell — a plain escaped name for individual
// formats, or the team name (+ member names on a muted sub-line, when
// withMembers) for team formats. Used everywhere a room/roster row currently
// shows `esc(p.name)`. `ri` (optional) is the round to mark the defender
// for, when the active team-scoring rule is 'designated-player' — see
// markedMemberNames() above.
function renderUnitCell(state, key, withMembers, ri) {
  var info = unitDisplay(state, key);
  if (!info.members) return esc(info.label);
  var html = '<strong>' + esc(info.label) + '</strong>';
  if (withMembers) html += '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + markedMemberNames(state, key, ri, info.members).join(' &amp; ') + '</div>';
  return html;
}

// Reads the score for room-position `pi` in round `ri`/room `rm`, for ONE
// specific game `g` of a (possibly multi-game) round — `g === null` reads
// the plain, ungamed key exactly as this function's logic always has (byte-
// identical key for every round that's never multi-game, which today is
// still every round except a "Semis format"/"Finals format" > 1 games
// round). This is getUnitScore()'s per-game building block, extracted
// (2026-09-08, "Multi-game Semis" in HANDOFF_LOG.md) so a multi-game round
// can sum over it without duplicating the individual/team branching logic
// below. Generic across formats: for an individual format this is exactly
// the stored value at that position; for a team format it's the DERIVED
// team score for that one game, computed from that position's per-member
// scores via the active TEAM_SCORING_RULES entry. `fallback` is substituted
// for a score not yet entered — passing null means "not fully scored"
// propagates (any missing member blocks the team score, same as a missing
// individual score blocks an FFA player's); passing a number (e.g. 0) fills
// missing members with that value instead, for a live/partial computation
// that still wants something to show.
function getUnitScoreForGame(state, ri, rm, pi, g, fallback) {
  var descriptor = getGamemodeDescriptorFor(state);
  var teamSize = descriptor.format && descriptor.format.teamSize;
  var gPart = g === null ? '' : `-g${g}`;
  if (!teamSize) return scoreOrDefault(state.scores[`r${ri}-rm${rm}-p${pi}${gPart}`], fallback);
  // A genuinely vacant slot (a member removed mid-tournament, not yet
  // replaced) contributes 0 and never blocks the team's score — only a
  // slot that HAS a member but no score entered yet counts as "missing".
  var asgn = (state.assignments[ri] || []).filter(a => a.room === rm);
  var team = asgn[pi] && teamMap(state)[asgn[pi].name];
  var vals = [], anyMissing = false;
  for (var mi = 0; mi < teamSize; mi++) {
    if (!(team && team.members && team.members[mi])) { vals.push(0); continue; }
    var v = scoreOrDefault(state.scores[`r${ri}-rm${rm}-p${pi}${gPart}-m${mi}`], null);
    if (v === null) { anyMissing = true; v = 0; }
    vals.push(v);
  }
  if (anyMissing && fallback === null) return null;
  var rule = TEAM_SCORING_RULES[(descriptor.config && descriptor.config.teamScoringRule) || 'sum-members'];
  // team (not asgn[pi] directly) — asgn[pi] can be undefined (pi beyond
  // this room's actual size, e.g. scanning a room-position that never had
  // an occupant); team is already the same `asgn[pi] &&`-guarded lookup
  // from above, and getDefenderIndex() itself tolerates a null/undefined
  // teamId gracefully (defaults to index 0), so this never throws. Fixed
  // to round `ri` regardless of which game `g` — the defender doesn't
  // change mid-round, only between rounds (see "Defender history" in
  // HANDOFF.md).
  return rule.computeTeamScore(vals, getDefenderIndex(state, team && team.teamId, ri));
}

// Reads a unit's TOTAL score for round ri/room rm/position pi — summed
// across every game of the round when it's multi-game (2026-09-08, "Multi-
// game Semis" in HANDOFF_LOG.md — today this can only be a Semis round;
// see js/bracket-phases.js), or the single game-1 value otherwise. Every
// existing caller (detectTieBreaks/isRoundFullyScored/computeLuckyLosers/
// recalcRoom/orderRoomByScore's feeders/computeRankings' elimination loop)
// already routes through this one function, so none of them needed to
// change to become multi-game-correct — confirmed directly, not assumed.
// `fallback` semantics generalize the per-game/per-member ones above one
// level up: with fallback=null, ANY missing game blocks the total (not
// just a missing team member within one game); with a number fallback
// (e.g. 0), a missing game contributes 0 toward the sum, for the same
// "still show something for a live/partial computation" reasoning.
function getUnitScore(state, ri, rm, pi, fallback) {
  var round = state.rounds && state.rounds[ri];
  var numGames = (round && round.numGames > 1) ? round.numGames : 1;
  if (numGames === 1) return getUnitScoreForGame(state, ri, rm, pi, null, fallback);
  var total = 0, anyMissing = false;
  for (var g = 1; g <= numGames; g++) {
    var v = getUnitScoreForGame(state, ri, rm, pi, g, null);
    if (v === null) { anyMissing = true; v = 0; }
    total += v;
  }
  if (anyMissing && fallback === null) return null;
  return total;
}

// Every T.scores key belonging to one room-position, across every game of a
// (possibly multi-game) round — used by the roster-edit helpers that
// repack/clear scores by position (removeTeam/swapPlayer/swapTeam/
// removePlayer, js/generation-and-roster.js) so a later game's key moves or
// clears together with game 1's, not just the single key those functions
// were written against before multi-game rounds existed.
function scoreKeysForPosition(ri, rm, pi, round, teamSize) {
  var numGames = (round && round.numGames > 1) ? round.numGames : 1;
  var keys = [];
  for (var g = 1; g <= numGames; g++) {
    var base = `r${ri}-rm${rm}-p${pi}` + (numGames > 1 ? `-g${g}` : '');
    if (teamSize) { for (var mi = 0; mi < teamSize; mi++) keys.push(`${base}-m${mi}`); }
    else keys.push(base);
  }
  return keys;
}

// Finals equivalent of getUnitScore — T.finalScores has no room/position
// structure (keyed "game{g}-{name}"), just a game number and a unit key.
// Double-elimination's grand final reuses this unchanged — it's a
// continuous games-until-someone-wins race (see "Grand-final race format"
// in HANDOFF.md) played entirely under one round's own keys, unlike the
// original single-reset design this replaced (which needed a second,
// namespaced key set for a live-inserted reset round).
function getFinalUnitScore(state, key, g, fallback) {
  var descriptor = getGamemodeDescriptorFor(state);
  var teamSize = descriptor.format && descriptor.format.teamSize;
  var gamePart = 'game' + g;
  if (!teamSize) {
    var v = state.finalScores[gamePart + '-' + key];
    return (v !== undefined && v !== null && v !== '') ? parseInt(v) : fallback;
  }
  var team = teamMap(state)[key];
  var vals = [], anyMissing = false;
  for (var mi = 0; mi < teamSize; mi++) {
    if (!(team && team.members && team.members[mi])) { vals.push(0); continue; } // vacant slot, never blocks
    var raw = state.finalScores[gamePart + '-' + key + '-m' + mi];
    var ok = raw !== undefined && raw !== null && raw !== '';
    vals.push(ok ? parseInt(raw) : 0);
    if (!ok) anyMissing = true;
  }
  if (anyMissing && fallback === null) return null;
  var rule = TEAM_SCORING_RULES[(descriptor.config && descriptor.config.teamScoringRule) || 'sum-members'];
  // isFinal is true for the grand-final round too (see "Grand-final race
  // format" in HANDOFF.md), so this is the Final's round index regardless
  // of schedule logic — resolved here rather than threaded as a new
  // parameter, since every existing call site already has `state` and
  // nothing else this function needs.
  var finalRi = state.rounds.findIndex(r => r.isFinal);
  return rule.computeTeamScore(vals, getDefenderIndex(state, key, finalRi));
}

// Verifies every room every round of a generated schedule would actually
// seat fits within HARD_ROOM_PLAYER_CAP, for whatever format generated it —
// format.teamSize is undefined for individual formats (FFA), hence the
// `|| 1` (one player per "unit"). Called once, right after
// composedBuildProgression() returns, covering every round type
// (no-elim, qual, elimination, Semis, Final) in one pass rather than
// scattering the check across every individual distributeRooms call site.
// Structurally impossible to violate with any format registered today —
// the entire point is to fail loudly, automatically, the first time a
// future format's arithmetic doesn't work out, rather than relying on
// manual review catching it (which very nearly didn't, this time).
function validateRoomCap(rounds, format) {
  var unitSize = format.teamSize || 1;
  for (var i = 0; i < rounds.length; i++) {
    var round = rounds[i];
    for (var r = 0; r < round.rooms.length; r++) {
      var playerCount = round.rooms[r] * unitSize;
      if (playerCount > HARD_ROOM_PLAYER_CAP) {
        return 'Round ' + round.roundNum + ' would seat ' + playerCount + ' players in one room (' +
          round.rooms[r] + ' ' + format.unitLabelPlural.toLowerCase() + ' × ' + unitSize + ' players each) — ' +
          'over the game\'s hard cap of ' + HARD_ROOM_PLAYER_CAP + ' players per room. If you set a Semis/Final ' +
          'size override, try a smaller value; otherwise this should not be possible with any registered ' +
          'format\'s current numbers — please report this before generating.';
      }
    }
  }
  return null;
}

// roomSize: { min, max, ideal } — for FFA that's { min:6, max:8, ideal:8 },
// sourced from the current gamemode descriptor's config, not hardcoded here,
// so a game format with different-sized rooms (e.g. team formats) can reuse
// this same distribution algorithm with its own bounds.
function distributeRooms(n, roomSize) {
  if (n <= 0) return [];
  if (n <= roomSize.max) return [n];
  var minRooms = Math.ceil(n / roomSize.max);  // fewest rooms with no room over this format's own max
  var maxRooms = Math.floor(n / roomSize.min); // most rooms with no room under the floor
  var numR = minRooms;
  if (maxRooms >= minRooms) {
    var idealRooms = Math.round(n / roomSize.ideal);
    numR = Math.min(maxRooms, Math.max(minRooms, idealRooms));
  }
  var base = Math.floor(n / numR), extra = n % numR, out = [];
  for (var i = 0; i < numR; i++) out.push(base + (i < extra ? 1 : 0));
  return out;
}

function snapFriendly(n, roomSize) {
  for (var d = 0; d <= roomSize.min; d++) {
    for (var dir = 0; dir < 2; dir++) {
      var c = n + (dir ? -d : d);
      if (c < roomSize.min) continue;
      var nr = Math.ceil(c / roomSize.ideal);
      if (nr >= 1 && Math.floor(c / nr) >= roomSize.min) return c;
    }
  }
  return n;
}

// A format with a static defaultRoomSize (FFA, 2v2v2v2) has one fixed range
// that never varies — used as-is, same as before this existed. A format that
// instead declares idealRoomSize (see GAME_FORMATS['team-3v3'] and the
// odd-count-strategy setup dropdown, "oddCountStrategy config and setup UI")
// has no single static room-size range — its room shape depends on which
// odd-count strategy the organiser picked, derived fresh here every
// generation. Once derived, the result flows through distributeRooms/
// computeTargets/snapFriendly exactly like any other format's roomSize — no
// changes needed there.
function deriveRoomSize(format, oddCountStrategy) {
  if (format.defaultRoomSize) return Object.assign({}, format.defaultRoomSize);
  var ideal = format.idealRoomSize;
  if (oddCountStrategy === 'flex') return { min: ideal, max: ideal + 1, ideal: ideal };
  // 'none' and 'bye' both use a strict fixed-point room size — a bye/none
  // distinction is NOT a room-size difference, it's what happens when a
  // round's count is odd despite that fixed point (see their own HANDOFF.md
  // sections). Also the fallback for a format that hasn't been generated
  // with a strategy selected yet.
  return { min: ideal, max: ideal, ideal: ideal };
}

// "Bye" odd-count strategy — a room shape as strict as "None" (see
// deriveRoomSize above), but instead of refusing to generate, a round whose
// incoming count isn't a clean multiple of idealRoomSize reserves exactly one
// unit as that round's bye (they sit out, no room, auto-advance — see
// roomBasedComputeAdvancement/advanceRound for the live mechanism
// and HANDOFF.md's "Odd-count strategy" section for the full reasoning) and
// distributes the even remainder into rooms normally. Used at every point
// composedBuildProgression turns a headcount into a rooms array,
// generation-time only — this never changes which units actually get a bye
// live (that's runtime data composedBuildProgression can't know in
// advance), only how many rooms + how big a bye reservation that round's
// STRUCTURE should project. A no-elim/qual round's byeCount is purely
// descriptive (its own advancement is already the dynamic "everyone present
// advances" case, self-consistent with no further adjustment); an
// elimination round's byeCount also feeds back into its own advPerRoom/
// luckyCount computation — see composedBuildProgression.
function distributeRoomsWithBye(n, roomSize, oddCountStrategy) {
  var remainder = (oddCountStrategy === 'bye' && roomSize.min === roomSize.max) ? (n % roomSize.ideal) : 0;
  return { rooms: distributeRooms(n - remainder, roomSize), byeCount: remainder };
}

function computeTargets(start, end, numRounds, roomSize) {
  if (numRounds <= 0) return [];
  if (numRounds === 1) return [end];
  // Already at or below the target — nothing left to eliminate over these rounds.
  if (start <= end) return Array(numRounds).fill(end);

  var ratio = Math.pow(end / start, 1 / numRounds);
  var targets = [], prev = start;
  for (var i = 1; i <= numRounds; i++) {
    var target;
    if (i === numRounds) {
      target = end;
    } else {
      var raw = Math.round(start * Math.pow(ratio, i));
      target = snapFriendly(raw, roomSize);
      // Never exceed the previous round's count (elimination can't add players
      // back), and never dip below the floor before the final forced round.
      target = Math.min(target, prev);
      target = Math.max(target, end);
    }
    targets.push(target);
    prev = target;
  }
  return targets;
}

// ═══════════════════════════════════════════════════════════════
//  SEEDING
// ═══════════════════════════════════════════════════════════════
// formatDescriptor is accepted but unused for FFA — the interleave algorithm
// is already format-agnostic (it just distributes named units across rooms),
// so nothing branches on it today. Threaded through now so a future format
// needing different seeding rules (e.g. avoiding a team-composition
// constraint) has a place to plug in without changing every call site.
function snakeSeed(players, numRooms, formatDescriptor) {
  var out = [], dir = 1, ri = 0;
  for (var i = 0; i < players.length; i++) {
    // players[i].name is a teamId for a team format (an opaque identity
    // key, not shown to anyone) — the roster of members/display name lives
    // on T.players and is looked up fresh at render time via unitDisplay().
    out.push({ name: players[i].name || players[i], room: ri + 1,
               isLucky: players[i].isLucky || false });
    ri += dir;
    if (ri >= numRooms) { ri = numRooms - 1; dir = -1; }
    else if (ri < 0)    { ri = 0;            dir =  1; }
  }
  return out;
}

// Fisher-Yates — a provably-uniform permutation, unlike the previous
// Array.sort(() => Math.random()-.5) (a well-known non-uniform shuffle:
// sort's comparator gets called an implementation-defined, non-random-
// walk number of times per element, biasing the result). Flagged as
// "good enough for now, revisit later" during the original audit — this
// closes that out.
function randomSeed(players, rooms) {
  var shuffled = players.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
  }
  var out = [], pi = 0;
  for (var ri = 0; ri < rooms.length; ri++)
    for (var p = 0; p < rooms[ri]; p++)
      out.push({ name: shuffled[pi++] || ('Player '+(pi)), room: ri+1, isLucky:false });
  return out;
}

// ═══════════════════════════════════════════════════════════════
// SCORING & TIE-BREAKS — Fair Points  (lower = better)
//  rank is the dominant term; score / 100000 is a same-rank tiebreaker
//  fraction small enough to never cross a rank boundary. SUBTRACTED (not
//  added) so a HIGHER score correctly produces a LOWER (better, under this
//  ascending sort) total among players sharing a rank — e.g. two 1st-place
//  finishers on scores 1306 and 1200 land at 0.98694 and 0.988 respectively,
//  so the higher score still sorts first. (Previously added, which had this
//  backwards — a higher score made the tiebreak fraction WORSE.)
// ═══════════════════════════════════════════════════════════════
function fairPoints(rank, score) { return rank - score / 100000; }

// Groups a room's score-sorted (descending) players into clusters sharing an
// identical score — size 1 for a unique score, size 2+ for a tie. Shared by
// detectTieBreaks (cares whether a cluster is still unresolved) and
// orderRoomByScore (just wants the final display/seeding order).
function groupByScore(scoredDesc) {
  var clusters = [], i = 0;
  while (i < scoredDesc.length) {
    var j = i;
    while (j + 1 < scoredDesc.length && scoredDesc[j + 1].score === scoredDesc[i].score) j++;
    clusters.push(scoredDesc.slice(i, j + 1));
    i = j + 1;
  }
  return clusters;
}

// Reads a tie-break resolution as an ordered array regardless of whether it
// was stored under the old single-winner-string format (tournaments/archives
// saved before ordered resolution existed) or the current array format.
function tieResolutionList(state, key) {
  var v = state && state.tieResolutions && state.tieResolutions[key];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// Orders a room's already-scored players (name + score), breaking same-score
// ties using any resolveTie() choices recorded in state.tieResolutions
// (keyed r{ri}-rm{rm}-s{score}) instead of leaving them in arbitrary
// sort-stability order. Used everywhere a room's exact order matters — Admin
// scoring, Scoreboard, Bracket (live or archived), lucky-loser candidacy, and
// seeding into the next round — so a tie the organiser resolved shows up
// resolved consistently everywhere, not just in the tie banner.
function orderRoomByScore(scored, ri, rm, state) {
  state = state || T;
  var byScore = scored.slice().sort((a, b) => b.score - a.score);
  var out = [];
  groupByScore(byScore).forEach(cluster => {
    if (cluster.length < 2) { out.push(cluster[0]); return; }
    var key = `r${ri}-rm${rm}-s${cluster[0].score}`;
    var resolved = tieResolutionList(state, key);
    var byName = {}; cluster.forEach(p => { byName[p.name] = p; });
    var remaining = cluster.map(p => p.name).filter(n => resolved.indexOf(n) === -1);
    resolved.concat(remaining).forEach(n => { if (byName[n]) out.push(byName[n]); });
  });
  return out;
}

// --- Scoring & Tie-breaks: Lucky Loser calculation ---
// For each room: take the player who JUST missed direct advancement
// (position = advPerRoom + 1), compute score/roomTotal, using the
// tie-resolved room order so a pending/resolved tie at that exact boundary
// doesn't silently pick the wrong candidate. Sort descending; top luckyCount get in.
// True once every player in every room of this round has a score entered.
// Lucky-loser selection is inherently cross-room (comparing relative
// performance against every other room's total), so a candidate computed
// from a still-partially-scored round would be a misleading guess that
// could change once the remaining rooms finish — wait for the whole round.
function isRoundFullyScored(ri, round) {
  for (var rm = 1; rm <= round.rooms.length; rm++) {
    var players = (T.assignments[ri] || []).filter(a => a.room === rm);
    if (!players.length) return false;
    for (var pi = 0; pi < players.length; pi++) {
      if (getUnitScore(T, ri, rm, pi, null) === null) return false;
    }
  }
  return true;
}
