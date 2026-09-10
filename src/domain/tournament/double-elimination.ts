import { distributeRooms, distributeRoomsWithBye } from './room-distribution';
import { computeCleanTargets, computeEliminationRoundCount, computeTargets } from './single-elimination';
import type { OddCountStrategyKey, RoomSize, TournamentRound } from './types';

interface BracketPowerShape {
  bracketSize: number;
  numRounds: number;
}

export interface RaceDoubleEliminationConfig {
  roomSize: RoomSize;
  oddCountStrategy?: OddCountStrategyKey;
}

export interface SharedFinalDoubleEliminationConfig extends RaceDoubleEliminationConfig {
  finalSize: number;
  lbQualifiers: number;
  finalsGames: number;
}

export function nextPowerOf2AndRounds(count: number): BracketPowerShape {
  let bracketSize = 1;
  let numRounds = 0;
  while (bracketSize < count) {
    bracketSize *= 2;
    numRounds += 1;
  }
  return { bracketSize, numRounds };
}

function concentratedByeFirstRound(
  total: number,
  shape: BracketPowerShape,
  roomSize: RoomSize,
): { rooms: number[]; byeCount: number } {
  const byeCount = shape.bracketSize - total;
  return {
    rooms: distributeRooms(total - byeCount, roomSize),
    byeCount,
  };
}

interface RaceBracketProjection {
  rooms: number[];
  byeCount: number;
  players: number;
  advTotal: number;
}

type RaceSequenceEntry = { type: 'wb'; wbIndex: number } | { type: 'lb'; lbIndex: number } | { type: 'gf' };

function findNextPosition<T>(sequence: readonly T[], after: number, matches: (entry: T) => boolean): number {
  return sequence.findIndex((entry, position) => position > after && matches(entry));
}

function toRoundIndex(startRoundNum: number, sequencePosition: number | null): number | null {
  return sequencePosition === null || sequencePosition === -1 ? null : startRoundNum - 1 + sequencePosition;
}

/** Builds a head-to-head double-elimination bracket with a grand final. */
export function raceDoubleEliminationBracketPhase(
  seedTotal: number,
  startRoundNum: number,
  config: RaceDoubleEliminationConfig,
): TournamentRound[] {
  if (config.roomSize.ideal !== 2) {
    throw new Error(
      `doubleEliminationBracketPhase requires a head-to-head room shape (roomSize.ideal === 2) — got ${config.roomSize.ideal}.`,
    );
  }
  if (config.oddCountStrategy === 'flex') {
    throw new Error(
      'doubleEliminationBracketPhase does not support the "flex" odd-count strategy — a 3-unit room is not double elimination. Use "none" or "bye" instead.',
    );
  }

  const shape = nextPowerOf2AndRounds(seedTotal);
  const winnersRoundCount = shape.numRounds;
  if (winnersRoundCount < 2) {
    throw new Error(
      `doubleEliminationBracketPhase requires at least 2 winners-bracket rounds — got seedTotal ${seedTotal}.`,
    );
  }

  const winners: RaceBracketProjection[] = [];
  let total = seedTotal;
  for (let index = 0; index < winnersRoundCount; index += 1) {
    const distribution =
      index === 0
        ? concentratedByeFirstRound(total, shape, config.roomSize)
        : distributeRoomsWithBye(total, config.roomSize, config.oddCountStrategy);
    const advTotal = distribution.rooms.length + distribution.byeCount;
    winners.push({ ...distribution, players: total, advTotal });
    total = advTotal;
  }

  const losers: Array<{
    rooms: number[];
    byeCount: number;
  }> = [];
  let losersSurvivors = 0;
  for (let index = 0; index < winnersRoundCount; index += 1) {
    const dropCount = winners[index].rooms.length;
    if (index === 0) {
      const drop = distributeRoomsWithBye(dropCount, config.roomSize, config.oddCountStrategy);
      losers.push(drop);
      losersSurvivors = drop.rooms.length + drop.byeCount;
    } else if (index < winnersRoundCount - 1) {
      const absorb = distributeRoomsWithBye(
        losersSurvivors + dropCount,
        config.roomSize,
        config.oddCountStrategy,
      );
      losers.push(absorb);
      const absorbSurvivors = absorb.rooms.length + absorb.byeCount;
      const survive = distributeRoomsWithBye(absorbSurvivors, config.roomSize, config.oddCountStrategy);
      losers.push(survive);
      losersSurvivors = survive.rooms.length + survive.byeCount;
    } else {
      losers.push(
        distributeRoomsWithBye(losersSurvivors + dropCount, config.roomSize, config.oddCountStrategy),
      );
    }
  }

  const sequence: RaceSequenceEntry[] = [];
  let losersIndex = 0;
  for (let index = 0; index < winnersRoundCount; index += 1) {
    sequence.push({ type: 'wb', wbIndex: index });
    const count = index === 0 || index === winnersRoundCount - 1 ? 1 : 2;
    for (let offset = 0; offset < count; offset += 1) {
      sequence.push({ type: 'lb', lbIndex: losersIndex });
      losersIndex += 1;
    }
  }
  sequence.push({ type: 'gf' });

  const grandFinalPosition = sequence.length - 1;

  return sequence.map((entry, position): TournamentRound => {
    if (entry.type === 'gf') {
      return {
        roundNum: startRoundNum + position,
        players: 2,
        rooms: [2],
        byeCount: 0,
        isQual: false,
        isNoElim: false,
        isSemis: false,
        isFinal: true,
        advPerRoom: 1,
        advTotal: 1,
        luckyCount: 0,
        bracket: 'grand-final',
        winnersTo: null,
        losersTo: null,
        numGames: 1,
      };
    }

    const isWinners = entry.type === 'wb';
    const source: RaceBracketProjection = isWinners
      ? winners[entry.wbIndex]
      : {
          ...losers[entry.lbIndex],
          players:
            losers[entry.lbIndex].rooms.reduce((sum, room) => sum + room, 0) + losers[entry.lbIndex].byeCount,
          advTotal: losers[entry.lbIndex].rooms.length + losers[entry.lbIndex].byeCount,
        };
    const winnersToPosition = isWinners
      ? entry.wbIndex === winnersRoundCount - 1
        ? grandFinalPosition
        : findNextPosition(sequence, position, (candidate) => candidate.type === 'wb')
      : findNextPosition(sequence, position, (candidate) => candidate.type !== 'wb');
    const losersToPosition = isWinners ? position + 1 : null;
    return {
      roundNum: startRoundNum + position,
      players: source.players,
      rooms: source.rooms,
      byeCount: source.byeCount,
      isQual: false,
      isNoElim: false,
      isSemis: false,
      isFinal: false,
      advPerRoom: 1,
      advTotal: source.rooms.length + source.byeCount,
      luckyCount: 0,
      bracket: isWinners ? 'winners' : 'losers',
      winnersTo: toRoundIndex(startRoundNum, winnersToPosition),
      losersTo: toRoundIndex(startRoundNum, losersToPosition),
      ...(isWinners && entry.wbIndex === 0 ? { bracketPhaseFirstRound: true } : {}),
    };
  });
}

interface SharedBracketProjection {
  rooms: number[];
  byeCount: number;
  players: number;
  advTotal: number;
  advPerRoom: number;
  luckyCount: number;
}

type SharedSequenceEntry =
  { type: 'wb'; wbIndex: number } | { type: 'lb'; lbIndex: number } | { type: 'final' };

/** Builds a multi-unit bracket where the winners and losers brackets feed one shared final. */
export function sharedFinalDoubleEliminationBracketPhase(
  seedTotal: number,
  startRoundNum: number,
  config: SharedFinalDoubleEliminationConfig,
): TournamentRound[] {
  const winnersQualifiers = config.finalSize - config.lbQualifiers;
  if (!(config.lbQualifiers >= 1) || !(winnersQualifiers >= 1)) {
    throw new Error(
      `doubleEliminationSharedFinalBracketPhase requires lbQualifiers >= 1 and finalSize - lbQualifiers >= 1 — got lbQualifiers=${config.lbQualifiers}, finalSize=${config.finalSize}.`,
    );
  }

  const requestedRounds = computeEliminationRoundCount(seedTotal, winnersQualifiers, config.roomSize);
  if (requestedRounds < 1) {
    throw new Error(
      `doubleEliminationSharedFinalBracketPhase requires at least 1 winners-bracket round — got seedTotal ${seedTotal}, wbQualifiers ${winnersQualifiers}.`,
    );
  }

  const winnersTargets = computeCleanTargets(seedTotal, winnersQualifiers, requestedRounds, config.roomSize);
  const winners: Array<SharedBracketProjection & { dropCount: number }> = [];
  for (const [index, target] of winnersTargets.entries()) {
    const players = index === 0 ? seedTotal : winnersTargets[index - 1];
    const distribution = distributeRoomsWithBye(players, config.roomSize, config.oddCountStrategy);
    const roomAdvanceTarget = target - distribution.byeCount;
    winners.push({
      ...distribution,
      players,
      advTotal: target,
      advPerRoom: Math.floor(roomAdvanceTarget / distribution.rooms.length),
      luckyCount: roomAdvanceTarget % distribution.rooms.length,
      dropCount: players - target,
    });
  }

  const losers: Array<SharedBracketProjection & { afterWbIndex: number }> = [];
  const losersDestinationByWinnersRound: Array<number | null> = Array.from(
    { length: winners.length },
    () => null,
  );
  let losersSurvivors = 0;
  let pendingDrop = 0;
  let pendingFrom: number[] = [];

  for (let winnersIndex = 0; winnersIndex < winners.length; winnersIndex += 1) {
    pendingDrop += winners[winnersIndex].dropCount;
    pendingFrom.push(winnersIndex);
    const players = losersSurvivors + pendingDrop;
    if (players === 0) {
      pendingFrom = [];
      continue;
    }
    const roundsLeft = winners.length - winnersIndex;
    const rawTargets = computeTargets(players, config.lbQualifiers, roundsLeft, config.roomSize);
    const survivorTarget = Math.min(rawTargets[0], players);
    if (survivorTarget === players) continue;

    const distribution = distributeRoomsWithBye(players, config.roomSize, config.oddCountStrategy);
    const roomAdvanceTarget = survivorTarget - distribution.byeCount;
    losers.push({
      ...distribution,
      players,
      advTotal: survivorTarget,
      advPerRoom: Math.floor(roomAdvanceTarget / distribution.rooms.length),
      luckyCount: roomAdvanceTarget % distribution.rooms.length,
      afterWbIndex: winnersIndex,
    });
    const losersIndex = losers.length - 1;
    for (const sourceIndex of pendingFrom) {
      losersDestinationByWinnersRound[sourceIndex] = losersIndex;
    }
    pendingFrom = [];
    losersSurvivors = survivorTarget;
    pendingDrop = 0;
  }

  if (pendingFrom.length > 0) {
    throw new Error(
      `doubleEliminationSharedFinalBracketPhase could not route every winners-bracket round's losers to a losers-bracket round — lbQualifiers (${config.lbQualifiers}) may be too large for how many units winners-bracket play actually eliminates from seedTotal ${seedTotal}.`,
    );
  }

  const sequence: SharedSequenceEntry[] = [];
  for (let winnersIndex = 0; winnersIndex < winners.length; winnersIndex += 1) {
    sequence.push({ type: 'wb', wbIndex: winnersIndex });
    for (const [losersIndex, round] of losers.entries()) {
      if (round.afterWbIndex === winnersIndex) {
        sequence.push({ type: 'lb', lbIndex: losersIndex });
      }
    }
  }
  sequence.push({ type: 'final' });

  const finalPosition = sequence.length - 1;
  const losersSequencePosition = (winnersIndex: number): number | null => {
    const destination = losersDestinationByWinnersRound[winnersIndex];
    if (destination === null) return null;
    const position = sequence.findIndex((entry) => entry.type === 'lb' && entry.lbIndex === destination);
    return position === -1 ? null : position;
  };
  return sequence.map((entry, position): TournamentRound => {
    if (entry.type === 'final') {
      return {
        roundNum: startRoundNum + position,
        players: config.finalSize,
        rooms: [config.finalSize],
        byeCount: 0,
        isQual: false,
        isNoElim: false,
        isSemis: false,
        isFinal: true,
        advPerRoom: 1,
        advTotal: 1,
        luckyCount: 0,
        numGames: config.finalsGames,
        winnersTo: null,
        losersTo: null,
      };
    }

    const isWinners = entry.type === 'wb';
    const source = isWinners ? winners[entry.wbIndex] : losers[entry.lbIndex];
    const nextLosersOrFinal = isWinners
      ? null
      : findNextPosition(sequence, position, (candidate) => candidate.type !== 'wb');
    const winnersTo = isWinners
      ? entry.wbIndex === winners.length - 1
        ? finalPosition
        : findNextPosition(sequence, position, (candidate) => candidate.type === 'wb')
      : nextLosersOrFinal === -1
        ? finalPosition
        : nextLosersOrFinal;
    const losersTo = isWinners ? losersSequencePosition(entry.wbIndex) : null;
    return {
      roundNum: startRoundNum + position,
      players: source.players,
      rooms: source.rooms,
      byeCount: source.byeCount,
      isQual: false,
      isNoElim: false,
      isSemis: false,
      isFinal: false,
      advPerRoom: source.advPerRoom,
      advTotal: source.advTotal,
      luckyCount: source.luckyCount,
      bracket: isWinners ? 'winners' : 'losers',
      winnersTo: toRoundIndex(startRoundNum, winnersTo),
      losersTo: toRoundIndex(startRoundNum, losersTo),
    };
  });
}
