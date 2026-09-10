import { describe, expect, it } from 'vitest';
import {
  computeCleanTargets,
  computeEliminationRoundCount,
  singleEliminationBracketPhase,
  type SingleEliminationConfig,
} from './single-elimination';
import type { RoomSize } from './types';

const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };
const HEAD_TO_HEAD_ROOM_SIZE: RoomSize = { min: 2, max: 2, ideal: 2 };

describe('computeEliminationRoundCount', () => {
  it('matches the N=37 FFA sweep-table anchor (4 elimination rounds, targets [30,24,20,16])', () => {
    expect(computeEliminationRoundCount(37, 16, FFA_ROOM_SIZE)).toBe(4);
  });

  it('caps at pure-halving rounds for a head-to-head room, not the naive survival-ratio count', () => {
    // Legacy regression: 16-player 1v1 used to request 7 rounds off the bare
    // ratio formula; capped at ceil(log2(16/4))=2 once roomSize.ideal===2.
    expect(computeEliminationRoundCount(16, 4, HEAD_TO_HEAD_ROOM_SIZE)).toBe(2);
  });

  it('caps at MAX_ELIM_ROUNDS=8 for a very large N', () => {
    expect(computeEliminationRoundCount(100, 16, FFA_ROOM_SIZE)).toBe(8);
  });

  it('returns 0 when the field is already at or below the floor', () => {
    expect(computeEliminationRoundCount(16, 16, FFA_ROOM_SIZE)).toBe(0);
    expect(computeEliminationRoundCount(10, 16, FFA_ROOM_SIZE)).toBe(0);
  });
});

describe('computeCleanTargets', () => {
  it('matches the exact N=37 FFA targets [30,24,20,16]', () => {
    expect(computeCleanTargets(37, 16, 4, FFA_ROOM_SIZE)).toEqual([30, 24, 20, 16]);
  });

  it('reduces an over-requested round count until the targets are strictly decreasing', () => {
    const targets = computeCleanTargets(19, 16, 6, FFA_ROOM_SIZE);
    let previous = 19;
    for (const target of targets) {
      expect(target).toBeLessThan(previous);
      previous = target;
    }
    expect(targets.length).toBeLessThanOrEqual(6);
    expect(targets[targets.length - 1]).toBe(16);
  });
});

describe('singleEliminationBracketPhase', () => {
  const ffaConfig: SingleEliminationConfig = {
    roomSize: FFA_ROOM_SIZE,
    semisSize: 16,
    finalSize: 8,
    semisGames: 1,
    finalsGames: 3,
  };

  it('produces the full N=37 FFA round count: 4 elimination + 1 semis + 1 final = 6', () => {
    const rounds = singleEliminationBracketPhase(37, 1, ffaConfig);
    expect(rounds).toHaveLength(6);
    expect(rounds.map((round) => round.roundNum)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rounds.slice(0, 4).map((round) => round.advTotal)).toEqual([30, 24, 20, 16]);
  });

  it('builds elimination rounds with at most one bye per round, including round 0 — never concentrated', () => {
    // Confirmed by direct source read: unlike double-elimination.ts's race
    // variant (which concentrates ALL byes into WB round 0 via a dedicated
    // helper), singleEliminationBracketPhase always uses the ordinary
    // self-correcting distributeRoomsWithBye, every round, round 0 included.
    // This test protects against "fixing" this file to match that other
    // file's behavior by mistake.
    const config: SingleEliminationConfig = {
      roomSize: HEAD_TO_HEAD_ROOM_SIZE,
      oddCountStrategy: 'bye',
      semisSize: 4,
      finalSize: 2,
      semisGames: 1,
      finalsGames: 1,
    };
    const rounds = singleEliminationBracketPhase(19, 1, config);
    const eliminationRounds = rounds.slice(0, rounds.length - 2);
    expect(eliminationRounds.length).toBeGreaterThan(0);
    for (const round of eliminationRounds) {
      expect(round.byeCount).toBeLessThanOrEqual(1);
    }
  });

  it('computes Semis advPerRoom/luckyCount as the floor/remainder of finalSize over the Semis room count', () => {
    // Reproduces the team-3v3v3 fix: FINAL=3 across 2 Semis rooms must give
    // advPerRoom=1 (direct) + luckyCount=1 (lucky loser) = 3, not a bare
    // division that would let 4 through.
    const config: SingleEliminationConfig = {
      roomSize: { min: 2, max: 3, ideal: 3 },
      semisSize: 6,
      finalSize: 3,
      semisGames: 1,
      finalsGames: 3,
    };
    const rounds = singleEliminationBracketPhase(9, 1, config);
    const semis = rounds[rounds.length - 2];
    expect(semis.isSemis).toBe(true);
    expect(semis.rooms).toEqual([3, 3]);
    expect(semis.advPerRoom).toBe(1);
    expect(semis.luckyCount).toBe(1);
    expect(semis.advTotal).toBe(3);
  });

  it('appends exactly one Final round as a single room sized [finalSize]', () => {
    const rounds = singleEliminationBracketPhase(37, 1, ffaConfig);
    const final = rounds[rounds.length - 1];
    expect(final.isFinal).toBe(true);
    expect(final.rooms).toEqual([8]);
    expect(final.advPerRoom).toBe(1);
    expect(final.advTotal).toBe(1);
    expect(final.numGames).toBe(3);
  });
});
