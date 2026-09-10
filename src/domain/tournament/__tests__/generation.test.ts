import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { getMinimumBracketUnits } from '../schedule-generation';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { createTournamentRuntime } from '../runtime';
import { fixedIdSource, sequenceRandom } from './test-fixtures';

function names(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

describe('getMinimumBracketUnits', () => {
  it('returns 4 for double-elimination regardless of room size', () => {
    expect(getMinimumBracketUnits('double-elimination', { min: 6, max: 8, ideal: 8 })).toBe(4);
  });

  it('returns 2 * roomSize.ideal for single-elimination', () => {
    expect(getMinimumBracketUnits('single-elimination', { min: 2, max: 2, ideal: 2 })).toBe(4);
    expect(getMinimumBracketUnits('single-elimination', { min: 6, max: 8, ideal: 8 })).toBe(16);
  });

  it('returns 2 * roomSize.ideal for double-elimination-shared-final -- NOT the flat 4 plain double-elimination gets (exact key match, not "any double-elim variant")', () => {
    expect(getMinimumBracketUnits('double-elimination-shared-final', { min: 6, max: 8, ideal: 8 })).toBe(16);
  });
});

describe('generateTournament -- validation failures', () => {
  it('refuses when no roster has been confirmed', () => {
    const state = createDefaultTournamentState({ confirmedCount: null });
    const form = createDefaultSetup();
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Load a roster first');
    }
  });

  it('refuses when confirmedCount is below the format/schedule floor', () => {
    const state = createDefaultTournamentState({ confirmedCount: 10 });
    const form = createDefaultSetup({ gameFormat: 'ffa-individual', scheduleLogic: 'single-elimination' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('needs at least 16 confirmed players');
      expect(result.message).toContain('Semis is fixed at 16 players in 2 rooms of 8');
    }
  });

  it('refuses a "None" odd-count strategy when config.n and the actual bracket-entry count disagree', () => {
    // n=10 (even, passes a naive config.n check) but qualAdv clamps to 5
    // (odd) -- the number ACTUALLY entering the bracket. A validation that
    // only checked config.n would wrongly accept this.
    const state = createDefaultTournamentState({ confirmedCount: 10 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '5',
      oddCountStrategy: 'none',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('number advancing to the bracket');
      expect(result.message).toContain('must be an exact multiple of 2');
      expect(result.message).toContain('got 5');
    }
  });
});

describe('generateTournament -- round-0 seeding', () => {
  it('seeds round 0 via randomSeed with the injected RandomSource, exact assignment', () => {
    const state = createDefaultTournamentState({ confirmedCount: 4, players: names(4) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'none',
    });
    const runtime = createTournamentRuntime({
      random: sequenceRandom([0, 0, 0]),
      ids: fixedIdSource(),
    });
    const result = generateTournament(state, form, runtime);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    // Fisher-Yates on [P1,P2,P3,P4] with next() always 0: swap(3,0)->[P4,P2,P3,P1],
    // swap(2,0)->[P3,P2,P4,P1], swap(1,0)->[P2,P3,P4,P1]. Rooms [2,2] fill
    // sequentially: room1=[P2,P3], room2=[P4,P1].
    expect(result.state.assignments[0]).toEqual([
      { name: 'P2', room: 1, isLucky: false },
      { name: 'P3', room: 1, isLucky: false },
      { name: 'P4', room: 2, isLucky: false },
      { name: 'P1', room: 2, isLucky: false },
    ]);
    expect(result.state.tournamentId).toBe('test-tournament-id');
  });

  it('benches the first roster-order player under the Bye odd-count strategy, deterministically', () => {
    const state = createDefaultTournamentState({ confirmedCount: 5, players: names(5) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'bye',
    });
    const runtime = createTournamentRuntime({ random: sequenceRandom([0.1, 0.2, 0.3]) });
    const result = generateTournament(state, form, runtime);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    // The first bye recipient is always roster-order position 0 (P1),
    // independent of the random source -- randomSeed only shuffles the
    // remaining players, the bye pick itself is positional.
    expect(result.state.byes[0]).toEqual(['P1']);
    expect(result.state.poolingByeCounts.P1).toBe(1);
    const byeEntry = result.state.assignments[0].find((a) => a.name === 'P1');
    expect(byeEntry).toEqual({ name: 'P1', room: null, isLucky: false });
    const seatedNames = result.state.assignments[0]
      .filter((a) => a.room !== null)
      .map((a) => a.name)
      .sort();
    expect(seatedNames).toEqual(['P2', 'P3', 'P4', 'P5']);
  });
});

describe('generateTournament -- end-to-end anchors', () => {
  it('FFA 37 players, single-elimination, default pooling: reproduces the known sweep-table shape', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37, players: names(37) });
    const form = createDefaultSetup({ gameFormat: 'ffa-individual', scheduleLogic: 'single-elimination' });
    const runtime = createTournamentRuntime({ random: sequenceRandom([0.37]), ids: fixedIdSource() });
    const result = generateTournament(state, form, runtime);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const rounds = result.state.rounds;
    // 2 no-elim warmup rounds (poolingPhase 'none') + 4 elimination rounds
    // (the [30,24,20,16] anchor, confirmed in Stage 1's single-elimination.test.ts)
    // + 1 Semis + 1 Final = 8.
    expect(rounds).toHaveLength(8);
    expect(rounds[0]).toMatchObject({ roundNum: 1, isNoElim: true, players: 37, advTotal: 37 });
    expect(rounds[1]).toMatchObject({ roundNum: 2, isNoElim: true, players: 37, advTotal: 37 });
    expect(rounds.slice(2, 6).map((r) => r.advTotal)).toEqual([30, 24, 20, 16]);
    expect(rounds.slice(2, 6).every((r) => !r.isNoElim && !r.isQual && !r.isFinal)).toBe(true);
    expect(rounds[6].isSemis).toBe(true);
    expect(rounds[7]).toMatchObject({ isFinal: true, rooms: [8] });
    // Every roster name seeded into round 0 exactly once.
    expect(result.state.assignments[0].map((a) => a.name).sort()).toEqual(names(37).sort());
    expect(result.state.qualTable).toHaveLength(37);
    expect(result.state.groupStandings).toEqual({});
  });

  it('individual-1v1, 16 players, double-elimination: WB/LB/grand-final shape composes correctly', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16, players: names(16) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'none',
    });
    const runtime = createTournamentRuntime({ random: sequenceRandom([0.16]), ids: fixedIdSource() });
    const result = generateTournament(state, form, runtime);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const rounds = result.state.rounds;
    expect(rounds[0].isNoElim).toBe(true);
    expect(rounds[1].isNoElim).toBe(true);
    const winnersRounds = rounds.filter((r) => r.bracket === 'winners');
    const losersRounds = rounds.filter((r) => r.bracket === 'losers');
    const grandFinal = rounds[rounds.length - 1];
    // nextPowerOf2AndRounds(16) -> 4 WB rounds; losers = 2*4-2 = 6 (both
    // confirmed directly in Stage 2's double-elimination.test.ts).
    expect(winnersRounds).toHaveLength(4);
    expect(losersRounds).toHaveLength(6);
    expect(grandFinal).toMatchObject({ bracket: 'grand-final', numGames: 1, isFinal: true });
    expect(rounds).toHaveLength(2 + 4 + 6 + 1);
    // 16 is an exact power of 2 at roomSize.ideal=2 -- no byes needed anywhere.
    expect(winnersRounds[0].byeCount).toBe(0);
    expect(result.state.gamemodeConfig.lbQualifiers).toBeUndefined();
    expect(result.state.assignments[0].map((a) => a.name).sort()).toEqual(names(16).sort());
  });
});
