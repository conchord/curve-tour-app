// bracket-phases.js — every BRACKET_PHASES implementation (single- and
// double-elimination) plus the SCHEDULE_LOGICS/POOLING_PHASES/
// BRACKET_PHASES/BRACKET_PHASE_MIN_UNITS registries.
// Load order: must come after pooling-phases.js (POOLING_PHASES references
// its functions) AND after advancement.js (SCHEDULE_LOGICS references
// roomBasedComputeAdvancement directly, at load time, not inside a function
// body — found during the multi-file split, see HANDOFF.md).
//
// "Single elimination" was renamed from "Classic elimination" (2026-09-08,
// see "Classic-elimination rename" in HANDOFF_LOG.md) — the mechanism itself
// (gradual room-based cuts toward a fixed Semis/Final floor, with a
// lucky-loser buffer for uneven room splits) is unchanged; only the name
// changed. The OLD, narrower "Single elimination" (strict head-to-head, pure
// recursive halving, no lucky-loser mechanism, no fixed Semis/Final floor)
// was retired — this mechanism now degenerates to matching behavior for a
// head-to-head room shape (its lucky-loser math never triggers when a room
// always halves exactly, and round counts come out identical), but that
// equivalence needed a real fix, not just an assumption: see
// computeElimRoundCount()'s own comment below for a bug this rename
// surfaced and fixed. `singleEliminationBracketPhase` below is what used to
// be `classicEliminationBracketPhase` — body unchanged, function renamed to
// match its registry key.

var SCHEDULE_LOGICS = {
  'single-elimination': {
    label: 'Single elimination',
    buildProgression: composedBuildProgression,
    computeAdvancement: roomBasedComputeAdvancement
  },
  'double-elimination': {
    label: 'Double elimination',
    // Same orchestrator (composedBuildProgression is unaware of what the
    // bracket phase itself looks like — it just concatenates whatever
    // doubleEliminationBracketPhase returns, see "Double elimination" in
    // HANDOFF.md). computeAdvancement here is roomBasedComputeAdvancement,
    // same as every other entry — NOT doubleEliminationComputeAdvancement.
    // This registry entry is only ever reached generically for a round that
    // ISN'T round.bracket-tagged (a pooling-phase round — warmup/qual/Swiss
    // — feeding into this bracket phase), which still needs the ordinary
    // room-based/qual-cutoff computation. Every round.bracket-tagged round
    // (WB/LB/grand-final) is intercepted by advanceRound()'s own early
    // dispatch to advanceDoubleEliminationRound() before this is ever
    // reached — doubleEliminationComputeAdvancement is called directly from
    // there instead, never through this registry.
    buildProgression: composedBuildProgression,
    computeAdvancement: roomBasedComputeAdvancement
  },
  'double-elimination-shared-final': {
    label: 'Double elimination — FFA/Team',
    // Same reasoning as 'double-elimination' immediately above — this entry
    // is only ever reached generically for a round that ISN'T
    // round.bracket-tagged; every WB/LB round is intercepted by
    // advanceRound()'s own early dispatch, and the shared Final round
    // carries no round.bracket tag at all (see "FFA/Team double-elimination
    // generalization" in HANDOFF_LOG.md), so it too reaches this entry's
    // computeAdvancement — correctly, since it's an ordinary isFinal round
    // needing no bracket-specific handling.
    buildProgression: composedBuildProgression,
    computeAdvancement: roomBasedComputeAdvancement
  }
  // future: 'kings-valley', 'group-knockout' — each would register its own
  // buildProgression/computeAdvancement pair here.
};

// PHASE COMPOSABILITY (2026-09-09 refactor — no new capability, see
// "Phase composability refactor" in HANDOFF.md): every tournament structure
// decomposes into two independent questions — how the field gets pooled/
// narrowed before the real bracket starts (a pooling phase), and what shape
// the elimination bracket itself is (a bracket phase). `composedBuild-
// Progression` (below) answers both with a thin orchestrator that calls one
// entry from each registry and concatenates the results — 'single-
// elimination' reuses that same orchestrator and `roomBasedComputeAdvancement`
// rather than needing its own copy.
//
// Handoff interface: a pooling-phase function takes (cfg, descriptor) and
// returns { rounds, seedTotal, nextRoundNum } — rounds it built, how many
// units are actually entering the bracket phase, and which round number the
// bracket phase should continue numbering from. A bracket-phase function
// takes (seedTotal, startRoundNum, descriptor) and returns just the array of
// round objects it built, numbered starting at startRoundNum.
var POOLING_PHASES = {
  'qual-table': qualTablePoolingPhase,
  'swiss': swissPoolingPhase,
  'group-stage': groupStagePoolingPhase,
  'none': noElimWarmupPoolingPhase
};

var BRACKET_PHASES = {
  'single-elimination': singleEliminationBracketPhase,
  'double-elimination': doubleEliminationBracketPhase,
  'double-elimination-shared-final': doubleEliminationSharedFinalBracketPhase
};

// Minimum viable seedTotal for each bracket phase, consulted by
// proceedGenerateSchedule()'s confirmed-count floor check. Takes the
// live-derived roomSize directly (not the full gamemodeConfig, which doesn't
// exist yet at floor-check time) since that's already how the existing
// floor check derives its own numbers pre-generation.
// - single-elimination genuinely needs at least a full Semis' worth of
//   units (2 * roomSize.ideal) — below that there's no valid Semis to reach.
var BRACKET_PHASE_MIN_UNITS = {
  'single-elimination': function (roomSize) { return 2 * roomSize.ideal; },
  // Same reasoning/formula as single-elimination's own floor above — enough
  // units for a real winners bracket before reaching final-qualifier
  // territory. Provisional, not a settled number.
  'double-elimination-shared-final': function (roomSize) { return 2 * roomSize.ideal; },
  // Provisional, not a settled number — enough for at least one real
  // winners-bracket round before the WB final. Also the minimum that keeps
  // doubleEliminationBracketPhase's own R>=2 assertion
  // satisfied (seedTotal>=4 always yields at least 2 WB rounds).
  'double-elimination': function (roomSize) { return 4; }
};

// Dispatcher — delegates to the current schedule logic's own progression
// builder (see SCHEDULE_LOGICS). Every registered schedule logic today
// resolves to the same shared composedBuildProgression() below, since all of
// them compose a pooling phase with a bracket phase the same way — see
// "Phase composability refactor" in HANDOFF.md. A schedule logic built
// differently later (e.g. Kings Valley's promote/demote) would produce an
// entirely different round shape here without this dispatcher needing to
// change.
function buildProgression(cfg) {
  var descriptor = getGamemodeDescriptor();
  return descriptor.schedule.buildProgression(cfg, descriptor);
}

function computeElimRoundCount(total, floor, roomSize) {
  if (total <= floor) return 0;
  var ideal = Math.log(floor / total) / Math.log(TARGET_ROUND_SURVIVAL_RATIO);
  // Math.ceil means the actual per-round cut ends up at least as gentle as
  // the target ratio, never steeper — except once MAX_ELIM_ROUNDS caps it for
  // very large fields, where a steeper-than-ideal cut is the accepted
  // tradeoff over an unbounded tournament length.
  var numElim = Math.min(Math.ceil(ideal), MAX_ELIM_ROUNDS);
  // A strict head-to-head room (roomSize.ideal===2) can only ever cut
  // exactly in half each round — there is no way to express TARGET_ROUND_
  // SURVIVAL_RATIO's gentler ~80%-per-round pacing in a room of 2, so the
  // formula above requests more rounds than the room can actually use.
  // computeTargets()/snapFriendly() then can't fill all of them meaningfully
  // — confirmed by direct testing (2026-09-08, during the Classic->Single
  // rename): a 16-player head-to-head bracket requested 7 elimination
  // rounds instead of the 2 pure halving needs, and one of those 7 rounds'
  // own computed target came out EQUAL to its input — a genuine wasted
  // round where an entire "elimination round" eliminates nobody. Capped
  // here at the room's own natural halving-round count specifically for
  // roomSize.ideal===2 — every other registered room size (3+: team-3v3v3,
  // team-2v2v2v2, FFA) has enough per-room granularity for the gentle
  // pacing to make sense as-is and is completely unaffected by this cap
  // (confirmed: (roomSize.ideal-1)/roomSize.ideal exceeds
  // TARGET_ROUND_SURVIVAL_RATIO for FFA's ideal:8, so the cap never
  // triggers there — this is deliberately scoped to ideal===2 alone rather
  // than generalized to every room size, since 3v3v3's ideal:3 and
  // 2v2v2v2's ideal:4 would otherwise ALSO get capped in a way that
  // changes their already-shipped, already-tested round pacing, which is
  // explicitly out of scope for this fix).
  if (roomSize && roomSize.ideal === 2) {
    var pureHalvingRounds = Math.ceil(Math.log(total / floor) / Math.log(2));
    numElim = Math.min(numElim, pureHalvingRounds);
  }
  return numElim;
}

// Defensive companion to computeElimRoundCount() above — even with that
// function's room-size-2 cap, a requested round count can still produce a
// sequence where some INTERMEDIATE target snaps to the same value as its
// predecessor (found 2026-09-08, during the FFA/Team double-elimination
// build: narrowing a 37-player field all the way to a small winners-bracket
// qualifier count, e.g. 6, hit exactly this case for FFA's own room size 8
// — not just the room-size-2 case computeElimRoundCount already guards).
// Root cause is the same class of bug either way: requesting more rounds
// than computeTargets()/snapFriendly() can fill with genuinely-decreasing
// values, given the room size and how few rooms remain near the target.
// Fixed generically here by iteratively trying fewer rounds until every
// target in the sequence is strictly less than the one before it — cheap
// (at most requestedNumRounds-1 extra computeTargets() calls, and
// requestedNumRounds is capped at MAX_ELIM_ROUNDS=8 to begin with) and
// requires no closed-form formula for "how many rounds are achievable,"
// which would need to account for room size AND floor AND total all
// together. A strictly-decreasing sequence of length 1 (a direct cut to
// floor) is always achievable when total>floor, so this always terminates.
// Confirmed a no-op (returns the exact same sequence) for every case tested
// so far where the original request was already achievable — this is a
// safety net, not a behavior change, for FFA/team-2v2v2v2/team-3v3v3's own
// existing Semis-floor usage.
function computeCleanTargets(total, floor, requestedNumRounds, roomSize) {
  var numRounds = Math.max(1, requestedNumRounds);
  while (numRounds > 1) {
    var candidate = computeTargets(total, floor, numRounds, roomSize);
    var isStrictlyDecreasing = true, prev = total;
    for (var i = 0; i < candidate.length; i++) {
      if (candidate[i] >= prev) { isStrictlyDecreasing = false; break; }
      prev = candidate[i];
    }
    if (isStrictlyDecreasing) return candidate;
    numRounds--;
  }
  return computeTargets(total, floor, 1, roomSize);
}

// --- Pooling phases (see POOLING_PHASES above) ---
// Each takes (cfg, descriptor) and returns { rounds, seedTotal, nextRoundNum }.
// Pure relocation of composedBuildProgression's old steps 1/2 — the
// actual computation is byte-for-byte unchanged, just split into two
// independently-registered strategies instead of one function with a branch.

// --- Bracket phase (see BRACKET_PHASES above) ---
// Single elimination: gradual cuts toward a fixed Semis/Final structure,
// with a lucky-loser buffer smoothing over room sizes that don't divide
// cleanly. Renamed from "Classic elimination" (2026-09-08) — the mechanism
// degenerates to a plain head-to-head bracket (lucky-loser math never
// firing) when roomSize.ideal===2, matching the old, narrower single-
// elimination mechanism this replaced — but this equivalence is NOT
// automatic from the room-cut math alone, as first assumed: it required a
// real fix to computeElimRoundCount() (see its own comment) once direct
// testing showed a naive port produced far more rounds than pure halving
// needs, including a genuinely wasted round. Verify this class of claim by
// actually generating a tournament and inspecting the output, not by
// hand-tracing the formula — that's exactly the check that caught this.
function singleEliminationBracketPhase(seedTotal, startRoundNum, descriptor) {
  var roomSize = descriptor.config.roomSize;
  var oddCountStrategy = descriptor.config.oddCountStrategy;
  var FINAL = descriptor.config.finalSize, SEMIS = descriptor.config.semisSize;
  var total = seedTotal;
  var rounds = [], rn = startRoundNum;

  // computeCleanTargets() (not a bare computeTargets() call) — see its own
  // comment for why: computeElimRoundCount()'s requested count can still
  // occasionally produce a sequence with a duplicate/non-decreasing
  // intermediate target even after its own room-size-2 cap, so numElim is
  // derived from the ACTUAL (possibly further-reduced) clean sequence
  // length, not trusted blindly — this is what keeps MAX_R/semisRound/
  // finalRound correctly numbered with no gap regardless.
  var requestedNumElim = computeElimRoundCount(total, SEMIS, roomSize);
  var targets = computeCleanTargets(total, SEMIS, requestedNumElim, roomSize);
  var numElim = targets.length;
  // MAX_R (and therefore semisRound/finalRound) is computed, not the literal
  // 8: (startRoundNum - 1) warm-up rounds (whatever the pooling phase built)
  // + numElim elimination rounds + 2 for Semis and Final.
  var MAX_R = (startRoundNum - 1) + numElim + 2;
  var semisRound = MAX_R - 1, finalRound = MAX_R;

  // Elimination rounds with lucky loser calculation
  for (var ei = 0; ei < targets.length; ei++) {
    var pIn  = ei === 0 ? total : targets[ei - 1];
    var pOut = targets[ei];
    var ed = distributeRoomsWithBye(pIn, roomSize, oddCountStrategy);
    var rooms = ed.rooms;
    var nr = rooms.length;
    // pOut is this round's TRUE total advancing out (bye recipient included —
    // see advTotal below). But the ROOM-based cutoff (advPerRoom/luckyCount)
    // only ever selects from units that actually played a room this round —
    // if this round itself reserved a bye (byeCount>0), that unit advances
    // automatically without going through room-based selection at all, so
    // the room-based target must be reduced by byeCount first, or the next
    // round would silently receive one MORE unit than its own generation-time
    // projection expects (an uncorrected +1 that — verified by hand-tracing —
    // never resolves on its own and cascades every subsequent round,
    // eventually corrupting the Final). Reducing here is what makes the
    // cascade self-terminate the moment a round's own target is already an
    // exact multiple of idealRoomSize (the normal case, restored within a
    // round or two of whatever triggered the original oddness).
    var advTarget = pOut - ed.byeCount;
    // Base: floor(advTarget/nr) advance per room; remainder = lucky losers
    var baseAdv = Math.floor(advTarget / nr);
    var lucky   = advTarget % nr;  // lucky loser spots needed
    rounds.push({ roundNum: rn++, players: pIn, rooms, byeCount: ed.byeCount,
      isQual:false, isNoElim:false, isSemis:false, isFinal:false,
      advPerRoom: baseAdv, advTotal: pOut, luckyCount: lucky });
  }

  // Semis' own incoming count is always SEMIS (= 2 * idealRoomSize) exactly —
  // an even multiple of idealRoomSize by construction, regardless of any bye
  // activity in earlier rounds (each bye-having round's own advTarget
  // reduction above already keeps the live count exactly matching this
  // projection — see the comment above advTarget). So Semis never itself
  // needs a bye reservation, and neither does the Final that follows it
  // (verified directly, not just assumed — see HANDOFF.md testing notes).
  var semisRooms = distributeRooms(SEMIS, roomSize);
  // Same floor+remainder split the regular elimination rounds above use —
  // NOT a bare FINAL/semisRooms.length division. That division silently
  // assumed FINAL always splits evenly across Semis' (always exactly 2)
  // rooms, true for every format built before 3v3v3 only because their
  // roomSize.ideal (8, 4, 2) happened to be even — team-3v3v3's ideal:3 is
  // odd, so FINAL(3)/2 rooms = 1.5, a non-integer that silently let 2 teams
  // through per room (4 total) instead of the intended 3 (caught by an
  // actual 3-team-Final playthrough, exactly the case the build spec asked
  // to verify directly rather than assume). Reusing the existing lucky-loser
  // mechanism for the remainder — 1 direct advancer per room + 1 slot
  // decided by best relative score among the 2nd-place finishers — needs no
  // new logic, and reproduces every prior format's behaviour byte-for-byte
  // (their FINAL % 2 is always 0, so this luckyCount is always 0 for them).
  var semisBaseAdv = Math.floor(FINAL / semisRooms.length);
  var semisLucky = FINAL % semisRooms.length;
  // numGames comes from descriptor.config.semisGames (2026-09-08, "Multi-
  // game Semis" in HANDOFF_LOG.md), mirroring the Final's own numGames
  // below exactly — a room-based round rather than the Final's single flat
  // pool, so its multi-game scoring lives under T.scores' own room/position
  // keys (see getUnitScore()/getUnitScoreForGame() in js/formats-and-
  // primitives.js), not T.finalScores.
  rounds.push({ roundNum: semisRound, players: SEMIS, rooms: semisRooms, byeCount: 0,
    isQual:false, isNoElim:false, isSemis:true, isFinal:false,
    advPerRoom: semisBaseAdv, advTotal: FINAL, luckyCount: semisLucky,
    numGames: descriptor.config.semisGames });

  // numGames comes from descriptor.config.finalsGames (populated at
  // generation time from cfg.finalsGames — see proceedGenerateSchedule())
  // rather than a cfg parameter directly, since the bracket phase's handoff
  // contract is (seedTotal, startRoundNum, descriptor) only — cfg is the
  // pooling phase's business, not the bracket phase's.
  rounds.push({ roundNum: finalRound, players: FINAL, rooms: [FINAL], byeCount: 0,
    isQual:false, isNoElim:false, isSemis:false, isFinal:true,
    advPerRoom:1, advTotal:1, luckyCount:0, numGames: descriptor.config.finalsGames });

  return rounds;
}

// Shared bracket-size utilities for a strict head-to-head bracket (used by
// doubleEliminationBracketPhase's winners-bracket round 0 below — the old,
// narrower "Single elimination" mechanism that also used these was retired
// in the 2026-09-08 rename, see the file header comment above; these two
// utilities outlived it because double-elimination still needs them).
//
// Bracket-size math: the field is conceptually rounded up to the next power
// of 2; the shortfall becomes byes. Rather than concentrating every needed
// bye into round 1 (the traditional seeded-bracket convention), everywhere
// but round 0 this reuses the *existing* distributeRoomsWithBye/
// oddCountStrategy mechanism exactly as team-3v3's Bye mode already does —
// at most one bye reserved per round, self-correcting round to round. This
// still produces exactly the same total round count as the traditional
// approach: each round's surviving count is ceil(pool/2) regardless of
// whether that round happened to need a bye or not (a bye simply makes an
// odd pool even *before* halving, same arithmetic result either way), so the
// field reaches 1 winner in exactly nextPowerOf2AndRounds(seedTotal).numRounds
// rounds either way — verified by hand-tracing, not just asserted (see
// HANDOFF.md).
function nextPowerOf2AndRounds(n) {
  // Pure integer doubling — deliberately not Math.log2/Math.pow, which can
  // land a hair off an exact power of 2 on some inputs due to floating-point
  // imprecision (the classic 1-off risk with log2-based "next power of 2"
  // formulas). This is exact by construction.
  var bracketSize = 1, numRounds = 0;
  while (bracketSize < n) { bracketSize *= 2; numRounds++; }
  return { bracketSize: bracketSize, numRounds: numRounds };
}

// Concentrates the ENTIRE shortfall to the next power of 2 into one round's
// byeCount, rather than the ordinary at-most-1-bye distributeRoomsWithBye
// formula (see "Concentrate single-elimination's byes" in HANDOFF.md for the
// original reasoning, unchanged here) — used by doubleEliminationBracketPhase's
// own WB round 0 (Part 1 of "Double elimination" in HANDOFF.md: reuse, don't
// rebuild). The old, narrower "Single elimination" mechanism that used to
// share this with double-elimination's WB round 0 was retired in the
// 2026-09-08 rename (see the file header comment above).
function concentratedByeFirstRound(total, shape, roomSize) {
  var byeCount0 = shape.bracketSize - total;
  return { rooms: distributeRooms(total - byeCount0, roomSize), byeCount: byeCount0 };
}

// ═══════════════════════════════════════════════════════════════
// DOUBLE ELIMINATION — see "Double elimination" in HANDOFF.md for the full
// design writeup. The genuinely new problem this bracket phase solves: every
// other bracket/pooling mechanism assumes a round's outcome feeds the VERY
// NEXT round (advanceRound()'s nextRound = T.rounds[ri+1] throughout).
// Double-elimination breaks that — a winners-bracket (WB) round's winners
// skip ahead past interleaved losers-bracket (LB) rounds, and an LB "absorb"
// round needs input from two different prior rounds at two different
// distances back.
//
// The fix: every WB/LB round object carries an explicit winnersTo/losersTo
// GLOBAL T.rounds index (null = nowhere, i.e. eliminated) computed once here
// at generation time. Live advancement (advanceDoubleEliminationRound,
// below) stages each round's winners/losers into T.pendingBracketSeeds[target]
// rather than assuming ri+1, and materializes whichever round the linear
// T.curRound pointer is about to arrive at from whatever's been staged for
// it — safe because of one load-bearing property, verified by direct
// enumeration during this build: for every round in the interleaved
// sequence, its LAST-arriving input is always the round immediately before
// it in play order. That's what lets the ordinary linear T.curRound pointer
// keep working even though a round's OTHER input may have arrived several
// rounds earlier and had to be staged.
// ═══════════════════════════════════════════════════════════════
function doubleEliminationBracketPhase(seedTotal, startRoundNum, descriptor) {
  var roomSize = descriptor.config.roomSize;
  var oddCountStrategy = descriptor.config.oddCountStrategy;
  // Same scope assertions as singleEliminationBracketPhase, same reasoning —
  // double-elimination is inherently head-to-head, no standard meaning
  // exists for an N-way version of it (see "Double elimination" Part 1/2 in
  // HANDOFF.md).
  if (roomSize.ideal !== 2) {
    throw new Error('doubleEliminationBracketPhase requires a head-to-head room shape (roomSize.ideal === 2) — got ' + roomSize.ideal + '.');
  }
  if (oddCountStrategy === 'flex') {
    throw new Error('doubleEliminationBracketPhase does not support the "flex" odd-count strategy — a 3-unit room is not double elimination. Use "none" or "bye" instead.');
  }

  var shape = nextPowerOf2AndRounds(seedTotal);
  var R = shape.numRounds;
  // R < 2 (seedTotal <= 2) has no meaningful losers bracket at all (the
  // single WB round's loser would have no one to face) — not reachable via
  // BRACKET_PHASE_MIN_UNITS' own floor of 4 (which guarantees R >= 2), so
  // this is a defensive assertion, not a normal code path.
  if (R < 2) {
    throw new Error('doubleEliminationBracketPhase requires at least 2 winners-bracket rounds — got seedTotal ' + seedTotal + '.');
  }

  // --- Winners bracket: Part 1 (reuse, don't rebuild) — round 0 reuses the
  // identical concentrated-bye math singleEliminationBracketPhase's own
  // round 0 uses; every round after it is the same plain halving shape. ---
  var wb = [];
  var total = seedTotal;
  for (var i = 0; i < R; i++) {
    var rd = i === 0 ? concentratedByeFirstRound(total, shape, roomSize) : distributeRoomsWithBye(total, roomSize, oddCountStrategy);
    var advTotal = rd.rooms.length + rd.byeCount;
    wb.push({ rooms: rd.rooms, byeCount: rd.byeCount, players: total, advTotal: advTotal });
    total = advTotal;
  }

  // --- Losers bracket: Part 2 topology. Standard shape — one pure-pairing
  // round after WB round 1 (nothing to absorb yet), an absorb round +
  // survivors-play round after each WB round 2..R-1, and one final absorb
  // round after the WB final (down to a single LB champion, no further
  // survivors-play needed). Produces 1 + 2*(R-2) + 1 = 2R-2 LB rounds total
  // — verify this by direct enumeration for whatever seedTotal is actually
  // tested, don't trust the formula blind (see HANDOFF.md).
  //
  // Each stage's incoming total is run through distributeRoomsWithBye (not
  // a bare distributeRooms) — the SAME at-most-1-bye self-correction WB
  // rounds after round 0 already use. This isn't optional polish: WB round
  // 0's own loser count (dropCount below) inherits seedTotal's own parity
  // whenever byeCount0 > 0 (an odd seedTotal, e.g. N=13, produces an ODD
  // number of round-0 match losers) — found via direct enumeration during
  // this build (a naive distributeRooms(5, {ideal:2}) silently produced a
  // room of size 1). A "survivor count" carried into the next stage is
  // always (real match winners) + (that stage's own bye, if any) — a bye
  // recipient auto-advances as a survivor without playing, same as
  // everywhere else in the app.
  var lb = []; // { rooms, byeCount, kind: 'drop'|'absorb'|'survive'|'final-absorb' }
  var lbSurvivorCount = 0;
  for (var k = 0; k < R; k++) {
    var dropCount = wb[k].rooms.length; // exactly 1 loser per WB room (advPerRoom:1)
    if (k === 0) {
      var d0 = distributeRoomsWithBye(dropCount, roomSize, oddCountStrategy);
      lb.push({ rooms: d0.rooms, byeCount: d0.byeCount, kind: 'drop' });
      lbSurvivorCount = d0.rooms.length + d0.byeCount;
    } else if (k < R - 1) {
      var absorbTotal = lbSurvivorCount + dropCount;
      var dA = distributeRoomsWithBye(absorbTotal, roomSize, oddCountStrategy);
      lb.push({ rooms: dA.rooms, byeCount: dA.byeCount, kind: 'absorb' });
      var absorbSurvivors = dA.rooms.length + dA.byeCount;
      var dS = distributeRoomsWithBye(absorbSurvivors, roomSize, oddCountStrategy);
      lb.push({ rooms: dS.rooms, byeCount: dS.byeCount, kind: 'survive' });
      lbSurvivorCount = dS.rooms.length + dS.byeCount;
    } else {
      var dF = distributeRoomsWithBye(lbSurvivorCount + dropCount, roomSize, oddCountStrategy);
      lb.push({ rooms: dF.rooms, byeCount: dF.byeCount, kind: 'final-absorb' });
    }
  }

  // --- Interleave WB/LB into one flat play-order sequence, then the grand
  // final. "Each round as soon as its last dependency is ready" — see
  // HANDOFF.md's worked WB-size-8 example for why this exact order is what
  // makes the linear T.curRound pointer stay valid. ---
  var sequence = [];
  var lbPtr = 0;
  for (var k2 = 0; k2 < R; k2++) {
    sequence.push({ type: 'wb', wbIndex: k2 });
    var lbCountHere = (k2 === 0 || k2 === R - 1) ? 1 : 2;
    for (var c = 0; c < lbCountHere; c++) { sequence.push({ type: 'lb', lbIndex: lbPtr }); lbPtr++; }
  }
  sequence.push({ type: 'gf' });

  // winnersTo/losersTo, computed as LOCAL positions in `sequence` for now —
  // converted to GLOBAL T.rounds indices below (baseIdx + position), since
  // composedBuildProgression concatenates this array after the pooling
  // phase's own rounds (see "Phase composability refactor" in HANDOFF.md;
  // roundNum === global array index + 1 always holds, confirmed against
  // qualTablePoolingPhase/noElimWarmupPoolingPhase's own rn bookkeeping).
  function nextWbPosition(afterPos) {
    for (var p = afterPos + 1; p < sequence.length; p++) if (sequence[p].type === 'wb') return p;
    return -1;
  }
  function nextNonWbPosition(afterPos) {
    for (var p = afterPos + 1; p < sequence.length; p++) if (sequence[p].type !== 'wb') return p;
    return -1;
  }
  var gfPosition = sequence.length - 1;
  var baseIdx = startRoundNum - 1;

  var rounds = sequence.map(function (entry, pos) {
    var winnersToPos = null, losersToPos = null;
    if (entry.type === 'wb') {
      // A WB round's losers ALWAYS feed the very next entry in the sequence
      // (by construction of the interleaving above — the LB round(s)
      // associated with this WB round always come immediately after it);
      // its winners feed the next WB round, or the grand final if this was
      // the WB's own final round.
      losersToPos = pos + 1;
      winnersToPos = entry.wbIndex === R - 1 ? gfPosition : nextWbPosition(pos);
    } else if (entry.type === 'lb') {
      // An LB round's winners (survivors) feed whichever comes next that
      // ISN'T a WB round — the next LB round, or the grand final for the
      // final absorb round. Losers are eliminated (2nd loss) — nowhere to go.
      winnersToPos = nextNonWbPosition(pos);
      losersToPos = null;
    }
    // entry.type === 'gf': both null — Part 4's own live-reset mechanism
    // takes over entirely from the grand final onward, not this routing table.

    var roundNum = startRoundNum + pos;
    var base = {
      roundNum: roundNum, isQual: false, isNoElim: false, isSemis: false,
      advPerRoom: 1, luckyCount: 0,
      winnersTo: winnersToPos === null || winnersToPos === -1 ? null : baseIdx + winnersToPos,
      losersTo: losersToPos === null || losersToPos === -1 ? null : baseIdx + losersToPos
    };
    if (entry.type === 'wb') {
      var w = wb[entry.wbIndex];
      return Object.assign(base, {
        bracket: 'winners', isFinal: false, rooms: w.rooms, byeCount: w.byeCount, players: w.players,
        advTotal: w.rooms.length + w.byeCount, bracketPhaseFirstRound: entry.wbIndex === 0 ? true : undefined
      });
    }
    if (entry.type === 'lb') {
      var l = lb[entry.lbIndex];
      return Object.assign(base, {
        bracket: 'losers', isFinal: false, rooms: l.rooms, byeCount: l.byeCount,
        players: l.rooms.reduce(function (s, r) { return s + r; }, 0) + l.byeCount,
        advTotal: l.rooms.length + l.byeCount
      });
    }
    // Grand final — a continuous games-until-someone-wins race (see
    // "Grand-final race format" in HANDOFF.md), not the fixed-numGames
    // cumulative-score match every other Final uses. numGames starts at 1
    // (one game open for entry) and grows live as each opened game is fully
    // scored and the race isn't yet decided — see checkGrandFinalRace() and
    // computeGrandFinalRaceState(). A plain 1-room-of-2 shape, same as
    // singleEliminationBracketPhase's own last round.
    return Object.assign(base, {
      bracket: 'grand-final', isFinal: true, rooms: [2], byeCount: 0, players: 2,
      advPerRoom: 1, advTotal: 1, numGames: 1
    });
  });

  return rounds;
}

// ═══════════════════════════════════════════════════════════════
// DOUBLE ELIMINATION — FFA/TEAM (shared Final), 2026-09-08 — see "FFA/Team
// double-elimination generalization" in HANDOFF_LOG.md for the full design
// writeup and hand-verified worked examples this algorithm was checked
// against before being written here. Coexists with doubleEliminationBracket-
// Phase above (registered separately as 'double-elimination-shared-final',
// not a branch inside 'double-elimination') — that one keeps its existing
// Grand-Final-race shape for individual-1v1/team-3v3 completely untouched;
// this one is for every other room-based format (and, technically, is
// compatible with a head-to-head room shape too, though not surfaced as
// those two formats' default — see HANDOFF.md).
//
// The key difference from the 1v1 shape: instead of narrowing WB and LB
// down to exactly one champion each and deciding the whole tournament with
// a Grand-Final race between them, WB and LB each narrow toward their own
// organiser-configured qualifier count (wbQualifiers/lbQualifiers, summing
// to finalSize) and their survivors are merged directly into ONE shared,
// ordinary multi-player Final round — the exact same isFinal/numGames
// structure singleEliminationBracketPhase's own Final already uses. This
// Final deliberately gets NO round.bracket tag, which is what lets it reuse
// every existing isFinal-driven ranking/rendering code path (computeRankings()'s
// round.bracket branch, Bracket's Final rendering, etc.) with zero special
// casing — see js/advancement.js's computeRankings() for the one other place
// this decision matters.
//
// Winners' bracket: reuses the EXACT same room-based narrowing primitives
// (computeElimRoundCount/computeTargets/distributeRoomsWithBye + the
// round-wide lucky-loser split) singleEliminationBracketPhase's own
// elimination-round loop above already uses — parameterized to narrow to
// wbQualifiers instead of semisSize, and without appending a fixed
// Semis+Final floor of its own (the shared Final below is generated once,
// fed from both WB and LB together, not owned by WB alone).
//
// Losers' bracket — the genuinely new part: because a room-based cut can
// eliminate an arbitrary (round-wide, non-1) count per round, ONE LB round
// per WB round suffices — no separate absorb-then-survive pair like the
// 1v1 LB's forced-pairing mechanism needs (that mechanism exists ONLY
// because a room of exactly 2 can never absorb-and-narrow in the same
// step). Each LB round re-derives its own target fresh via computeTargets()
// against the round's ACTUAL live incoming pool (this round's own survivor
// count from the prior LB round, plus whatever WB just dropped) — asking
// "if this pool had (R-k) rounds left to reach lbQualifiers, what's the
// FIRST of those targets?" Because computeTargets(...,numRounds===1) always
// returns exactly [end], the LAST LB round (roundsLeft===1) forces its own
// target to lbQualifiers exactly — no separate "final absorb" case needed,
// it falls out of the same formula used for every other LB round.
//
// A pool of exactly 0 is only possible at the very first LB round (k===0,
// if WB round 0 happens to drop nobody) — every LB round after that always
// has a pool of at least lbQualifiers (computeTargets clamps target>=end),
// so that round is simply skipped (lb[0] left null) rather than emitting an
// empty round; no later round can ever hit this case.
function doubleEliminationSharedFinalBracketPhase(seedTotal, startRoundNum, descriptor) {
  var roomSize = descriptor.config.roomSize;
  var oddCountStrategy = descriptor.config.oddCountStrategy;
  var FINAL = descriptor.config.finalSize;
  var LBQ = descriptor.config.lbQualifiers;
  var WBQ = FINAL - LBQ;
  // Defensive — proceedGenerateSchedule() already validates this at
  // generation time (lbQualifiers >= 1 && lbQualifiers < finalSize), same
  // "fail loudly rather than silently misbehave" reasoning as every other
  // bracket phase's own scope assertions.
  if (!(LBQ >= 1) || !(WBQ >= 1)) {
    throw new Error('doubleEliminationSharedFinalBracketPhase requires lbQualifiers >= 1 and finalSize - lbQualifiers >= 1 — got lbQualifiers=' + LBQ + ', finalSize=' + FINAL + '.');
  }

  var requestedR = computeElimRoundCount(seedTotal, WBQ, roomSize);
  if (requestedR < 1) {
    throw new Error('doubleEliminationSharedFinalBracketPhase requires at least 1 winners-bracket round — got seedTotal ' + seedTotal + ', wbQualifiers ' + WBQ + '.');
  }

  // --- Winners' bracket --- computeCleanTargets() (see its own comment),
  // not a bare computeTargets() call — a naive port hit a real, wasted
  // (zero-progress) round during verification when narrowing a large field
  // all the way to a small wbQualifiers value, even for FFA's own room size
  // 8 (not just the room-size-2 case computeElimRoundCount's own cap
  // guards). R is derived from the ACTUAL clean sequence length, which can
  // come out smaller than requestedR.
  var wbTargets = computeCleanTargets(seedTotal, WBQ, requestedR, roomSize);
  var R = wbTargets.length;
  var wb = []; // { rooms, byeCount, players, advTotal, advPerRoom, luckyCount, dropCount }
  for (var k = 0; k < R; k++) {
    var pIn = k === 0 ? seedTotal : wbTargets[k - 1];
    var pOut = wbTargets[k];
    var ed = distributeRoomsWithBye(pIn, roomSize, oddCountStrategy);
    // Same byeCount-reduction reasoning as singleEliminationBracketPhase's
    // own elimination-round loop above (see its advTarget comment) — a
    // round's own bye recipient advances automatically, outside room-based
    // selection, so the room-based target must exclude them.
    var advTarget = pOut - ed.byeCount;
    var advPerRoom = Math.floor(advTarget / ed.rooms.length);
    var luckyCount = advTarget % ed.rooms.length;
    wb.push({ rooms: ed.rooms, byeCount: ed.byeCount, players: pIn, advTotal: pOut,
      advPerRoom: advPerRoom, luckyCount: luckyCount, dropCount: pIn - pOut });
  }

  // --- Losers' bracket --- the genuinely new part, and the one place
  // computeCleanTargets() alone isn't enough: LB recomputes fresh every
  // round from a *live* incoming pool (this round's own WB drop-ins plus
  // whatever survived the prior LB round), not from one upfront array, so a
  // round that would make zero genuine progress can appear anywhere, not
  // just as an intermediate value in one static sequence — confirmed by
  // direct testing (2026-09-08): even with WB's own targets already clean,
  // an early LB round independently computed a target equal to its own
  // input for a 32-player FFA field. Fixed by DEFERRING round creation
  // whenever it would be a no-op: a WB round's drops accumulate
  // (pendingDrop) across as many WB rounds as it takes until the combined
  // pool can actually be narrowed by at least one unit, at which point ONE
  // real LB round is created for that combined pool and every WB round
  // whose drops fed it gets routed there. This also means an LB round is no
  // longer created 1:1 per WB round (contrast the 1v1 mechanism's fixed
  // absorb+survive pairing) — `lb.length` can be less than R, and each
  // created LB round remembers which WB index it was finally resolved
  // after (afterWbIndex) so the interleave step below can place it
  // correctly regardless of how many WB rounds it absorbed.
  var lb = []; // { rooms, byeCount, players, advTotal, advPerRoom, luckyCount, afterWbIndex }
  var wbLosersLbIndex = new Array(R).fill(null); // wbLosersLbIndex[k] = index into lb[], or null if nothing was ever pending from k (only possible while every drop so far has been 0)
  var lbSurvivorCount = 0, pendingDrop = 0, pendingFromK = [];
  for (var k2 = 0; k2 < R; k2++) {
    pendingDrop += wb[k2].dropCount;
    pendingFromK.push(k2);
    var poolThisRound = lbSurvivorCount + pendingDrop;
    if (poolThisRound === 0) { pendingFromK = []; continue; } // nobody dropped yet at all
    var roundsLeft = R - k2; // an upper bound once rounds have been deferred — fine, just paces the request gentler, computeTargets/snapFriendly still find a valid step
    var rawTargets = computeTargets(poolThisRound, LBQ, roundsLeft, roomSize);
    var survivorTarget = Math.min(rawTargets[0], poolThisRound); // never claim more survivors than entered
    if (survivorTarget === poolThisRound) continue; // no genuine progress yet — keep deferring, try again once more has dropped in
    var edLb = distributeRoomsWithBye(poolThisRound, roomSize, oddCountStrategy);
    var advTargetLb = survivorTarget - edLb.byeCount;
    var advPerRoomLb = Math.floor(advTargetLb / edLb.rooms.length);
    var luckyCountLb = advTargetLb % edLb.rooms.length;
    lb.push({ rooms: edLb.rooms, byeCount: edLb.byeCount, players: poolThisRound, advTotal: survivorTarget,
      advPerRoom: advPerRoomLb, luckyCount: luckyCountLb, afterWbIndex: k2 });
    var thisLbIndex = lb.length - 1;
    pendingFromK.forEach(function (kk) { wbLosersLbIndex[kk] = thisLbIndex; });
    pendingFromK = [];
    lbSurvivorCount = survivorTarget;
    pendingDrop = 0;
  }
  // Defensive — should be unreachable given R's own last round always forces
  // survivorTarget===LBQ via computeTargets(...,numRounds===1,...)'s exact-
  // end guarantee, so pendingFromK is always flushed by the time the loop
  // ends UNLESS lbQualifiers itself could never actually be reached (e.g.
  // WB never drops enough units in total to fill it) — a genuine organiser
  // configuration problem, not a code bug, so fail loudly rather than
  // silently routing someone's losers nowhere.
  if (pendingFromK.length) {
    throw new Error('doubleEliminationSharedFinalBracketPhase could not route every winners-bracket round\'s losers to a losers-bracket round — lbQualifiers (' + LBQ + ') may be too large for how many units winners-bracket play actually eliminates from seedTotal ' + seedTotal + '.');
  }

  // --- Interleave: wb_0, [lb rounds resolved at k=0]?, wb_1, [lb rounds
  // resolved at k=1]?, ..., wb_(R-1), [lb rounds resolved at k=R-1], FINAL.
  // Satisfies the same load-bearing invariant doubleEliminationBracketPhase's
  // own sequence relies on (each round's LAST-arriving input is the round
  // immediately before it in play order) — a WB round's losers always feed
  // whichever LB round resolves them (immediately after that WB round in
  // play order by construction — see afterWbIndex above); an LB round's
  // OTHER input (its own prior LB round's survivors) was staged earlier,
  // which is fine since staging (T.pendingBracketSeeds) is dict-based, not
  // adjacency-dependent — exactly the same reasoning the 1v1 code already
  // establishes.
  var sequence = [];
  for (var k3 = 0; k3 < R; k3++) {
    sequence.push({ type: 'wb', wbIndex: k3 });
    lb.forEach(function (l, li) { if (l.afterWbIndex === k3) sequence.push({ type: 'lb', lbIndex: li }); });
  }
  sequence.push({ type: 'final' });
  var finalPosition = sequence.length - 1;
  var baseIdx = startRoundNum - 1;

  function nextWbPosition(afterPos) {
    for (var p = afterPos + 1; p < sequence.length; p++) if (sequence[p].type === 'wb') return p;
    return -1;
  }
  // The next position that ISN'T a WB round — either the next LB round, or
  // the Final itself once no LB rounds remain (the sequence always ends
  // with exactly one 'final' entry, so this never returns -1 in practice).
  function nextLbOrFinalPosition(afterPos) {
    for (var p = afterPos + 1; p < sequence.length; p++) if (sequence[p].type !== 'wb') return p;
    return finalPosition;
  }
  // A WB round's losers route via whichever LB round resolved them (see
  // afterWbIndex above) — this looks up that LB round's own SEQUENCE
  // position (not its lb[] array index, which is a different numbering) by
  // scanning the now-fully-built sequence once per WB round.
  function lbSequencePosition(wbIndex) {
    var lbIdx = wbLosersLbIndex[wbIndex];
    if (lbIdx === null) return null;
    for (var p = 0; p < sequence.length; p++) {
      if (sequence[p].type === 'lb' && sequence[p].lbIndex === lbIdx) return p;
    }
    return null;
  }

  var rounds = sequence.map(function (entry, pos) {
    var winnersToPos = null, losersToPos = null;
    if (entry.type === 'wb') {
      losersToPos = lbSequencePosition(entry.wbIndex);
      winnersToPos = entry.wbIndex === R - 1 ? finalPosition : nextWbPosition(pos);
    } else if (entry.type === 'lb') {
      winnersToPos = nextLbOrFinalPosition(pos);
      losersToPos = null; // a second LB loss is final — nowhere to go
    }
    // entry.type === 'final': both stay null, nothing routes out of it.

    var roundNum = startRoundNum + pos;
    var base = {
      roundNum: roundNum, isQual: false, isNoElim: false, isSemis: false,
      winnersTo: winnersToPos === null ? null : baseIdx + winnersToPos,
      losersTo: losersToPos === null ? null : baseIdx + losersToPos
    };
    if (entry.type === 'wb') {
      var w = wb[entry.wbIndex];
      return Object.assign(base, {
        bracket: 'winners', isFinal: false, rooms: w.rooms, byeCount: w.byeCount, players: w.players,
        advTotal: w.advTotal, advPerRoom: w.advPerRoom, luckyCount: w.luckyCount
      });
    }
    if (entry.type === 'lb') {
      var l = lb[entry.lbIndex];
      return Object.assign(base, {
        bracket: 'losers', isFinal: false, rooms: l.rooms, byeCount: l.byeCount, players: l.players,
        advTotal: l.advTotal, advPerRoom: l.advPerRoom, luckyCount: l.luckyCount
      });
    }
    // Shared Final — deliberately carries NO round.bracket tag (see the
    // file-header comment above for why). Always exactly ONE literal room
    // (`[FINAL]`, not distributeRooms(FINAL, roomSize)) — matching
    // singleEliminationBracketPhase's own Final precedent exactly, since
    // the rest of the app (Bracket/Scoreboard/Rankings) treats "the Final"
    // as one shared room where every finalist's score is directly
    // comparable; splitting it across rooms would silently break that
    // assumption everywhere else, not just here. An oversized FINAL (e.g.
    // from a Final-size override) is caught by the existing
    // validateRoomCap() check that already runs generically on every
    // bracket phase's output after buildProgression() — not this
    // function's job to pre-empt.
    return {
      roundNum: roundNum, isQual: false, isNoElim: false, isSemis: false, isFinal: true,
      rooms: [FINAL], byeCount: 0, players: FINAL,
      advPerRoom: 1, advTotal: 1, luckyCount: 0,
      numGames: descriptor.config.finalsGames,
      winnersTo: null, losersTo: null
    };
  });

  return rounds;
}

// --- Orchestrator (registered by every SCHEDULE_LOGICS entry that composes
// a pooling phase with a bracket phase — today, all three entries do) ---
// Thin composition of one pooling phase + one bracket phase, both read from
// gamemodeConfig (populated at generation time — see proceedGenerateSchedule()
// — the same way roomSize/qualRounds/semisSize/finalSize already are).
// poolingPhase is a direct organiser choice (the "Pooling phase" dropdown);
// bracketPhase is derived from T.scheduleLogic (the "Schedule logic" setup
// dropdown — see "True single-elimination bracket phase" in HANDOFF.md).
// This function used to BE classic-elimination's tangled pooling+bracket
// logic directly; now it's just wiring two phases together and concatenating
// their rounds, reused verbatim by every schedule logic built this way — see
// "Phase composability refactor" in HANDOFF.md.
function composedBuildProgression(cfg, descriptor) {
  var poolingPhase = descriptor.config.poolingPhase;
  var bracketPhase = descriptor.config.bracketPhase;
  var pooled = POOLING_PHASES[poolingPhase](cfg, descriptor);
  var bracket = BRACKET_PHASES[bracketPhase](pooled.seedTotal, pooled.nextRoundNum, descriptor);
  return pooled.rounds.concat(bracket);
}
