import { describe, expect, it } from 'vitest';
import { computeRankings } from '../rankings';
import { createDefaultTournamentState } from '../state-defaults';
import { buildRound } from './test-fixtures';

describe('computeRankings -- Kings Valley room-depth tiebreak', () => {
  // Room1 (top): P1=100, P2=10 -- P2's pct = 10/110 ~= 0.091 (low).
  // Room2 (bottom, further from the top): P3=100, P4=90 -- P4's pct = 90/190 ~= 0.474 (high).
  // Pure pct ordering would rank P4 above P2; the room-depth tiebreak should
  // instead rank P2 (room 1, closer to the top) above P4 regardless.
  function buildState(isKingsValley: boolean) {
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      rounds: [
        buildRound({ roundNum: 1, rooms: [2, 2], players: 4, isKingsValley }),
        buildRound({ roundNum: 2, rooms: [2], players: 2 }),
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
          { name: 'P3', room: 1, isLucky: false },
        ],
      ],
      scores: {
        'r0-rm1-p0': 100,
        'r0-rm1-p1': 10,
        'r0-rm2-p0': 100,
        'r0-rm2-p1': 90,
      },
    });
  }

  it('ranks a same-round elimination from a lower Kings Valley room above one from a higher room, regardless of pct', () => {
    const rankings = computeRankings(buildState(true));
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toEqual(['P2', 'P4']);
  });

  it('leaves non-Kings-Valley same-round eliminations ordered purely by pct (regression -- no room field populated)', () => {
    const rankings = computeRankings(buildState(false));
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toEqual(['P4', 'P2']);
  });
});
