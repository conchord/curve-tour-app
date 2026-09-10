import { describe, expect, it } from 'vitest';
import {
  avoidSameGroupInFirstBracketRound,
  randomSeed,
  selectPoolingBye,
  snakeSeed,
  swissFoldPair,
} from '../seeding';
import { createDefaultTournamentState } from '../state-defaults';
import { buildRound, sequenceRandom } from './test-fixtures';
import type { RoundAssignment, TournamentGroup } from '../types';

describe('snakeSeed', () => {
  it('fills rooms in order without bouncing when candidates fit exactly one pass', () => {
    const result = snakeSeed(['A', 'B', 'C'], 3);
    expect(result.map((entry) => entry.room)).toEqual([1, 2, 3]);
  });

  it('bounces back down once the last room is reached, then back up', () => {
    const result = snakeSeed(['A', 'B', 'C', 'D', 'E', 'F'], 3);
    expect(result.map((entry) => entry.room)).toEqual([1, 2, 3, 3, 2, 1]);
  });

  it('keeps everyone in the single room when roomCount is 1', () => {
    const result = snakeSeed(['A', 'B', 'C'], 1);
    expect(result.map((entry) => entry.room)).toEqual([1, 1, 1]);
  });

  it('accepts SeedCandidate objects as well as plain name strings', () => {
    const result = snakeSeed(['A', { name: 'B', isLucky: true }], 2);
    expect(result).toEqual([
      { name: 'A', room: 1, isLucky: false },
      { name: 'B', room: 2, isLucky: true },
    ]);
  });
});

describe('randomSeed', () => {
  // Fisher-Yates trace with next() always returning 0:
  // index=3: swapIndex=0 -> [A,B,C,D] becomes [D,B,C,A]
  // index=2: swapIndex=0 -> [D,B,C,A] becomes [C,B,D,A]
  // index=1: swapIndex=0 -> [C,B,D,A] becomes [B,C,D,A]
  const names = ['A', 'B', 'C', 'D'];
  const rooms = [2, 2];

  it('shuffles via Fisher-Yates using the provided RandomSource, matching the exact expected permutation', () => {
    const result = randomSeed(names, rooms, sequenceRandom([0, 0, 0]));
    expect(result.map((entry) => entry.name)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('fills rooms sequentially (chunked), not snaked, per the rooms size array', () => {
    const result = randomSeed(names, rooms, sequenceRandom([0, 0, 0]));
    // Contrast with snakeSeed: room 1 gets the first `rooms[0]` shuffled
    // names in order, room 2 gets the next `rooms[1]` — no zigzag bounce.
    expect(result).toEqual([
      { name: 'B', room: 1, isLucky: false },
      { name: 'C', room: 1, isLucky: false },
      { name: 'D', room: 2, isLucky: false },
      { name: 'A', room: 2, isLucky: false },
    ]);
  });
});

describe('avoidSameGroupInFirstBracketRound', () => {
  const groups: TournamentGroup[] = [
    { label: 'A', members: ['P1', 'P2'] },
    { label: 'B', members: ['P3'] },
    { label: 'C', members: ['P4'] },
  ];

  it('swaps two candidates to separate two same-group members sharing a room', () => {
    const input: RoundAssignment[] = [
      { name: 'P1', room: 1 },
      { name: 'P2', room: 1 },
      { name: 'P3', room: 2 },
      { name: 'P4', room: 2 },
    ];
    const result = avoidSameGroupInFirstBracketRound(input, groups);
    const roomOf = Object.fromEntries(result.map((entry) => [entry.name, entry.room]));
    expect(roomOf.P1).not.toBe(roomOf.P2);
  });

  it('accepts the collision when no valid swap exists anywhere (best-effort, does not throw)', () => {
    const allSameGroup: TournamentGroup[] = [{ label: 'A', members: ['P1', 'P2', 'P3', 'P4'] }];
    const input: RoundAssignment[] = [
      { name: 'P1', room: 1 },
      { name: 'P2', room: 1 },
      { name: 'P3', room: 2 },
      { name: 'P4', room: 2 },
    ];
    expect(() => avoidSameGroupInFirstBracketRound(input, allSameGroup)).not.toThrow();
    const result = avoidSameGroupInFirstBracketRound(input, allSameGroup);
    expect(result).toEqual(input);
  });
});

describe('selectPoolingBye', () => {
  it('picks the first candidate at the group-minimum bye count', () => {
    const advancing = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    const result = selectPoolingBye(advancing, { A: 2, B: 1, C: 1 });
    expect(result?.name).toBe('B');
  });

  it('returns undefined for an empty advancing list', () => {
    expect(selectPoolingBye([], {})).toBeUndefined();
  });
});

describe('swissFoldPair', () => {
  const roomSize = { min: 2, max: 2, ideal: 2 };

  it('throws when roomSize.ideal !== 2', () => {
    expect(() =>
      swissFoldPair({
        activeNames: ['A', 'B', 'C'],
        throughRoundIndex: 0,
        roomSize: { min: 3, max: 3, ideal: 3 },
        state: createDefaultTournamentState(),
      }),
    ).toThrow();
  });

  it('fold-pairs rank i against rank i+half for an even active count', () => {
    // With no scored qual/swiss rounds, computeQualificationStandings leaves
    // every entry's FP null; the stable sort then preserves roster order,
    // giving a fully deterministic "standings" order to fold-pair against.
    const players = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    const state = createDefaultTournamentState({ players, rounds: [] });
    const result = swissFoldPair({
      activeNames: players,
      throughRoundIndex: -1,
      roomSize,
      state,
    });
    expect(result.byeName).toBeNull();
    expect(result.seeded).toEqual([
      { name: 'P1', room: 1, isLucky: false },
      { name: 'P5', room: 1, isLucky: false },
      { name: 'P2', room: 2, isLucky: false },
      { name: 'P6', room: 2, isLucky: false },
      { name: 'P3', room: 3, isLucky: false },
      { name: 'P7', room: 3, isLucky: false },
      { name: 'P4', room: 4, isLucky: false },
      { name: 'P8', room: 4, isLucky: false },
    ]);
  });

  it('benches the fewest-byes-so-far unit on an odd active count, tie-broken toward the median rank', () => {
    const players = Array.from({ length: 9 }, (_, index) => `P${index + 1}`);
    const state = createDefaultTournamentState({
      players,
      rounds: [],
      poolingByeCounts: { P1: 1 },
    });
    const result = swissFoldPair({
      activeNames: players,
      throughRoundIndex: -1,
      roomSize,
      state,
    });
    // P1 already has a bye, so it's excluded from the minimum(0) pool.
    // Among P2..P9, P5 sits closest to the median index (floor(9/2)=4).
    expect(result.byeName).toBe('P5');
    expect(result.poolingByeCounts).toEqual({ P1: 1, P5: 1 });
  });

  it('avoids a rematch by swapping second elements when both resulting pairs become rematch-free', () => {
    const state = createDefaultTournamentState({
      players: ['P1', 'P3', 'P2', 'P4'],
      rounds: [buildRound({ roundNum: 1, isSwiss: true, players: 4, rooms: [2, 2], advTotal: 4 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
      ],
    });
    const result = swissFoldPair({
      activeNames: ['P1', 'P2', 'P3', 'P4'],
      throughRoundIndex: 0,
      roomSize,
      state,
    });
    // Naive fold would reproduce round 1's exact pairing (P1-P2, P3-P4);
    // swapping second elements (-> P1-P4, P3-P2) clears both rematches.
    expect(result.seeded).toEqual([
      { name: 'P1', room: 1, isLucky: false },
      { name: 'P4', room: 1, isLucky: false },
      { name: 'P3', room: 2, isLucky: false },
      { name: 'P2', room: 2, isLucky: false },
    ]);
  });

  it('keeps the naive fold-pairing when a rematch exists but no swap clears both pairs', () => {
    const state = createDefaultTournamentState({
      players: ['P1', 'P3', 'P2', 'P4'],
      rounds: [
        buildRound({ roundNum: 1, isSwiss: true, players: 4, rooms: [2, 2], advTotal: 4 }),
        buildRound({
          roundNum: 2,
          isSwiss: true,
          pairingTBD: true,
          players: 4,
          rooms: [2, 2],
          advTotal: 4,
        }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
          { name: 'P4', room: 2, isLucky: false },
        ],
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P4', room: 1, isLucky: false },
          { name: 'P2', room: 2, isLucky: false },
          { name: 'P3', room: 2, isLucky: false },
        ],
      ],
    });
    const result = swissFoldPair({
      activeNames: ['P1', 'P2', 'P3', 'P4'],
      throughRoundIndex: 1,
      roomSize,
      state,
    });
    // Round 1 played P1-P2/P3-P4; round 2 played P1-P4/P2-P3 — every pair
    // except P1-P3 and P2-P4 has now been played. The naive fold reproduces
    // P1-P2/P3-P4 again; BOTH candidate swaps (P1-P4 and P2-P3) are also
    // already-played, so the rematch is accepted rather than swapped.
    expect(result.seeded).toEqual([
      { name: 'P1', room: 1, isLucky: false },
      { name: 'P2', room: 1, isLucky: false },
      { name: 'P3', room: 2, isLucky: false },
      { name: 'P4', room: 2, isLucky: false },
    ]);
  });
});
