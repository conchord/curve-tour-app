import { describe, expect, it } from 'vitest';
import {
  computeGroupStandings,
  computeQualificationStandings,
  detectTieBreaks,
  doubleEliminationComputeAdvancement,
  hasPendingTies,
  invalidateStaleTieResolutions,
  isTieResolved,
  roomBasedComputeAdvancement,
} from './advancement';
import { createDefaultTournamentState } from './state-defaults';
import { buildRound } from './test-fixtures';

describe('detectTieBreaks', () => {
  it('detects a tie on the multi-game total, not a single game score', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, numGames: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0-g1': 300,
        'r0-rm1-p0-g2': 200,
        'r0-rm1-p1-g1': 100,
        'r0-rm1-p1-g2': 400,
      },
    });
    const ties = detectTieBreaks(0, state.rounds[0], state);
    expect(Object.keys(ties)).toEqual(['r0-rm1-s500']);
    expect(ties['r0-rm1-s500'].players.map((p) => p.name).sort()).toEqual(['P1', 'P2']);
  });

  it('does not report a tie when only a single game matches but totals differ', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, numGames: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0-g1': 300,
        'r0-rm1-p0-g2': 200,
        'r0-rm1-p1-g1': 300,
        'r0-rm1-p1-g2': 300,
      },
    });
    expect(detectTieBreaks(0, state.rounds[0], state)).toEqual({});
  });

  it('never reports a tie on the Final round', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isFinal: true, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 500 },
    });
    expect(detectTieBreaks(0, state.rounds[0], state)).toEqual({});
  });
});

describe('isTieResolved / hasPendingTies', () => {
  const threeWayState = createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    rounds: [buildRound({ roundNum: 1, rooms: [3], players: 3 })],
    assignments: [
      [
        { name: 'P1', room: 1, isLucky: false },
        { name: 'P2', room: 1, isLucky: false },
        { name: 'P3', room: 1, isLucky: false },
      ],
    ],
    scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 500, 'r0-rm1-p2': 500 },
  });

  it('requires K-1 resolutions for a K-way tie', () => {
    const ties = detectTieBreaks(0, threeWayState.rounds[0], threeWayState);
    const cluster = ties['r0-rm1-s500'];
    expect(isTieResolved('r0-rm1-s500', cluster, { tieResolutions: {} })).toBe(false);
    expect(isTieResolved('r0-rm1-s500', cluster, { tieResolutions: { 'r0-rm1-s500': ['P1'] } })).toBe(false);
    expect(isTieResolved('r0-rm1-s500', cluster, { tieResolutions: { 'r0-rm1-s500': ['P1', 'P2'] } })).toBe(
      true,
    );
  });

  it('hasPendingTies flips from true to false once the tie is fully resolved', () => {
    const twoWayState = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 500 },
    });
    expect(hasPendingTies(twoWayState, 0)).toBe(true);
    const resolved = { ...twoWayState, tieResolutions: { 'r0-rm1-s500': ['P1'] } };
    expect(hasPendingTies(resolved, 0)).toBe(false);
  });
});

describe('invalidateStaleTieResolutions', () => {
  it('drops a resolution whose recorded cluster no longer exists at that key', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      // P1 now scores 600, no longer tied with P2 at 500 -- the recorded
      // resolution for the old "r0-rm1-s500" cluster is now stale.
      scores: { 'r0-rm1-p0': 600, 'r0-rm1-p1': 500 },
      tieResolutions: { 'r0-rm1-s500': ['P1'] },
    });
    const result = invalidateStaleTieResolutions(state, 0, 1);
    expect(result.tieResolutions).toEqual({});
  });

  it('leaves a still-valid resolution untouched (same state reference, no change)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 500 },
      tieResolutions: { 'r0-rm1-s500': ['P1'] },
    });
    expect(invalidateStaleTieResolutions(state, 0, 1)).toBe(state);
  });
});

describe('computeQualificationStandings', () => {
  it('orders standings ascending by fairPoints across independent rooms', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      cfg: { poolingPhase: 'qual-table' },
      rounds: [buildRound({ roundNum: 1, isQual: true, rooms: [2, 2], players: 4 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      // room1: P1=100 (rank1), P2=50 (rank2). room2: P3=200 (rank1), P4=10 (rank2).
      // fairPoints(1,200) < fairPoints(1,100) < fairPoints(2,50) < fairPoints(2,10).
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50, 'r0-rm2-p0': 200, 'r0-rm2-p1': 10 },
    });
    expect(computeQualificationStandings(state).map((entry) => entry.name)).toEqual(['P3', 'P1', 'P2', 'P4']);
  });
});

describe('computeGroupStandings', () => {
  it('partitions standings by group, independently of overall performance', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      groups: [
        { label: 'A', members: ['P1', 'P2'] },
        { label: 'B', members: ['P3', 'P4'] },
      ],
      rounds: [
        buildRound({
          roundNum: 1,
          isGroupStage: true,
          rooms: [2, 2],
          roomGroups: ['A', 'B'],
          players: 4,
        }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50, 'r0-rm2-p0': 5, 'r0-rm2-p1': 1 },
    });
    const standings = computeGroupStandings(state);
    expect(standings.A.map((entry) => entry.name)).toEqual(['P1', 'P2']);
    expect(standings.B.map((entry) => entry.name)).toEqual(['P3', 'P4']);
  });
});

describe('roomBasedComputeAdvancement', () => {
  it('excludes an all-zero-score room from lucky-loser candidacy even though it structurally qualifies', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({ roundNum: 1, rooms: [8, 8], advPerRoom: 6, luckyCount: 1, advTotal: 13, players: 16 }),
      ],
      assignments: [
        [
          ...['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map((name) => ({
            name,
            room: 1,
            isLucky: false,
          })),
          ...['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'].map((name) => ({
            name,
            room: 2,
            isLucky: false,
          })),
        ],
      ],
      scores: {
        'r0-rm1-p0': 800,
        'r0-rm1-p1': 700,
        'r0-rm1-p2': 600,
        'r0-rm1-p3': 500,
        'r0-rm1-p4': 400,
        'r0-rm1-p5': 300,
        'r0-rm1-p6': 200,
        'r0-rm1-p7': 100,
        'r0-rm2-p0': 0,
        'r0-rm2-p1': 0,
        'r0-rm2-p2': 0,
        'r0-rm2-p3': 0,
        'r0-rm2-p4': 0,
        'r0-rm2-p5': 0,
        'r0-rm2-p6': 0,
        'r0-rm2-p7': 0,
      },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    // Room 2's candidate (Q7) sits at the boundary too, but its room total is
    // 0, so it's excluded rather than dividing by zero -- P7 is the only
    // lucky loser even though both rooms "structurally" have a candidate.
    expect(result.luckyNames).toEqual(['P7']);
  });

  it('picks the top-luckyCount candidates by relative (pct) score across rooms', () => {
    const buildRoomAssignments = (prefix: string, room: number) =>
      Array.from({ length: 8 }, (_, index) => ({ name: `${prefix}${index + 1}`, room, isLucky: false }));
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [8, 8, 8],
          advPerRoom: 6,
          luckyCount: 2,
          advTotal: 20,
          players: 24,
        }),
      ],
      assignments: [
        [...buildRoomAssignments('P', 1), ...buildRoomAssignments('Q', 2), ...buildRoomAssignments('R', 3)],
      ],
      scores: {
        // Room 1 (P): candidate P7=150, total=2900, pct~=0.0517 (highest)
        'r0-rm1-p0': 700,
        'r0-rm1-p1': 600,
        'r0-rm1-p2': 500,
        'r0-rm1-p3': 400,
        'r0-rm1-p4': 300,
        'r0-rm1-p5': 200,
        'r0-rm1-p6': 150,
        'r0-rm1-p7': 50,
        // Room 2 (Q): candidate Q7=50, total=2760, pct~=0.0181 (lowest)
        'r0-rm2-p0': 700,
        'r0-rm2-p1': 600,
        'r0-rm2-p2': 500,
        'r0-rm2-p3': 400,
        'r0-rm2-p4': 300,
        'r0-rm2-p5': 200,
        'r0-rm2-p6': 50,
        'r0-rm2-p7': 10,
        // Room 3 (R): candidate R7=100, total=2890, pct~=0.0346 (middle)
        'r0-rm3-p0': 700,
        'r0-rm3-p1': 600,
        'r0-rm3-p2': 500,
        'r0-rm3-p3': 400,
        'r0-rm3-p4': 300,
        'r0-rm3-p5': 200,
        'r0-rm3-p6': 100,
        'r0-rm3-p7': 90,
      },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    expect(result.luckyNames).toEqual(['P7', 'R7']);
  });

  it('advances everyone in a no-elim round regardless of luckyCount', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isNoElim: true, rooms: [3], advTotal: 3, players: 3 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 300, 'r0-rm1-p1': 200, 'r0-rm1-p2': 100 },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    expect(result.advancing.map((entry) => entry.name)).toEqual(['P1', 'P2', 'P3']);
    expect(result.luckyNames).toEqual([]);
  });

  it('at a qualification-table cutoff, slices the fairPoints-ordered standings to qualAdv', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      cfg: { poolingPhase: 'qual-table', qualAdv: 2 },
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [4], players: 4 }),
        buildRound({ roundNum: 2, isQual: false, rooms: [2], players: 2 }),
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
    });
    const result = roomBasedComputeAdvancement(state, 0);
    expect(result.advancing).toEqual([
      { name: 'P1', isLucky: false },
      { name: 'P2', isLucky: false },
    ]);
    expect(result.luckyNames).toBeNull();
    expect(result.qualTable).toHaveLength(4);
  });

  it('at a group-stage handoff, interleaves cross-group qualifiers by finish tier', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      cfg: { qualifiersPerGroup: 2 },
      groups: [
        { label: 'A', members: ['P1', 'P2'] },
        { label: 'B', members: ['P3', 'P4'] },
      ],
      rounds: [
        buildRound({
          roundNum: 1,
          isGroupStage: true,
          rooms: [2, 2],
          roomGroups: ['A', 'B'],
          players: 4,
        }),
        buildRound({ roundNum: 2, isGroupStage: false, rooms: [4], players: 4 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
      // Group A: P1 beats P2. Group B: P4 beats P3 (P4's fairPoints will beat P1's).
      scores: { 'r0-rm1-p0': 50, 'r0-rm1-p1': 10, 'r0-rm2-p0': 5, 'r0-rm2-p1': 100 },
    });
    const result = roomBasedComputeAdvancement(state, 0);
    // Tier 1 (rank-1 finishers, sorted among themselves by fairPoints) first,
    // then tier 2 (rank-2 finishers) -- never clustered by group.
    expect(result.advancing.map((entry) => entry.name)).toEqual(['P4', 'P1', 'P2', 'P3']);
  });
});

describe('doubleEliminationComputeAdvancement', () => {
  it('routes the top advPerRoom per room to winners and the rest to losers', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, rooms: [4], advPerRoom: 2, luckyCount: 0, bracket: 'winners' })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
    });
    const result = doubleEliminationComputeAdvancement(state, 0);
    expect(result.winners.map((entry) => entry.name)).toEqual(['P1', 'P2']);
    expect(result.losers.map((entry) => entry.name)).toEqual(['P3', 'P4']);
    expect(result.luckyNames).toEqual([]);
  });

  it('excludes a lucky-loser winner from the losers list (promoted, not double-counted)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({
          roundNum: 1,
          rooms: [8, 8],
          advPerRoom: 6,
          luckyCount: 1,
          bracket: 'winners',
          players: 16,
        }),
      ],
      assignments: [
        [
          ...['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map((name) => ({
            name,
            room: 1,
            isLucky: false,
          })),
          ...['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'].map((name) => ({
            name,
            room: 2,
            isLucky: false,
          })),
        ],
      ],
      scores: {
        'r0-rm1-p0': 800,
        'r0-rm1-p1': 700,
        'r0-rm1-p2': 600,
        'r0-rm1-p3': 500,
        'r0-rm1-p4': 400,
        'r0-rm1-p5': 300,
        'r0-rm1-p6': 250,
        'r0-rm1-p7': 50,
        'r0-rm2-p0': 800,
        'r0-rm2-p1': 700,
        'r0-rm2-p2': 600,
        'r0-rm2-p3': 500,
        'r0-rm2-p4': 400,
        'r0-rm2-p5': 300,
        'r0-rm2-p6': 10,
        'r0-rm2-p7': 5,
      },
    });
    const result = doubleEliminationComputeAdvancement(state, 0);
    expect(result.luckyNames).toEqual(['P7']);
    expect(result.winners.map((entry) => entry.name)).toContain('P7');
    expect(result.losers.map((entry) => entry.name)).not.toContain('P7');
    expect(result.losers.map((entry) => entry.name)).toEqual(['P8', 'Q7', 'Q8']);
  });
});
