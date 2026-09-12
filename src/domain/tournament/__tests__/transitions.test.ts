import { describe, expect, it } from 'vitest';
import { advanceTournamentRound } from '../transitions';
import {
  raceDoubleEliminationBracketPhase,
  sharedFinalDoubleEliminationBracketPhase,
} from '../double-elimination';
import { roomPairKey, snakeSeed } from '../seeding';
import { createDefaultTournamentState } from '../state-defaults';
import { buildRound } from './test-fixtures';
import type { RoundAssignment } from '../types';

describe('advanceTournamentRound — missing roomSize backstop', () => {
  it('returns blocked/"missing-room-size" (not a throw) for a bracket round with no gamemodeConfig.roomSize', () => {
    const state = createDefaultTournamentState({
      rounds: [
        buildRound({ roundNum: 1, bracket: 'winners', rooms: [2], players: 2, advPerRoom: 1 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [[{ name: 'P1', room: 1, isLucky: false }]],
      gamemodeConfig: {},
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toBe('missing-room-size');
  });

  it('returns blocked/"missing-room-size" (not a throw) when advancing into a Swiss round with no gamemodeConfig.roomSize', () => {
    const state = createDefaultTournamentState({
      rounds: [
        buildRound({ roundNum: 1, isNoElim: true, rooms: [2], players: 2, advTotal: 2 }),
        buildRound({ roundNum: 2, isSwiss: true, rooms: [2], players: 2 }),
      ],
      assignments: [[{ name: 'P1', room: 1, isLucky: false }]],
      gamemodeConfig: {},
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toBe('missing-room-size');
  });

  it('returns blocked/"missing-room-size" (not a throw) for an ordinary round with no gamemodeConfig.roomSize', () => {
    const state = createDefaultTournamentState({
      rounds: [
        buildRound({ roundNum: 1, isNoElim: true, rooms: [2], players: 2, advTotal: 2 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [[{ name: 'P1', room: 1, isLucky: false }]],
      gamemodeConfig: {},
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toBe('missing-room-size');
  });
});

describe('advanceTournamentRound — noop/blocked guards', () => {
  it('returns noop/"last-round" when there is no next round', () => {
    const state = createDefaultTournamentState({
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, isFinal: true })],
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('noop');
    expect(result.status === 'noop' && result.reason).toBe('last-round');
  });

  it('returns blocked/"pending-ties" when an unresolved tie exists, without advancing', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      rounds: [
        buildRound({ roundNum: 1, rooms: [4], advPerRoom: 2, luckyCount: 0, players: 4 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 100, 'r0-rm1-p2': 50, 'r0-rm1-p3': 10 },
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toBe('pending-ties');
    expect(state.curRound).toBe(0); // input untouched
  });

  it('advances once the tie is resolved', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      rounds: [
        buildRound({ roundNum: 1, rooms: [4], advPerRoom: 2, luckyCount: 0, players: 4 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 100, 'r0-rm1-p2': 50, 'r0-rm1-p3': 10 },
      tieResolutions: { 'r0-rm1-s100': ['P1'] },
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    expect(result.status === 'advanced' && result.state.curRound).toBe(1);
  });
});

describe('advanceTournamentRound — double-elimination routing', () => {
  it('delegates to advanceDoubleElimination for a real generated bracket:"winners" round', () => {
    const rounds = raceDoubleEliminationBracketPhase(4, 1, {
      roomSize: { min: 2, max: 2, ideal: 2 },
      oddCountStrategy: 'bye',
    });
    const wb0 = rounds[0];
    expect(wb0.bracket).toBe('winners');
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      rounds,
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50, 'r0-rm2-p0': 100, 'r0-rm2-p1': 50 },
      byes: rounds.map(() => []),
      luckyLosers: rounds.map(() => []),
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    // P1 and P3 win their rooms; the losers-bracket round is round0.losersTo.
    const losersTargetIndex = wb0.losersTo as number;
    expect(result.state.curRound).toBe(losersTargetIndex);
    expect(result.state.assignments[losersTargetIndex]?.map((a) => a.name).sort()).toEqual(['P2', 'P4']);
    // The winners are staged for the winners-target round, not yet seeded.
    const winnersTargetIndex = wb0.winnersTo as number;
    expect(result.state.pendingBracketSeeds[winnersTargetIndex]?.map((a) => a.name).sort()).toEqual([
      'P1',
      'P3',
    ]);
  });

  it('returns noop/"grand-final" for a bracket:"grand-final" round without touching state', () => {
    const state = createDefaultTournamentState({
      rounds: [
        buildRound({
          roundNum: 1,
          isFinal: true,
          bracket: 'grand-final',
          rooms: [2],
          players: 2,
        }),
        buildRound({ roundNum: 2, rooms: [1], players: 1 }), // dummy, just to pass the "has next round" guard
      ],
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result).toEqual({ status: 'noop', reason: 'grand-final', state });
  });
});

describe('advanceTournamentRound — bye-prepend dedup at a cumulative-standings cutoff', () => {
  it('a bye recipient who already qualifies via standings appears exactly once, not duplicated', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      cfg: { poolingPhase: 'qual-table', qualAdv: 2 },
      players: ['P1', 'P2', 'P3', 'P4'],
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [4], players: 4 }),
        buildRound({ roundNum: 2, isQual: true, rooms: [3], players: 3 }),
        buildRound({ roundNum: 3, isQual: false, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: null, isLucky: false }, // P4's bye in round 1
        ],
      ],
      // Round 0: P4 wins big (rank1), everyone else ranked below.
      // Round 1: P4 sits out; P1 wins the round among the 3 who play.
      // P4's single strong round-0 result alone outranks everyone else's
      // two-round cumulative total, so P4 legitimately qualifies via
      // standings for the round-1 cutoff -- while ALSO being round 1's bye.
      scores: {
        'r0-rm1-p0': 80,
        'r0-rm1-p1': 60,
        'r0-rm1-p2': 40,
        'r0-rm1-p3': 100,
        'r1-rm1-p0': 90,
        'r1-rm1-p1': 70,
        'r1-rm1-p2': 50,
      },
      byes: [[], ['P4'], []],
      curRound: 1,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    const advancedNames = result.state.assignments[2].map((a) => a.name);
    expect(advancedNames.filter((name) => name === 'P4')).toHaveLength(1);
    expect(advancedNames).toHaveLength(2); // qualAdv=2, not 3
  });
});

describe('advanceTournamentRound — next-round seeding dispatch', () => {
  it("dispatches to group-stage seeding (from the next round's own matches/byes) when nextRound.isGroupStage", () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      rounds: [
        buildRound({ roundNum: 1, isNoElim: true, rooms: [4], advTotal: 4, players: 4 }),
        buildRound({
          roundNum: 2,
          isGroupStage: true,
          rooms: [2],
          players: 2,
          matches: [{ group: 'A', pair: ['P1', 'P2'] }],
          groupByes: ['P3'],
        }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 200, 'r0-rm1-p2': 100 },
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    expect(result.state.assignments[1]).toEqual([
      { name: 'P1', room: 1, isLucky: false },
      { name: 'P2', room: 1, isLucky: false },
      { name: 'P3', room: null, isLucky: false },
    ]);
    expect(result.state.byes[1]).toEqual(['P3']);
  });

  it('dispatches to Swiss fold-pairing when nextRound.isSwiss', () => {
    const players = ['P1', 'P2', 'P3', 'P4'];
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      players,
      rounds: [
        buildRound({ roundNum: 1, isNoElim: true, rooms: [4], advTotal: 4, players: 4 }),
        buildRound({ roundNum: 2, isSwiss: true, pairingTBD: true, rooms: [2, 2], players: 4 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    // No qual/swiss rounds played yet -> roster-order fold, matching
    // seeding.test.ts's already-verified "rank i vs rank i+half" case.
    expect(result.state.assignments[1]).toEqual([
      { name: 'P1', room: 1, isLucky: false },
      { name: 'P3', room: 1, isLucky: false },
      { name: 'P2', room: 2, isLucky: false },
      { name: 'P4', room: 2, isLucky: false },
    ]);
  });

  it('applies avoidSameGroupInFirstBracketRound only when the CURRENT round isGroupStage', () => {
    const buildState = (isGroupStage: boolean) =>
      createDefaultTournamentState({
        gameFormat: 'ffa-individual',
        gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
        cfg: { qualifiersPerGroup: 2 },
        groups: [
          { label: 'A', members: ['P1', 'P2'] },
          { label: 'B', members: ['P3', 'P4'] },
        ],
        rounds: [
          buildRound({
            roundNum: 1,
            isGroupStage,
            // isNoElim so every player advances regardless of which branch
            // (computeGroupStageAdvancement vs. the plain per-room path)
            // computes the advancing list -- keeps both cases comparable.
            isNoElim: true,
            rooms: [2, 2],
            roomGroups: isGroupStage ? ['A', 'B'] : undefined,
            players: 4,
          }),
          buildRound({ roundNum: 2, rooms: [2, 2], players: 4 }),
        ],
        assignments: [
          [
            { name: 'P1', room: 1, isLucky: false },
            { name: 'P2', room: 1, isLucky: false },
            { name: 'P3', room: 2, isLucky: false },
            { name: 'P4', room: 2, isLucky: false },
          ],
        ],
        scores: { 'r0-rm1-p0': 50, 'r0-rm1-p1': 10, 'r0-rm2-p0': 5, 'r0-rm2-p1': 100 },
        curRound: 0,
      });

    const withAvoidance = advanceTournamentRound(buildState(true));
    expect(withAvoidance.status).toBe('advanced');
    if (withAvoidance.status === 'advanced') {
      const byRoom = new Map<number, string[]>();
      for (const a of withAvoidance.state.assignments[1]) {
        byRoom.set(a.room as number, [...(byRoom.get(a.room as number) ?? []), a.name]);
      }
      // The invariant avoidSameGroupInFirstBracketRound guarantees: no room
      // holds two players from the same group -- verified directly against
      // real output rather than a hand-derived exact seed, since the
      // interaction between computeGroupStageAdvancement's tier-interleaving
      // and tieredSeed's own tier-rank/pct ordering is exactly what's under
      // test here. tieredSeed's raw output already places P4 (room2 winner,
      // pct .952) and P1 (room1 winner, pct .833) into different rooms (tier
      // 0 alone, one per room), then P2/P3 (tier 1) likewise -- confirmed
      // directly by running it, this particular case needs no swap at all:
      // room1={P4,P2} (one from each group), room2={P1,P3} (ditto).
      expect(byRoom.get(1)?.sort()).toEqual(['P2', 'P4']);
      expect(byRoom.get(2)?.sort()).toEqual(['P1', 'P3']);
    }

    // Without groupStage on the CURRENT round, avoidSameGroupInFirstBracketRound
    // must never run, even though `state.groups` still has data.
    // buildAdvancementTiers re-derives tiers from state.assignments/scores
    // directly, independent of round.isGroupStage, so tieredSeed's raw
    // output is identical either way: room1={P4,P2}, room2={P1,P3} (same as
    // above), confirmed directly by running it. Redefining the groups
    // (independent of round-0's real room membership -- irrelevant here,
    // since this branch never reaches computeGroupStageAdvancement) as
    // A:{P2,P4}, B:{P1,P3} makes rm1/rm2 each a genuine same-group collision
    // -- if the isGroupStage guard were missing and avoidance ran anyway, a
    // valid swap exists and would change the output. Asserting the raw,
    // unswapped result is therefore a real test of the guard, not just of
    // tieredSeed's own tier ordering.
    const plain = buildState(false);
    plain.groups = [
      { label: 'A', members: ['P2', 'P4'] },
      { label: 'B', members: ['P1', 'P3'] },
    ];
    const withoutAvoidance = advanceTournamentRound(plain);
    expect(withoutAvoidance.status).toBe('advanced');
    if (withoutAvoidance.status === 'advanced') {
      const byRoom = new Map<number, string[]>();
      for (const a of withoutAvoidance.state.assignments[1]) {
        byRoom.set(a.room as number, [...(byRoom.get(a.room as number) ?? []), a.name]);
      }
      expect(byRoom.get(1)?.sort()).toEqual(['P2', 'P4']);
      expect(byRoom.get(2)?.sort()).toEqual(['P1', 'P3']);
    }
  });
});

describe('advanceTournamentRound — Kings Valley dispatch', () => {
  it('advances via the merge + sequential-chunk path, matching kingsValleyComputeAdvancement + sequentialSeed by hand', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [4, 4, 4],
          players: 12,
          isKingsValley: true,
          kvPromoteCounts: [1, 1, 1],
          kvDemoteCounts: [1, 1, 0],
          kvEliminateCount: 2,
        }),
        buildRound({ roundNum: 2, rooms: [5, 5], players: 10, isKingsValley: true }),
      ],
      assignments: [
        [
          { name: 'A', room: 1, isLucky: false },
          { name: 'B', room: 1, isLucky: false },
          { name: 'C', room: 1, isLucky: false },
          { name: 'D', room: 1, isLucky: false },
          { name: 'E', room: 2, isLucky: false },
          { name: 'F', room: 2, isLucky: false },
          { name: 'G', room: 2, isLucky: false },
          { name: 'H', room: 2, isLucky: false },
          { name: 'I', room: 3, isLucky: false },
          { name: 'J', room: 3, isLucky: false },
          { name: 'K', room: 3, isLucky: false },
          { name: 'L', room: 3, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 90,
        'r0-rm1-p2': 80,
        'r0-rm1-p3': 70,
        'r0-rm2-p0': 100,
        'r0-rm2-p1': 90,
        'r0-rm2-p2': 80,
        'r0-rm2-p3': 70,
        'r0-rm3-p0': 100,
        'r0-rm3-p1': 90,
        'r0-rm3-p2': 80,
        'r0-rm3-p3': 70,
      },
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    expect(result.state.curRound).toBe(1);
    // nextRoomOrder = [A,B,C,E,D,F,G,I,H,J] chunked into [5,5].
    expect(result.state.assignments[1]).toEqual([
      { name: 'A', room: 1, isLucky: false },
      { name: 'B', room: 1, isLucky: false },
      { name: 'C', room: 1, isLucky: false },
      { name: 'E', room: 1, isLucky: false },
      { name: 'D', room: 1, isLucky: false },
      { name: 'F', room: 2, isLucky: false },
      { name: 'G', room: 2, isLucky: false },
      { name: 'I', room: 2, isLucky: false },
      { name: 'H', room: 2, isLucky: false },
      { name: 'J', room: 2, isLucky: false },
    ]);
    // K and L (room 3's eliminate band) are absent -- the sole elimination signal.
    const nextNames = result.state.assignments[1].map((entry) => entry.name);
    expect(nextNames).not.toContain('K');
    expect(nextNames).not.toContain('L');
  });

  it('advances a Kings Valley round directly into the Final round via the same dispatch', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [4, 4],
          players: 8,
          isKingsValley: true,
          kvPromoteCounts: [1, 1],
          kvDemoteCounts: [1, 0],
          kvEliminateCount: 2,
        }),
        buildRound({ roundNum: 2, isFinal: true, rooms: [6], players: 6, advPerRoom: 1, advTotal: 1 }),
      ],
      assignments: [
        [
          { name: 'A', room: 1, isLucky: false },
          { name: 'B', room: 1, isLucky: false },
          { name: 'C', room: 1, isLucky: false },
          { name: 'D', room: 1, isLucky: false },
          { name: 'E', room: 2, isLucky: false },
          { name: 'F', room: 2, isLucky: false },
          { name: 'G', room: 2, isLucky: false },
          { name: 'H', room: 2, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 90,
        'r0-rm1-p2': 80,
        'r0-rm1-p3': 70,
        'r0-rm2-p0': 100,
        'r0-rm2-p1': 90,
        'r0-rm2-p2': 80,
        'r0-rm2-p3': 70,
      },
      curRound: 0,
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    expect(result.state.assignments[1].map((entry) => entry.name)).toEqual(['A', 'B', 'C', 'E', 'D', 'F']);
    expect(result.state.assignments[1].every((entry) => entry.room === 1)).toBe(true);
  });
});

describe('advanceTournamentRound — tieredSeed reduces round-to-round staleness vs. plain snakeSeed', () => {
  // Note on the metric: "overlap" here means shared ROOMMATE PAIRS across
  // rounds (did these two specific people share a room again), not "did this
  // player keep the same room NUMBER" -- room numbers carry no identity
  // across rounds (confirmed directly: a player keeping the same room
  // NUMBER while gaining entirely new roommates is a success, not staleness)
  // -- pair co-occurrence is the metric the whole feature (and roomHistory
  // itself) is actually built around.
  const staticScore = (name: string) => 100 - Number(name.slice(1));

  function scoresForRooms(roundIndex: number, rooms: string[][]): Record<string, number> {
    const scores: Record<string, number> = {};
    rooms.forEach((names, roomZeroBased) => {
      names.forEach((name, position) => {
        scores[`r${roundIndex}-rm${roomZeroBased + 1}-p${position}`] = staticScore(name);
      });
    });
    return scores;
  }

  function assignmentsFromRooms(rooms: string[][]): RoundAssignment[] {
    return rooms.flatMap((names, roomZeroBased) =>
      names.map((name) => ({ name, room: roomZeroBased + 1, isLucky: false })),
    );
  }

  function roomsFromAssignments(assignments: RoundAssignment[]): string[][] {
    const byRoom = new Map<number, string[]>();
    for (const entry of assignments) {
      if (entry.room === null) continue;
      byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
    }
    return [...byRoom.entries()].sort(([a], [b]) => a - b).map(([, names]) => names);
  }

  /** Plain baseline: room-major/rank-minor (each room's members sorted by
   * static score desc, concatenated room by room) through unmodified
   * snakeSeed -- exactly what the generic path did before this feature. */
  function baselineNextRooms(currentRooms: string[][], roomCount: number): string[][] {
    const advancing = currentRooms.flatMap((names) =>
      [...names].sort((a, b) => staticScore(b) - staticScore(a)),
    );
    return roomsFromAssignments(snakeSeed(advancing, roomCount));
  }

  function pairsIn(rooms: string[][]): Set<string> {
    const pairs = new Set<string>();
    for (const names of rooms) {
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          pairs.add(names[i] < names[j] ? `${names[i]}|${names[j]}` : `${names[j]}|${names[i]}`);
        }
      }
    }
    return pairs;
  }

  /** Total repeat pairs across a full trajectory of rounds (each round's
   * pairs checked against everything accumulated from every earlier round),
   * mirroring roomHistory's own full-history (not just-last-round) scope. */
  function cumulativeRepeats(trajectory: string[][][]): number {
    const seen = new Set<string>();
    let repeats = 0;
    for (const rooms of trajectory) {
      for (const pair of pairsIn(rooms)) {
        if (seen.has(pair)) repeats += 1;
        seen.add(pair);
      }
    }
    return repeats;
  }

  // Three distinct starting layouts for 16 players / 4 rooms of 4 -- "several
  // initial random seedings", hand-constructed (not sorted, not
  // deliberately balanced) so the comparison isn't tuned to one lucky case.
  const seedLayouts: string[][][] = [
    [
      ['P1', 'P6', 'P11', 'P16'],
      ['P2', 'P5', 'P12', 'P15'],
      ['P3', 'P8', 'P9', 'P14'],
      ['P4', 'P7', 'P10', 'P13'],
    ],
    [
      ['P16', 'P2', 'P9', 'P7'],
      ['P1', 'P13', 'P4', 'P10'],
      ['P15', 'P6', 'P3', 'P12'],
      ['P8', 'P14', 'P5', 'P11'],
    ],
    [
      ['P5', 'P12', 'P1', 'P8'],
      ['P16', 'P4', 'P9', 'P13'],
      ['P2', 'P11', 'P6', 'P15'],
      ['P14', 'P3', 'P10', 'P7'],
    ],
  ];

  it('across several distinct starting layouts, chaining real advances accumulates strictly fewer total repeat-pairs than a plain-snakeSeed baseline chained the same way', () => {
    const roundCount = 5; // 5 isNoElim rounds -> 4 real reseed transitions each
    let totalReal = 0;
    let totalBaseline = 0;

    for (const layout of seedLayouts) {
      // --- Real trajectory: driven entirely through advanceTournamentRound. ---
      let state = createDefaultTournamentState({
        gameFormat: 'ffa-individual',
        gamemodeConfig: { roomSize: { min: 4, max: 4, ideal: 4 } },
        players: layout.flat(),
        rounds: Array.from({ length: roundCount }, (_, index) =>
          buildRound({ roundNum: index + 1, isNoElim: true, rooms: [4, 4, 4, 4], players: 16 }),
        ),
        assignments: [assignmentsFromRooms(layout)],
        scores: scoresForRooms(0, layout),
        curRound: 0,
      });
      const realTrajectory: string[][][] = [layout];
      for (let roundIndex = 0; roundIndex < roundCount - 1; roundIndex += 1) {
        const advance = advanceTournamentRound(state);
        expect(advance.status).toBe('advanced');
        if (advance.status !== 'advanced') break;
        state = advance.state;
        const rooms = roomsFromAssignments(state.assignments[roundIndex + 1]);
        realTrajectory.push(rooms);
        state = { ...state, scores: { ...state.scores, ...scoresForRooms(roundIndex + 1, rooms) } };
      }

      // --- Baseline trajectory: plain snakeSeed, chained independently. ---
      const baselineTrajectory: string[][][] = [layout];
      let currentBaselineRooms = layout;
      for (let roundIndex = 0; roundIndex < roundCount - 1; roundIndex += 1) {
        currentBaselineRooms = baselineNextRooms(currentBaselineRooms, 4);
        baselineTrajectory.push(currentBaselineRooms);
      }

      totalReal += cumulativeRepeats(realTrajectory);
      totalBaseline += cumulativeRepeats(baselineTrajectory);
    }

    expect(totalReal).toBeLessThan(totalBaseline);
  });

  it('persists roomHistory across real advances, recording every pair that has actually shared a room', () => {
    const layout = seedLayouts[0];
    let state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 4, max: 4, ideal: 4 } },
      players: layout.flat(),
      rounds: [
        buildRound({ roundNum: 1, isNoElim: true, rooms: [4, 4, 4, 4], players: 16 }),
        buildRound({ roundNum: 2, isNoElim: true, rooms: [4, 4, 4, 4], players: 16 }),
        buildRound({ roundNum: 3, isNoElim: true, rooms: [4, 4, 4, 4], players: 16 }),
      ],
      assignments: [assignmentsFromRooms(layout)],
      scores: scoresForRooms(0, layout),
      curRound: 0,
    });
    expect(state.roomHistory).toEqual({});

    const firstAdvance = advanceTournamentRound(state);
    expect(firstAdvance.status).toBe('advanced');
    if (firstAdvance.status !== 'advanced') return;
    state = firstAdvance.state;
    // recordRoomHistory tags the round being SEEDED INTO (index 1) -- the
    // starting layout (index 0) was never itself seeded by any code here,
    // so it leaves no history of its own.
    const roundIndex1Rooms = roomsFromAssignments(state.assignments[1]);
    const roundIndex1Pairs = pairsIn(roundIndex1Rooms);
    expect(new Set(Object.keys(state.roomHistory))).toEqual(roundIndex1Pairs);
    expect(Object.values(state.roomHistory).every((recordedRoundIndex) => recordedRoundIndex === 1)).toBe(
      true,
    );

    state = { ...state, scores: { ...state.scores, ...scoresForRooms(1, roundIndex1Rooms) } };
    const secondAdvance = advanceTournamentRound(state);
    expect(secondAdvance.status).toBe('advanced');
    if (secondAdvance.status !== 'advanced') return;
    const roundIndex2Pairs = pairsIn(roomsFromAssignments(secondAdvance.state.assignments[2]));
    // Every pair recorded after the first advance is still present (history
    // is cumulative, not just-last-round), plus the second advance's own
    // newly-seeded pairs are now recorded too, tagged with round index 2.
    for (const pair of roundIndex1Pairs) expect(secondAdvance.state.roomHistory[pair]).toBeDefined();
    for (const pair of roundIndex2Pairs) expect(secondAdvance.state.roomHistory[pair]).toBe(2);
  });
});

describe('advanceTournamentRound — double-elimination WB/LB routing via tieredBracketSeed', () => {
  function scoresForAssignments(
    roundIndex: number,
    assignments: RoundAssignment[],
    scoreByName: Record<string, number>,
  ): Record<string, number> {
    const scores: Record<string, number> = {};
    const positionByRoom = new Map<number, number>();
    for (const entry of assignments) {
      if (entry.room === null) continue;
      const position = positionByRoom.get(entry.room) ?? 0;
      scores[`r${roundIndex}-rm${entry.room}-p${position}`] = scoreByName[entry.name];
      positionByRoom.set(entry.room, position + 1);
    }
    return scores;
  }

  function groupByRoom(assignments: RoundAssignment[]): string[][] {
    const byRoom = new Map<number, string[]>();
    for (const entry of assignments) {
      if (entry.room === null) continue;
      byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
    }
    return [...byRoom.entries()].sort(([a], [b]) => a - b).map(([, names]) => [...names].sort());
  }

  // Shared WB0 setup for an 8-player race (1v1) double-elimination bracket:
  // 4 head-to-head rooms; P1/P3/P5/P7 win (rank 0), P2/P4/P6/P8 lose (rank 1,
  // with pct 0.333/0.375/0.412/0.444 respectively -- distinct on purpose, so
  // the losers pool has an unambiguous sort order for tiebreaking).
  function buildRound0Assignments(): RoundAssignment[] {
    return [
      { name: 'P1', room: 1, isLucky: false },
      { name: 'P2', room: 1, isLucky: false },
      { name: 'P3', room: 2, isLucky: false },
      { name: 'P4', room: 2, isLucky: false },
      { name: 'P5', room: 3, isLucky: false },
      { name: 'P6', room: 3, isLucky: false },
      { name: 'P7', room: 4, isLucky: false },
      { name: 'P8', room: 4, isLucky: false },
    ];
  }
  const round0Scores: Record<string, number> = {
    'r0-rm1-p0': 100,
    'r0-rm1-p1': 50,
    'r0-rm2-p0': 100,
    'r0-rm2-p1': 60,
    'r0-rm3-p0': 100,
    'r0-rm3-p1': 70,
    'r0-rm4-p0': 100,
    'r0-rm4-p1': 80,
  };

  it('avoids a repeat pairing (engineered via a pre-existing roomHistory entry) in the very first WB0-to-LB0 reseed', () => {
    const rounds = raceDoubleEliminationBracketPhase(8, 1, {
      roomSize: { min: 2, max: 2, ideal: 2 },
      oddCountStrategy: 'bye',
    });
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      rounds,
      assignments: [buildRound0Assignments()],
      scores: round0Scores,
      byes: rounds.map(() => []),
      luckyLosers: rounds.map(() => []),
      curRound: 0,
      // P4 and P8 already shared a room -- without this, the natural tiered
      // assignment pairs them together in LB0 (hand-verified: the losers
      // pool sorted by pct desc is P8/P6/P4/P2, and the wave-based search
      // places the first wave [P8,P6] into rooms 1/2 with no history to
      // avoid, then places [P4,P2] with P4 defaulting to room 1 alongside
      // P8 absent any repeat pressure). With this entry present, the search
      // must place P4 away from P8 instead.
      roomHistory: { [roomPairKey('P4', 'P8')]: 0 },
    });

    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;

    const lb0Index = rounds[0].losersTo as number;
    expect(result.state.curRound).toBe(lb0Index);
    const rooms = groupByRoom(result.state.assignments[lb0Index]);
    expect(rooms).toContainEqual(['P2', 'P8']);
    expect(rooms).toContainEqual(['P4', 'P6']);
  });

  it("assembles a multi-source pool (LB0's survivors + WB1's own drops) into one correctly-sized, history-aware reseed", () => {
    const rounds = raceDoubleEliminationBracketPhase(8, 1, {
      roomSize: { min: 2, max: 2, ideal: 2 },
      oddCountStrategy: 'bye',
    });
    let state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      rounds,
      assignments: [buildRound0Assignments()],
      scores: round0Scores,
      byes: rounds.map(() => []),
      luckyLosers: rounds.map(() => []),
      curRound: 0,
    });

    const lb0Index = rounds[0].losersTo as number;
    const wb1Index = rounds[0].winnersTo as number;

    // Advance 1: WB0 -> LB0 finalized (P2/P4/P6/P8); WB1's own pool
    // (P1/P3/P5/P7) is staged but not yet finalized.
    const first = advanceTournamentRound(state);
    expect(first.status).toBe('advanced');
    if (first.status !== 'advanced') return;
    state = first.state;
    expect(state.curRound).toBe(lb0Index);

    // Advance 2: LB0 -> WB1 finalized (from the pool WB0 staged); LB0's own
    // winners (P8, P6) are staged toward the absorb round.
    state = {
      ...state,
      scores: {
        ...state.scores,
        ...scoresForAssignments(lb0Index, state.assignments[lb0Index], { P8: 90, P4: 40, P6: 90, P2: 40 }),
      },
    };
    const second = advanceTournamentRound(state);
    expect(second.status).toBe('advanced');
    if (second.status !== 'advanced') return;
    state = second.state;
    expect(state.curRound).toBe(wb1Index);

    // Advance 3: WB1 -> the absorb round finalized, pooling BOTH LB0's
    // already-staged survivors (P8, P6) AND WB1's own just-computed drops
    // (P5, P7) -- the multi-source pool this whole mechanism exists for.
    const absorbIndex = rounds[wb1Index].losersTo as number;
    state = {
      ...state,
      scores: {
        ...state.scores,
        ...scoresForAssignments(wb1Index, state.assignments[wb1Index], { P1: 100, P5: 30, P3: 100, P7: 45 }),
      },
    };
    const third = advanceTournamentRound(state);
    expect(third.status).toBe('advanced');
    if (third.status !== 'advanced') return;
    state = third.state;
    expect(state.curRound).toBe(absorbIndex);

    const absorbAssignments = state.assignments[absorbIndex];
    // The pool is exactly the union of LB0's 2 survivors and WB1's 2
    // losers -- nobody dropped, nobody duplicated.
    expect(new Set(absorbAssignments.map((entry) => entry.name))).toEqual(new Set(['P5', 'P6', 'P7', 'P8']));
    // Room sizes match the round's own declared structure exactly.
    const roomSizes = groupByRoom(absorbAssignments).map((names) => names.length);
    expect(roomSizes.slice().sort()).toEqual(rounds[absorbIndex].rooms.slice().sort());
    // Hand-verified exact assignment: room 1 = {P6, P7}, room 2 = {P8, P5}
    // (the "wave 0" tier-0 pair P6/P8 has no mutual history and no
    // engineered collision to avoid, so it lands via the deterministic
    // first-permutation tiebreak; "wave 1"'s P5/P7 likewise has no repeat
    // pressure against either of them).
    expect(groupByRoom(absorbAssignments)).toEqual([
      ['P6', 'P7'],
      ['P5', 'P8'],
    ]);

    // roomHistory now correctly persists across double-elimination rounds
    // too (previously never recorded at all for this call site) -- every
    // pair seeded at each of the 3 advances above is present, tagged with
    // the round it was actually seeded into.
    expect(state.roomHistory[roomPairKey('P8', 'P4')]).toBe(lb0Index);
    expect(state.roomHistory[roomPairKey('P6', 'P2')]).toBe(lb0Index);
    expect(state.roomHistory[roomPairKey('P1', 'P5')]).toBe(wb1Index);
    expect(state.roomHistory[roomPairKey('P3', 'P7')]).toBe(wb1Index);
  });

  it('respects declared per-room sizes exactly for the shared-final (multi-unit) double-elimination variant too', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(9, 1, {
      roomSize: { min: 3, max: 3, ideal: 3 },
      finalSize: 4,
      lbQualifiers: 1,
      finalsGames: 1,
    });
    const wb0 = rounds[0];
    expect(wb0.bracket).toBe('winners');

    let index = 0;
    const assignments0: RoundAssignment[] = wb0.rooms.flatMap((size, roomZeroBased) =>
      Array.from({ length: size }, () => {
        index += 1;
        return { name: `P${index}`, room: roomZeroBased + 1, isLucky: false };
      }),
    );
    const scores0 = scoresForRoomSizesDescending(0, assignments0);

    const state = createDefaultTournamentState({
      // Individual format on purpose (not team-3v3v3) -- this test only
      // needs a room SIZE bigger than head-to-head to exercise multi-unit
      // tiering; team scoring's own -m{mi} member-key wrapping is an
      // unrelated concern this test doesn't need to engage with.
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 3, max: 3, ideal: 3 } },
      rounds,
      assignments: [assignments0],
      scores: scores0,
      byes: rounds.map(() => []),
      luckyLosers: rounds.map(() => []),
      curRound: 0,
    });

    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;

    const nextIndex = result.state.curRound;
    const nextRound = rounds[nextIndex];
    const actualSizes = groupByRoom(result.state.assignments[nextIndex]).map((names) => names.length);
    expect(actualSizes.slice().sort()).toEqual(nextRound.rooms.slice().sort());
    // roomHistory now records this reseed too (previously never written for
    // double-elimination at all).
    expect(Object.keys(result.state.roomHistory).length).toBeGreaterThan(0);
  });

  /** Descending score within each room by array position -- position 0 always ranks highest. */
  function scoresForRoomSizesDescending(
    roundIndex: number,
    assignments: RoundAssignment[],
  ): Record<string, number> {
    const scores: Record<string, number> = {};
    const positionByRoom = new Map<number, number>();
    for (const entry of assignments) {
      if (entry.room === null) continue;
      const position = positionByRoom.get(entry.room) ?? 0;
      scores[`r${roundIndex}-rm${entry.room}-p${position}`] = 100 - position * 10;
      positionByRoom.set(entry.room, position + 1);
    }
    return scores;
  }
});
