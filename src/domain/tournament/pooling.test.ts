import { describe, expect, it } from 'vitest';
import {
  computeSwissRoundCount,
  groupStagePoolingPhase,
  noEliminationWarmupPoolingPhase,
  qualificationTablePoolingPhase,
  seedFromGroupStageRound,
  swissPoolingPhase,
} from './pooling';
import type { RoomSize } from './types';

const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };

describe('computeSwissRoundCount', () => {
  it('clamps to MIN_SWISS_ROUNDS=3 for a small N', () => {
    expect(computeSwissRoundCount(4)).toBe(3);
  });

  it('clamps to MAX_SWISS_ROUNDS=7 for a large N', () => {
    expect(computeSwissRoundCount(200)).toBe(7);
  });

  it('matches the unclamped ceil(log2(N)) in the middle of the range', () => {
    expect(computeSwissRoundCount(20)).toBe(5);
  });
});

describe('groupStagePoolingPhase — circle-method round-robin (via output shape, circleMethodSchedule is not exported)', () => {
  it('produces size-1 rounds for an even group, covering every pair exactly once', () => {
    const roster = ['P1', 'P2', 'P3', 'P4'];
    const result = groupStagePoolingPhase(
      { n: 4, groupSize: 4, roundRobinMode: 'single', qualifiersPerGroup: 2 },
      roster,
    );
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds.map((round) => round.matches?.map((match) => match.pair))).toEqual([
      [
        ['P1', 'P4'],
        ['P2', 'P3'],
      ],
      [
        ['P1', 'P3'],
        ['P4', 'P2'],
      ],
      [
        ['P1', 'P2'],
        ['P3', 'P4'],
      ],
    ]);
  });

  it('adds a phantom position for an odd group, giving each real position exactly one bye across the schedule', () => {
    const roster = ['P1', 'P2', 'P3', 'P4', 'P5'];
    const result = groupStagePoolingPhase(
      { n: 5, groupSize: 5, roundRobinMode: 'single', qualifiersPerGroup: 2 },
      roster,
    );
    expect(result.rounds).toHaveLength(5);
    const byes = result.rounds.map((round) => round.groupByes ?? []);
    expect(byes.every((roundByes) => roundByes.length === 1)).toBe(true);
    expect(new Set(byes.flat())).toEqual(new Set(roster));
  });

  it('the total round count equals the max across mixed group sizes', () => {
    // n=9, groupSize=4 -> distributeRooms produces groups of [5,4]; the
    // size-5 group needs 5 rounds, the size-4 group needs 3 — total is 5.
    const roster = Array.from({ length: 9 }, (_, index) => `P${index + 1}`);
    const result = groupStagePoolingPhase(
      { n: 9, groupSize: 4, roundRobinMode: 'single', qualifiersPerGroup: 2 },
      roster,
    );
    expect(result.groups?.map((group) => group.members.length)).toEqual([5, 4]);
    expect(result.rounds).toHaveLength(5);
  });
});

describe('groupStagePoolingPhase — assignGroupMembers (snake-bounce into capacity-limited groups)', () => {
  it('snake-bounces members into equal-capacity groups', () => {
    const roster = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    const result = groupStagePoolingPhase(
      { n: 8, groupSize: 4, roundRobinMode: 'single', qualifiersPerGroup: 2 },
      roster,
    );
    expect(result.groups).toEqual([
      { label: 'A', members: ['P1', 'P4', 'P5', 'P8'] },
      { label: 'B', members: ['P2', 'P3', 'P6', 'P7'] },
    ]);
  });

  it('skips an already-full group during the snake pass rather than overfilling it', () => {
    const roster = Array.from({ length: 7 }, (_, index) => `P${index + 1}`);
    const result = groupStagePoolingPhase(
      { n: 7, groupSize: 4, roundRobinMode: 'single', qualifiersPerGroup: 2 },
      roster,
    );
    // groupSizes = [4,3]; B fills first and P7 must skip past it into A.
    expect(result.groups).toEqual([
      { label: 'A', members: ['P1', 'P4', 'P5', 'P7'] },
      { label: 'B', members: ['P2', 'P3', 'P6'] },
    ]);
  });
});

describe('seedFromGroupStageRound', () => {
  it('flattens matches into paired room assignments and byes into room:null entries', () => {
    const round = {
      matches: [
        { group: 'A', pair: ['P1', 'P2'] as [string, string] },
        { group: 'A', pair: ['P3', 'P4'] as [string, string] },
      ],
      groupByes: ['P5'],
    };
    expect(seedFromGroupStageRound(round)).toEqual([
      { name: 'P1', room: 1, isLucky: false },
      { name: 'P2', room: 1, isLucky: false },
      { name: 'P3', room: 2, isLucky: false },
      { name: 'P4', room: 2, isLucky: false },
      { name: 'P5', room: null, isLucky: false },
    ]);
  });
});

describe('phase builders — shape-level', () => {
  it('qualificationTablePoolingPhase produces exactly qualRounds rounds, each isQual:true', () => {
    const result = qualificationTablePoolingPhase(
      { n: 10, qualAdv: 24 },
      { roomSize: FFA_ROOM_SIZE, qualRounds: 3 },
    );
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds.every((round) => round.isQual)).toBe(true);
  });

  it('swissPoolingPhase produces exactly the configured number of rounds, each isSwiss:true', () => {
    const result = swissPoolingPhase({ n: 37, qualAdv: 24 }, { roomSize: FFA_ROOM_SIZE, swissRounds: 6 });
    expect(result.rounds).toHaveLength(6);
    expect(result.rounds.every((round) => round.isSwiss)).toBe(true);
  });

  it('noEliminationWarmupPoolingPhase always produces exactly 2 rounds', () => {
    const result = noEliminationWarmupPoolingPhase({ n: 10 }, { roomSize: FFA_ROOM_SIZE });
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds.every((round) => round.isNoElim)).toBe(true);
  });
});
