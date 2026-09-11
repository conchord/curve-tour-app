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

describe('generateTournament -- Group Stage format gating', () => {
  it.each([
    ['ffa-individual', 20, 'FFA — Individual'],
    ['team-2v2v2v2', 10, '2v2v2v2'],
    ['team-3v3v3', 8, '3v3v3'],
  ] as const)(
    'refuses Group Stage for %s -- round-robin needs a head-to-head room shape',
    (gameFormat, confirmedCount, label) => {
      const state = createDefaultTournamentState({ confirmedCount });
      const form = createDefaultSetup({ gameFormat, poolingPhase: 'group-stage' });
      const result = generateTournament(state, form, createTournamentRuntime());
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.message).toContain('Group Stage');
        expect(result.message).toContain(label);
      }
    },
  );

  it('still generates Group Stage successfully for a head-to-head format (individual-1v1)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 12, players: names(12) });
    const form = createDefaultSetup({ gameFormat: 'individual-1v1', poolingPhase: 'group-stage' });
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds[0].isGroupStage).toBe(true);
    expect(result.state.groups.length).toBeGreaterThan(0);
  });
});

describe('generateTournament -- Swiss format gating', () => {
  it.each([
    ['ffa-individual', 20, 'FFA — Individual'],
    ['team-2v2v2v2', 10, '2v2v2v2'],
    ['team-3v3v3', 8, '3v3v3'],
  ] as const)(
    'refuses Swiss for %s -- fold-pairing needs a head-to-head room shape',
    (gameFormat, confirmedCount, label) => {
      const state = createDefaultTournamentState({ confirmedCount });
      const form = createDefaultSetup({ gameFormat, poolingPhase: 'swiss' });
      const result = generateTournament(state, form, createTournamentRuntime());
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.message).toContain('Swiss');
        expect(result.message).toContain(label);
      }
    },
  );

  it('still generates Swiss successfully for a head-to-head format (individual-1v1)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = createDefaultSetup({ gameFormat: 'individual-1v1', poolingPhase: 'swiss' });
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds[0].isSwiss).toBe(true);
  });
});

describe('generateTournament -- double-elimination format/odd-count-strategy gating', () => {
  it('refuses "double-elimination" for a non-head-to-head format', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ gameFormat: 'ffa-individual', scheduleLogic: 'double-elimination' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Double elimination');
      expect(result.message).toContain('FFA — Individual');
    }
  });

  it('refuses "double-elimination" combined with the "flex" odd-count strategy -- the stale UI-desync scenario (odd-count-strategy changed after schedule logic was picked)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16 });
    const form = createDefaultSetup({
      gameFormat: 'team-3v3',
      scheduleLogic: 'double-elimination',
      oddCountStrategy: 'flex',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Double elimination');
      expect(result.message).toContain('Flex');
    }
  });
});

describe('generateTournament -- double-elimination bracket-entry-count reachability', () => {
  it('refuses Group Stage + Double Elimination when too few qualifiers would actually reach the bracket', () => {
    // 6 players, groups of 3 (2 groups), 1 qualifier per group -> only 2
    // units would enter the bracket phase, below double-elimination's own
    // floor of 2 winners-bracket rounds (needs at least 3, floored to 4 by
    // getMinimumBracketUnits's conservative flat minimum).
    const state = createDefaultTournamentState({ confirmedCount: 6 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'group-stage',
      groupSize: '3',
      qualifiersPerGroup: '1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('double-elimination bracket');
      expect(result.message).toContain('enter the bracket phase');
    }
  });

  it('refuses a Final size override for double-elimination-shared-final that needs more WB qualifiers than would actually enter the bracket', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
      finalOverride: '30',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Final size override');
      expect(result.message).toContain('winners-bracket qualifiers');
    }
  });
});

describe('generateTournament -- double-elimination-shared-final + Group Stage / Swiss (empirical smoke check)', () => {
  // Both combinations are only UI-reachable for a head-to-head format via
  // the 'flex' odd-count strategy (team-3v3 is the only format supporting
  // it) -- flex keeps raceCompatible false (so shared-final, not the race
  // variant, is offered) while leaving Group Stage/Swiss still available
  // (both only require idealRoomSize===2, unaffected by flex). Verified
  // structurally plausible during the audit but never executed -- these
  // anchors convert "looks fine on paper" into "confirmed by running it."
  it('generates successfully: team-3v3, Group Stage + double-elimination-shared-final', () => {
    const state = createDefaultTournamentState({ confirmedCount: 12, players: names(12) });
    const form = {
      ...createDefaultSetup({
        gameFormat: 'team-3v3',
        scheduleLogic: 'double-elimination-shared-final',
        poolingPhase: 'group-stage',
        oddCountStrategy: 'flex',
        finalOverride: '3',
      }),
      lbQualifiers: '2',
    };
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds[0].isGroupStage).toBe(true);
    expect(result.state.rounds.some((r) => r.bracket === 'winners')).toBe(true);
    expect(result.state.rounds.some((r) => r.bracket === 'losers')).toBe(true);
    expect(result.state.rounds[result.state.rounds.length - 1]).toMatchObject({ isFinal: true, rooms: [3] });
  });

  it('generates successfully: team-3v3, Swiss + double-elimination-shared-final', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = {
      ...createDefaultSetup({
        gameFormat: 'team-3v3',
        scheduleLogic: 'double-elimination-shared-final',
        poolingPhase: 'swiss',
        oddCountStrategy: 'flex',
        finalOverride: '3',
      }),
      lbQualifiers: '2',
    };
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds[0].isSwiss).toBe(true);
    expect(result.state.rounds.some((r) => r.bracket === 'winners')).toBe(true);
    expect(result.state.rounds.some((r) => r.bracket === 'losers')).toBe(true);
    expect(result.state.rounds[result.state.rounds.length - 1]).toMatchObject({ isFinal: true, rooms: [3] });
  });
});

describe('generateTournament -- Stage B numeric-input robustness', () => {
  it('refuses a negative Semis size override', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      semisOverride: '-5',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Semis size override');
      expect(result.message).toContain('positive');
    }
  });

  it('refuses a negative Final size override', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      finalOverride: '-3',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Final size override');
      expect(result.message).toContain('positive');
    }
  });

  it('refuses a Final size override exceeding the derived default Semis size when no Semis override is set', () => {
    // ffa-individual's default Semis size is 2 * roomSize.ideal = 16.
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      finalOverride: '20',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Final size override');
      expect(result.message).toContain('default Semis size');
    }
  });

  it('refuses a Group size exceeding the upper bound', () => {
    const state = createDefaultTournamentState({ confirmedCount: 10 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      groupSize: '10',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Group size');
      expect(result.message).toContain("can't exceed");
    }
  });

  it('refuses a negative Qualifiers per group', () => {
    const state = createDefaultTournamentState({ confirmedCount: 10 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      qualifiersPerGroup: '-1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Qualifiers per group');
      expect(result.message).toContain('positive');
    }
  });

  it('refuses a negative Grand Final win target', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      grandFinalWbTarget: '-2',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Grand Final win targets');
      expect(result.message).toContain('positive');
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
