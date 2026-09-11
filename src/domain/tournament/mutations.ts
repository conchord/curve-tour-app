import {
  computeGroupStandings,
  computeQualificationStandings,
  invalidateStaleTieResolutions,
} from './advancement';
import { progressGrandFinalRace } from './finals';
import { getGameFormat } from './formats';
import { validateRoomCap } from './room-distribution';
import { isDisplayNameTaken, rosterKeys } from './roster';
import { buildTournamentProgression, type TournamentProgressionInput } from './schedule-generation';
import { scoreKeysForPosition, tieResolutionList } from './scoring';
import type { MaterializedGamemodeConfig, TournamentRoster, TournamentState, TournamentTeam } from './types';

function dirty(state: TournamentState): TournamentState {
  return { ...state, needsSave: true };
}

export function setRoundScore(
  state: TournamentState,
  key: string,
  value: string | number | null,
  roundIndex: number,
  room: number,
): TournamentState {
  const parsed = value === '' || value === null ? null : Number.parseInt(String(value), 10);
  let next = {
    ...state,
    scores: { ...state.scores, [key]: Number.isNaN(parsed) ? null : parsed },
  };
  next = invalidateStaleTieResolutions(next, roundIndex, room);
  const round = next.rounds[next.curRound];
  if (round && (round.isQual || round.isSwiss)) {
    next = { ...next, qualTable: computeQualificationStandings(next) };
  }
  if (round?.isGroupStage) {
    next = { ...next, groupStandings: computeGroupStandings(next) };
  }
  return dirty(next);
}

export function setFinalScore(
  state: TournamentState,
  key: string,
  value: string | number | null,
): TournamentState {
  const parsed = value === '' || value === null ? '' : Number.parseInt(String(value), 10);
  const updated = dirty({
    ...state,
    finalScores: {
      ...state.finalScores,
      [key]: typeof parsed === 'number' && Number.isNaN(parsed) ? '' : parsed,
    },
  });
  return progressGrandFinalRace(updated).state;
}

export function resolveTournamentTie(state: TournamentState, key: string, name: string): TournamentState {
  const list = [...tieResolutionList(state, key)];
  if (!list.includes(name)) list.push(name);
  return dirty({
    ...state,
    tieResolutions: { ...state.tieResolutions, [key]: list },
  });
}

export function renameIndividual(state: TournamentState, oldName: string, newName: string): TournamentState {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return state;
  const players = state.players as string[];
  const reserves = state.reserves as string[];
  if (players.includes(trimmed) || reserves.includes(trimmed)) return state;
  const rename = (name: string) => (name === oldName ? trimmed : name);
  const finalScores: TournamentState['finalScores'] = {};
  for (const [key, score] of Object.entries(state.finalScores)) {
    const match = key.match(/^(game\d+)-(.*)$/u);
    finalScores[match?.[2] === oldName ? `${match[1]}-${trimmed}` : key] = score;
  }
  return dirty({
    ...state,
    players: players.map(rename),
    reserves: reserves.map(rename),
    assignments: state.assignments.map((round) =>
      round.map((entry) => ({ ...entry, name: rename(entry.name) })),
    ),
    qualTable: state.qualTable.map((entry) => ({ ...entry, name: rename(entry.name) })),
    luckyLosers: state.luckyLosers.map((round) => round.map(rename)),
    tieResolutions: Object.fromEntries(
      Object.entries(state.tieResolutions).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(rename) : rename(value),
      ]),
    ),
    finalScores,
  });
}

function rebuildFutureRounds(state: TournamentState): TournamentState | null {
  const round = state.rounds[state.curRound];
  if (!round?.isNoElim || state.cfg.poolingPhase === 'group-stage') return state;
  const format = getGameFormat(state.gameFormat);
  if (!format) return null;
  const config = state.gamemodeConfig as MaterializedGamemodeConfig;
  if (!config.roomSize || !config.bracketPhase) return null;
  const progression = buildTournamentProgression({
    bracketPhase: config.bracketPhase,
    poolingPhase: state.cfg.poolingPhase ?? 'none',
    config: {
      n: rosterKeys(state.players).length,
      qualAdv: state.cfg.qualAdv ?? rosterKeys(state.players).length,
      groupSize: state.cfg.groupSize ?? 4,
      roundRobinMode: state.cfg.roundRobinMode ?? 'single',
      qualifiersPerGroup: state.cfg.qualifiersPerGroup ?? 2,
    },
    format: config,
    roster: rosterKeys(state.players),
  } as TournamentProgressionInput);
  const rounds = [
    ...state.rounds.slice(0, state.curRound + 1),
    ...progression.rounds.slice(state.curRound + 1),
  ];
  if (validateRoomCap(rounds, format)) return null;
  const emptyTail = Array.from(
    { length: Math.max(0, rounds.length - state.curRound - 1) },
    () => [] as string[],
  );
  return {
    ...state,
    rounds,
    assignments: state.assignments.slice(0, state.curRound + 1),
    byes: [...state.byes.slice(0, state.curRound + 1), ...emptyTail.map(() => [])],
    luckyLosers: [...state.luckyLosers.slice(0, state.curRound + 1), ...emptyTail.map(() => [])],
  };
}

export type ReserveAddResult =
  | { status: 'added'; state: TournamentState }
  | { status: 'blocked'; reason: 'closed' | 'group-stage' | 'strict-room' | 'room-cap' | 'duplicate-name' }
  | { status: 'confirm-over-cap'; room: number; count: number };

export function addReserveUnit(
  state: TournamentState,
  key: string,
  options: { allowOverCap?: boolean } = {},
): ReserveAddResult {
  if (!state.reserveOpen) return { status: 'blocked', reason: 'closed' };
  if (state.cfg.poolingPhase === 'group-stage') {
    return { status: 'blocked', reason: 'group-stage' };
  }
  const format = getGameFormat(state.gameFormat);
  const roomSize = state.gamemodeConfig.roomSize;
  const round = state.rounds[state.curRound];
  if (!format || !roomSize || !round) return { status: 'blocked', reason: 'room-cap' };
  const assignments = state.assignments[state.curRound] ?? [];
  let room = 1;
  let count = assignments.filter((entry) => entry.room === room).length;
  for (let candidate = 2; candidate <= round.rooms.length; candidate += 1) {
    const candidateCount = assignments.filter((entry) => entry.room === candidate).length;
    if (candidateCount < count) {
      room = candidate;
      count = candidateCount;
    }
  }
  if (count >= roomSize.max && state.gamemodeConfig.oddCountStrategy === 'none') {
    return { status: 'blocked', reason: 'strict-room' };
  }
  if (count >= roomSize.max && !options.allowOverCap) {
    return { status: 'confirm-over-cap', room, count };
  }
  const team = format.teamSize
    ? (state.reserves as TournamentTeam[]).find((entry) => entry.teamId === key)
    : undefined;
  if (format.teamSize && !team) return { status: 'blocked', reason: 'room-cap' };
  const nextAssignments = state.assignments.map((entries) => entries.map((entry) => ({ ...entry })));
  nextAssignments[state.curRound] = [
    ...(nextAssignments[state.curRound] ?? []),
    { name: key, room, isLucky: false },
  ];
  let next: TournamentState = {
    ...state,
    assignments: nextAssignments,
    players: format.teamSize
      ? ([...(state.players as TournamentTeam[]), team as TournamentTeam] as TournamentRoster)
      : ([...(state.players as string[]), key] as TournamentRoster),
    reserves: format.teamSize
      ? (state.reserves as TournamentTeam[]).filter((entry) => entry.teamId !== key)
      : (state.reserves as string[]).filter((entry) => entry !== key),
  };
  const rebuilt = rebuildFutureRounds(next);
  if (!rebuilt) return { status: 'blocked', reason: 'room-cap' };
  next = dirty(rebuilt);
  return { status: 'added', state: next };
}

export function addWalkUpIndividual(
  state: TournamentState,
  name: string,
  options: { allowOverCap?: boolean } = {},
): ReserveAddResult {
  const trimmed = name.trim();
  if (!trimmed || getGameFormat(state.gameFormat)?.teamSize) {
    return { status: 'blocked', reason: 'room-cap' };
  }
  if ((state.players as string[]).includes(trimmed) || (state.reserves as string[]).includes(trimmed)) {
    return { status: 'blocked', reason: 'duplicate-name' };
  }
  return addReserveUnit({ ...state, reserves: [...(state.reserves as string[]), trimmed] }, trimmed, options);
}

export function removeReserveUnit(state: TournamentState, key: string): TournamentState {
  const format = getGameFormat(state.gameFormat);
  return dirty({
    ...state,
    reserves: format?.teamSize
      ? (state.reserves as TournamentTeam[]).filter((entry) => entry.teamId !== key)
      : (state.reserves as string[]).filter((entry) => entry !== key),
  });
}

function removeUnitFromCurrentRoom(state: TournamentState, key: string, teamSize: number): TournamentState {
  const roundIndex = state.curRound;
  const assignments = state.assignments[roundIndex] ?? [];
  const found = assignments.find((entry) => entry.name === key);
  if (!found || found.room === null) {
    return {
      ...state,
      assignments: state.assignments.map((entries, index) =>
        index === roundIndex ? entries.filter((entry) => entry.name !== key) : entries,
      ),
    };
  }
  const room = found.room;
  const roomUnits = assignments.filter((entry) => entry.room === room);
  const position = roomUnits.findIndex((entry) => entry.name === key);
  const scores = { ...state.scores };
  const round = state.rounds[roundIndex];
  const keysAtPosition = (positionIndex: number) =>
    scoreKeysForPosition({
      roundIndex,
      room,
      position: positionIndex,
      numGames: Math.max(round.numGames ?? 1, 1),
      teamSize: teamSize || undefined,
    });

  for (let index = position + 1; index < roomUnits.length; index += 1) {
    const from = keysAtPosition(index);
    const to = keysAtPosition(index - 1);
    from.forEach((fromKey, offset) => {
      const toKey = to[offset];
      if (scores[fromKey] !== undefined) scores[toKey] = scores[fromKey];
      else delete scores[toKey];
    });
  }
  for (const scoreKey of keysAtPosition(roomUnits.length - 1)) delete scores[scoreKey];
  return invalidateStaleTieResolutions(
    {
      ...state,
      scores,
      assignments: state.assignments.map((entries, index) =>
        index === roundIndex ? entries.filter((entry) => entry.name !== key) : entries,
      ),
    },
    roundIndex,
    room,
  );
}

export function removeRosterUnit(state: TournamentState, key: string): TournamentState {
  const format = getGameFormat(state.gameFormat);
  const teamSize = format?.teamSize ?? 0;
  let next = removeUnitFromCurrentRoom(state, key, teamSize);
  const strip = (values: string[]) => values.filter((name) => name !== key);
  const tieResolutions = Object.fromEntries(
    Object.entries(next.tieResolutions).map(([tieKey, value]) => {
      const filtered = tieResolutionList(next, tieKey).filter((name) => name !== key);
      return [tieKey, Array.isArray(value) ? filtered : (filtered[0] ?? '')];
    }),
  );
  next = {
    ...next,
    players: teamSize
      ? (next.players as TournamentTeam[]).filter((entry) => entry.teamId !== key)
      : (next.players as string[]).filter((entry) => entry !== key),
    reserves: teamSize
      ? (next.reserves as TournamentTeam[]).filter((entry) => entry.teamId !== key)
      : (next.reserves as string[]).filter((entry) => entry !== key),
    qualTable: next.qualTable.filter((entry) => entry.name !== key),
    luckyLosers: next.luckyLosers.map(strip),
    byes: next.byes.map(strip),
    tieResolutions,
  };
  return dirty(next);
}

function replaceAssignedUnit(
  state: TournamentState,
  oldKey: string,
  newKey: string,
  teamSize?: number,
): TournamentState | null {
  const assignments = state.assignments.map((entries) => entries.map((entry) => ({ ...entry })));
  const current = assignments[state.curRound] ?? [];
  const assignmentIndex = current.findIndex((entry) => entry.name === oldKey);
  if (assignmentIndex < 0) return null;

  const room = current[assignmentIndex].room;
  const position = current.filter((entry) => entry.room === room).findIndex((entry) => entry.name === oldKey);
  current[assignmentIndex].name = newKey;

  const scores = { ...state.scores };
  if (room !== null) {
    for (const key of scoreKeysForPosition({
      roundIndex: state.curRound,
      room,
      position,
      numGames: Math.max(state.rounds[state.curRound].numGames ?? 1, 1),
      teamSize,
    }))
      delete scores[key];
  }

  const poolingByeCounts = { ...state.poolingByeCounts };
  if (poolingByeCounts[oldKey] !== undefined) {
    poolingByeCounts[newKey] = poolingByeCounts[oldKey];
    delete poolingByeCounts[oldKey];
  }

  let next: TournamentState = {
    ...state,
    scores,
    assignments,
    qualTable: state.qualTable.filter((entry) => entry.name !== oldKey),
    byes: state.byes.map((values, index) =>
      index === state.curRound ? values.map((name) => (name === oldKey ? newKey : name)) : values,
    ),
    poolingByeCounts,
  };
  if (room !== null) next = invalidateStaleTieResolutions(next, state.curRound, room);
  return next;
}

export function swapIndividual(state: TournamentState, oldName: string, newName: string): TournamentState {
  const trimmed = newName.trim();
  const players = state.players as string[];
  if (!trimmed || players.includes(trimmed)) return state;

  const replaced = replaceAssignedUnit(state, oldName, trimmed);
  if (!replaced) return state;

  return dirty({
    ...replaced,
    players: players.filter((name) => name !== oldName).concat(trimmed),
    reserves: (state.reserves as string[]).filter((name) => name !== trimmed),
  });
}

export function swapTeam(
  state: TournamentState,
  oldTeamId: string,
  replacement: TournamentTeam,
): TournamentState {
  const format = getGameFormat(state.gameFormat);
  const teamSize = format?.teamSize;
  if (!teamSize || (state.players as TournamentTeam[]).some((team) => team.teamId === replacement.teamId)) {
    return state;
  }
  // The outgoing team (oldTeamId) is excluded -- it's being removed by this
  // same swap, so a replacement sharing its exact name is not a collision.
  if (isDisplayNameTaken(state, replacement.teamName, oldTeamId)) return state;
  const replaced = replaceAssignedUnit(state, oldTeamId, replacement.teamId, teamSize);
  if (!replaced) return state;

  return dirty({
    ...replaced,
    players: (state.players as TournamentTeam[])
      .filter((team) => team.teamId !== oldTeamId)
      .concat(replacement),
    reserves: (state.reserves as TournamentTeam[]).filter((team) => team.teamId !== replacement.teamId),
    groups: state.groups.map((group) => ({
      ...group,
      members: group.members.map((name) => (name === oldTeamId ? replacement.teamId : name)),
    })),
  });
}

export function fillTeamSlot(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
  member: { name: string; userId?: string },
  reserveIndex?: number,
): TournamentState {
  if (!state.reserveOpen) return state;
  const next = updateTeam(state, teamId, (team) => {
    if (team.members[memberIndex]) return team;
    const members = [...team.members];
    members[memberIndex] = member;
    return { ...team, members };
  });
  return reserveIndex === undefined
    ? next
    : {
        ...next,
        reserveIndividuals: next.reserveIndividuals.filter((_, index) => index !== reserveIndex),
      };
}

export function updateTeam(
  state: TournamentState,
  teamId: string,
  updater: (team: TournamentTeam) => TournamentTeam,
): TournamentState {
  return dirty({
    ...state,
    players: (state.players as TournamentTeam[]).map((team) =>
      team.teamId === teamId ? updater({ ...team, members: [...team.members] }) : team,
    ),
  });
}

export function setTeamDefender(state: TournamentState, teamId: string, memberIdx: number): TournamentState {
  const changes = [...(state.defenderChanges[teamId] ?? [])];
  const existing = changes.find((entry) => entry.round === state.curRound);
  if (existing) existing.memberIdx = memberIdx;
  else changes.push({ round: state.curRound, memberIdx });
  return dirty({
    ...state,
    defenderChanges: { ...state.defenderChanges, [teamId]: changes },
  });
}

/**
 * Clears just the registered roster (players/reserves/individual reserves)
 * plus anything derived from it that would otherwise go stale -- the
 * generated schedule preview, if "Generate Schedule" was already clicked
 * pre-start. Deliberately preserves title/gameFormat/scheduleLogic/cfg (the
 * Setup configuration itself) -- the complement of resetTournamentState()
 * below, which preserves the roster but clears live progress.
 */
export function resetRoster(state: TournamentState): TournamentState {
  return {
    ...state,
    players: [],
    reserves: [],
    reserveIndividuals: [],
    confirmedCount: null,
    rounds: [],
    groups: [],
    groupStandings: {},
    qualTable: [],
    gamemodeConfig: {},
    scores: {},
    finalScores: {},
    assignments: [],
    luckyLosers: [],
    byes: [],
    poolingByeCounts: {},
    pendingBracketSeeds: {},
    tieResolutions: {},
    defenderChanges: {},
    curRound: 0,
    reserveOpen: true,
    started: false,
    needsSave: false,
    autoSaved: false,
    tournamentId: null,
  };
}

export function resetTournamentState(state: TournamentState): TournamentState {
  return {
    ...state,
    scores: {},
    finalScores: {},
    assignments: [],
    qualTable: [],
    groupStandings: {},
    poolingByeCounts: {},
    pendingBracketSeeds: {},
    tieResolutions: {},
    luckyLosers: [],
    byes: [],
    defenderChanges: {},
    curRound: 0,
    reserveOpen: true,
    started: false,
    needsSave: false,
    autoSaved: false,
    tournamentId: null,
  };
}
