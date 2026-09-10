import type { IdSource, RandomSource } from './runtime';
import type { RoundAssignment, TournamentRound } from './types';

/** Deterministic RandomSource yielding a fixed sequence, cycling if exhausted. */
export function sequenceRandom(values: number[]): RandomSource {
  let index = 0;
  return {
    next: () => {
      const value = values[index % values.length];
      index += 1;
      return value;
    },
  };
}

/** Builds a bare TournamentRound with sane defaults; override anything. */
export function buildRound(
  overrides: Partial<TournamentRound> & Pick<TournamentRound, 'roundNum'>,
): TournamentRound {
  return {
    players: 0,
    rooms: [],
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal: false,
    advPerRoom: null,
    advTotal: 0,
    luckyCount: 0,
    ...overrides,
  };
}

/** Deterministic IdSource for generation tests that need a stable tournamentId. */
export function fixedIdSource(overrides: Partial<IdSource> = {}): IdSource {
  return {
    tournamentId: () => 'test-tournament-id',
    rosterUnitId: (prefix, index) => `${prefix}_${index}`,
    ...overrides,
  };
}

/** Builds RoundAssignment[] for the given names, distributed into `rooms` sequentially. */
export function buildAssignments(names: string[], rooms: number[]): RoundAssignment[] {
  const assignments: RoundAssignment[] = [];
  let nameIndex = 0;
  for (const [roomIndex, roomSize] of rooms.entries()) {
    for (let position = 0; position < roomSize; position += 1) {
      const name = names[nameIndex];
      nameIndex += 1;
      if (name === undefined) continue;
      assignments.push({ name, room: roomIndex + 1, isLucky: false });
    }
  }
  return assignments;
}
