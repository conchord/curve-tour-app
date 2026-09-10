import { describe, expect, it } from 'vitest';
import { computeGrandFinalRaceState, finalsProgressState, progressGrandFinalRace } from '../finals';
import { createDefaultTournamentState } from '../state-defaults';
import { buildRound } from './test-fixtures';

function grandFinalState(numGames: number, finalScores: Record<string, number>, target = { wb: 2, lb: 3 }) {
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    rounds: [
      buildRound({
        roundNum: 1,
        isFinal: true,
        bracket: 'grand-final',
        rooms: [2],
        players: 2,
        numGames,
        wbFinalistName: 'WB',
      }),
    ],
    assignments: [
      [
        { name: 'WB', room: 1, isLucky: false },
        { name: 'LB', room: 1, isLucky: false },
      ],
    ],
    finalScores,
    gamemodeConfig: { grandFinalWbTarget: target.wb, grandFinalLbTarget: target.lb },
    curRound: 0,
  });
}

describe('computeGrandFinalRaceState', () => {
  it("a tied game increments gamesPlayed but neither side's win count", () => {
    const state = grandFinalState(3, {
      'game1-WB': 300,
      'game1-LB': 100, // WB wins game 1
      'game2-WB': 200,
      'game2-LB': 200, // tie
      'game3-WB': 300,
      'game3-LB': 100, // WB wins game 2 -> reaches target 2, decided
    });
    const race = computeGrandFinalRaceState(state, 0, state.rounds[0]);
    expect(race).toEqual({
      wbName: 'WB',
      lbName: 'LB',
      wbWins: 2,
      lbWins: 0,
      wbTarget: 2,
      lbTarget: 3,
      gamesPlayed: 3,
      decided: true,
      winnerName: 'WB',
    });
  });

  it('decides for the winner as soon as either target is reached, with asymmetric targets', () => {
    // WB clinches 2-4 against an lbTarget of 5 -- fewer raw wins than LB.
    const state = grandFinalState(
      6,
      {
        'game1-WB': 100,
        'game1-LB': 200, // LB
        'game2-WB': 100,
        'game2-LB': 200, // LB
        'game3-WB': 100,
        'game3-LB': 200, // LB
        'game4-WB': 100,
        'game4-LB': 200, // LB (4 wins, not yet at target 5)
        'game5-WB': 200,
        'game5-LB': 100, // WB (1 win)
        'game6-WB': 200,
        'game6-LB': 100, // WB (2 wins, reaches target 2 -> decided)
      },
      { wb: 2, lb: 5 },
    );
    const race = computeGrandFinalRaceState(state, 0, state.rounds[0]);
    expect(race?.wbWins).toBe(2);
    expect(race?.lbWins).toBe(4);
    expect(race?.gamesPlayed).toBe(6);
    expect(race?.decided).toBe(true);
    expect(race?.winnerName).toBe('WB');
  });

  it('returns null when the two grand-final entrants are not yet known', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isFinal: true, bracket: 'grand-final', rooms: [2], players: 2 })],
      assignments: [[]],
    });
    expect(computeGrandFinalRaceState(state, 0, state.rounds[0])).toBeNull();
  });
});

describe('progressGrandFinalRace', () => {
  it('grows numGames by exactly 1 once the open game is fully scored and undecided', () => {
    const state = grandFinalState(1, { 'game1-WB': 100, 'game1-LB': 100 }); // tie, not decided
    const result = progressGrandFinalRace(state);
    expect(result.inProgress).toBe(true);
    expect(result.openedNextGame).toBe(true);
    expect(result.state.rounds[0].numGames).toBe(2);
  });

  it('does not grow numGames while the current game is only partially scored', () => {
    const state = grandFinalState(1, { 'game1-WB': 100 }); // LB not yet scored
    const result = progressGrandFinalRace(state);
    expect(result.inProgress).toBe(true);
    expect(result.openedNextGame).toBe(false);
    expect(result.state.rounds[0].numGames).toBe(1);
  });

  it('no-ops once the race is decided', () => {
    const state = grandFinalState(2, {
      'game1-WB': 300,
      'game1-LB': 100,
      'game2-WB': 300,
      'game2-LB': 100,
    });
    const result = progressGrandFinalRace(state);
    expect(result.inProgress).toBe(false);
    expect(result.openedNextGame).toBe(false);
    expect(result.state).toBe(state);
  });

  it('no-ops for a round that is not the grand final', () => {
    const state = createDefaultTournamentState({
      rounds: [buildRound({ roundNum: 1, isFinal: true, rooms: [2], players: 2 })],
      curRound: 0,
    });
    const result = progressGrandFinalRace(state);
    expect(result).toEqual({ state, inProgress: false, openedNextGame: false });
  });
});

describe('finalsProgressState', () => {
  it('orders the grand-final winner first regardless of raw win count', () => {
    const state = grandFinalState(
      6,
      {
        'game1-WB': 100,
        'game1-LB': 200,
        'game2-WB': 100,
        'game2-LB': 200,
        'game3-WB': 100,
        'game3-LB': 200,
        'game4-WB': 100,
        'game4-LB': 200,
        'game5-WB': 200,
        'game5-LB': 100,
        'game6-WB': 200,
        'game6-LB': 100,
      },
      { wb: 2, lb: 5 },
    );
    const progress = finalsProgressState(state, 0, state.rounds[0]);
    expect(progress.isGrandFinal).toBe(true);
    expect(progress.complete).toBe(true);
    expect(progress.order).toEqual(['WB', 'LB']);
  });

  it('falls back to total-score descending order for a non-race multi-game Final', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isFinal: true, rooms: [2], players: 2, numGames: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      finalScores: {
        'game1-P1': 100,
        'game2-P1': 100,
        'game1-P2': 300,
        'game2-P2': 300,
      },
      curRound: 0,
    });
    const progress = finalsProgressState(state, 0, state.rounds[0]);
    expect(progress.isGrandFinal).toBe(false);
    expect(progress.complete).toBe(true);
    expect(progress.order).toEqual(['P2', 'P1']);
  });
});
