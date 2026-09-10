import { distributeRooms, distributeRoomsWithBye } from './room-distribution';
import type {
  GroupStageMatch,
  OddCountStrategyKey,
  RoomSize,
  RoundAssignment,
  RoundRobinMode,
  TournamentGroup,
  TournamentRound,
} from './types';

export const QUALIFICATION_ROUNDS = 3;
const MIN_SWISS_ROUNDS = 3;
const MAX_SWISS_ROUNDS = 7;
const IDEAL_GROUP_SIZE = 4;
export const GROUP_SIZE_BOUNDS = {
  min: 3,
  max: 5,
  ideal: IDEAL_GROUP_SIZE,
} as const;

export interface PoolingConfig {
  n: number;
  qualAdv: number;
  groupSize: number;
  roundRobinMode: RoundRobinMode;
  qualifiersPerGroup: number;
}

export interface PoolingFormatConfig {
  roomSize: RoomSize;
  oddCountStrategy?: OddCountStrategyKey;
  qualRounds: number;
  swissRounds: number;
}

export interface PoolingPhaseResult {
  rounds: TournamentRound[];
  seedTotal: number;
  nextRoundNum: number;
  groups?: TournamentGroup[];
}

interface CircleMethodSchedule {
  numRounds: number;
  phantomPosition: number | null;
  rounds: Array<Array<[number, number]>>;
}

interface RoundRobinRound {
  matches: GroupStageMatch[];
  byes: string[];
}

export function computeSwissRoundCount(count: number): number {
  const ideal = count > 1 ? Math.ceil(Math.log2(count)) : 1;
  return Math.max(MIN_SWISS_ROUNDS, Math.min(ideal, MAX_SWISS_ROUNDS));
}

function createPoolingRound(
  roundNum: number,
  total: number,
  rooms: number[],
  byeCount: number,
): TournamentRound {
  return {
    roundNum,
    players: total,
    rooms,
    byeCount,
    isQual: false,
    isNoElim: true,
    isSemis: false,
    isFinal: false,
    advPerRoom: null,
    advTotal: total,
    luckyCount: 0,
  };
}

export function qualificationTablePoolingPhase(
  config: Pick<PoolingConfig, 'n' | 'qualAdv'>,
  format: Pick<PoolingFormatConfig, 'roomSize' | 'oddCountStrategy' | 'qualRounds'>,
): PoolingPhaseResult {
  const rounds = Array.from({ length: format.qualRounds }, (_, index) => {
    const distribution = distributeRoomsWithBye(config.n, format.roomSize, format.oddCountStrategy);
    return {
      ...createPoolingRound(index + 1, config.n, distribution.rooms, distribution.byeCount),
      isQual: true,
    };
  });
  return {
    rounds,
    seedTotal: config.qualAdv,
    nextRoundNum: rounds.length + 1,
  };
}

export function swissPoolingPhase(
  config: Pick<PoolingConfig, 'n' | 'qualAdv'>,
  format: Pick<PoolingFormatConfig, 'roomSize' | 'oddCountStrategy' | 'swissRounds'>,
): PoolingPhaseResult {
  const rounds = Array.from({ length: format.swissRounds }, (_, index) => {
    const distribution = distributeRoomsWithBye(config.n, format.roomSize, format.oddCountStrategy);
    return {
      ...createPoolingRound(index + 1, config.n, distribution.rooms, distribution.byeCount),
      isSwiss: true,
      ...(index > 0 ? { pairingTBD: true } : {}),
    };
  });
  return {
    rounds,
    seedTotal: config.qualAdv,
    nextRoundNum: rounds.length + 1,
  };
}

function circleMethodSchedule(groupSize: number): CircleMethodSchedule {
  const isOdd = groupSize % 2 !== 0;
  const positionCount = isOdd ? groupSize + 1 : groupSize;
  const numRounds = positionCount - 1;
  let positions = Array.from({ length: positionCount }, (_, index) => index);
  const rounds: CircleMethodSchedule['rounds'] = [];

  for (let roundIndex = 0; roundIndex < numRounds; roundIndex += 1) {
    const pairs: Array<[number, number]> = [];
    for (let index = 0; index < positionCount / 2; index += 1) {
      pairs.push([positions[index], positions[positionCount - 1 - index]]);
    }
    rounds.push(pairs);
    positions = [positions[0], positions[positionCount - 1], ...positions.slice(1, -1)];
  }

  return {
    numRounds,
    phantomPosition: isOdd ? groupSize : null,
    rounds,
  };
}

function assignGroupMembers(sortedUnits: string[], groupSizes: number[]): TournamentGroup[] {
  const groups = groupSizes.map((_, index) => ({
    label: String.fromCharCode(65 + index),
    members: [] as string[],
  }));
  let direction = 1;
  let groupIndex = 0;
  let unitIndex = 0;

  while (unitIndex < sortedUnits.length) {
    if (groups[groupIndex].members.length < groupSizes[groupIndex]) {
      groups[groupIndex].members.push(sortedUnits[unitIndex]);
      unitIndex += 1;
    }
    groupIndex += direction;
    if (groupIndex >= groups.length) {
      groupIndex = groups.length - 1;
      direction = -1;
    } else if (groupIndex < 0) {
      groupIndex = 0;
      direction = 1;
    }
  }

  return groups;
}

function buildRoundRobinRounds(groups: TournamentGroup[], roundRobinMode: RoundRobinMode): RoundRobinRound[] {
  const schedules = groups.map((group) => {
    const schedule = circleMethodSchedule(group.members.length);
    const rounds = roundRobinMode === 'double' ? [...schedule.rounds, ...schedule.rounds] : schedule.rounds;
    return { group, phantomPosition: schedule.phantomPosition, rounds };
  });
  const maxRounds = schedules.reduce((maximum, schedule) => Math.max(maximum, schedule.rounds.length), 0);

  return Array.from({ length: maxRounds }, (_, roundIndex) => {
    const matches: GroupStageMatch[] = [];
    const byes: string[] = [];
    for (const schedule of schedules) {
      const pairs = schedule.rounds[roundIndex];
      if (!pairs) {
        byes.push(...schedule.group.members);
        continue;
      }
      for (const [first, second] of pairs) {
        if (first === schedule.phantomPosition) {
          byes.push(schedule.group.members[second]);
        } else if (second === schedule.phantomPosition) {
          byes.push(schedule.group.members[first]);
        } else {
          matches.push({
            group: schedule.group.label,
            pair: [schedule.group.members[first], schedule.group.members[second]],
          });
        }
      }
    }
    return { matches, byes };
  });
}

export function groupStagePoolingPhase(
  config: Pick<PoolingConfig, 'n' | 'groupSize' | 'roundRobinMode' | 'qualifiersPerGroup'>,
  roster: string[],
): PoolingPhaseResult {
  const groupSizes = distributeRooms(config.n, {
    min: GROUP_SIZE_BOUNDS.min,
    max: GROUP_SIZE_BOUNDS.max,
    ideal: config.groupSize,
  });
  const groups = assignGroupMembers(roster, groupSizes);
  const roundRobinRounds = buildRoundRobinRounds(groups, config.roundRobinMode);
  const rounds = roundRobinRounds.map((round, index): TournamentRound => ({
    ...createPoolingRound(
      index + 1,
      config.n,
      round.matches.map(() => 2),
      round.byes.length,
    ),
    roomGroups: round.matches.map((match) => match.group),
    matches: round.matches,
    groupByes: round.byes,
    isGroupStage: true,
  }));

  return {
    rounds,
    seedTotal: groups.length * config.qualifiersPerGroup,
    nextRoundNum: rounds.length + 1,
    groups,
  };
}

export function seedFromGroupStageRound(
  round: Pick<TournamentRound, 'matches' | 'groupByes'>,
): RoundAssignment[] {
  const assignments: RoundAssignment[] = [];
  for (const [index, match] of (round.matches ?? []).entries()) {
    assignments.push(
      { name: match.pair[0], room: index + 1, isLucky: false },
      { name: match.pair[1], room: index + 1, isLucky: false },
    );
  }
  for (const name of round.groupByes ?? []) {
    assignments.push({ name, room: null, isLucky: false });
  }
  return assignments;
}

export function noEliminationWarmupPoolingPhase(
  config: Pick<PoolingConfig, 'n'>,
  format: Pick<PoolingFormatConfig, 'roomSize' | 'oddCountStrategy'>,
): PoolingPhaseResult {
  const rounds = Array.from({ length: 2 }, (_, index) => {
    const distribution = distributeRoomsWithBye(config.n, format.roomSize, format.oddCountStrategy);
    return createPoolingRound(index + 1, config.n, distribution.rooms, distribution.byeCount);
  });
  return { rounds, seedTotal: config.n, nextRoundNum: 3 };
}
