// pooling-phases.js — every POOLING_PHASES implementation (qual-table, Swiss,
// group stage, no-elim warm-up) and their own private helpers.

function computeSwissRoundCount(n) {
  var ideal = n > 1 ? Math.ceil(Math.log2(n)) : 1;
  return Math.max(MIN_SWISS_ROUNDS, Math.min(ideal, MAX_SWISS_ROUNDS));
}

// A round belongs to the shared cumulative-standings mechanism (qual-table
// or Swiss) if either flag is set — kept as two distinct flags rather than
// one (UI copy needs to say "Swiss" vs "Qualification Table" even though the
// underlying accumulation/tie-break/cutoff machinery is identical), but
// every place that only cares "is this a standings-accumulating round"
// checks this instead of repeating `r.isQual || r.isSwiss` everywhere — see
// "Swiss pooling phase" in HANDOFF.md.
function isStandingsRound(round) { return !!(round.isQual || round.isSwiss); }

// Group stage is deliberately NOT folded into isStandingsRound() above —
// per "Group stage" in HANDOFF.md, its standings/tie-break machinery is
// genuinely new surface area (K separate per-group tables, K independent
// cutoff lines), not a gating extension of the qual/Swiss single-table
// mechanism, so treating it as a third case of the same predicate would
// misrepresent that. A plain round.isGroupStage check is used directly
// wherever needed instead.
function isGroupStageRound(round) { return !!round.isGroupStage; }

var GROUP_SIZE_BOUNDS = { min: 3, max: 5, ideal: IDEAL_GROUP_SIZE };

// Pools the field through qualRounds rounds of pooled play, then cuts to
// cfg.qualAdv — the qual-table pooling strategy.
function qualTablePoolingPhase(cfg, descriptor) {
  var roomSize = descriptor.config.roomSize;
  var qualRounds = descriptor.config.qualRounds;
  var oddCountStrategy = descriptor.config.oddCountStrategy;
  var total = cfg.n;
  var rounds = [], rn = 1;
  for (var q = 0; q < qualRounds; q++) {
    var qd = distributeRoomsWithBye(total, roomSize, oddCountStrategy);
    rounds.push({ roundNum: rn++, players: total, rooms: qd.rooms, byeCount: qd.byeCount,
      isQual:true, isNoElim:true, isSemis:false, isFinal:false,
      advPerRoom:null, advTotal:total, luckyCount:0 });
  }
  return { rounds: rounds, seedTotal: cfg.qualAdv, nextRoundNum: rn };
}

// Pools the field through swissRounds rounds of live fold-paired play, then
// cuts to cfg.qualAdv — the Swiss pooling strategy. Round 1 has no standings
// to pair by yet, so its room composition here is a genuine projection,
// identical in mechanism to qualTablePoolingPhase's own round 1 (random
// pairing via distributeRoomsWithBye). Every round after that depends on
// live results that don't exist at generation time — the room *count* here
// is still a reasonable projection (same distributeRoomsWithBye math, on the
// still-total field), but which units land in which room is not, so those
// rounds are marked pairingTBD:true — the actual pairing is computed live in
// advanceRound() (see swissFoldPair) when that round is actually reached.
function swissPoolingPhase(cfg, descriptor) {
  var roomSize = descriptor.config.roomSize;
  var oddCountStrategy = descriptor.config.oddCountStrategy;
  var swissRounds = descriptor.config.swissRounds;
  var total = cfg.n;
  var rounds = [], rn = 1;
  for (var s = 0; s < swissRounds; s++) {
    var sd = distributeRoomsWithBye(total, roomSize, oddCountStrategy);
    rounds.push({ roundNum: rn++, players: total, rooms: sd.rooms, byeCount: sd.byeCount,
      isQual:false, isNoElim:true, isSemis:false, isFinal:false, isSwiss:true,
      pairingTBD: s > 0 ? true : undefined,
      advPerRoom:null, advTotal:total, luckyCount:0 });
  }
  return { rounds: rounds, seedTotal: cfg.qualAdv, nextRoundNum: rn };
}

// ═══════════════════════════════════════════════════════════════
// GROUP STAGE — round-robin (circle method), seeded group formation
//  See "Group stage" in HANDOFF.md for the full design writeup. Genuinely
//  new mechanism, not a reuse/gating tweak — the three helpers below are
//  pure and format-agnostic, deliberately kept separate from
//  groupStagePoolingPhase() itself so they're independently testable
//  (see the circle-method correctness testing this build's own prompt
//  calls for).
// ═══════════════════════════════════════════════════════════════

// Standard circle-method round-robin schedule for an abstract group of `g`
// positions (0-indexed) — no unit names involved, buildRoundRobinRounds()
// maps positions to actual roster keys. Even g: position 0 stays fixed,
// the rest rotate around it, for g-1 rounds — every pair meets exactly
// once. Odd g: a phantom position (index g) is folded in, making it g+1
// (even) positions internally, producing g rounds — whichever real
// position is paired with the phantom that round is that round's bye.
// Returns { numRounds, phantomPosition (null if g is even), rounds:
// [[ [posA,posB], ... ], ...] }.
function circleMethodSchedule(g) {
  var isOdd = g % 2 !== 0;
  var n = isOdd ? g + 1 : g; // total positions, always even
  var numRounds = n - 1;
  var positions = [];
  for (var i = 0; i < n; i++) positions.push(i);
  var rounds = [];
  for (var r = 0; r < numRounds; r++) {
    var pairs = [];
    for (var i = 0; i < n / 2; i++) pairs.push([positions[i], positions[n - 1 - i]]);
    rounds.push(pairs);
    // Rotate: position 0 stays fixed; the last position moves to index 1;
    // everything else shifts up by one. Standard circle-method rotation.
    var fixed = positions[0], last = positions[n - 1], rest = positions.slice(1, n - 1);
    positions = [fixed, last].concat(rest);
  }
  return { numRounds: numRounds, phantomPosition: isOdd ? g : null, rounds: rounds };
}

// Distributes seed-sorted units into groups matching groupSizes exactly
// (from distributeRooms), via the same snake/interleave pattern already
// used for balanced room distribution elsewhere (1->A,2->B,3->C..., then
// reverse), so groups are seeded as evenly as possible rather than
// stacking strength unevenly. A small new function, not a direct reuse of
// an existing one: snakeSeed(players, numRooms) bounces freely across
// numRooms with no per-room capacity, so it can't be trusted to reproduce
// an arbitrary distributeRooms sizing exactly; randomSeed(players, rooms)
// *does* respect an exact per-room size array, but shuffles randomly
// rather than snaking an already-seeded order. This does both at once —
// exact capacities, seeded snake order — by bouncing the same way
// snakeSeed does but skipping any group that's already reached its
// assigned size.
function assignGroupMembers(sortedUnits, groupSizes) {
  var groups = groupSizes.map(function (size, i) { return { label: String.fromCharCode(65 + i), members: [] }; });
  var dir = 1, gi = 0, ui = 0;
  while (ui < sortedUnits.length) {
    if (groups[gi].members.length < groupSizes[gi]) groups[gi].members.push(sortedUnits[ui++]);
    gi += dir;
    if (gi >= groups.length) { gi = groups.length - 1; dir = -1; }
    else if (gi < 0) { gi = 0; dir = 1; }
  }
  return groups;
}

// Builds the full set of group-stage rounds up front — this pooling phase
// is a COMPLETE generation-time projection, unlike Swiss, since group
// membership and the round-robin schedule are both fully deterministic
// once group size and single/double are fixed. Handles two things the raw
// per-group circleMethodSchedule() output alone doesn't: mapping abstract
// positions to actual roster keys, and reconciling groups whose own
// round-robin naturally finishes before others' — GROUP_SIZE_BOUNDS
// allows a mix of sizes (e.g. a 5 alongside 4s), and a group of 5 needs 5
// rounds where a group of 4 only needs 3. A group with no round of its own
// at index ri has already played every pairing it needs to — its entire
// membership sits out for that round (a multi-recipient bye, reusing the
// exact same array-based T.byes mechanism every other bye source already
// populates, just applied to a whole group at once) rather than being left
// with nothing scheduled. Returns one entry per round: { matches:
// [{group,pair:[keyA,keyB]}, ...], byes: [key, ...] }.
function buildRoundRobinRounds(groups, roundRobinMode) {
  var isDouble = roundRobinMode === 'double';
  var perGroupSchedules = groups.map(function (g) {
    var sched = circleMethodSchedule(g.members.length);
    var allRounds = isDouble ? sched.rounds.concat(sched.rounds) : sched.rounds;
    return { group: g, phantomPosition: sched.phantomPosition, rounds: allRounds };
  });
  var maxRounds = perGroupSchedules.reduce(function (m, s) { return Math.max(m, s.rounds.length); }, 0);

  var out = [];
  for (var ri = 0; ri < maxRounds; ri++) {
    var matches = [], byes = [];
    perGroupSchedules.forEach(function (s) {
      var g = s.group;
      if (ri >= s.rounds.length) { byes = byes.concat(g.members); return; }
      s.rounds[ri].forEach(function (pair) {
        var a = pair[0], b = pair[1];
        if (a === s.phantomPosition) { byes.push(g.members[b]); return; }
        if (b === s.phantomPosition) { byes.push(g.members[a]); return; }
        matches.push({ group: g.label, pair: [g.members[a], g.members[b]] });
      });
    });
    out.push({ matches: matches, byes: byes });
  }
  return out;
}

// Small, fixed-membership groups — a fixed number of top finishers *per
// group* (not one global cutoff) advance to the bracket phase. Registered
// as POOLING_PHASES['group-stage'].
function groupStagePoolingPhase(cfg, descriptor) {
  var groupSizeConfig = { min: GROUP_SIZE_BOUNDS.min, max: GROUP_SIZE_BOUNDS.max, ideal: cfg.groupSize };
  var groupSizes = distributeRooms(cfg.n, groupSizeConfig);
  // No prior ranking exists yet (group stage, like every other pooling
  // phase, is always the first phase played) — registration order, same
  // convention every other phase's own round-1 seeding already uses.
  var sortedUnits = rosterKeys(T.players);
  var groups = assignGroupMembers(sortedUnits, groupSizes);
  T.groups = groups;

  var roundRobinRounds = buildRoundRobinRounds(groups, cfg.roundRobinMode);
  var rounds = [], rn = 1;
  roundRobinRounds.forEach(function (rr) {
    var rooms = rr.matches.map(function () { return 2; });
    var roomGroups = rr.matches.map(function (m) { return m.group; });
    rounds.push({ roundNum: rn++, players: cfg.n, rooms: rooms, roomGroups: roomGroups,
      byeCount: rr.byes.length, matches: rr.matches, groupByes: rr.byes,
      isQual:false, isNoElim:true, isSemis:false, isFinal:false, isGroupStage:true,
      advPerRoom:null, advTotal:cfg.n, luckyCount:0 });
  });
  return { rounds: rounds, seedTotal: groups.length * cfg.qualifiersPerGroup, nextRoundNum: rn };
}

// Converts a group-stage round's precomputed matches/byes into the
// {name, room, isLucky} shape every other round's T.assignments entry
// already uses — room numbering is 1..matches.length in the round's own
// matches order, exactly matching round.rooms/roomGroups, so every
// existing room-by-room renderer needs no changes to understand a
// group-stage round. Shared by Round 1's generation-time seeding
// (proceedGenerateSchedule()) and advanceRound()'s live seeding step for
// every later group-stage round — both need the identical conversion,
// since the pairing itself is already fully determined at generation time
// either way; there's no live computation left to do for group stage
// specifically (unlike Swiss).
function seedFromGroupStageRound(round) {
  var seeded = [];
  round.matches.forEach(function (m, i) {
    seeded.push({ name: m.pair[0], room: i + 1, isLucky: false });
    seeded.push({ name: m.pair[1], room: i + 1, isLucky: false });
  });
  round.groupByes.forEach(function (name) { seeded.push({ name: name, room: null, isLucky: false }); });
  return seeded;
}

// No pooling — just the fixed 2-round no-elim warm-up every player advances
// through untouched, unchanged count going into the bracket phase.
function noElimWarmupPoolingPhase(cfg, descriptor) {
  var roomSize = descriptor.config.roomSize;
  var oddCountStrategy = descriptor.config.oddCountStrategy;
  var total = cfg.n;
  var rounds = [], rn = 1;
  var noElimCount = 2; // fixed warm-up round count, unchanged by this refactor
  for (var ne = 0; ne < noElimCount; ne++) {
    var ned = distributeRoomsWithBye(total, roomSize, oddCountStrategy);
    rounds.push({ roundNum: rn++, players: total, rooms: ned.rooms, byeCount: ned.byeCount,
      isQual:false, isNoElim:true, isSemis:false, isFinal:false,
      advPerRoom:null, advTotal:total, luckyCount:0 });
  }
  return { rounds: rounds, seedTotal: total, nextRoundNum: rn };
}

// A stable, order-independent key for an unordered pair of roster keys —
// shared by collectPlayedSwissPairs (recording) and isRematch (checking).
function swissPairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

// Every pair of units that have already shared a room in a Swiss round
// played so far (rounds 0..uptoRi inclusive) — the rematch-avoidance input.
// Reads room pairings directly off T.assignments rather than recomputing
// anything, since a Swiss room is always exactly 2 units by construction
// (the roomSize.ideal===2 assertion below).
function collectPlayedSwissPairs(uptoRi) {
  var played = {};
  for (var r = 0; r <= uptoRi; r++) {
    var round = T.rounds[r];
    if (!round || !round.isSwiss) continue;
    var byRoom = {};
    (T.assignments[r] || []).forEach(function (a) {
      if (a.room === null) return; // a bye entry never shared a room with anyone
      (byRoom[a.room] = byRoom[a.room] || []).push(a.name);
    });
    Object.keys(byRoom).forEach(function (rm) {
      var names = byRoom[rm];
      for (var i = 0; i < names.length; i++) {
        for (var j = i + 1; j < names.length; j++) played[swissPairKey(names[i], names[j])] = true;
      }
    });
  }
  return played;
}

function isRematch(pair, playedPairs) { return !!playedPairs[swissPairKey(pair[0], pair[1])]; }

// The live fold-pairing computation for a Swiss round beyond the first
// (round 1 is randomly paired at generation time, same as qual-table's own
// round 1 — see swissPoolingPhase). Takes the roster keys currently heading
// into this round (already includes any prior round's own bye recipient,
// prepended by advanceRound() before calling this) and the round index just
// finished (uptoRi), and returns { seeded, byeName }.
//
// Fold pairing, adapted for continuous scoring: chess-style Swiss splits
// players into discrete score groups (integer win counts) and folds each
// group in half separately. This app's Fair Points is continuous
// (rank + score/100000), so exact ties across multiple rounds are rare and
// small — there's no meaningful discrete grouping to fold within. Deliberate
// translation, not a silent simplification: treat the entire current
// standings list as one continuous group each round, sort it ascending
// (better standing first), and fold *that* — pair rank i (top half) against
// rank i+half (bottom half) for every i. This keeps the same "better plays
// better" pairing shape real Swiss fold pairing produces within a score
// group, without inventing a discretization this app's scoring doesn't have.
//
// Rematch avoidance is best-effort, not guaranteed-optimal: when the natural
// fold pairing would repeat a pairing already played, this tries one local
// swap with the adjacent pairing. If that swap would itself create a
// rematch, the original rematch is accepted rather than backtracking further
// — a small field running several rounds can genuinely run out of fresh
// pairings, and this app doesn't need competition-grade constraint-solving
// Swiss software to handle the ordinary case well.
function swissFoldPair(activeNames, uptoRi) {
  var descriptor = getGamemodeDescriptor();
  var roomSize = descriptor.config.roomSize;
  if (roomSize.ideal !== 2) {
    throw new Error('swissFoldPair requires a head-to-head room shape (roomSize.ideal === 2) — got ' + roomSize.ideal + '.');
  }

  updateQualTable(); // refresh T.qualTable off every Swiss round actually played so far
  var byName = {};
  T.qualTable.forEach(function (p) { byName[p.name] = p; });
  // T.qualTable is already sorted ascending by totalFP (nulls last) — filter
  // it down to just the units actually active this round, preserving that
  // order, rather than re-sorting from scratch.
  var sorted = T.qualTable.filter(function (p) { return activeNames.indexOf(p.name) !== -1; }).map(function (p) { return p.name; });
  // Defensive: a name active this round but somehow absent from T.qualTable
  // (shouldn't happen — rosterKeys(T.players) always covers it) sorts last.
  activeNames.forEach(function (n) { if (sorted.indexOf(n) === -1) sorted.push(n); });

  var byeName = null;
  if (sorted.length % 2 !== 0) {
    // Odd count: someone sits out — same bye convention as everywhere else
    // in the app (no score entry, advances automatically). "Fewest byes so
    // far this pooling phase" is now the PRIMARY selection criterion (see
    // "Fair bye rotation during pooling phases" in HANDOFF.md), so a
    // consistently-central-standings unit doesn't ride a bye every round.
    // Median-of-standings — Swiss's original convention, since fold pairing
    // has no natural "top" unit left over the way a room-based round does —
    // now serves only as the tie-break among units tied for fewest byes,
    // closest-to-median winning ties. A deliberate divergence from "seed"
    // as the tie-break (unlike qual-table/no-elim's "highest remaining
    // seed"): reintroducing a top/bottom-seed tie-break here would revive
    // exactly the unfairness Swiss's own median convention was built to
    // avoid, so median-proximity is kept as the fairer tie-break for this
    // specific selection.
    var minByeCount = Infinity;
    sorted.forEach(function (n) { var c = T.poolingByeCounts[n] || 0; if (c < minByeCount) minByeCount = c; });
    var leastByedCandidates = sorted.filter(function (n) { return (T.poolingByeCounts[n] || 0) === minByeCount; });
    var medianIdx = Math.floor(sorted.length / 2);
    var bestDist = Infinity;
    leastByedCandidates.forEach(function (n) {
      var dist = Math.abs(sorted.indexOf(n) - medianIdx);
      if (dist < bestDist) { bestDist = dist; byeName = n; }
    });
    sorted.splice(sorted.indexOf(byeName), 1);
    T.poolingByeCounts[byeName] = (T.poolingByeCounts[byeName] || 0) + 1;
  }

  var half = sorted.length / 2;
  var pairs = [];
  for (var i = 0; i < half; i++) pairs.push([sorted[i], sorted[i + half]]);

  var playedPairs = collectPlayedSwissPairs(uptoRi);
  for (var p = 0; p < pairs.length; p++) {
    if (isRematch(pairs[p], playedPairs) && p + 1 < pairs.length) {
      var swappedA = [pairs[p][0], pairs[p + 1][1]];
      var swappedB = [pairs[p + 1][0], pairs[p][1]];
      if (!isRematch(swappedA, playedPairs) && !isRematch(swappedB, playedPairs)) {
        pairs[p] = swappedA;
        pairs[p + 1] = swappedB;
      }
      // else: no local swap resolves it — accept the rematch (best-effort,
      // not guaranteed-optimal, per the doc comment above).
    }
  }

  var seeded = [];
  pairs.forEach(function (pair, idx) {
    seeded.push({ name: pair[0], room: idx + 1, isLucky: false });
    seeded.push({ name: pair[1], room: idx + 1, isLucky: false });
  });
  if (byeName) seeded.push({ name: byeName, room: null, isLucky: false });
  return { seeded: seeded, byeName: byeName };
}
