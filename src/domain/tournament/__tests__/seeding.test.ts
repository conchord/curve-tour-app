import { describe, expect, it } from 'vitest';
import {
  assignWaveToRooms,
  avoidSameGroupInFirstBracketRound,
  randomSeed,
  recencyWeight,
  RECENCY_REPEAT_WEIGHT_K,
  roomPairKey,
  selectPoolingBye,
  semisApproachProgress,
  sequentialSeed,
  snakeSeed,
  swissFoldPair,
  tieredSeed,
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

describe('sequentialSeed', () => {
  it('slices an already-ordered list into consecutive room-sized chunks, no reordering', () => {
    expect(sequentialSeed(['A', 'B', 'C', 'D'], [2, 2])).toEqual([
      { name: 'A', room: 1, isLucky: false },
      { name: 'B', room: 1, isLucky: false },
      { name: 'C', room: 2, isLucky: false },
      { name: 'D', room: 2, isLucky: false },
    ]);
  });

  it('handles uneven chunk sizes', () => {
    expect(sequentialSeed(['A', 'B', 'C', 'D', 'E'], [3, 2])).toEqual([
      { name: 'A', room: 1, isLucky: false },
      { name: 'B', room: 1, isLucky: false },
      { name: 'C', room: 1, isLucky: false },
      { name: 'D', room: 2, isLucky: false },
      { name: 'E', room: 2, isLucky: false },
    ]);
  });

  it('stops cleanly rather than crashing when fewer names are supplied than total room capacity', () => {
    expect(sequentialSeed(['A', 'B'], [2, 2])).toEqual([
      { name: 'A', room: 1, isLucky: false },
      { name: 'B', room: 1, isLucky: false },
    ]);
  });
});

describe('recencyWeight', () => {
  it('is exactly 1 + K at roundsAgo=1 (played together last round) and decays toward 1 for older repeats', () => {
    expect(recencyWeight(1)).toBeCloseTo(1 + RECENCY_REPEAT_WEIGHT_K);
    expect(recencyWeight(2)).toBeCloseTo(1 + RECENCY_REPEAT_WEIGHT_K / 2);
    expect(recencyWeight(10)).toBeGreaterThan(1);
    expect(recencyWeight(10)).toBeLessThan(recencyWeight(1));
  });
});

describe('assignWaveToRooms', () => {
  it('avoids placing a candidate into a room already holding a player they have real match history with', () => {
    // Three tierRank-0 candidates (equal tierRank -> balanceCost is
    // identical for every permutation here, isolating repeat-avoidance).
    // Room 1 already holds 'X'; A and X shared a room 2 rounds before the
    // round being seeded into (targetRoundIndex=5 -> roundsAgo=5-3=2).
    const members = [
      { name: 'A', tierRank: 0 },
      { name: 'B', tierRank: 0 },
      { name: 'C', tierRank: 0 },
    ];
    const roomMembersSoFar = new Map([
      [1, ['X']],
      [2, []],
      [3, []],
    ]);
    const roomBalanceSoFar = new Map([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    const result = assignWaveToRooms(members, [1, 2, 3], roomMembersSoFar, roomBalanceSoFar, {
      roomHistory: { [roomPairKey('A', 'X')]: 3 },
      targetRoundIndex: 5,
      allRoomNumbers: [1, 2, 3],
      diversityWeight: 10,
      balanceWeight: 1,
    });
    expect(result.find((entry) => entry.name === 'A')?.room).not.toBe(1);
  });

  it('given two equal-repeat-count choices, prefers avoiding the MORE RECENT repeat over the older one', () => {
    // A has history with both X (room 1, very recent -- roundsAgo=1) and Y
    // (room 2, very old -- roundsAgo=10). B has no history with either.
    // Every permutation forces exactly one repeat (A always joins X or Y) --
    // the search should pick the cheaper, staler one (A+Y), leaving B with X.
    const members = [
      { name: 'A', tierRank: 0 },
      { name: 'B', tierRank: 0 },
    ];
    const roomMembersSoFar = new Map([
      [1, ['X']],
      [2, ['Y']],
    ]);
    const roomBalanceSoFar = new Map([
      [1, 0],
      [2, 0],
    ]);
    const result = assignWaveToRooms(members, [1, 2], roomMembersSoFar, roomBalanceSoFar, {
      roomHistory: {
        [roomPairKey('A', 'X')]: 19, // roundsAgo = 20 - 19 = 1
        [roomPairKey('A', 'Y')]: 10, // roundsAgo = 20 - 10 = 10
      },
      targetRoundIndex: 20,
      allRoomNumbers: [1, 2],
      diversityWeight: 10,
      balanceWeight: 1,
    });
    expect(result.find((entry) => entry.name === 'A')?.room).toBe(2);
    expect(result.find((entry) => entry.name === 'B')?.room).toBe(1);
  });
});

describe('semisApproachProgress', () => {
  const rounds = [
    buildRound({ roundNum: 1, isNoElim: true, rooms: [4, 4], players: 8 }),
    buildRound({ roundNum: 2, isNoElim: true, rooms: [4, 4], players: 8 }),
    buildRound({ roundNum: 3, rooms: [4, 4], players: 8, advPerRoom: 3 }), // first real elim round, index 2
    buildRound({ roundNum: 4, rooms: [4, 4], players: 6, advPerRoom: 2 }), // index 3
    buildRound({ roundNum: 5, rooms: [4, 4], players: 4, advPerRoom: 2 }), // index 4 -- transitions INTO Semis
    buildRound({ roundNum: 6, isSemis: true, rooms: [4], players: 4 }), // index 5
    buildRound({ roundNum: 7, isFinal: true, rooms: [1], players: 1 }), // index 6
  ];

  it('is 0 throughout the no-elim/pooling phase', () => {
    expect(semisApproachProgress(rounds, 0)).toBe(0);
    expect(semisApproachProgress(rounds, 1)).toBe(0);
  });

  it('is 0 at the first real elimination round and rises linearly to 1 at the round transitioning into Semis', () => {
    expect(semisApproachProgress(rounds, 2)).toBe(0);
    expect(semisApproachProgress(rounds, 3)).toBe(0.5);
    expect(semisApproachProgress(rounds, 4)).toBe(1);
  });

  it('falls back to Final when no isSemis round exists, treating the sole elimination round as immediately decisive', () => {
    const noSemis = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, advPerRoom: 1 }),
      buildRound({ roundNum: 2, isFinal: true, rooms: [1], players: 1 }),
    ];
    expect(semisApproachProgress(noSemis, 0)).toBe(1);
  });
});

describe('tieredSeed', () => {
  it('builds a pool from per-room rank tiers (not room-major/rank-minor) and avoids a repeat that plain snakeSeed would have reproduced', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 2, max: 2, ideal: 2 } },
      rounds: [
        // isNoElim forces semisApproachProgress's progress=0 here, isolating
        // the repeat-avoidance mechanism from the Semis taper -- the taper
        // itself is covered separately above.
        buildRound({ roundNum: 1, isNoElim: true, rooms: [4, 4], players: 8, advPerRoom: 2 }),
        buildRound({ roundNum: 2, rooms: [2, 2], players: 4 }),
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
        'r0-rm2-p0': 60,
        'r0-rm2-p1': 50,
        'r0-rm2-p2': 40,
        'r0-rm2-p3': 30,
      },
      // Baseline: what plain room-major/rank-minor concatenation through
      // snakeSeed would have produced for this exact advancing list --
      // confirmed directly below, not assumed.
      roomHistory: {},
    });
    const advancing = [{ name: 'A' }, { name: 'B' }, { name: 'E' }, { name: 'F' }];
    const baseline = snakeSeed(advancing, 2);
    const baselineRoomOf = Object.fromEntries(baseline.map((entry) => [entry.name, entry.room]));
    expect(baselineRoomOf.A).toBe(baselineRoomOf.F); // plain snakeSeed pairs A with F

    // Engineer roomHistory so A and F have real, recent match history --
    // the exact pairing plain snakeSeed would have reproduced above.
    const stateWithHistory = { ...state, roomHistory: { [roomPairKey('A', 'F')]: 0 } };
    const { seeded } = tieredSeed({ state: stateWithHistory, roundIndex: 0, advancing });
    const roomOf = Object.fromEntries(seeded.map((entry) => [entry.name, entry.room]));
    expect(roomOf.A).not.toBe(roomOf.F);
    // Every candidate still placed exactly once, into one of the two rooms.
    expect(seeded).toHaveLength(4);
    expect(new Set(seeded.map((entry) => entry.room))).toEqual(new Set([1, 2]));
  });

  it('chunks into capacity-derived waves so a shrinking room-size distribution (e.g. [3,2] from an uneven cut) is handled correctly', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: { min: 2, max: 3, ideal: 3 } },
      rounds: [
        buildRound({ roundNum: 1, isNoElim: true, rooms: [3, 2], players: 5 }),
        buildRound({ roundNum: 2, rooms: [3, 2], players: 5 }),
      ],
      assignments: [
        [
          { name: 'A', room: 1, isLucky: false },
          { name: 'B', room: 1, isLucky: false },
          { name: 'C', room: 1, isLucky: false },
          { name: 'D', room: 2, isLucky: false },
          { name: 'E', room: 2, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 90,
        'r0-rm1-p2': 80,
        'r0-rm2-p0': 60,
        'r0-rm2-p1': 50,
      },
    });
    const advancing = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }];
    const { seeded } = tieredSeed({ state, roundIndex: 0, advancing });
    expect(seeded).toHaveLength(5);
    const sizeByRoom = new Map<number, number>();
    for (const entry of seeded) {
      if (entry.room === null) continue;
      sizeByRoom.set(entry.room, (sizeByRoom.get(entry.room) ?? 0) + 1);
    }
    expect([...sizeByRoom.entries()].sort()).toEqual([
      [1, 3],
      [2, 2],
    ]);
  });
});
