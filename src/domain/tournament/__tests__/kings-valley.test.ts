import { describe, expect, it } from 'vitest';
import { MAX_KINGS_VALLEY_ROUNDS, kingsValleyBracketPhase } from '../kings-valley';
import { getMinimumBracketUnits } from '../schedule-generation';
import type { RoomSize } from '../types';

const FIXED_ROOM_SIZE: RoomSize = { min: 4, max: 4, ideal: 4 };
const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };
const HEAD_TO_HEAD_ROOM_SIZE: RoomSize = { min: 2, max: 2, ideal: 2 };

describe('kingsValleyBracketPhase', () => {
  it('matches the hand-traced band counts for a 3-room, 12-player round', () => {
    const rounds = kingsValleyBracketPhase(12, 1, { roomSize: FIXED_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.isKingsValley).toBe(true);
    expect(round.rooms).toEqual([4, 4, 4]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1]);
    expect(round.kvDemoteCounts).toEqual([1, 1, 0]);
    expect(round.kvEliminateCount).toBe(2);
    expect(round.advTotal).toBe(10);
    expect(round.isFinal).toBe(false);
  });

  it('collapses immediately to a Final round when the seed total already fits one room', () => {
    const rounds = kingsValleyBracketPhase(4, 1, { roomSize: FFA_ROOM_SIZE, finalsGames: 3 });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      isFinal: true,
      rooms: [4],
      numGames: 3,
      advPerRoom: 1,
      advTotal: 1,
    });
  });

  it('degenerates to a clean win-climbs/lose-drops ladder for head-to-head rooms (zero stay band)', () => {
    const rounds = kingsValleyBracketPhase(8, 1, { roomSize: HEAD_TO_HEAD_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.rooms).toEqual([2, 2, 2, 2]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1, 1]);
    // Non-bottom rooms demote 1 (the placeholder 0 belongs to the bottom room only).
    expect(round.kvDemoteCounts).toEqual([1, 1, 1, 0]);
    expect(round.kvEliminateCount).toBe(1);
    // promote(1) + demote-or-eliminate(1) === room size 2 -- no stay band.
  });

  it('conserves population across rounds (advTotal shrinks by exactly kvEliminateCount each round) and ends in a Final', () => {
    const rounds = kingsValleyBracketPhase(37, 1, { roomSize: FFA_ROOM_SIZE, finalsGames: 3 });
    expect(rounds[0].rooms).toEqual([8, 8, 7, 7, 7]);
    expect(rounds[0].kvEliminateCount).toBe(4);
    expect(rounds[0].advTotal).toBe(33);
    expect(rounds[1].players).toBe(33);
    expect(rounds[1].rooms).toEqual([7, 7, 7, 6, 6]);

    for (let index = 1; index < rounds.length; index += 1) {
      const previous = rounds[index - 1];
      if (previous.isFinal) continue;
      expect(rounds[index].players).toBe(previous.advTotal);
    }
    expect(rounds[rounds.length - 1].isFinal).toBe(true);
    // Every round index before the Final is a real Kings Valley round with a
    // strictly increasing roundNum, matching every other bracket phase's convention.
    for (const [index, round] of rounds.slice(0, -1).entries()) {
      expect(round.isKingsValley).toBe(true);
      expect(round.roundNum).toBe(1 + index);
    }
  });

  it('force-terminates at MAX_KINGS_VALLEY_ROUNDS for a field too large to naturally converge in time', () => {
    const rounds = kingsValleyBracketPhase(200, 1, { roomSize: FFA_ROOM_SIZE, finalsGames: 3 });
    expect(rounds).toHaveLength(MAX_KINGS_VALLEY_ROUNDS + 1);
    expect(rounds[rounds.length - 1].isFinal).toBe(true);
    expect(rounds.slice(0, -1).every((round) => round.isKingsValley)).toBe(true);
  });
});

describe('getMinimumBracketUnits -- kings-valley', () => {
  it('returns 2 * roomSize.ideal, same floor as single-elimination', () => {
    expect(getMinimumBracketUnits('kings-valley', { min: 6, max: 8, ideal: 8 })).toBe(16);
    expect(getMinimumBracketUnits('kings-valley', { min: 2, max: 2, ideal: 2 })).toBe(4);
  });
});
