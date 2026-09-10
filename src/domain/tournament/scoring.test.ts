import { describe, expect, it } from 'vitest';
import {
  fairPoints,
  getDefenderIndex,
  getFinalUnitScore,
  getUnitScore,
  groupByScore,
  orderRoomByScore,
  scoreKeysForPosition,
  tieResolutionList,
} from './scoring';
import { createDefaultTournamentState } from './state-defaults';
import { buildRound } from './test-fixtures';

describe('getDefenderIndex', () => {
  it('returns 0 by default with no defenderChanges', () => {
    expect(getDefenderIndex({ defenderChanges: {} }, 'team1', 5)).toBe(0);
  });

  it('returns the most recent change at or before the given round', () => {
    const state = {
      defenderChanges: {
        team1: [
          { round: 0, memberIdx: 1 },
          { round: 3, memberIdx: 2 },
        ],
      },
    };
    expect(getDefenderIndex(state, 'team1', 3)).toBe(2);
    expect(getDefenderIndex(state, 'team1', 2)).toBe(1);
    expect(getDefenderIndex(state, 'team1', 5)).toBe(2);
  });
});

describe('getUnitScore', () => {
  it('reads a single-game individual score from the r{ri}-rm{room}-p{position} key', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0': 500 },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(500);
  });

  it('applies the fallback when the key is missing', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: {},
    });
    expect(getUnitScore(state, 0, 1, 5, 42)).toBe(42);
  });

  it('sums team member scores across -m{memberIdx} keys under sum-members', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [{ teamId: 't1', teamName: 'Team One', members: [{ name: 'A' }, { name: 'B' }] }],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0-m0': 300, 'r0-rm1-p0-m1': 200 },
      gamemodeConfig: { teamScoringRule: 'sum-members' },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(500);
  });

  it("picks only the defender's score under designated-player", () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [{ teamId: 't1', teamName: 'Team One', members: [{ name: 'A' }, { name: 'B' }] }],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0-m0': 300, 'r0-rm1-p0-m1': 200 },
      gamemodeConfig: { teamScoringRule: 'designated-player' },
      defenderChanges: { t1: [{ round: 0, memberIdx: 1 }] },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(200);
  });

  it('returns null (not the fallback) when a team score is partially missing and fallback is null', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [{ teamId: 't1', teamName: 'Team One', members: [{ name: 'A' }, { name: 'B' }] }],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0-m0': 300 },
      gamemodeConfig: { teamScoringRule: 'sum-members' },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBeNull();
  });

  it('sums across numGames > 1 games, returning null only under the null fallback', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1], numGames: 3 })],
      scores: { 'r0-rm1-p0-g1': 100, 'r0-rm1-p0-g2': 200 },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBeNull();
    // A zero fallback surfaces the live partial total instead of blocking.
    expect(getUnitScore(state, 0, 1, 0, 0)).toBe(300);
  });
});

describe('getFinalUnitScore', () => {
  it('reads only from the separate finalScores namespace, ignoring a colliding-looking scores key', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isFinal: true, players: 1, rooms: [1] })],
      scores: { 'game1-P1': 999 },
      finalScores: { 'game1-P1': 555 },
    });
    expect(getFinalUnitScore(state, 'P1', 1, null)).toBe(555);
  });
});

describe('scoreKeysForPosition', () => {
  it('enumerates a single key for a single-game individual position', () => {
    expect(scoreKeysForPosition({ roundIndex: 0, room: 1, position: 0 })).toEqual(['r0-rm1-p0']);
  });

  it('enumerates the full game x member cross-product for a multi-game team position', () => {
    const keys = scoreKeysForPosition({ roundIndex: 1, room: 2, position: 0, numGames: 2, teamSize: 3 });
    expect(keys).toEqual([
      'r1-rm2-p0-g1-m0',
      'r1-rm2-p0-g1-m1',
      'r1-rm2-p0-g1-m2',
      'r1-rm2-p0-g2-m0',
      'r1-rm2-p0-g2-m1',
      'r1-rm2-p0-g2-m2',
    ]);
  });
});

describe('fairPoints', () => {
  it('computes rank - score/100_000, exactly', () => {
    expect(fairPoints(1, 1306)).toBe(1 - 1306 / 100_000);
    expect(fairPoints(2, 500)).toBe(2 - 500 / 100_000);
  });

  it('is monotonically more favorable (lower) for a higher score at the same rank', () => {
    expect(fairPoints(1, 1306)).toBeLessThan(fairPoints(1, 1200));
  });
});

describe('groupByScore', () => {
  it('clusters adjacent equal-score entries in a descending-sorted array', () => {
    const scored = [{ score: 10 }, { score: 10 }, { score: 8 }, { score: 8 }, { score: 8 }, { score: 5 }];
    expect(groupByScore(scored).map((cluster) => cluster.map((entry) => entry.score))).toEqual([
      [10, 10],
      [8, 8, 8],
      [5],
    ]);
  });

  it('does not retroactively merge non-adjacent equal scores', () => {
    const scored = [{ score: 10 }, { score: 8 }, { score: 10 }, { score: 5 }];
    expect(groupByScore(scored)).toHaveLength(4);
  });
});

describe('tieResolutionList', () => {
  it('normalizes a string entry to a single-element array', () => {
    expect(tieResolutionList({ tieResolutions: { key1: 'P1' } }, 'key1')).toEqual(['P1']);
  });

  it('returns an array entry unchanged', () => {
    expect(tieResolutionList({ tieResolutions: { key1: ['P1', 'P2'] } }, 'key1')).toEqual(['P1', 'P2']);
  });

  it('returns [] when the key is absent', () => {
    expect(tieResolutionList({ tieResolutions: {} }, 'missing')).toEqual([]);
  });
});

describe('orderRoomByScore', () => {
  const noResolutions = { tieResolutions: {} };

  it('sorts strictly by score when no ties exist', () => {
    const scored = [
      { name: 'A', score: 5 },
      { name: 'B', score: 10 },
      { name: 'C', score: 1 },
    ];
    expect(orderRoomByScore(scored, 0, 1, noResolutions).map((entry) => entry.name)).toEqual(['B', 'A', 'C']);
  });

  it('orders a tied cluster by tieResolutionList, resolved names first in resolution order', () => {
    const scored = [
      { name: 'A', score: 10 },
      { name: 'B', score: 10 },
      { name: 'C', score: 10 },
    ];
    const state = { tieResolutions: { 'r0-rm1-s10': ['C', 'A'] } };
    expect(orderRoomByScore(scored, 0, 1, state).map((entry) => entry.name)).toEqual(['C', 'A', 'B']);
  });

  it('places unresolved names within a tied cluster after resolved ones, preserving relative order', () => {
    const scored = [
      { name: 'A', score: 10 },
      { name: 'B', score: 10 },
      { name: 'C', score: 10 },
      { name: 'D', score: 10 },
    ];
    const state = { tieResolutions: { 'r0-rm1-s10': ['B'] } };
    expect(orderRoomByScore(scored, 0, 1, state).map((entry) => entry.name)).toEqual(['B', 'A', 'C', 'D']);
  });
});
