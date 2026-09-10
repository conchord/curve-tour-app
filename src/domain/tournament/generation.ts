import { getGameFormat, deriveRoomSize } from './formats';
import {
  GROUP_SIZE_BOUNDS,
  QUALIFICATION_ROUNDS,
  computeSwissRoundCount,
  seedFromGroupStageRound,
} from './pooling';
import { distributeRooms, validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { randomSeed } from './seeding';
import {
  buildTournamentProgression,
  getMinimumBracketUnits,
  type TournamentProgressionInput,
} from './schedule-generation';
import type { TournamentRuntime } from './runtime';
import type {
  GeneratedTournamentConfig,
  MaterializedGamemodeConfig,
  PersistedSetup,
  TournamentState,
} from './types';

interface GenerationForm extends PersistedSetup {
  /** Intentionally omitted from PersistedSetup for legacy compatibility. */
  lbQualifiers?: string;
}

type GenerateTournamentResult =
  { status: 'generated'; state: TournamentState } | { status: 'invalid'; message: string };

function parsed(value: string, fallback: number): number {
  return Number.parseInt(value, 10) || fallback;
}

function generationError(message: string): GenerateTournamentResult {
  return { status: 'invalid', message };
}

export function generateTournament(
  current: TournamentState,
  form: GenerationForm,
  runtime: TournamentRuntime,
): GenerateTournamentResult {
  if (current.confirmedCount === null || current.confirmedCount === undefined) {
    return generationError(
      'Load a roster first — click "Load roster & reserves" before generating a schedule.',
    );
  }
  const format = getGameFormat(form.gameFormat);
  if (!format) return generationError('This game format is not available yet.');
  if (form.scheduleLogic === 'kings-valley') {
    return generationError('This schedule logic is not available yet.');
  }
  const schedule = form.scheduleLogic;
  const floorIdeal = format.defaultRoomSize?.ideal ?? format.idealRoomSize;
  if (!floorIdeal) return generationError('This game format has no room size.');
  const floorMin = getMinimumBracketUnits(schedule, {
    min: floorIdeal,
    max: floorIdeal,
    ideal: floorIdeal,
  });
  const unitPlural = format.unitLabelPlural.toLowerCase();
  if (current.confirmedCount < floorMin) {
    const reason =
      schedule === 'single-elimination'
        ? ` (Semis is fixed at ${floorMin} ${unitPlural} in 2 rooms of ${floorIdeal})`
        : '';
    return generationError(
      `This format needs at least ${floorMin} confirmed ${unitPlural}${reason}. Confirmed: ${current.confirmedCount}.`,
    );
  }

  const config: GeneratedTournamentConfig = {
    n: current.confirmedCount,
    poolingPhase: form.poolingPhase,
    qualAdv: parsed(form.qualAdv, 24),
    groupSize: parsed(form.groupSize, GROUP_SIZE_BOUNDS.ideal),
    roundRobinMode: form.roundRobinMode,
    qualifiersPerGroup: parsed(form.qualifiersPerGroup, 2),
    scoring: 'fairpoints',
    finalsGames: parsed(form.finalsGames, 3),
    semisGames: parsed(form.semisGames, 1),
  };
  if (config.poolingPhase === 'group-stage') {
    if (config.groupSize < GROUP_SIZE_BOUNDS.min) {
      return generationError(
        `Group size must be at least ${GROUP_SIZE_BOUNDS.min} — round-robin below that is degenerate. Got ${config.groupSize}.`,
      );
    }
    if (config.groupSize <= config.qualifiersPerGroup) {
      return generationError(
        `Group size (${config.groupSize}) must be greater than qualifiers per group (${config.qualifiersPerGroup}) — a group can't qualify more finishers than it contains.`,
      );
    }
  }
  if (config.poolingPhase !== 'none') {
    config.qualAdv = Math.min(Math.max(config.qualAdv, floorMin), config.n);
  }

  const oddCountStrategy = format.supportedOddCountStrategies?.length
    ? form.oddCountStrategy || undefined
    : undefined;
  if (format.supportedOddCountStrategies && oddCountStrategy === 'none') {
    const ideal = format.idealRoomSize as number;
    if (config.poolingPhase !== 'none' && config.poolingPhase !== 'group-stage' && config.n % ideal !== 0) {
      const alternatives = format.supportedOddCountStrategies
        .filter((strategy) => strategy !== 'none')
        .map((strategy) => strategy.charAt(0).toUpperCase() + strategy.slice(1))
        .join('/');
      return generationError(
        `With "None" selected as the odd-count strategy, the confirmed ${unitPlural} must be an exact multiple of ${ideal} (this format's room size) so the pooling phase itself can pair everyone cleanly — got ${config.n}.${alternatives ? ` Adjust the count, or pick ${alternatives} instead.` : ' Adjust the count.'}`,
      );
    }
    const eliminationEntryCount =
      config.poolingPhase === 'group-stage'
        ? distributeRooms(config.n, {
            min: GROUP_SIZE_BOUNDS.min,
            max: GROUP_SIZE_BOUNDS.max,
            ideal: config.groupSize,
          }).length * config.qualifiersPerGroup
        : config.poolingPhase !== 'none'
          ? config.qualAdv
          : config.n;
    const isMultiple = eliminationEntryCount % ideal === 0;
    const isPowerOfTwo =
      eliminationEntryCount > 0 && (eliminationEntryCount & (eliminationEntryCount - 1)) === 0;
    const needsPowerOfTwo = schedule === 'double-elimination';
    if (!(needsPowerOfTwo ? isMultiple && isPowerOfTwo : isMultiple)) {
      const alternatives = format.supportedOddCountStrategies
        .filter((strategy) => strategy !== 'none')
        .map((strategy) => strategy.charAt(0).toUpperCase() + strategy.slice(1))
        .join('/');
      const requirement = needsPowerOfTwo
        ? 'must be an exact power of 2 (double elimination halves the field every round)'
        : `must be an exact multiple of ${ideal} (this format's room size)`;
      return generationError(
        `With "None" selected as the odd-count strategy, the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket' : `confirmed ${unitPlural}`} ${requirement} — got ${eliminationEntryCount}.${alternatives ? ` Adjust the count, or pick ${alternatives} instead.` : ' Adjust the count.'}`,
      );
    }
  }

  const semisOverride = schedule === 'single-elimination' ? parsed(form.semisOverride, 0) || null : null;
  const finalOverride =
    schedule === 'single-elimination' || schedule === 'double-elimination-shared-final'
      ? parsed(form.finalOverride, 0) || null
      : null;
  const overrideEntryCount = config.poolingPhase !== 'none' ? config.qualAdv : config.n;
  if (semisOverride && finalOverride && finalOverride > semisOverride) {
    return generationError(
      `Final size override (${finalOverride}) can't exceed the Semis size override (${semisOverride}) — there can't be more finalists than Semis participants.`,
    );
  }
  if (semisOverride && semisOverride > overrideEntryCount) {
    return generationError(
      `Semis size override (${semisOverride}) can't exceed the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket (' : 'confirmed count ('}${overrideEntryCount}) — there'd be nothing left to eliminate down to it.`,
    );
  }

  const roomSize = deriveRoomSize(format, oddCountStrategy);
  const prospectiveFinalSize = finalOverride || roomSize.ideal;
  let lbQualifiers: number | undefined;
  if (schedule === 'double-elimination-shared-final') {
    lbQualifiers = parsed(form.lbQualifiers ?? '2', 0);
    if (!(lbQualifiers >= 1) || !(lbQualifiers < prospectiveFinalSize)) {
      return generationError(
        `LB qualifiers into the Final (${lbQualifiers}) must be at least 1 and less than the Final size (${prospectiveFinalSize}).`,
      );
    }
  }

  const gamemodeConfig: MaterializedGamemodeConfig = {
    qualRounds: QUALIFICATION_ROUNDS,
    swissRounds: computeSwissRoundCount(config.n),
    teamScoringRule: format.teamSize ? form.teamScoringRule || 'sum-members' : 'sum-members',
    ...(oddCountStrategy ? { oddCountStrategy } : {}),
    roomSize,
    semisSize: semisOverride || 2 * roomSize.ideal,
    finalSize: finalOverride || roomSize.ideal,
    ...(lbQualifiers !== undefined ? { lbQualifiers } : {}),
    poolingPhase: config.poolingPhase,
    bracketPhase: schedule,
    finalsGames: config.finalsGames,
    semisGames: config.semisGames,
    grandFinalWbTarget: parsed(form.grandFinalWbTarget, 2),
    grandFinalLbTarget: parsed(form.grandFinalLbTarget, 3),
    groupSize: config.groupSize,
    roundRobinMode: config.roundRobinMode,
    qualifiersPerGroup: config.qualifiersPerGroup,
  };
  const roster = rosterKeys(current.players);
  let progression;
  try {
    progression = buildTournamentProgression({
      bracketPhase: schedule,
      poolingPhase: config.poolingPhase,
      config,
      format: gamemodeConfig,
      roster,
    } as TournamentProgressionInput);
  } catch (error) {
    return generationError(error instanceof Error ? error.message : String(error));
  }
  const roomCapError = validateRoomCap(progression.rounds, format);
  if (roomCapError) return generationError(roomCapError);

  const groups = progression.groups;
  const groupStandings = Object.fromEntries(
    groups.map((group) => [
      group.label,
      group.members.map((name) => ({
        name,
        totalFP: null,
        totalScore: 0,
        played: 0,
      })),
    ]),
  );
  const state: TournamentState = {
    ...current,
    rounds: progression.rounds,
    curRound: 0,
    scores: {},
    finalScores: {},
    assignments: [],
    luckyLosers: progression.rounds.map(() => []),
    byes: progression.rounds.map(() => []),
    poolingByeCounts: {},
    pendingBracketSeeds: {},
    qualTable: roster.map((name) => ({
      name,
      totalFP: null,
      totalScore: 0,
      played: 0,
    })),
    groups,
    groupStandings,
    tieResolutions: {},
    defenderChanges: {},
    reserveOpen: true,
    started: false,
    needsSave: false,
    autoSaved: false,
    tournamentId: runtime.ids.tournamentId(),
    cfg: config,
    scheduleLogic: schedule,
    gameFormat: form.gameFormat,
    gamemodeConfig,
  };
  const initialPool = rosterKeys(state.players);
  if (config.poolingPhase === 'group-stage') {
    state.assignments[0] = seedFromGroupStageRound(state.rounds[0]);
    state.byes[0] = [...(state.rounds[0].groupByes ?? [])];
  } else if (gamemodeConfig.oddCountStrategy === 'bye' && initialPool.length % roomSize.ideal !== 0) {
    const firstBye = initialPool[0];
    state.byes[0] = [firstBye];
    state.poolingByeCounts[firstBye] = 1;
    state.assignments[0] = randomSeed(initialPool.slice(1), state.rounds[0].rooms, runtime.random);
    state.assignments[0].push({
      name: firstBye,
      room: null,
      isLucky: false,
    });
  } else {
    state.assignments[0] = randomSeed(initialPool, state.rounds[0].rooms, runtime.random);
  }
  return { status: 'generated', state };
}
