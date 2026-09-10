import { lastAssignedRound } from './rankings';
import type { TournamentState } from './types';

interface BracketRoundLabel {
  label: string;
  accent: '' | 'wb' | 'lb' | 'gf';
}

export function bracketRoundLabels(state: Pick<TournamentState, 'rounds'>): BracketRoundLabel[] {
  let winnersRound = 0;
  let losersRound = 0;
  return state.rounds.map((round) => {
    if (round.bracket === 'winners') return { label: `WB Round ${++winnersRound}`, accent: 'wb' };
    if (round.bracket === 'losers') return { label: `LB Round ${++losersRound}`, accent: 'lb' };
    if (round.bracket === 'grand-final') return { label: '🏆 Grand Final', accent: 'gf' };
    const label = round.isFinal
      ? '🏆 Final'
      : round.isSemis
        ? '⚔ Semis'
        : round.isQual
          ? `Round ${round.roundNum} (Qual)`
          : round.isSwiss
            ? `Round ${round.roundNum} (Swiss)`
            : round.isGroupStage
              ? `Round ${round.roundNum} (Group)`
              : `Round ${round.roundNum}`;
    return { label, accent: '' };
  });
}

export interface BracketFollowStatus {
  key: string;
  rounds: Record<number, { room: number | null; isBye: boolean }>;
  lastRi: number;
  room: number | null;
  isBye: boolean;
  eliminated: boolean;
}

export function bracketFollowStatus(
  state: Pick<TournamentState, 'assignments' | 'byes'>,
  key: string | null,
): BracketFollowStatus | null {
  if (!key) return null;
  const rounds: BracketFollowStatus['rounds'] = {};
  let lastRi = -1;
  let room: number | null = null;
  let isBye = false;
  state.assignments.forEach((assignments, roundIndex) => {
    const entry = assignments.find((assignment) => assignment.name === key);
    const listedBye = !entry && Boolean(state.byes[roundIndex]?.includes(key));
    if (!entry && !listedBye) return;
    room = entry?.room ?? null;
    isBye = listedBye || room === null;
    rounds[roundIndex] = { room, isBye };
    lastRi = roundIndex;
  });
  if (lastRi < 0) return null;
  return {
    key,
    rounds,
    lastRi,
    room,
    isBye,
    eliminated: lastRi < lastAssignedRound(state),
  };
}

export function bracketRoundDefaultCollapsed(roundIndex: number, currentRound: number): boolean {
  return roundIndex < currentRound - 1;
}
