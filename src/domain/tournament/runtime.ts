export interface Clock {
  now(): number;
}

export interface RandomSource {
  next(): number;
}

export interface IdSource {
  tournamentId(): string;
  rosterUnitId(prefix: 'team' | 'reserveteam', index: number): string;
}

export interface TournamentRuntime {
  clock: Clock;
  random: RandomSource;
  ids: IdSource;
}

const systemClock: Clock = {
  now: () => Date.now(),
};

const systemRandom: RandomSource = {
  next: () => Math.random(),
};

function createLegacyCompatibleIdSource(clock: Clock): IdSource {
  return {
    tournamentId: () => String(clock.now()),
    rosterUnitId: (prefix, index) => `${prefix}_${clock.now()}_${index}`,
  };
}

export function createTournamentRuntime(overrides: Partial<TournamentRuntime> = {}): TournamentRuntime {
  const clock = overrides.clock ?? systemClock;
  return {
    clock,
    random: overrides.random ?? systemRandom,
    ids: overrides.ids ?? createLegacyCompatibleIdSource(clock),
  };
}
