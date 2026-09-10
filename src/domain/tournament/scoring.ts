import { getGameFormat } from './formats';
import { buildTeamMap } from './roster';
import type { TeamScoringRuleKey, TournamentState } from './types';

function scoreOrDefault(raw: string | number | null | undefined, fallback: number | null): number | null {
  return raw !== null && raw !== undefined && raw !== '' ? Number.parseInt(String(raw), 10) : fallback;
}

function computeTeamScore(individualScores: number[], rule: TeamScoringRuleKey, designatedIndex = 0): number {
  return rule === 'designated-player'
    ? individualScores[designatedIndex] || 0
    : individualScores.reduce((total, score) => total + score, 0);
}

export function getDefenderIndex(
  state: Pick<TournamentState, 'defenderChanges'>,
  teamId: string | undefined,
  roundIndex: number,
): number {
  const changes = teamId ? (state.defenderChanges[teamId] ?? []) : [];
  let bestIndex = 0;
  let bestRound = -1;
  for (const change of changes) {
    if (change.round <= roundIndex && change.round > bestRound) {
      bestRound = change.round;
      bestIndex = change.memberIdx;
    }
  }
  return bestIndex;
}

function getUnitScoreForGame(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  game: number | null,
  fallback: number | null,
): number | null {
  const format = getGameFormat(state.gameFormat);
  const teamSize = format?.teamSize;
  const gamePart = game === null ? '' : `-g${game}`;
  if (!teamSize) {
    return scoreOrDefault(state.scores[`r${roundIndex}-rm${room}-p${position}${gamePart}`], fallback);
  }

  const roomAssignments = (state.assignments[roundIndex] ?? []).filter(
    (assignment) => assignment.room === room,
  );
  const team = roomAssignments[position] ? buildTeamMap(state)[roomAssignments[position].name] : undefined;
  const values: number[] = [];
  let anyMissing = false;
  for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
    if (!team?.members?.[memberIndex]) {
      values.push(0);
      continue;
    }
    let value = scoreOrDefault(
      state.scores[`r${roundIndex}-rm${room}-p${position}${gamePart}-m${memberIndex}`],
      null,
    );
    if (value === null) {
      anyMissing = true;
      value = 0;
    }
    values.push(value);
  }
  if (anyMissing && fallback === null) return null;
  const rule = state.gamemodeConfig.teamScoringRule ?? 'sum-members';
  return computeTeamScore(values, rule, getDefenderIndex(state, team?.teamId, roundIndex));
}

export function getUnitScore(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  fallback: number | null,
): number | null {
  const round = state.rounds[roundIndex];
  const games = round?.numGames && round.numGames > 1 ? round.numGames : 1;
  if (games === 1) {
    return getUnitScoreForGame(state, roundIndex, room, position, null, fallback);
  }
  let total = 0;
  let anyMissing = false;
  for (let game = 1; game <= games; game += 1) {
    let value = getUnitScoreForGame(state, roundIndex, room, position, game, null);
    if (value === null) {
      anyMissing = true;
      value = 0;
    }
    total += value;
  }
  return anyMissing && fallback === null ? null : total;
}

export function getFinalUnitScore(
  state: TournamentState,
  key: string,
  game: number,
  fallback: number | null,
): number | null {
  const format = getGameFormat(state.gameFormat);
  const teamSize = format?.teamSize;
  const gamePart = `game${game}`;
  if (!teamSize) {
    return scoreOrDefault(state.finalScores[`${gamePart}-${key}`], fallback);
  }
  const team = buildTeamMap(state)[key];
  const values: number[] = [];
  let anyMissing = false;
  for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
    if (!team?.members?.[memberIndex]) {
      values.push(0);
      continue;
    }
    const value = scoreOrDefault(state.finalScores[`${gamePart}-${key}-m${memberIndex}`], null);
    values.push(value ?? 0);
    if (value === null) anyMissing = true;
  }
  if (anyMissing && fallback === null) return null;
  const rule = state.gamemodeConfig.teamScoringRule ?? 'sum-members';
  const finalRoundIndex = state.rounds.findIndex((round) => round.isFinal);
  return computeTeamScore(values, rule, getDefenderIndex(state, key, finalRoundIndex));
}

export function scoreKeysForPosition(options: {
  roundIndex: number;
  room: number;
  position: number;
  numGames?: number;
  teamSize?: number;
}): string[] {
  const { roundIndex, room, position, numGames = 1, teamSize } = options;
  const keys: string[] = [];
  for (let game = 1; game <= numGames; game += 1) {
    const base = `r${roundIndex}-rm${room}-p${position}` + (numGames > 1 ? `-g${game}` : '');
    if (teamSize) {
      for (let member = 0; member < teamSize; member += 1) {
        keys.push(`${base}-m${member}`);
      }
    } else {
      keys.push(base);
    }
  }
  return keys;
}

export function fairPoints(rank: number, score: number): number {
  return rank - score / 100_000;
}

export function groupByScore<T extends { score: number }>(scoredDescending: T[]): T[][] {
  const clusters: T[][] = [];
  let index = 0;
  while (index < scoredDescending.length) {
    let end = index;
    while (
      end + 1 < scoredDescending.length &&
      scoredDescending[end + 1].score === scoredDescending[index].score
    ) {
      end += 1;
    }
    clusters.push(scoredDescending.slice(index, end + 1));
    index = end + 1;
  }
  return clusters;
}

export function tieResolutionList(state: Pick<TournamentState, 'tieResolutions'>, key: string): string[] {
  const value = state.tieResolutions[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function orderRoomByScore<T extends { name: string; score: number }>(
  scored: T[],
  roundIndex: number,
  room: number,
  state: Pick<TournamentState, 'tieResolutions'>,
): T[] {
  const sorted = [...scored].sort((first, second) => second.score - first.score);
  const ordered: T[] = [];
  for (const cluster of groupByScore(sorted)) {
    if (cluster.length < 2) {
      ordered.push(cluster[0]);
      continue;
    }
    const key = `r${roundIndex}-rm${room}-s${cluster[0].score}`;
    const resolved = tieResolutionList(state, key);
    const byName = new Map(cluster.map((entry) => [entry.name, entry]));
    const remaining = cluster.map((entry) => entry.name).filter((name) => !resolved.includes(name));
    for (const name of [...resolved, ...remaining]) {
      const entry = byName.get(name);
      if (entry) ordered.push(entry);
    }
  }
  return ordered;
}
