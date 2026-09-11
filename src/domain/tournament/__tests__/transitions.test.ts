import { describe, expect, it } from 'vitest';
import { advanceTournamentRound } from '../transitions';
import { raceDoubleEliminationBracketPhase } from '../double-elimination';
import { createDefaultTournamentState } from '../state-defaults';
import { buildRound } from './test-fixtures';

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
      // and snakeSeed's own bounce order is exactly what's under test here.
      expect(byRoom.get(1)?.sort()).toEqual(['P1', 'P4']);
      expect(byRoom.get(2)?.sort()).toEqual(['P2', 'P3']);
    }

    // Without groupStage on the CURRENT round, avoidSameGroupInFirstBracketRound
    // must never run, even though `state.groups` still has data. Room-based
    // direct advancement (isNoElim) here produces raw order [P1,P2,P4,P3]
    // (score-descending within each room, room 1 fully before room 2),
    // confirmed directly by running it -- snakeSeed's 2-room bounce then
    // places rm1=[P1,P3], rm2=[P2,P4]. Redefining the groups (independent of
    // round-0's real room membership -- irrelevant here, since this branch
    // never reaches computeGroupStageAdvancement/computeGroupStandings) as
    // A:{P1,P3}, B:{P2,P4} makes rm1/rm2 each a genuine same-group collision
    // -- if the isGroupStage guard were missing and avoidance ran anyway, a
    // valid swap (P3<->P2) exists and would change the output. Asserting the
    // raw, unswapped result is therefore a real test of the guard, not just
    // of snakeSeed's own bounce order.
    const plain = buildState(false);
    plain.groups = [
      { label: 'A', members: ['P1', 'P3'] },
      { label: 'B', members: ['P2', 'P4'] },
    ];
    const withoutAvoidance = advanceTournamentRound(plain);
    expect(withoutAvoidance.status).toBe('advanced');
    if (withoutAvoidance.status === 'advanced') {
      const byRoom = new Map<number, string[]>();
      for (const a of withoutAvoidance.state.assignments[1]) {
        byRoom.set(a.room as number, [...(byRoom.get(a.room as number) ?? []), a.name]);
      }
      expect(byRoom.get(1)?.sort()).toEqual(['P1', 'P3']);
      expect(byRoom.get(2)?.sort()).toEqual(['P2', 'P4']);
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
