// advancement.js — the live per-round engine: tie-break detection/resolution,
// advanceRound() and its double-elimination branch, the cumulative-standings
// cutoff systems (qual/Swiss/group-stage), and computeRankings().

// Shared lucky-loser selection math (2026-09-08, "FFA/Team double-
// elimination generalization" in HANDOFF_LOG.md — extracted once a third
// near-identical copy of this exact logic was about to be added for
// doubleEliminationComputeAdvancement(), on top of the two that already
// existed here and in roomBasedComputeAdvancement(); three independently-
// hand-maintained copies of "find the borderline candidate, compute its
// relative dominance, sort, slice" is exactly the kind of drift risk this
// project has been bitten by before). Deliberately NOT a single function
// that also owns the per-room loop — every caller's loop does other things
// too (building its own direct-advancer/loser list from the same `scored`
// array), so re-deriving `scored` a second time inside a fully-owned helper
// would mean either duplicating orderRoomByScore() calls or awkwardly
// threading it back out; splitting into "per-room candidate extraction" +
// "pool-wide selection" keeps each caller's own loop natural while still
// centralizing the actual selection math in one place.

// Given one room's already tie-resolved, score-sorted list and the round's
// own advPerRoom, returns { name, pct } for that room's lucky-loser
// candidate (the unit at position advPerRoom — "missed the direct-advance
// cutoff by exactly one slot"), or null if there's no such position or the
// room's total score is 0 (a percentage would be undefined).
function luckyLoserCandidate(scored, advPerRoom) {
  var candidate = scored[advPerRoom];
  if (!candidate) return null;
  var roomTotal = scored.reduce(function (s, p) { return s + p.score; }, 0);
  if (roomTotal <= 0) return null;
  return { name: candidate.name, pct: candidate.score / roomTotal };
}

// Given a pool of { name, pct } candidates (one per room, from
// luckyLoserCandidate() above) and how many lucky-loser slots this round
// has, picks the top luckyCount by pct (highest relative dominance in their
// own room wins the cross-room comparison) and returns just their names.
function pickLuckyLosers(candidatePool, luckyCount) {
  if (!luckyCount || !candidatePool.length) return [];
  var sorted = candidatePool.slice().sort(function (a, b) { return b.pct - a.pct; });
  return sorted.slice(0, luckyCount).map(function (c) { return c.name; });
}

// Display-only preview of who WOULD be lucky losers if the round ended
// right now (used by Admin/Bracket's live banners, never by the actual
// advancement path — see roomBasedComputeAdvancement()/
// doubleEliminationComputeAdvancement() for that). Independently re-derives
// its own per-room loop (it's called fresh from rendering code, not handed
// an in-progress loop's own `scored` arrays), but the actual candidate/
// selection math now comes from the two shared helpers above rather than a
// third hand-maintained copy of it.
function computeLuckyLosers(ri, round) {
  if (!round.luckyCount || round.isNoElim || round.isFinal) return [];
  if (!isRoundFullyScored(ri, round)) return [];
  var candidates = [];
  for (var rm = 1; rm <= round.rooms.length; rm++) {
    var players = (T.assignments[ri] || []).filter(a => a.room === rm);
    var raw = players.map((p, pi) => ({ name: p.name, score: getUnitScore(T, ri, rm, pi, 0) }));
    var scored = orderRoomByScore(raw, ri, rm);
    var c = luckyLoserCandidate(scored, round.advPerRoom);
    if (c) candidates.push(c);
  }
  return pickLuckyLosers(candidates, round.luckyCount);
}

// --- Scoring & Tie-breaks: Tie-break detection ---
// Universal: ANY two or more players sharing an identical score anywhere in a
// room's ranking is a tie needing resolution, not just a tie straddling the
// advance/eliminate cutoff — because every round's finishing order (except
// the Final, which has no next round) feeds into the next round's
// snake-seeding, so an unresolved tie anywhere can change which room a
// player lands in. This applies uniformly to every round type — no-elim,
// qualification, and elimination rounds alike. Returns
// { "r{ri}-rm{rm}-s{score}" -> { players, rm, score } } for each cluster of
// size >= 2. Resolution is an ORDERED LIST built up one player at a time via
// resolveTie() ("this player ranks next among the remaining tied ones") —
// once a cluster has (size - 1) names resolved, the one name left over is
// implied and no further click is needed.
function detectTieBreaks(ri, round, state) {
  state = state || T;
  if (round.isFinal) return {};
  var ties = {};
  for (var rm = 1; rm <= round.rooms.length; rm++) {
    var players = (state.assignments[ri] || []).filter(a => a.room === rm);
    var scored = players.map((p, pi) => ({ name: p.name, score: getUnitScore(state, ri, rm, pi, null) }))
      .filter(p => p.score !== null).sort((a, b) => b.score - a.score);

    groupByScore(scored).forEach(cluster => {
      if (cluster.length < 2) return;
      var key = `r${ri}-rm${rm}-s${cluster[0].score}`;
      ties[key] = { players: cluster, rm, score: cluster[0].score };
    });
  }
  return ties;
}

function isTieResolved(key, cluster, state) {
  state = state || T;
  return tieResolutionList(state, key).length >= cluster.players.length - 1;
}

// A tie-break resolution can go stale if the organiser edits a score (or
// removes a player) after resolving a tie. Keying resolutions by score value
// (r{ri}-rm{rm}-s{score}) already prevents the common case — a different pair
// tying at a different score gets its own key — but a narrower case survives:
// a brand-new tie recurring at the exact same score, with a different set of
// players. Clears any resolution whose recorded names are no longer actually
// part of the cluster currently detected at that key, so a genuinely new,
// unresolved tie is never silently hidden behind an old decision. Called
// after any score/roster change that could shift a room's tie composition.
function invalidateStaleTieResolutions(ri, rm) {
  var round = T.rounds[ri];
  if (!round) return;
  var currentTies = detectTieBreaks(ri, round);
  var prefix = `r${ri}-rm${rm}-`;
  Object.keys(T.tieResolutions).forEach(key => {
    if (key.indexOf(prefix) !== 0) return;
    var cluster = currentTies[key];
    var resolved = tieResolutionList(T, key);
    var stillValid = cluster && resolved.every(n => cluster.players.some(p => p.name === n));
    if (!stillValid) delete T.tieResolutions[key];
  });
}

// Every currently-relevant tie for this round: the per-room clusters from
// detectTieBreaks(), plus — only when this is the last qualification round —
// the qual-table cutoff tie (see detectQualCutoffTie). Both share the same
// cluster shape ({players, score/fp, key}) and the same
// resolveTie()/renderTieBanner() peel-off mechanism.
//
// state-parameterized (2026-09-07) so Bracket's read-only Archive render can
// call this safely against a frozen snapshot — see "Bracket: unresolved-tie
// indicator" in HANDOFF_LOG.md. The live path (state === T) recomputes
// qualTable/groupStandings before checking a cutoff, matching what Admin's
// renderTieBanner() has always relied on. A snapshot's qualTable/
// groupStandings were already frozen correctly by performArchiveSave()'s
// deep clone at save time — recomputing would mean calling functions that
// WRITE into live T while reading live T.rounds/T.assignments, corrupting
// the live tournament as a side effect of rendering an archived one. Trust
// the snapshot instead.
function getAllTies(ri, round, state) {
  state = state || T;
  var isLive = (state === T);
  var ties = detectTieBreaks(ri, round, state);
  var isLastStandingsRound = (state.cfg || {}).poolingPhase !== 'none' && isStandingsRound(round) &&
    !(state.rounds[ri + 1] && isStandingsRound(state.rounds[ri + 1]));
  if (isLastStandingsRound) {
    if (isLive) updateQualTable(); // ensure totalFP reflects the latest scores before checking
    var cutoffTie = detectQualCutoffTie(state);
    if (cutoffTie) ties[cutoffTie.key] = cutoffTie;
  }
  // Group stage: unlike the single global cutoff above, MULTIPLE groups can
  // each have their own unresolved cutoff tie at once — group A's line and
  // group B's line are entirely independent clusters, both added to the
  // same flat `ties` dict here (keyed uniquely per group by
  // detectGroupCutoffTie), so hasPendingTies()/renderTieBanner() below need
  // no structural change to handle several simultaneous clusters — both
  // already just iterate every key in `ties`.
  var isLastGroupStageRound = round.isGroupStage && !(state.rounds[ri + 1] && state.rounds[ri + 1].isGroupStage);
  if (isLastGroupStageRound) {
    if (isLive) updateGroupStandings();
    (state.groups || []).forEach(g => {
      var groupTie = detectGroupCutoffTie(g.label, state);
      if (groupTie) ties[groupTie.key] = groupTie;
    });
  }
  return ties;
}

function hasPendingTies(ri, round, state) {
  state = state || T;
  var ties = getAllTies(ri, round, state);
  for (var k in ties) {
    if (!isTieResolved(k, ties[k], state)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// ROSTER & PLAYER MANAGEMENT — Reserves (mid-tournament add/remove)
// ═══════════════════════════════════════════════════════════════
// Window closes once the tournament has ADVANCED PAST the first round whose
// advancement can actually eliminate a player — not merely once that round
// becomes current (reserves must stay addable while that round is still
// being scored). For qual mode the first real cut happens when advancing out
// of the LAST qualification round (the qualTable cutoff, applied before any
// !isNoElim round even begins); for standard elimination it's the first
// !isNoElim round itself.
function checkReserveWindow() {
  var cutRound = -1;
  if (T.cfg.poolingPhase === 'group-stage') {
    for (var i = 0; i < T.rounds.length; i++) if (T.rounds[i].isGroupStage) cutRound = i;
  } else if (T.cfg.poolingPhase !== 'none') {
    for (var i = 0; i < T.rounds.length; i++) if (isStandingsRound(T.rounds[i])) cutRound = i;
  } else {
    cutRound = T.rounds.findIndex(r => !r.isNoElim && !r.isFinal);
  }
  if (cutRound === -1) { T.reserveOpen = false; return; }
  T.reserveOpen = T.curRound <= cutRound;
}

// Every BRACKET_PHASES implementation computes room counts/advancement
// targets/Semis/Final (and, for double-elimination, the whole WB/LB routing
// table) ONCE at Generate Schedule time, from a single seedTotal frozen at
// that moment — see "Fix: future-round structure goes stale when reserves
// join mid-tournament" in HANDOFF_LOG.md. addReserve()/addTeamReserve() call
// this immediately after adding the new unit to T.players so every
// not-yet-reached round's structure is re-derived from the new live
// headcount, instead of quietly running the rest of the tournament against
// stale numbers. Only ever called while T.curRound is still inside the
// pooling/no-elim phase (or, for 'none' pooling, the first bracket-phase
// round) — checkReserveWindow() above guarantees T.reserveOpen can never be
// true any later than that, so this never needs to regenerate a bracket
// phase mid-sequence, only from its own natural (seedTotal, startRoundNum)
// entry point, which singleEliminationBracketPhase/doubleEliminationBracketPhase
// are pure functions of. T.rounds[0..T.curRound] (already-played or currently being
// scored) is never touched — same historical-integrity principle as the
// defender-change log. Returns false (nothing committed) if the recomputed
// tail would violate validateRoomCap() — caller must roll back its own
// mutation and tell the organiser. Not called for group-stage tournaments —
// see the guard in addReserve()/addTeamReserve() — since group stage's
// T.groups/round-robin schedule is fixed membership, not a headcount-derived
// rooms array; the group-stage check here is a defensive no-op only.
function recomputeFutureRounds() {
  var descriptor = getGamemodeDescriptor();
  var ri = T.curRound, round = T.rounds[ri];

  if (T.cfg.poolingPhase === 'group-stage') return true;
  if (!round.isNoElim) return true; // already inside the bracket phase — this round's own targets are frozen, nothing ahead to recompute differently

  var roomSize = descriptor.config.roomSize;
  var oddCountStrategy = descriptor.config.oddCountStrategy;
  var liveTotal = rosterKeys(T.players).length; // team-unit count for team formats (rosterKey() normalizes to teamId), player count for individual

  var totalPoolingRounds =
    T.cfg.poolingPhase === 'qual-table' ? descriptor.config.qualRounds :
    T.cfg.poolingPhase === 'swiss'      ? descriptor.config.swissRounds :
    2; // 'none' — fixed no-elim warm-up count, see noElimWarmupPoolingPhase()
  var lastPoolingIdx = totalPoolingRounds - 1;
  var bracketStartRoundNum = totalPoolingRounds + 1;

  var newPoolingTail = [];
  for (var idx = ri + 1; idx <= lastPoolingIdx; idx++) {
    var pd = distributeRoomsWithBye(liveTotal, roomSize, oddCountStrategy);
    newPoolingTail.push(Object.assign({}, T.rounds[idx], {
      players: liveTotal, rooms: pd.rooms, byeCount: pd.byeCount, advTotal: liveTotal
    }));
  }

  // qual-table/Swiss cut to the organiser's fixed T.cfg.qualAdv regardless of
  // how many more players are now competing for those same slots — only
  // 'none' pooling (no cutoff at all) feeds the live total straight through.
  var bracketSeedTotal = T.cfg.poolingPhase === 'none' ? liveTotal : T.cfg.qualAdv;
  var newBracketTail = BRACKET_PHASES[descriptor.config.bracketPhase](
    bracketSeedTotal, bracketStartRoundNum, descriptor);

  var proposedRounds = T.rounds.slice(0, ri + 1).concat(newPoolingTail, newBracketTail);
  var roomCapError = validateRoomCap(proposedRounds, descriptor.format);
  if (roomCapError) return false;

  T.rounds = proposedRounds;
  var tailLen = newPoolingTail.length + newBracketTail.length;
  T.byes = T.byes.slice(0, ri + 1).concat(Array.from({ length: tailLen }, () => []));
  T.luckyLosers = T.luckyLosers.slice(0, ri + 1).concat(Array.from({ length: tailLen }, () => []));
  return true;
}

// Finds the smallest room in the current round — shared by addReserve() and
// addTeamReserve(), the only difference between them being what gets pushed
// into T.assignments/T.players/T.reserves (a bare name vs. a team object).
function smallestRoomInCurrentRound() {
  var ri = T.curRound, round = T.rounds[ri];
  var asgn = T.assignments[ri] || [];
  var roomCounts = {};
  for (var rm = 1; rm <= round.rooms.length; rm++) roomCounts[rm] = asgn.filter(a => a.room === rm).length;
  var smallestRm = 1, smallestCount = roomCounts[1] || 0;
  for (var rm = 2; rm <= round.rooms.length; rm++) {
    if ((roomCounts[rm] || 0) < smallestCount) { smallestRm = rm; smallestCount = roomCounts[rm] || 0; }
  }
  return { rm: smallestRm, count: smallestCount };
}

// --- Scoring & Tie-breaks: cumulative standings (Qualification Table or
// Swiss — only when T.cfg.poolingPhase !== 'none') ---
function updateQualTable() {
  var qualRounds = T.rounds.map((r, i) => ({ r, i })).filter(({ r }) => isStandingsRound(r)).map(({ i }) => i);
  // Pools Fair Points per roster identity key — a team's teamId for team
  // formats, a player's name otherwise (see rosterKeys()).
  var playerData = {};
  rosterKeys(T.players).forEach(key => { playerData[key] = { name: key, rounds: [] }; });

  qualRounds.forEach(ri => {
    var round = T.rounds[ri];
    for (var rm = 1; rm <= round.rooms.length; rm++) {
      var players = (T.assignments[ri] || []).filter(a => a.room === rm);
      var withScores = players.map((p, pi) => ({ name: p.name, score: getUnitScore(T, ri, rm, pi, null) }))
        .filter(p => p.score !== null);
      // A resolved tie determines rank here too — it decides the Fair Points
      // each tied player is credited with, not just their next-round seed.
      var scored = orderRoomByScore(withScores, ri, rm);

      scored.forEach((p, idx) => {
        var rank = idx + 1;
        var fp = fairPoints(rank, p.score);
        if (playerData[p.name]) playerData[p.name].rounds.push({ fp, score: p.score });
      });
    }
  });

  T.qualTable = Object.values(playerData).map(pd => {
    var totalFP = 0, totalScore = 0;
    pd.rounds.forEach(r => { totalFP += r.fp; totalScore += r.score; });
    return { name: pd.name, totalFP: pd.rounds.length ? totalFP : null, totalScore, played: pd.rounds.length };
  }).sort((a, b) => {
    if (a.totalFP === null && b.totalFP === null) return 0;
    if (a.totalFP === null) return 1;
    if (b.totalFP === null) return -1;
    return a.totalFP - b.totalFP;
  });
}

// Checks whether the qualAdv cutoff itself falls inside a tie — the player at
// the last qualifying position and the first non-qualifying one share the
// exact same totalFP. Fair Points already resolves most same-rank
// coincidences via its per-round score-based fractional component, so a
// survivor here is rare but genuine, and it decides who actually advances —
// same peel-off resolution as a per-room tie (see resolveTie), just scoped
// to the whole qual table instead of one room. Only one cluster can ever
// exist (there's only one cut line), keyed 'qual-cutoff'.
function detectQualCutoffTie(state) {
  state = state || T;
  var qt = (state.qualTable || []).filter(p => p.totalFP !== null);
  var qualAdv = (state.cfg || {}).qualAdv;
  if (!qualAdv || qualAdv >= qt.length) return null; // no contested boundary — everyone scored qualifies
  var boundaryFP = qt[qualAdv - 1].totalFP;
  var cluster = qt.filter(p => p.totalFP === boundaryFP);
  if (cluster.length < 2) return null;
  return { key: 'qual-cutoff', players: cluster, fp: boundaryFP, rm: null };
}

// Applies a resolved qual-cutoff tie to the (already totalFP-sorted) qual
// table, splicing the organiser's chosen order into the cluster's slice —
// used by advanceRound() once hasPendingTies() has confirmed nothing is
// still unresolved.
function applyQualCutoffOrder(qt) {
  var tie = detectQualCutoffTie();
  if (!tie) return qt;
  var resolved = tieResolutionList(T, tie.key);
  var remaining = tie.players.map(p => p.name).filter(n => resolved.indexOf(n) === -1);
  var order = resolved.concat(remaining);
  var byName = {}; tie.players.forEach(p => { byName[p.name] = p; });
  var out = qt.slice();
  var startIdx = out.findIndex(p => p.totalFP === tie.fp);
  order.forEach((name, i) => { if (byName[name] && out[startIdx + i] !== undefined) out[startIdx + i] = byName[name]; });
  return out;
}

// --- Scoring & Tie-breaks: Group Stage (K separate per-group tables) ---
// Genuinely new surface area, not a relabeled reuse of updateQualTable()
// above (see "Group stage" in HANDOFF.md, Part 5) — the per-round Fair
// Points accumulation is the same core computation, but scoped per group
// and never merged into one flat ranked list, because there's no single
// global cutoff line here: each group qualifies its own top N
// independently.
function updateGroupStandings() {
  var groupRoundIndices = T.rounds.map((r, i) => ({ r, i })).filter(({ r }) => r.isGroupStage).map(({ i }) => i);
  var byGroup = {};
  T.groups.forEach(g => {
    byGroup[g.label] = {};
    g.members.forEach(key => { byGroup[g.label][key] = { name: key, rounds: [] }; });
  });

  groupRoundIndices.forEach(ri => {
    var round = T.rounds[ri];
    for (var rm = 1; rm <= round.rooms.length; rm++) {
      var groupLabel = round.roomGroups[rm - 1];
      var players = (T.assignments[ri] || []).filter(a => a.room === rm);
      var withScores = players.map((p, pi) => ({ name: p.name, score: getUnitScore(T, ri, rm, pi, null) }))
        .filter(p => p.score !== null);
      var scored = orderRoomByScore(withScores, ri, rm);
      scored.forEach((p, idx) => {
        var rank = idx + 1;
        var fp = fairPoints(rank, p.score);
        if (byGroup[groupLabel] && byGroup[groupLabel][p.name]) byGroup[groupLabel][p.name].rounds.push({ fp, score: p.score });
      });
    }
  });

  var out = {};
  T.groups.forEach(g => {
    out[g.label] = Object.values(byGroup[g.label]).map(pd => {
      var totalFP = 0, totalScore = 0;
      pd.rounds.forEach(r => { totalFP += r.fp; totalScore += r.score; });
      return { name: pd.name, totalFP: pd.rounds.length ? totalFP : null, totalScore, played: pd.rounds.length };
    }).sort((a, b) => {
      if (a.totalFP === null && b.totalFP === null) return 0;
      if (a.totalFP === null) return 1;
      if (b.totalFP === null) return -1;
      return a.totalFP - b.totalFP;
    });
  });
  T.groupStandings = out;
}

// Per-group analog of detectQualCutoffTie() — checks whether ONE group's
// own qualifiersPerGroup cutoff falls inside a tie. Multiple groups can
// each have their own unresolved cluster simultaneously (getAllTies() below
// checks every group independently and can surface several at once) —
// keyed group-cutoff-{label} so each is tracked/resolved independently in
// T.tieResolutions, unlike the single global 'qual-cutoff' key qual/Swiss
// share.
function detectGroupCutoffTie(label, state) {
  state = state || T;
  var table = ((state.groupStandings || {})[label] || []).filter(p => p.totalFP !== null);
  var qpg = (state.cfg || {}).qualifiersPerGroup;
  if (!qpg || qpg >= table.length) return null; // no contested boundary — everyone scored qualifies
  var boundaryFP = table[qpg - 1].totalFP;
  var cluster = table.filter(p => p.totalFP === boundaryFP);
  if (cluster.length < 2) return null;
  return { key: 'group-cutoff-' + label, players: cluster, fp: boundaryFP, rm: null, groupLabel: label };
}

// Per-group analog of applyQualCutoffOrder().
function applyGroupCutoffOrder(label, table) {
  var tie = detectGroupCutoffTie(label);
  if (!tie) return table;
  var resolved = tieResolutionList(T, tie.key);
  var remaining = tie.players.map(p => p.name).filter(n => resolved.indexOf(n) === -1);
  var order = resolved.concat(remaining);
  var byName = {}; tie.players.forEach(p => { byName[p.name] = p; });
  var out = table.slice();
  var startIdx = out.findIndex(p => p.totalFP === tie.fp);
  order.forEach((name, i) => { if (byName[name] && out[startIdx + i] !== undefined) out[startIdx + i] = byName[name]; });
  return out;
}

// Group stage's own cutoff computation (Part 6 of "Group stage" in
// HANDOFF.md) — called from roomBasedComputeAdvancement() once the group
// stage's last round is being advanced out of. hasPendingTies() already
// guarantees every group's own cutoff tie (if any) is fully resolved by
// this point, via getAllTies()'s group-stage branch below.
//
// Seeds qualifiers into the bracket phase by finish position across
// groups, not by group order: all group winners first (ranked among
// themselves by their own Fair Points — the same cross-group comparability
// the existing flat qual-table cutoff already assumes, just applied per
// tier instead of once globally), then all runners-up, and so on. This
// keeps the seed *order* as the only new surface area at the handoff
// boundary — the returned advancing list flows through advanceRound()'s
// existing, unmodified bye/snake-seed/concentrated-bye machinery exactly
// like qual/Swiss's own cutoff-to-bracket handoff already does.
function computeGroupStageAdvancement() {
  updateGroupStandings();
  var qpg = T.cfg.qualifiersPerGroup;
  var perGroupQualifiers = T.groups.map(g => {
    var table = applyGroupCutoffOrder(g.label, (T.groupStandings[g.label] || []).filter(p => p.totalFP !== null));
    return table.slice(0, qpg);
  });
  var advancing = [];
  for (var tier = 0; tier < qpg; tier++) {
    var tierFinishers = perGroupQualifiers.map(gq => gq[tier]).filter(Boolean);
    tierFinishers.sort((a, b) => a.totalFP - b.totalFP);
    tierFinishers.forEach(p => advancing.push({ name: p.name, isLucky: false }));
  }
  return { advancing: advancing, luckyNames: null };
}

// Same-group avoidance at the group-stage -> bracket-phase-first-round
// handoff — explicitly flagged as "not built" in the original group-stage
// build (see "Group stage pooling phase" in HANDOFF.md, Part 6). Scoped
// deliberately narrow, mirroring swissFoldPair's own rematch-avoidance
// philosophy: best-effort, not a guaranteed-optimal solver (try one local
// swap per collision, accept it if nothing resolves it cleanly), and only
// for THIS one handoff — every later bracket round is already generically
// snake-seeded off live results same as every other bracket type, so
// extending avoidance there would need bracket-phase-specific code, which
// this intentionally avoids (see "Avoid structure-specific special-casing").
// Called on `seeded` (the room-assigned output of snakeSeed for this
// transition, mutated and returned) rather than on the flat pre-seed
// `advancing` list — snakeSeed's bounce pattern (seed i paired against the
// room's other seeds via a fixed index formula) makes room membership only
// meaningful to check after seeding, not by assuming adjacency beforehand.
function avoidSameGroupInFirstBracketRound(seeded) {
  var groupOf = {};
  (T.groups || []).forEach(function (g) { g.members.forEach(function (m) { groupOf[m] = g.label; }); });

  var byRoom = {};
  seeded.forEach(function (entry, idx) {
    if (entry.room === null) return; // a bye recipient never shares a room with anyone
    (byRoom[entry.room] = byRoom[entry.room] || []).push(idx);
  });

  Object.keys(byRoom).forEach(function (rmKey) {
    var progress = true;
    while (progress) {
      progress = false;
      var indices = byRoom[rmKey];
      var seenGroups = {}, collisionIdx = -1;
      for (var i = 0; i < indices.length; i++) {
        var g = groupOf[seeded[indices[i]].name];
        if (g == null) continue;
        if (seenGroups[g]) { collisionIdx = indices[i]; break; }
        seenGroups[g] = true;
      }
      if (collisionIdx === -1) break; // this room is clean

      var thisRoomGroups = indices.map(function (i) { return groupOf[seeded[i].name]; });
      var movedGroup = groupOf[seeded[collisionIdx].name];
      for (var otherRoomKey in byRoom) {
        if (otherRoomKey === rmKey || progress) continue;
        var otherIndices = byRoom[otherRoomKey];
        var otherRoomGroups = otherIndices.map(function (i) { return groupOf[seeded[i].name]; });
        if (otherRoomGroups.indexOf(movedGroup) !== -1) continue; // moving would just create a new collision there
        for (var j = 0; j < otherIndices.length; j++) {
          var candidateIdx = otherIndices[j];
          var candidateGroup = groupOf[seeded[candidateIdx].name];
          if (candidateGroup == null || thisRoomGroups.indexOf(candidateGroup) !== -1) continue;
          // Swap the two entries' room assignments (identity/isLucky stay
          // with whoever they belong to — only .room moves).
          var tmp = seeded[collisionIdx].room;
          seeded[collisionIdx].room = seeded[candidateIdx].room;
          seeded[candidateIdx].room = tmp;
          byRoom[rmKey] = indices.map(function (i) { return i === collisionIdx ? candidateIdx : i; });
          byRoom[otherRoomKey] = otherIndices.map(function (i) { return i === candidateIdx ? collisionIdx : i; });
          progress = true;
          break;
        }
      }
      // No swap found this pass -> progress stays false, loop exits and the
      // residual collision is accepted, same fallback swissFoldPair uses.
    }
  });

  return seeded;
}

// "Fewest byes so far this pooling phase, tie-broken by seed" — see "Fair
// bye rotation during pooling phases" in HANDOFF.md. Used by advanceRound()'s
// self-correcting single-bye path (qual-table's and the no-elim warm-up
// phase's own internal rounds) — never called for a bracket-phase bye,
// which keeps the original "highest remaining seed" convention unchanged.
// `advancing` is already in seed order (best-to-worst finish) by the time
// this runs, so the first entry among those tied for fewest byes is the
// best-seeded one — no separate seed lookup needed.
function selectPoolingBye(advancing) {
  var minCount = Infinity;
  advancing.forEach(function (a) { var c = T.poolingByeCounts[a.name] || 0; if (c < minCount) minCount = c; });
  for (var i = 0; i < advancing.length; i++) {
    if ((T.poolingByeCounts[advancing[i].name] || 0) === minCount) return advancing[i];
  }
  return advancing[0]; // unreachable — advancing is never empty when this is called
}

// --- Round Rendering: advancing to the next round / resetting ---
// Dispatcher — shared plumbing (tie-break block, seeding, state advance) for
// every schedule logic; the "who actually advances" computation is delegated
// to the current schedule logic's own module (see SCHEDULE_LOGICS). Both
// registered schedule logics resolve to the same shared
// roomBasedComputeAdvancement() below (see "True single-elimination bracket
// phase" in HANDOFF.md for why this needed no schedule-logic-specific
// version — it was already generic, reading only round.isNoElim/advPerRoom/
// luckyCount/isQual, nothing schedule-logic-specific).
function advanceRound() {
  var ri = T.curRound, round = T.rounds[ri];
  var nextRound = T.rounds[ri + 1];
  if (!nextRound) return;
  if (hasPendingTies(ri, round)) { alert('Resolve all tie-breaks before advancing.'); return; }

  // Double-elimination's winners/losers routing is structurally different
  // from every other schedule logic (a round's outcome can feed two
  // different, non-adjacent rounds, not just nextRound) — dispatched here,
  // keyed on round.bracket (the round just finished), before any of the
  // generic nextRound-based logic below runs. See the topology comment
  // above doubleEliminationBracketPhase in HANDOFF.md.
  if (round.bracket) {
    advanceDoubleEliminationRound(ri, round);
    return;
  }

  var descriptor = getGamemodeDescriptor();
  var result = descriptor.schedule.computeAdvancement(ri, round, descriptor);
  var advancing = result.advancing;
  // luckyNames is null (not touched) for the qual-cut branch, same as the
  // original code never wrote T.luckyLosers[ri+1] on that path either — an
  // empty array from the direct-advance branch is still truthy, so it's
  // always recorded there, matching original behaviour exactly.
  if (result.luckyNames) T.luckyLosers[ri + 1] = result.luckyNames;

  // "Bye" odd-count strategy: whoever had a bye THIS round (T.byes[ri]) gets
  // a free pass into the next round, seeded as clean top-seed finishers
  // (a fairness convention, not a derived fact — see "Odd-count strategy
  // (Bye)" in HANDOFF.md). Applied uniformly here, after computeAdvancement()
  // returns, rather than inside roomBasedComputeAdvancement's own
  // branches, so a bye during the last qual round's own cutoff still carries
  // the byed unit(s) forward exactly the same way a room-based round's would.
  if (T.byes[ri] && T.byes[ri].length) {
    advancing = T.byes[ri].map(function (name) { return { name: name, isLucky: false }; }).concat(advancing);
  }

  // Dedupe by roster identity key (name — overloaded throughout this app to
  // mean a player name or a team's teamId, see rosterKeys()), not by
  // teaching the prepend above which branches need it. The prepend is
  // correct and necessary for a plain room-based round — a bye recipient
  // has no room result to rank by, so without it they'd be missing
  // entirely. It's wrong for the three cumulative-standings cutoff branches
  // (qual-table/Swiss/group-stage, see roomBasedComputeAdvancement /
  // computeGroupStageAdvancement): there, a bye recipient's *cumulative*
  // total from rounds actually played can already place them inside the
  // cutoff's own returned list, and the unconditional prepend above then
  // adds that same unit a second time — confirmed independently for all
  // three (see "Fix: bye recipient double-counted at a cumulative-standings
  // cutoff" in HANDOFF.md). A dedup here is robust to *why* the overlap
  // happened, not just these three known cases — a fourth pooling-phase
  // type added later is protected automatically, without needing to
  // remember to special-case it. Keeps the LAST occurrence of each name:
  // for a cutoff branch, that's computeAdvancement()'s own correctly-ranked
  // entry (the prepended duplicate, artificially shoved to the front, is
  // what gets dropped); for a plain room-based round, the prepend is the
  // only entry to begin with (a bye recipient's room:null means
  // computeAdvancement()'s per-room loop can never also produce them), so
  // this is a no-op there — verified directly, not just reasoned about.
  var seenNames = {}, deduped = [];
  for (var di = advancing.length - 1; di >= 0; di--) {
    if (!seenNames[advancing[di].name]) { seenNames[advancing[di].name] = true; deduped.unshift(advancing[di]); }
  }
  advancing = deduped;

  // If the pool now heading into the next round is odd, reserve one or more
  // byes — "highest-seeded" = first N in this list, per the same convention,
  // generalized from selecting one recipient to selecting several (see
  // "Concentrate single-elimination's byes" in HANDOFF.md). Two distinct
  // cases:
  //  - nextRound.bracketPhaseFirstRound: the pooling-phase-to-bracket-phase
  //    handoff for single-elimination — concentrate the FULL shortfall to
  //    the next power of 2 here, once. Re-derived from the actual live
  //    advancing pool, not the generation-time projection — same "live
  //    always wins" philosophy the ordinary self-correcting case below
  //    already uses, so a pooling-phase quirk that changed the live count
  //    from what was originally projected is still handled correctly.
  //  - otherwise: the original single-bye self-correcting fallback — every
  //    pooling-phase round (which never needs more than 1), and the rare
  //    mid-tournament-withdrawal case reintroducing oddness at some later
  //    bracket-phase round (single-elimination's concentration only ever
  //    fires once, at its own first round).
  // Every elimination round's own advancement target above is already
  // reduced by its own byeCount specifically so this shouldn't cascade all
  // the way to the Final under normal play (verified via testing) — but a
  // mid-tournament team removal permanently shrinks the live population in a
  // way the generation-time targets can't retroactively account for (the
  // same class of gap as the general "frozen room count" limitation this
  // whole app already has for live perturbations), and CAN reintroduce
  // oddness that keeps recurring every round after. A Final can never
  // structurally take a bye (no round after it to seed the bye recipient(s)
  // into, and it needs a genuine head-to-head match) — so if the pool
  // heading into the Final is ever unexpectedly odd, refuse to advance
  // outright rather than either silently seeding a malformed Final or
  // inventing a nonsensical "Final bye". This is a safety net for an
  // out-of-scope scenario (Bye mode has no removal-time guard the way
  // None mode's does), not a normal code path.
  var seeded;
  if (nextRound.isGroupStage) {
    // Group stage: the entire round-by-round pairing was already fixed at
    // generation time (see "Group stage" in HANDOFF.md) — unlike Swiss,
    // there's no live computation left to do here, just a lookup + the
    // same {name,room,isLucky} conversion Round 1 already used
    // (seedFromGroupStageRound, shared with proceedGenerateSchedule()).
    // advancing's own composition (from the generic room-based fallback
    // path above, since group-stage rounds are isNoElim:true) is
    // deliberately unused here — it's still computed for bookkeeping
    // consistency, same as numNextRooms already goes unused in the Swiss
    // branch above.
    seeded = seedFromGroupStageRound(nextRound);
    T.byes[ri + 1] = nextRound.groupByes.slice();
  } else if (nextRound.isSwiss) {
    // Live fold-pairing (see swissFoldPair / "Swiss pooling phase" in
    // HANDOFF.md) — a genuinely different seeding mechanism from the generic
    // snake-seed path below, since pairing depends on live cumulative
    // standings that don't exist until this exact moment (unlike every other
    // round transition, which can be meaningfully seeded off the room-based
    // finishing order alone). swissFoldPair resolves its own odd-count bye
    // internally (the median standings unit, not "highest seed" — see its
    // own comment), so the generic bye-peel block below doesn't apply to
    // this transition at all; it writes T.byes[ri+1] itself.
    var fp = swissFoldPair(advancing.map(function (a) { return a.name; }), ri);
    seeded = fp.seeded;
    T.byes[ri + 1] = fp.byeName ? [fp.byeName] : [];
  } else {
    var newByes = [];
    if (descriptor.config.oddCountStrategy === 'bye') {
      var byeNeeded = 0;
      if (nextRound.bracketPhaseFirstRound) {
        byeNeeded = nextPowerOf2AndRounds(advancing.length).bracketSize - advancing.length;
      } else if (advancing.length % descriptor.config.roomSize.ideal !== 0) {
        byeNeeded = 1;
      }
      if (byeNeeded > 0) {
        if (nextRound.isFinal) {
          alert('Can\'t advance to the Final — an odd number of teams (' + advancing.length + ') would be heading into it, which can\'t form a clean head-to-head match. This usually means a team was removed mid-tournament; check Manage Teams before advancing.');
          return;
        }
        // Pooling-phase transitions (nextRound.isNoElim — qual-table's and
        // the no-elim warm-up's own internal rounds) use fair rotation
        // instead of always the single best-remaining seed, so a
        // consistently-dominant unit doesn't ride a bye every round and
        // never accumulate a standing — see "Fair bye rotation during
        // pooling phases" in HANDOFF.md. bracketPhaseFirstRound's own
        // concentrated byeNeeded (potentially >1, checked above) and any
        // later bracket-phase self-correction both keep the original
        // "highest remaining seed" convention unchanged — nextRound.isNoElim
        // is always false for a bracket round, so this check alone is
        // sufficient to exclude both without an explicit extra condition.
        if (nextRound.isNoElim && byeNeeded === 1) {
          var chosen = selectPoolingBye(advancing);
          newByes = [chosen];
          advancing = advancing.filter(function (a) { return a !== chosen; });
          T.poolingByeCounts[chosen.name] = (T.poolingByeCounts[chosen.name] || 0) + 1;
        } else {
          newByes = advancing.slice(0, byeNeeded);
          advancing = advancing.slice(byeNeeded);
        }
      }
    }

    // Only the very first assignment (proceedGenerateSchedule's initial seed
    // into Round 1) is a random draw — every advancement past that, including
    // into Round 2, snake-seeds off the round just played so rooms stay as
    // evenly mixed by prior performance as possible going into eliminations.
    var numNextRooms = nextRound.rooms.length;
    seeded = snakeSeed(advancing, numNextRooms, descriptor.format);
    // Group-stage's own last round can only ever reach this generic branch
    // (its own internal rounds always take the nextRound.isGroupStage branch
    // above) — so round.isGroupStage here means exactly one thing: this is
    // the group-stage-cutoff -> bracket-phase-first-round handoff. See
    // avoidSameGroupInFirstBracketRound's own comment for why this is
    // scoped to only this one transition.
    if (round.isGroupStage) seeded = avoidSameGroupInFirstBracketRound(seeded);
    if (newByes.length) {
      T.byes[ri + 1] = newByes.map(function (b) { return b.name; });
      newByes.forEach(function (b) { seeded.push({ name: b.name, room: null, isLucky: false }); });
    }
  }

  T.curRound++;
  T.assignments[T.curRound] = seeded;
  renderAdminRound();
  markDirty();
  saveState();
}

// ═══════════════════════════════════════════════════════════════
// SWISS — live fold pairing
//  The genuinely new algorithm this build adds (everything else reuses the
//  existing qual-table/bye/tie-break machinery — see "Swiss pooling phase"
//  in HANDOFF.md). Scoped to head-to-head rooms only (roomSize.ideal === 2)
//  — fold pairing is inherently a pairwise concept (rank i vs rank i+half);
//  there's no meaningful N-way generalization of it, the same scoping
//  decision singleEliminationBracketPhase already made for its own room
//  shape. Asserts rather than silently misbehaving if some future caller
//  violates it.
// ═══════════════════════════════════════════════════════════════

// Generic room-based "who advances" computation: the qual-cutoff cut on the
// last qual round, or per-room direct-advancer + lucky-loser selection
// otherwise — exactly what advanceRound() always computed inline before the
// gamemode refactor, just extracted so a schedule logic built differently
// (e.g. Kings Valley's promote/demote) can supply its own version without
// touching advanceRound()'s shared plumbing above. Reused as-is by both
// registered schedule logics ('single-elimination', and 'double-
// elimination''s own pooling-phase rounds — every round.bracket-tagged WB/LB
// round is intercepted before this is ever reached, see SCHEDULE_LOGICS in
// js/bracket-phases.js).
// Returns { advancing: [{name, isLucky}], luckyNames: string[]|null }.
function roomBasedComputeAdvancement(ri, round, descriptor) {
  // "Last standings round" derived structurally (this round accumulates
  // standings, the next doesn't) rather than a hardcoded round index, so
  // qualRounds/swissRounds can change freely. Shared by Qualification Table
  // and Swiss — both cut the pooled field the same way, straight off
  // T.qualTable's cumulative standings (see isStandingsRound/updateQualTable
  // and "Swiss pooling phase" in HANDOFF.md).
  if (T.cfg.poolingPhase !== 'none' && isStandingsRound(round) &&
      !(T.rounds[ri + 1] && isStandingsRound(T.rounds[ri + 1]))) {
    updateQualTable();
    // hasPendingTies() above already guarantees any qual-cutoff tie is fully
    // resolved by this point — apply that resolved order before slicing.
    var qt = applyQualCutoffOrder(T.qualTable.filter(p => p.totalFP !== null));
    var advancing = qt.slice(0, T.cfg.qualAdv).map(p => ({ name: p.name, isLucky: false }));
    return { advancing: advancing, luckyNames: null };
  }

  // Group stage's own cutoff — a genuinely different computation from the
  // qual/Swiss cutoff above, not a gating extension of it: top
  // qualifiersPerGroup finishers from *each* group independently, then
  // re-ranked across groups by finish tier (see computeGroupStageAdvancement).
  if (round.isGroupStage && !(T.rounds[ri + 1] && T.rounds[ri + 1].isGroupStage)) {
    return computeGroupStageAdvancement();
  }

  // Collect direct advancers + lucky losers
  var direct = [], luckyPool = [];
  var asgn = T.assignments[ri] || [];

  for (var rm = 1; rm <= round.rooms.length; rm++) {
    var players = asgn.filter(a => a.room === rm);
    var thisAdv = round.isNoElim ? players.length : round.advPerRoom;
    var raw = players.map((p, pi) => ({ name: p.name, score: getUnitScore(T, ri, rm, pi, 0) }));
    // Tie-resolved order — any tie-break the organiser resolved for this
    // room already determines exact rank here, for both the direct-advance
    // cutoff and the lucky-loser candidate slot right below it, so no
    // separate single-slot substitution step is needed (that's what let a
    // tie-break winner also get double-counted as a lucky-loser candidate).
    var scored = orderRoomByScore(raw, ri, rm);

    for (var i = 0; i < Math.min(thisAdv, scored.length); i++) {
      direct.push({ name: scored[i].name, isLucky: false });
    }

    // Candidate for lucky loser: position advPerRoom+1
    if (!round.isNoElim && round.luckyCount > 0 && scored.length > round.advPerRoom) {
      var candidate = luckyLoserCandidate(scored, round.advPerRoom);
      if (candidate) luckyPool.push(candidate);
    }
  }

  // Select lucky losers
  var luckyNames = pickLuckyLosers(luckyPool, round.luckyCount);

  var advancing = direct.concat(luckyNames.map(n => ({ name: n, isLucky: true })));
  return { advancing: advancing, luckyNames: luckyNames };
}

// ═══════════════════════════════════════════════════════════════
// DOUBLE ELIMINATION — live advancement (see the topology comment above
// doubleEliminationBracketPhase for the winnersTo/losersTo routing design).
// ═══════════════════════════════════════════════════════════════

// Per-room winner/loser split for a double-elimination round — unlike every
// existing computeAdvancement (which only ever returns advancers), this
// surfaces BOTH explicitly, since a room's loser still needs routing (to the
// losers bracket, or nowhere) rather than being silently dropped. Uses the
// same tie-resolved orderRoomByScore() every other room-based computation
// uses, so a resolved tie-break here agrees with what elimination-detection
// (computeRankings' round.bracket branch) later reads back.
//
// Generalized (2026-09-08, "FFA/Team double-elimination generalization" in
// HANDOFF_LOG.md) from the original 1v1-only version, which hardcoded
// scored[0] as the sole winner and scored[1] as the sole loser per room,
// unconditionally — that assumption is baked into a strict head-to-head
// room (round.advPerRoom is always 1 there, luckyCount always 0). This
// version instead reads round.advPerRoom/round.luckyCount directly, mirroring
// roomBasedComputeAdvancement()'s own direct-advancer + cross-room
// lucky-loser split (js/advancement.js, same file) exactly, so both
// mechanisms agree on what "who advances" means. Confirmed byte-compatible
// with the old behavior when advPerRoom:1, luckyCount:0 (every registered
// double-elimination round for individual-1v1/team-3v3, unchanged) — that's
// what makes reusing this ONE function for both the old 1v1 doubleElimination
// BracketPhase and the new doubleEliminationSharedFinalBracketPhase safe.
function doubleEliminationComputeAdvancement(ri, round, descriptor) {
  var asgn = T.assignments[ri] || [];
  var direct = [], loserPool = [], luckyPool = [];
  for (var rm = 1; rm <= round.rooms.length; rm++) {
    var players = asgn.filter(function (a) { return a.room === rm; });
    var raw = players.map(function (p, pi) { return { name: p.name, score: getUnitScore(T, ri, rm, pi, 0) }; });
    var scored = orderRoomByScore(raw, ri, rm);
    var thisAdv = round.advPerRoom;
    for (var i = 0; i < Math.min(thisAdv, scored.length); i++) {
      direct.push({ name: scored[i].name });
    }
    // Everyone below the direct-advance cutoff is a loser candidate by
    // default — including the lucky-loser candidate slot itself (position
    // thisAdv): if they don't win the cross-room lucky-loser comparison
    // below, they're still a loser, dropping to the losers bracket like
    // anyone else who didn't advance.
    for (var j = thisAdv; j < scored.length; j++) {
      loserPool.push({ name: scored[j].name });
    }
    if (round.luckyCount > 0 && scored.length > thisAdv) {
      var candidate = luckyLoserCandidate(scored, thisAdv);
      if (candidate) luckyPool.push(candidate);
    }
  }
  var luckyNames = pickLuckyLosers(luckyPool, round.luckyCount);
  var luckyNameSet = {};
  luckyNames.forEach(function (n) { luckyNameSet[n] = true; });
  var winners = direct.concat(luckyNames.map(function (n) { return { name: n }; }));
  var losers = loserPool.filter(function (l) { return !luckyNameSet[l.name]; });
  // luckyNames returned (2026-09-08, Stage B4 rendering-verification pass) so
  // advanceDoubleEliminationRound() can record it into T.luckyLosers, same as
  // the generic path already does with roomBasedComputeAdvancement()'s own
  // luckyNames — see that function's write site for why this was missing
  // until now (harmless for the old 1v1 case, luckyCount always 0 there; a
  // real, visible gap for the FFA/team generalization, where it isn't).
  return { winners: winners, losers: losers, luckyNames: luckyNames };
}

// Materializes whatever's staged in T.pendingBracketSeeds[idx] into
// T.assignments[idx] — called the moment T.curRound actually reaches idx,
// by which point (per the load-bearing property in the topology comment
// above) every contribution that round needs has already arrived. Odd-pool
// self-correction here always uses "highest remaining seed(s)" (pool[0..]),
// the same convention singleEliminationBracketPhase's own later-round self-
// correction uses — the fair-rotation convention (selectPoolingBye) is
// pooling-phase-only (see "Fair bye rotation during pooling phases" in
// HANDOFF.md) and doesn't apply once inside the bracket phase.
//
// byeChosen is an ARRAY now (2026-09-08, "FFA/Team double-elimination
// generalization" in HANDOFF_LOG.md) — was a single unit or null/undefined
// when every round was strictly head-to-head (at most 1 leftover could ever
// need a bye). A room-based round (roomSize.ideal > 2) can leave more than
// one unit short of a clean room split, so the caller
// (advanceDoubleEliminationRound) now always passes an array, empty when no
// bye is needed. Byte-compatible with the old single-unit call sites: an
// empty array behaves exactly like the old falsy/null case below.
function finalizeDoubleEliminationRound(idx, byeChosen) {
  var targetRound = T.rounds[idx];
  var descriptor = getGamemodeDescriptor();
  var pool = (T.pendingBracketSeeds[idx] || []).slice();
  delete T.pendingBracketSeeds[idx];
  var byeNames = (byeChosen || []).map(function (u) { return u.name; });
  if (byeNames.length) pool = pool.filter(function (u) { return byeNames.indexOf(u.name) === -1; });
  T.assignments[idx] = snakeSeed(pool, targetRound.rooms.length, descriptor.format);
  if (byeNames.length) {
    T.byes[idx] = byeNames;
    byeNames.forEach(function (name) { T.assignments[idx].push({ name: name, room: null, isLucky: false }); });
  } else {
    T.byes[idx] = [];
  }
  // Grand final: stamp which of the two arriving finalists came from the
  // winners bracket, once, right here — the one place both finalists are
  // known and it's still unambiguous which side each came from. Stored on
  // the round object itself (not recomputed later from
  // doubleEliminationComputeAdvancement(), which only ever reads live T)
  // so computeGrandFinalRaceState() works identically for live T and an
  // archived snapshot — see "Grand-final race format" in HANDOFF.md.
  if (targetRound.bracket === 'grand-final') {
    for (var i = 0; i < T.rounds.length; i++) {
      if (T.rounds[i].bracket === 'winners' && T.rounds[i].winnersTo === idx) {
        var wbResult = doubleEliminationComputeAdvancement(i, T.rounds[i], descriptor);
        targetRound.wbFinalistName = wbResult.winners[0] && wbResult.winners[0].name;
        break;
      }
    }
  }
}

// The double-elimination counterpart to advanceRound()'s generic path —
// dispatched from advanceRound() itself, keyed on round.bracket (the round
// JUST FINISHED), not nextRound, since a round's winners and losers can head
// to two different, non-adjacent rounds rather than always "the next one" —
// see the topology comment above doubleEliminationBracketPhase.
function advanceDoubleEliminationRound(ri, round) {
  // The grand final (first match or reset) is never reachable via "Next
  // Round" — renderAdminRound()'s isLast computation hides that button for
  // any round.bracket==='grand-final' unconditionally (see Part 4 in
  // HANDOFF.md) — this is a defensive no-op, not a normal code path.
  if (round.bracket === 'grand-final') return;

  var descriptor = getGamemodeDescriptor();
  var roomSize = descriptor.config.roomSize;
  var result = doubleEliminationComputeAdvancement(ri, round, descriptor);

  // A bye recipient THIS round (room:null, never seen by the per-room loop
  // above) auto-advances exactly like a real winner — same "T.byes[ri]
  // prepend" convention the generic advanceRound() path already uses for
  // every other bracket type.
  if (T.byes[ri] && T.byes[ri].length) {
    result.winners = T.byes[ri].map(function (n) { return { name: n }; }).concat(result.winners);
  }

  var nextIdx = ri + 1;

  // Assemble (but don't yet commit) what each target's pool would look like
  // with this round's contribution added, so a failed validation below
  // leaves nothing to roll back — same "compute everything, validate, mutate
  // only on success" ordering the generic advanceRound() path already uses
  // for its own nextRound.isFinal odd-pool guard.
  var pendingWinners = (round.winnersTo !== null && round.winnersTo !== undefined)
    ? (T.pendingBracketSeeds[round.winnersTo] || []).concat(result.winners.map(function (w) { return { name: w.name, isLucky: false }; }))
    : null;
  var pendingLosers = (round.losersTo !== null && round.losersTo !== undefined)
    ? (T.pendingBracketSeeds[round.losersTo] || []).concat(result.losers.map(function (l) { return { name: l.name, isLucky: false }; }))
    : null;

  var poolAtNext = (T.pendingBracketSeeds[nextIdx] || []).slice();
  if (round.winnersTo === nextIdx) poolAtNext = pendingWinners;
  if (round.losersTo === nextIdx) poolAtNext = pendingLosers;

  // The Final round (the old grand-final's fixed 2, or the new shared
  // Final's fixed finalSize — both isFinal:true, checked generically via
  // T.rounds[nextIdx].players rather than a bracket==='grand-final'-specific
  // literal 2, 2026-09-08 "FFA/Team double-elimination generalization")
  // always needs EXACTLY as many entrants as it was generated to expect — a
  // bye there is meaningless (no round after it to carry a bye recipient
  // into; they'd just be a non-playing extra entrant). Under normal play
  // this is structurally guaranteed by construction (WB's own final round
  // and LB's own final round each contribute exactly the configured
  // wbQualifiers/lbQualifiers — or, for the old grand-final, exactly one
  // winner each). A live mid-tournament withdrawal can still break this,
  // though — found via direct testing during the original 1v1 build: a
  // single withdrawal early in the winners bracket can leave the losers
  // bracket's own arithmetic off by one several rounds later, since each
  // round's self-correction bye is a LOCAL, live decision rather than a
  // full re-plan of the remaining topology (a substantially bigger
  // undertaking than "the same rare-recovery bye mechanism" this build
  // reuses everywhere else — see "Double elimination" in HANDOFF.md).
  // Refuse loudly here rather than silently seed a malformed Final — same
  // philosophy as the existing nextRound.isFinal guard every other bracket
  // type already has.
  if (T.rounds[nextIdx].isFinal && poolAtNext.length !== T.rounds[nextIdx].players) {
    alert('Can\'t advance into the Final — ' + poolAtNext.length + ' entrants would arrive instead of the required ' + T.rounds[nextIdx].players + '. A mid-tournament withdrawal has likely thrown off the losers bracket\'s balance too deeply for the usual single-bye recovery to fix automatically; check Manage Teams, or add a replacement, before advancing further.');
    return;
  }

  // Odd-pool self-correction for an ORDINARY (non-Final) WB/LB round only —
  // the Final's own exact-count requirement was already checked above.
  // Only relevant for a STRICT room size (roomSize.min === roomSize.max,
  // e.g. the old 1v1/team-3v3's head-to-head shape, or team-3v3v3/
  // team-2v2v2v2/FFA under a strict-ideal odd-count strategy) — a FLEXIBLE
  // room size (roomSize.min < roomSize.max, FFA/2v2v2v2/3v3v3's normal
  // default shape) can already form a valid room split for essentially any
  // positive count via distributeRooms()'s own min/max window, exactly the
  // same reason distributeRoomsWithBye() itself never produces a bye for
  // those formats at generation time either (js/formats-and-primitives.js).
  // byeChosen is now an ARRAY (see finalizeDoubleEliminationRound()'s own
  // comment) — a room-based strict shape (roomSize.ideal > 2) can leave
  // more than one unit short of a clean split, unlike the old head-to-head-
  // only case where at most 1 ever could.
  var byeChosen = [];
  if (roomSize.min === roomSize.max) {
    var byeNeeded = poolAtNext.length % roomSize.ideal;
    if (byeNeeded > 0) {
      if (descriptor.config.oddCountStrategy !== 'bye') {
        alert('Can\'t advance — ' + poolAtNext.length + ' units would be heading into the next round, which can\'t form a clean room split (needs a multiple of ' + roomSize.ideal + '). This usually means a team was removed mid-tournament; check Manage Teams before advancing.');
        return;
      }
      byeChosen = poolAtNext.slice(0, byeNeeded);
    }
  }

  // Validated — safe to commit.
  if (round.winnersTo !== null && round.winnersTo !== undefined) T.pendingBracketSeeds[round.winnersTo] = pendingWinners;
  if (round.losersTo !== null && round.losersTo !== undefined) T.pendingBracketSeeds[round.losersTo] = pendingLosers;

  // Record which units arrived at winnersTo via the cross-room lucky-loser
  // comparison — mirrors the generic advanceRound() path's own
  // "T.luckyLosers[ri+1] = result.luckyNames" (this file, above), just keyed
  // by the round's actual winnersTo destination rather than ri+1, since a
  // WB/LB round's winners don't always land on the very next array index
  // (an interposed round from the other bracket can sit between them — see
  // the topology comment above doubleEliminationBracketPhase). Concatenated,
  // not overwritten: winnersTo can be the shared Final for BOTH the winners'
  // bracket's own last round AND the losers' bracket's own last round (the
  // FFA/Team merged-Final topology), so a second contribution must add to
  // the first, never replace it. losersTo needs no equivalent write — the
  // lucky-loser mechanism only ever decides who escapes UP into winners;
  // nobody "lucks" their way into the losers bracket. Found and fixed
  // 2026-09-08 during Stage B4's rendering-verification pass — without this,
  // Bracket/Admin's ★ marker never appeared for a WB/LB lucky-loser winner,
  // and worse, they'd render with the 'elim' (grey/struck-through) style on
  // their own round's card despite having actually advanced.
  if (round.winnersTo !== null && round.winnersTo !== undefined && result.luckyNames && result.luckyNames.length) {
    T.luckyLosers[round.winnersTo] = (T.luckyLosers[round.winnersTo] || []).concat(result.luckyNames);
  }

  T.curRound = nextIdx;
  finalizeDoubleEliminationRound(nextIdx, byeChosen);
  renderAdminRound();
  markDirty();
  saveState();
}

// Double-elimination's grand final is a continuous games-until-someone-wins
// race, not a fixed-numGames/cumulative-score match (see "Grand-final race
// format" in HANDOFF.md — this replaced the original classic single-reset
// mechanism, which inserted a whole second Final-shaped round if the
// losers'-bracket finalist won the first match). Pure function of state —
// works for live T or an archived snapshot alike, since round.wbFinalistName
// is stamped once at materialization time (see finalizeDoubleEliminationRound)
// rather than re-derived from doubleEliminationComputeAdvancement() (which
// only ever reads live T).
//
// Targets are per-finalist and independently configurable (T.gamemodeConfig.
// grandFinalWbTarget/.grandFinalLbTarget, organiser-set, symmetric values
// allowed — no structural advantage is enforced in code). A tied individual
// game counts toward neither side's total; the race simply continues.
// Iterates only games already "opened" for entry (round.numGames, grown live
// by checkGrandFinalRace() below) — not open-ended, so this always
// terminates.
function computeGrandFinalRaceState(state, ri, round) {
  var asgn = state.assignments[ri] || [];
  if (asgn.length !== 2 || round.wbFinalistName == null) return null;
  var wbName = round.wbFinalistName;
  var lbName = asgn[0].name === wbName ? asgn[1].name : asgn[0].name;
  var wbTarget = (state.gamemodeConfig && state.gamemodeConfig.grandFinalWbTarget) || 2;
  var lbTarget = (state.gamemodeConfig && state.gamemodeConfig.grandFinalLbTarget) || 3;
  var wbWins = 0, lbWins = 0, gamesPlayed = 0, winnerName = null;
  for (var g = 1; g <= round.numGames; g++) {
    var sWb = getFinalUnitScore(state, wbName, g, null);
    var sLb = getFinalUnitScore(state, lbName, g, null);
    if (sWb === null || sLb === null) break;
    gamesPlayed = g;
    if (sWb > sLb) wbWins++;
    else if (sLb > sWb) lbWins++;
    // else: tied game, counts as played but advances neither total
    if (wbWins >= wbTarget) { winnerName = wbName; break; }
    if (lbWins >= lbTarget) { winnerName = lbName; break; }
  }
  return { wbName: wbName, lbName: lbName, wbWins: wbWins, lbWins: lbWins,
    wbTarget: wbTarget, lbTarget: lbTarget, gamesPlayed: gamesPlayed,
    decided: winnerName !== null, winnerName: winnerName };
}

// Called from finalScoreChanged() (live only) after every grand-final score
// entry, in place of checkAutoArchive() while the race is undecided — same
// calling contract the old checkGrandFinalReset() had: returns true to mean
// "still in progress, skip checkAutoArchive() this call", false to mean "not
// a grand-final round, or the race just concluded — let checkAutoArchive()
// run normally." Its only side effect is opening the next game for entry
// (round.numGames++) once every currently-open game is fully scored and
// nobody has reached their target yet.
function checkGrandFinalRace() {
  var ri = T.curRound, round = T.rounds[ri];
  if (!round || round.bracket !== 'grand-final') return false;
  var race = computeGrandFinalRaceState(T, ri, round);
  if (!race || race.decided) return false;
  if (race.gamesPlayed === round.numGames) {
    round.numGames++;
    renderAdminRound();
  }
  return true;
}

// Per-round Finals progress, for Bracket's compact history+next-game display
// (js/render-viewer.js's buildFinalColumnHtml()). Neither existing helper
// gives this: computeRankings() only exposes a whole-tournament boolean
// (finalComplete), and computeGrandFinalRaceState() only covers the
// grand-final case. Pure function of state — safe against live T or an
// archived snapshot, no DOM.
//
// "complete" for a grand final comes from race.decided, NEVER from "every
// opened game is scored" — those differ (an opened, fully-scored game with
// nobody at target means the race continues and numGames grows next). For a
// plain multi-game Final, "complete" means every finalist scored in every
// game, matching computeRankings()'s own rule for that case.
function finalsProgressState(state, ri, round) {
  var asgn = state.assignments[ri] || [];
  var teamSize = getGamemodeDescriptorFor(state).format.teamSize;
  var race = round.bracket === 'grand-final' ? computeGrandFinalRaceState(state, ri, round) : null;

  var units = asgn.map(function (p) {
    var perGame = [];
    for (var g = 1; g <= round.numGames; g++) perGame.push(getFinalUnitScore(state, p.name, g, null));
    var total = 0;
    for (var g2 = 1; g2 <= round.numGames; g2++) total += getFinalUnitScore(state, p.name, g2, 0);
    var wins = 0;
    if (race) {
      for (var g3 = 1; g3 <= race.gamesPlayed; g3++) {
        var mine = getFinalUnitScore(state, p.name, g3, null);
        var otherName = p.name === race.wbName ? race.lbName : race.wbName;
        var other = getFinalUnitScore(state, otherName, g3, null);
        if (mine !== null && other !== null && mine > other) wins++;
      }
    }
    return { name: p.name, perGame: perGame, total: total, wins: wins };
  });

  var gameComplete = [];
  for (var g4 = 1; g4 <= round.numGames; g4++) {
    gameComplete.push(asgn.length > 0 && asgn.every(function (p) { return getFinalUnitScore(state, p.name, g4, null) !== null; }));
  }
  var complete = race ? !!race.decided : (asgn.length > 0 && gameComplete.length > 0 && gameComplete.every(Boolean));
  var nextGame = null;
  if (!complete) {
    for (var g5 = 0; g5 < gameComplete.length; g5++) { if (!gameComplete[g5]) { nextGame = g5 + 1; break; } }
  }

  var order;
  if (complete && race) {
    var loserName = race.winnerName === race.wbName ? race.lbName : race.wbName;
    order = [race.winnerName, loserName]; // NEVER a win-count sort — see computeRankings()'s
                                            // own comment: asymmetric targets mean the winner's
                                            // raw win count can legitimately be lower.
  } else if (complete) {
    order = units.slice().sort(function (a, b) { return b.total - a.total; }).map(function (u) { return u.name; });
  } else {
    order = asgn.map(function (p) { return p.name; });
  }

  return { isGrandFinal: !!race, numGames: round.numGames, units: units, gameComplete: gameComplete,
    nextGame: nextGame, complete: complete, order: order, race: race };
}

// ═══════════════════════════════════════════════════════════════
// PLAYERS & RANKINGS — Rankings. computeRankings/buildRankingsRows below
//  are SHARED pure builders (also used by Archive's read-only detail
//  view); renderRankings() near the bottom of this block is the
//  live-only DOM-writing wrapper.
//  Finalists: ranked by cumulative Final score, but only once every
//  finalist has a score for every Final game — until then they show
//  as "still in tournament" like anyone else mid-round.
//  Everyone else: ranked by the round they were eliminated in (later
//  round = better), then by relative score (their score ÷ their
//  room's total score that round) as the sole tiebreaker within the
//  same elimination round. "Eliminated" here just means present in a
//  round's assignment but absent from the next one — that covers
//  normal cutoffs, lucky-loser misses, tie-break losses, and the
//  qualification-table cut uniformly, without re-deriving each
//  round's advancement logic separately.
// ═══════════════════════════════════════════════════════════════
// Index of the last round that currently has any assignment at all — the
// single shared definition of "what counts as still active vs. eliminated"
// (computeRankings() is now its only caller — the Players tab, which used
// to call this directly too, was retired 2026-09-08 and folded into
// Rankings). A unit's *latest* appearance
// being in this round means they're still in progress, regardless of
// whether their room happens to be fully scored yet; only a unit whose
// latest appearance is in an *earlier* round, with this round's assignment
// existing and not including them, is actually eliminated.
function lastAssignedRound(state) {
  var lastRi = -1;
  for (var i = 0; i < state.assignments.length; i++) if (state.assignments[i] && state.assignments[i].length) lastRi = i;
  return lastRi;
}

function computeRankings(state) {
  state = state || T;
  if (!state.rounds.length || !state.assignments.length) return null;

  var lastRi = lastAssignedRound(state);
  if (lastRi === -1) return null;

  var eliminatedInfo = {}; // key -> { ri, round, pct }
  for (var ri = 0; ri < lastRi; ri++) {
    var round = state.rounds[ri];
    if (round.isFinal) continue;
    var asgn = state.assignments[ri] || [];
    var byRoom = {};
    asgn.forEach(p => { (byRoom[p.room] = byRoom[p.room] || []).push(p); });

    if (round.bracket) {
      // Double-elimination (see "Double elimination" Part 3 in HANDOFF.md):
      // "absent from ri+1" isn't meaningful here — a round's winners and
      // losers can head to two different, non-adjacent rounds. Per
      // participant: check presence in whichever target their OWN room
      // result actually routes them to (winnersTo if they won their room,
      // losersTo if they lost it) — the same orderRoomByScore() winner/loser
      // split doubleEliminationComputeAdvancement() itself uses, so this
      // never disagrees with what live advancement actually did. A null
      // target (every losers-bracket round's own losersTo) means "nowhere"
      // — genuinely eliminated, falling out for free from the same
      // "not found in the target set" check every other round type uses.
      var winnersToNames = round.winnersTo !== null && round.winnersTo !== undefined
        ? new Set((state.assignments[round.winnersTo] || []).map(p => p.name)) : null;
      var losersToNames = round.losersTo !== null && round.losersTo !== undefined
        ? new Set((state.assignments[round.losersTo] || []).map(p => p.name)) : null;
      Object.keys(byRoom).forEach(rm => {
        var raw = byRoom[rm].map((p, pi) => ({ name: p.name, score: getUnitScore(state, ri, rm, pi, 0) }));
        var scored = orderRoomByScore(raw, ri, rm, state);
        var roomTotal = scored.reduce((sum, p) => sum + p.score, 0);
        // Membership check, NOT position (pi===0) — a room-based double-
        // elimination round (2026-09-08 "FFA/Team double-elimination
        // generalization") can have several direct-advancing winners AND a
        // lucky-loser winner who sits well below position 0, so "did this
        // unit actually end up in winnersTo" is the only correct test.
        // Identical result to the old positional check for the original
        // 1v1 shape (where position 0 alone was ever a winner), so this is
        // a strict generalization, not a behavior change for that case.
        scored.forEach(p => {
          var inWinners = winnersToNames && winnersToNames.has(p.name);
          var inLosers = losersToNames && losersToNames.has(p.name);
          if (!inWinners && !inLosers) {
            eliminatedInfo[p.name] = { ri, round, pct: roomTotal > 0 ? p.score / roomTotal : 0 };
          }
        });
      });
    } else {
      var nextNames = new Set((state.assignments[ri + 1] || []).map(p => p.name));
      Object.keys(byRoom).forEach(rm => {
        var roomPlayers = byRoom[rm];
        var scored = roomPlayers.map((p, pi) => ({ name: p.name, score: getUnitScore(state, ri, rm, pi, 0) }));
        var roomTotal = scored.reduce((sum, p) => sum + p.score, 0);
        scored.forEach(p => {
          if (!nextNames.has(p.name)) {
            eliminatedInfo[p.name] = { ri, round, pct: roomTotal > 0 ? p.score / roomTotal : 0 };
          }
        });
      });
    }
  }

  var lastRound = state.rounds[lastRi];
  var lastAsgn = state.assignments[lastRi] || [];
  var stillActive = [], finalists = [], finalComplete = false;

  // A double-elimination grand final is a games-until-someone-wins race
  // (see computeGrandFinalRaceState / "Grand-final race format" in
  // HANDOFF.md), not the fixed-numGames/cumulative-score match every other
  // Final uses — genuinely different completion and ranking rules, so it's
  // its own branch rather than a variant of the generic one below.
  if (lastRound.isFinal && lastRound.bracket === 'grand-final') {
    var race = computeGrandFinalRaceState(state, lastRi, lastRound);
    finalComplete = !!(race && race.decided);
    if (finalComplete) {
      var loserName = race.winnerName === race.wbName ? race.lbName : race.wbName;
      var winnerWins = race.winnerName === race.wbName ? race.wbWins : race.lbWins;
      var loserWins = race.winnerName === race.wbName ? race.lbWins : race.wbWins;
      // Ranked explicitly (winner first) rather than via the generic
      // total-comparison sort below — with asymmetric targets, the winner's
      // own raw win count can legitimately be LOWER than the loser's (e.g. a
      // 2-target WB finalist clinching 2-4 against a 5-target LB finalist),
      // so sorting by total would rank the wrong side first.
      finalists = [{ name: race.winnerName, total: winnerWins }, { name: loserName, total: loserWins }];
    } else {
      lastAsgn.forEach(p => stillActive.push(p));
    }
  } else if (lastRound.isFinal) {
    var ng = lastRound.numGames;
    finalComplete = lastAsgn.length > 0 && lastAsgn.every(p => {
      for (var g = 1; g <= ng; g++) if (getFinalUnitScore(state, p.name, g, null) === null) return false;
      return true;
    });
    if (finalComplete) {
      finalists = lastAsgn.map(p => {
        var total = 0;
        for (var g = 1; g <= ng; g++) total += getFinalUnitScore(state, p.name, g, 0);
        return { name: p.name, total };
      }).sort((a, b) => b.total - a.total);
    } else {
      lastAsgn.forEach(p => stillActive.push(p));
    }
  } else {
    lastAsgn.forEach(p => stillActive.push(p));
  }

  // stillActive now holds the raw assignment entries (name/room/isLucky),
  // not bare names — see stillActiveOut below, which attaches them to the
  // returned entries so a viewer tab can show "which room am I in right
  // now" (folded in from the retired Players tab, 2026-09-08). The set used
  // for elimination-exclusion below must stay name-keyed regardless.
  var stillActiveSet = new Set(stillActive.map(p => p.name));
  var finalistSet = new Set(finalists.map(f => f.name));

  // Ranks by roster identity key — a team's teamId for team formats, a
  // player's name otherwise (see rosterKeys()).
  var eliminatedList = [];
  rosterKeys(state.players).forEach(key => {
    if (stillActiveSet.has(key) || finalistSet.has(key)) return;
    var info = eliminatedInfo[key];
    if (info) eliminatedList.push({ name: key, ri: info.ri, round: info.round, pct: info.pct });
  });
  eliminatedList.sort((a, b) => b.ri - a.ri || b.pct - a.pct);

  var offset = finalComplete ? finalists.length : 0;
  var rank = 0, prevKey = null;
  eliminatedList.forEach((e, idx) => {
    var key = e.ri + '|' + e.pct.toFixed(9);
    if (key !== prevKey) { rank = idx + 1 + offset; prevKey = key; }
    e.rank = rank;
  });

  if (finalComplete && lastRound.bracket === 'grand-final') {
    // Winner/loser order is already exactly right (see above) — a decided
    // race can never end in a genuine tie between the two finalists, so the
    // generic total-comparison tie logic below doesn't apply here.
    finalists[0].rank = 1;
    finalists[1].rank = 2;
  } else if (finalComplete) {
    var frank = 0, fprev = null;
    finalists.forEach((f, idx) => {
      if (f.total !== fprev) { frank = idx + 1; fprev = f.total; }
      f.rank = frank;
    });
  }

  // Live pooling-phase rank (Qual Table / Swiss's flat table, or Group
  // Stage's per-group table) for each still-active unit — folded in from
  // the retired Players tab (2026-09-08, see "Merge Players tab into
  // Rankings" in HANDOFF_LOG.md). Generalized from state.T-only to
  // state.cfg/.qualTable/.groupStandings, with defensive guards Players
  // itself never needed (it only ever ran against live T) — computeRankings()
  // is also called against arbitrary Archive snapshots, including ones
  // saved before these fields existed at all (same "may be missing"
  // precedent already established at js/archive.js's own snapshot handling).
  var poolRankMap = {};
  if (state.cfg && state.cfg.poolingPhase === 'group-stage') {
    Object.keys(state.groupStandings || {}).forEach(label => {
      (state.groupStandings[label] || []).forEach((p, i) => {
        poolRankMap[p.name] = { rank: i + 1, fp: p.totalFP, groupLabel: label };
      });
    });
  } else if (state.cfg && state.cfg.poolingPhase && state.cfg.poolingPhase !== 'none') {
    (state.qualTable || []).forEach((p, i) => { poolRankMap[p.name] = { rank: i + 1, fp: p.totalFP }; });
  }

  // Attach display label/members (resolved fresh from state.players, so a
  // renamed team shows its current name/roster) — done here, once, so
  // downstream pure consumers (buildRankingsRows, the rankings image
  // export) never need to re-derive it or take a separate state parameter.
  function withLabel(entry) {
    var info = unitDisplay(state, entry.name);
    entry.label = info.label; entry.members = info.members;
    return entry;
  }
  // room/isLucky/poolRank are new (2026-09-08, Players-tab fold-in) — a
  // still-active unit's current room ("Room B", or null for a bye) and live
  // pooling rank, the two pieces of information the Players tab used to be
  // the only viewer-facing surface for. finalists/eliminatedList entries
  // never get these three fields (undefined on those), same as before.
  var stillActiveOut = stillActive.map(p => withLabel({
    name: p.name, room: p.room, isLucky: p.isLucky || false, poolRank: poolRankMap[p.name] || null
  })).sort((a, b) => a.label.localeCompare(b.label));
  finalists.forEach(withLabel);
  eliminatedList.forEach(withLabel);

  // lastRound/lastRi exposed once, at the top level, rather than per
  // stillActive entry — every still-active unit is, by construction, from
  // this exact same round (lastAsgn = state.assignments[lastRi]), so a
  // single shared reference is correct and avoids a redundant per-entry copy.
  return { stillActive: stillActiveOut, finalComplete, finalists, eliminatedList, lastRound, lastRi };
}
