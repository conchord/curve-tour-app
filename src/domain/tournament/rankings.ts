import { computeGrandFinalRaceState } from './finals';
import { getFinalUnitScore, getUnitScore, orderRoomByScore } from './scoring';
import { rosterKeys, unitDisplay } from './roster';
import type { RoundAssignment, TournamentRound, TournamentState } from './types';

export interface RankingDisplay {
  name: string;
  label: string;
  members: string[] | null;
}

interface ActiveRanking extends RankingDisplay {
  room: number | null;
  isLucky: boolean;
  poolRank: { rank: number; fp: number | null; groupLabel?: string } | null;
}

interface FinalistRanking extends RankingDisplay {
  total: number;
  rank: number;
}

interface EliminatedRanking extends RankingDisplay {
  ri: number;
  round: TournamentRound;
  pct: number;
  rank: number;
}

interface TournamentRankings {
  stillActive: ActiveRanking[];
  finalComplete: boolean;
  finalists: FinalistRanking[];
  eliminatedList: EliminatedRanking[];
  lastRound: TournamentRound;
  lastRi: number;
}

export function lastAssignedRound(state: Pick<TournamentState, 'assignments'>): number {
  let last = -1;
  for (const [index, assignments] of state.assignments.entries()) {
    if (assignments?.length) last = index;
  }
  return last;
}

function assignmentsByRoom(assignments: RoundAssignment[]) {
  const rooms = new Map<string, RoundAssignment[]>();
  for (const assignment of assignments) {
    const key = String(assignment.room);
    rooms.set(key, [...(rooms.get(key) ?? []), assignment]);
  }
  return rooms;
}

export function computeRankings(state: TournamentState): TournamentRankings | null {
  if (!state.rounds.length || !state.assignments.length) return null;
  const lastRi = lastAssignedRound(state);
  if (lastRi === -1) return null;

  const eliminated = new Map<string, { ri: number; round: TournamentRound; pct: number }>();
  for (let roundIndex = 0; roundIndex < lastRi; roundIndex += 1) {
    const round = state.rounds[roundIndex];
    if (round.isFinal) continue;
    const byRoom = assignmentsByRoom(state.assignments[roundIndex] ?? []);
    if (round.bracket) {
      const winners =
        round.winnersTo !== null && round.winnersTo !== undefined
          ? new Set((state.assignments[round.winnersTo] ?? []).map(({ name }) => name))
          : null;
      const losers =
        round.losersTo !== null && round.losersTo !== undefined
          ? new Set((state.assignments[round.losersTo] ?? []).map(({ name }) => name))
          : null;
      for (const [roomKey, roomAssignments] of byRoom) {
        const room = Number(roomKey);
        const scored = orderRoomByScore(
          roomAssignments.map((assignment, position) => ({
            name: assignment.name,
            score: getUnitScore(state, roundIndex, room, position, 0) ?? 0,
          })),
          roundIndex,
          room,
          state,
        );
        const total = scored.reduce((sum, entry) => sum + entry.score, 0);
        for (const entry of scored) {
          if (!winners?.has(entry.name) && !losers?.has(entry.name)) {
            eliminated.set(entry.name, {
              ri: roundIndex,
              round,
              pct: total > 0 ? entry.score / total : 0,
            });
          }
        }
      }
    } else {
      const nextNames = new Set((state.assignments[roundIndex + 1] ?? []).map(({ name }) => name));
      for (const [roomKey, roomAssignments] of byRoom) {
        const room = Number(roomKey);
        const scored = roomAssignments.map((assignment, position) => ({
          name: assignment.name,
          score: getUnitScore(state, roundIndex, room, position, 0) ?? 0,
        }));
        const total = scored.reduce((sum, entry) => sum + entry.score, 0);
        for (const entry of scored) {
          if (!nextNames.has(entry.name)) {
            eliminated.set(entry.name, {
              ri: roundIndex,
              round,
              pct: total > 0 ? entry.score / total : 0,
            });
          }
        }
      }
    }
  }

  const lastRound = state.rounds[lastRi];
  const lastAssignments = state.assignments[lastRi] ?? [];
  let active: RoundAssignment[] = [];
  let finalistValues: Array<{ name: string; total: number }> = [];
  let finalComplete = false;
  if (lastRound.isFinal && lastRound.bracket === 'grand-final') {
    const race = computeGrandFinalRaceState(state, lastRi, lastRound);
    finalComplete = Boolean(race?.decided);
    if (race?.decided) {
      const loser = race.winnerName === race.wbName ? race.lbName : race.wbName;
      finalistValues = [
        {
          name: race.winnerName as string,
          total: race.winnerName === race.wbName ? race.wbWins : race.lbWins,
        },
        {
          name: loser,
          total: race.winnerName === race.wbName ? race.lbWins : race.wbWins,
        },
      ];
    } else active = [...lastAssignments];
  } else if (lastRound.isFinal) {
    const games = lastRound.numGames ?? 0;
    finalComplete =
      lastAssignments.length > 0 &&
      lastAssignments.every((assignment) =>
        Array.from({ length: games }, (_, index) => index + 1).every(
          (game) => getFinalUnitScore(state, assignment.name, game, null) !== null,
        ),
      );
    if (finalComplete) {
      finalistValues = lastAssignments
        .map((assignment) => ({
          name: assignment.name,
          total: Array.from({ length: games }, (_, index) => index + 1).reduce(
            (sum, game) => sum + (getFinalUnitScore(state, assignment.name, game, 0) ?? 0),
            0,
          ),
        }))
        .sort((first, second) => second.total - first.total);
    } else active = [...lastAssignments];
  } else active = [...lastAssignments];

  const activeNames = new Set(active.map(({ name }) => name));
  const finalistNames = new Set(finalistValues.map(({ name }) => name));
  const eliminatedValues = rosterKeys(state.players)
    .filter((name) => !activeNames.has(name) && !finalistNames.has(name))
    .flatMap((name) => {
      const info = eliminated.get(name);
      return info ? [{ name, ...info }] : [];
    })
    .sort((first, second) => second.ri - first.ri || second.pct - first.pct);

  const offset = finalComplete ? finalistValues.length : 0;
  let rank = 0;
  let previousKey: string | null = null;
  const rankedEliminated = eliminatedValues.map((entry, index) => {
    const key = `${entry.ri}|${entry.pct.toFixed(9)}`;
    if (key !== previousKey) {
      rank = index + 1 + offset;
      previousKey = key;
    }
    return { ...entry, rank };
  });

  let finalRank = 0;
  let previousTotal: number | null = null;
  const rankedFinalists = finalistValues.map((entry, index) => {
    if (lastRound.bracket === 'grand-final') return { ...entry, rank: index + 1 };
    if (entry.total !== previousTotal) {
      finalRank = index + 1;
      previousTotal = entry.total;
    }
    return { ...entry, rank: finalRank };
  });

  const poolRanks = new Map<string, { rank: number; fp: number | null; groupLabel?: string }>();
  if (state.cfg.poolingPhase === 'group-stage') {
    for (const [label, table] of Object.entries(state.groupStandings)) {
      table.forEach((entry, index) =>
        poolRanks.set(entry.name, {
          rank: index + 1,
          fp: entry.totalFP,
          groupLabel: label,
        }),
      );
    }
  } else if (state.cfg.poolingPhase && state.cfg.poolingPhase !== 'none') {
    state.qualTable.forEach((entry, index) =>
      poolRanks.set(entry.name, { rank: index + 1, fp: entry.totalFP }),
    );
  }

  const display = (name: string): RankingDisplay => ({
    name,
    ...unitDisplay(state, name),
  });
  return {
    stillActive: active
      .map((entry) => ({
        ...display(entry.name),
        room: entry.room,
        isLucky: Boolean(entry.isLucky),
        poolRank: poolRanks.get(entry.name) ?? null,
      }))
      .sort((first, second) => first.label.localeCompare(second.label)),
    finalComplete,
    finalists: rankedFinalists.map((entry) => ({
      ...entry,
      ...display(entry.name),
    })),
    eliminatedList: rankedEliminated.map((entry) => ({
      ...entry,
      ...display(entry.name),
    })),
    lastRound,
    lastRi,
  };
}
