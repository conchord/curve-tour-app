import { describe, expect, it } from 'vitest';
import {
  nextPowerOf2AndRounds,
  raceDoubleEliminationBracketPhase,
  sharedFinalDoubleEliminationBracketPhase,
  type RaceDoubleEliminationConfig,
  type SharedFinalDoubleEliminationConfig,
} from './double-elimination';
import type { RoomSize } from './types';

const HEAD_TO_HEAD_ROOM_SIZE: RoomSize = { min: 2, max: 2, ideal: 2 };
const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };

describe('nextPowerOf2AndRounds', () => {
  it('rounds up to the next power of 2 for a non-power-of-2 input', () => {
    expect(nextPowerOf2AndRounds(37)).toEqual({ bracketSize: 64, numRounds: 6 });
  });

  it('returns the input unchanged when already a power of 2', () => {
    expect(nextPowerOf2AndRounds(32)).toEqual({ bracketSize: 32, numRounds: 5 });
  });
});

describe('raceDoubleEliminationBracketPhase', () => {
  const baseConfig: RaceDoubleEliminationConfig = {
    roomSize: HEAD_TO_HEAD_ROOM_SIZE,
    oddCountStrategy: 'bye',
  };

  it('throws when roomSize.ideal !== 2', () => {
    expect(() =>
      raceDoubleEliminationBracketPhase(16, 1, { ...baseConfig, roomSize: FFA_ROOM_SIZE }),
    ).toThrow();
  });

  it("throws when oddCountStrategy is 'flex'", () => {
    expect(() =>
      raceDoubleEliminationBracketPhase(16, 1, { ...baseConfig, oddCountStrategy: 'flex' }),
    ).toThrow();
  });

  it('throws when the field is too small for at least 2 winners-bracket rounds', () => {
    expect(() => raceDoubleEliminationBracketPhase(2, 1, baseConfig)).toThrow();
  });

  it('concentrates ALL of the shortfall into WB round 0, unlike single-elimination.ts', () => {
    const rounds = raceDoubleEliminationBracketPhase(19, 1, baseConfig);
    const wb0 = rounds[0];
    expect(wb0.bracket).toBe('winners');
    expect(wb0.bracketPhaseFirstRound).toBe(true);
    // nextPowerOf2AndRounds(19) -> bracketSize 32, so round 0 must absorb the
    // entire 13-unit shortfall at once, not the usual self-correcting <=1.
    expect(wb0.byeCount).toBe(13);
    expect(wb0.rooms).toEqual([2, 2, 2]);
  });

  it('computes the losers-bracket round count as 2*winnersRoundCount - 2', () => {
    const rounds = raceDoubleEliminationBracketPhase(16, 1, baseConfig); // numRounds=4
    const losersRounds = rounds.filter((round) => round.bracket === 'losers');
    expect(losersRounds).toHaveLength(2 * 4 - 2);
  });

  it('interleaves exactly 1 LB round after WB round 0 and the WB final, 2 between every other pair', () => {
    const rounds = raceDoubleEliminationBracketPhase(16, 1, baseConfig);
    const groups: number[] = [];
    let currentGroup = 0;
    for (const round of rounds) {
      if (round.bracket === 'winners') {
        if (currentGroup > 0 || groups.length === 0) groups.push(currentGroup);
        currentGroup = 0;
      } else if (round.bracket === 'losers') {
        currentGroup += 1;
      }
    }
    groups.push(currentGroup); // trailing group after the last WB round
    groups.shift(); // drop the placeholder pushed before WB round 0 ever ran
    expect(groups).toEqual([1, 2, 2, 1]);
  });

  it('the grand final round is bracket:"grand-final" seeded with numGames:1', () => {
    const rounds = raceDoubleEliminationBracketPhase(16, 1, baseConfig);
    const grandFinal = rounds[rounds.length - 1];
    expect(grandFinal.bracket).toBe('grand-final');
    expect(grandFinal.numGames).toBe(1);
    expect(grandFinal.isFinal).toBe(true);
  });
});

describe('sharedFinalDoubleEliminationBracketPhase', () => {
  const baseConfig: SharedFinalDoubleEliminationConfig = {
    roomSize: FFA_ROOM_SIZE,
    finalSize: 8,
    lbQualifiers: 2,
    finalsGames: 3,
  };

  it('throws when lbQualifiers < 1', () => {
    expect(() =>
      sharedFinalDoubleEliminationBracketPhase(37, 1, { ...baseConfig, lbQualifiers: 0 }),
    ).toThrow();
  });

  it('throws when finalSize - lbQualifiers < 1', () => {
    expect(() =>
      sharedFinalDoubleEliminationBracketPhase(37, 1, { ...baseConfig, lbQualifiers: 8 }),
    ).toThrow();
  });

  it('WB round 0 uses ordinary self-correcting distributeRoomsWithBye — never concentrated', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(37, 1, {
      ...baseConfig,
      oddCountStrategy: 'bye',
    });
    const wb0 = rounds[0];
    expect(wb0.bracket).toBe('winners');
    expect(wb0.byeCount).toBeLessThanOrEqual(1);
  });

  it('defers losers-bracket round creation, so not every WB round gets its own LB round', () => {
    // FFA 32p, WBQ=6/LBQ=2 -- the legacy-flagged anchor case that originally
    // surfaced the "wasted LB round" bug this deferral logic fixes.
    const rounds = sharedFinalDoubleEliminationBracketPhase(32, 1, baseConfig);
    const winnersRounds = rounds.filter((round) => round.bracket === 'winners');
    const losersRounds = rounds.filter((round) => round.bracket === 'losers');
    expect(winnersRounds.length).toBeGreaterThan(0);
    expect(losersRounds.length).toBeGreaterThan(0);
    expect(losersRounds.length).toBeLessThan(winnersRounds.length);
  });

  it('the shared Final is always a single literal room, never split, even for a large finalSize', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(37, 1, { ...baseConfig, finalSize: 20 });
    const final = rounds[rounds.length - 1];
    expect(final.isFinal).toBe(true);
    expect(final.rooms).toEqual([20]);
  });

  it('every winners-bracket round routes its losers to a real losers-bracket round or the Final', () => {
    const rounds = sharedFinalDoubleEliminationBracketPhase(37, 1, baseConfig);
    const winnersRounds = rounds.filter((round) => round.bracket === 'winners');
    for (const round of winnersRounds) {
      expect(round.losersTo).not.toBeNull();
      expect(round.losersTo).toBeGreaterThanOrEqual(0);
    }
  });
});
