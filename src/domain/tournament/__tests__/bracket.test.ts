import { describe, expect, it } from 'vitest';
import { projectedSlotLabelText, projectFutureRoundSlots } from '../bracket';
import type { TournamentRound } from '../types';
import { buildRound } from './test-fixtures';

function project(rounds: TournamentRound[], curRound: number) {
  return projectFutureRoundSlots({ rounds, curRound });
}

describe('projectFutureRoundSlots', () => {
  it('projects a plain single-elimination hop as "Winner of Room N", room-major, chunked sequentially into the target room', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [3, 3], players: 6, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual(['Winner of Room 1', 'Winner of Room 2']);
  });

  it('orders room-major/rank-minor for advPerRoom > 1, appending lucky-loser tokens last', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [3, 3, 3], players: 9, advPerRoom: 2, luckyCount: 1 }),
      buildRound({ roundNum: 2, rooms: [7], players: 7, advPerRoom: 7, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Room 1, Rank 1',
      'Room 1, Rank 2',
      'Room 2, Rank 1',
      'Room 2, Rank 2',
      'Room 3, Rank 1',
      'Room 3, Rank 2',
      '★ Lucky loser (any room)',
    ]);
  });

  it("labels a WB round's losers-edge into an LB round by source-round identity, not room", () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [2, 2],
        players: 4,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'winners',
        winnersTo: null,
        losersTo: 1,
      }),
      buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0, bracket: 'losers' }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Dropped from WB Round 1',
      'Dropped from WB Round 1',
    ]);
  });

  it('labels an LB round\'s winners-edge by source-round identity ("Advanced from LB Round N")', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [2, 2],
        players: 4,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'losers',
        winnersTo: 1,
        losersTo: null,
      }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Advanced from LB Round 1',
      'Advanced from LB Round 1',
    ]);
  });

  it('gives every slot a uniform "seed TBD" label leaving the last qual round, ignoring the source round\'s own advPerRoom/luckyCount', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [2, 2],
        players: 4,
        isQual: true,
        isNoElim: true,
        advPerRoom: 5,
        luckyCount: 3,
      }),
      buildRound({ roundNum: 2, rooms: [3], players: 3, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Qualifier from standings (seed TBD)',
      'Qualifier from standings (seed TBD)',
      'Qualifier from standings (seed TBD)',
    ]);
  });

  it('gives every slot a uniform "seed TBD" label leaving the last group-stage round', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, isGroupStage: true, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Qualifier from standings (seed TBD)',
      'Qualifier from standings (seed TBD)',
    ]);
  });

  it('returns null for a Swiss round target (pairingTBD) and a group-stage round target', () => {
    const swissRounds = [
      buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, isSwiss: true, isNoElim: true, pairingTBD: true }),
    ];
    expect(project(swissRounds, 0)[1]).toBeNull();

    const groupRounds = [
      buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 2, rooms: [2, 2], players: 4, isGroupStage: true, isNoElim: true }),
    ];
    expect(project(groupRounds, 0)[1]).toBeNull();
  });

  it("projects a mid-pooling-phase hop (qual round 1 -> qual round 2, neither is the last) via the same per-room-rank shape as any other no-elim round -- everyone advances, ranked within their own room, then chunked sequentially into the target round's own declared room sizes (not snake-seeded -- see bracket.ts's comment on why the projection deliberately diverges from the real transition's snakeSeed here)", () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [2, 2], players: 4, isQual: true, isNoElim: true }),
      buildRound({ roundNum: 3, rooms: [2, 2], players: 4, isQual: true, isNoElim: true }),
    ];
    const result = project(rounds, 0);
    // Pool = [R1r1, R1r2, R2r1, R2r2] (room-major); chunked sequentially into
    // 2 target rooms of size 2 each: room1 <- [R1r1, R1r2], room2 <- [R2r1, R2r2].
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual(['Room 1, Rank 1', 'Room 1, Rank 2']);
    expect(result[1]?.[1].map(projectedSlotLabelText)).toEqual(['Room 2, Rank 1', 'Room 2, Rank 2']);
  });

  it('projects a no-elim (e.g. "None" pooling warmup) round using each room\'s own size -- nobody is cut, but within-room rank still carries forward, and room sizes can differ; every target room\'s slot count always matches its own declared size exactly', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [3, 2], players: 5, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [3, 2], players: 5, isNoElim: true }),
    ];
    const result = project(rounds, 0);
    // Pool = [R1r1, R1r2, R1r3, R2r1, R2r2]; chunked sequentially into rooms
    // sized [3, 2]: room1 (size 3) <- [R1r1, R1r2, R1r3], room2 (size 2) <- [R2r1, R2r2].
    expect(result[1]?.[0].map(projectedSlotLabelText)).toEqual([
      'Room 1, Rank 1',
      'Room 1, Rank 2',
      'Room 1, Rank 3',
    ]);
    expect(result[1]?.[1].map(projectedSlotLabelText)).toEqual(['Room 2, Rank 1', 'Room 2, Rank 2']);
  });

  it('resolves every round in a chain of no-elim rounds feeding a real elimination round -- poisoning no longer cascades past a no-elim predecessor', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [4], players: 4, isNoElim: true }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isNoElim: true }),
      buildRound({ roundNum: 3, rooms: [4], players: 4, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 4, rooms: [1], players: 1, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]).not.toBeNull();
    expect(result[2]).not.toBeNull();
    expect(result[3]?.[0].map(projectedSlotLabelText)).toEqual(['Winner of Room 1']);
  });

  it('falls back to null on a structural token-count mismatch (e.g. an unmodeled bye), and poisons downstream rounds', () => {
    const rounds = [
      buildRound({ roundNum: 1, rooms: [2, 2], players: 4, advPerRoom: 1, luckyCount: 0 }),
      // Only 2 tokens will be produced, but this round expects 3 -- an unmodeled bye.
      buildRound({ roundNum: 2, rooms: [3], players: 3, advPerRoom: 1, luckyCount: 0 }),
      buildRound({ roundNum: 3, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
  });

  it('concatenates multiple predecessors feeding the same target in ascending source-round-index order', () => {
    const rounds = [
      buildRound({
        roundNum: 1,
        rooms: [2],
        players: 2,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'winners',
        winnersTo: 2,
        losersTo: null,
      }),
      buildRound({
        roundNum: 1,
        rooms: [2],
        players: 2,
        advPerRoom: 1,
        luckyCount: 0,
        bracket: 'losers',
        winnersTo: 2,
        losersTo: null,
      }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, advPerRoom: 1, luckyCount: 0 }),
    ];
    const result = project(rounds, 0);
    expect(result[2]?.[0].map((slot) => slot.kind)).toEqual(['room-rank', 'round-edge']);
    expect(result[2]?.[0].map(projectedSlotLabelText)).toEqual([
      'Winner of Room 1',
      'Advanced from LB Round 1',
    ]);
  });
});
