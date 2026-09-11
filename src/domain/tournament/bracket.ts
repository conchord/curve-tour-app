import { lastAssignedRound } from './rankings';
import { snakeSeed } from './seeding';
import type { TournamentRound, TournamentState } from './types';

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

export type ProjectedSlotLabel =
  | { kind: 'room-rank'; room: number; rank: number; advPerRoom: number }
  | { kind: 'lucky' }
  | { kind: 'qualifier-cutoff' }
  | { kind: 'round-edge'; sourceRoundIndex: number; edge: 'advanced' | 'dropped'; label: string };

export function projectedSlotLabelText(slot: ProjectedSlotLabel): string {
  switch (slot.kind) {
    case 'room-rank':
      return slot.advPerRoom === 1 ? `Winner of Room ${slot.room}` : `Room ${slot.room}, Rank ${slot.rank}`;
    case 'lucky':
      return '★ Lucky loser (any room)';
    case 'qualifier-cutoff':
      return 'Qualifier from standings (seed TBD)';
    case 'round-edge':
      return slot.label;
  }
}

function winnersSideCount(round: Pick<TournamentRound, 'advPerRoom' | 'rooms' | 'luckyCount'>): number {
  return (round.advPerRoom ?? 0) * round.rooms.length + round.luckyCount;
}

function losersSideCount(round: Pick<TournamentRound, 'advPerRoom' | 'rooms' | 'luckyCount'>): number {
  const roomSum = round.rooms.reduce((total, size) => total + size, 0);
  return roomSum - (round.advPerRoom ?? 0) * round.rooms.length - round.luckyCount;
}

function isLastPoolingRound(rounds: TournamentRound[], index: number): boolean {
  const round = rounds[index];
  const next = rounds[index + 1];
  return Boolean(round && (round.isQual || round.isSwiss) && !(next?.isQual || next?.isSwiss));
}

function isLastGroupStageRound(rounds: TournamentRound[], index: number): boolean {
  const round = rounds[index];
  const next = rounds[index + 1];
  return Boolean(round?.isGroupStage && !next?.isGroupStage);
}

interface PredecessorEdge {
  sourceIndex: number;
  edge: 'winners' | 'losers';
}

function predecessorsOf(rounds: TournamentRound[], targetIndex: number): PredecessorEdge[] {
  const predecessors: PredecessorEdge[] = [];
  for (let sourceIndex = 0; sourceIndex < targetIndex; sourceIndex += 1) {
    const source = rounds[sourceIndex];
    if (!source) continue;
    if (source.bracket) {
      if (source.winnersTo === targetIndex) predecessors.push({ sourceIndex, edge: 'winners' });
      if (source.losersTo === targetIndex) predecessors.push({ sourceIndex, edge: 'losers' });
    } else if (sourceIndex === targetIndex - 1) {
      predecessors.push({ sourceIndex, edge: 'winners' });
    }
  }
  return predecessors;
}

/**
 * Structural, score-independent projection of where each future round's slots will
 * likely come from. Computed once per render over the whole rounds array. A round
 * index maps to null when its origin can't be resolved ahead of time (group-stage —
 * handled by real names elsewhere; Swiss — handled by the existing pairingTBD note;
 * a no-elim predecessor; a mid-pooling-phase hop; or a structural token-count
 * mismatch, e.g. an unmodeled bye). A null result poisons every downstream round fed
 * (even indirectly) by that round.
 */
export function projectFutureRoundSlots(
  state: Pick<TournamentState, 'rounds' | 'curRound'>,
): Record<number, ProjectedSlotLabel[][] | null> {
  const { rounds } = state;
  const labels = bracketRoundLabels({ rounds });
  const result: Record<number, ProjectedSlotLabel[][] | null> = {};
  const unresolved = new Set<number>();

  for (let targetIndex = state.curRound + 1; targetIndex < rounds.length; targetIndex += 1) {
    const round = rounds[targetIndex];
    if (!round || round.isGroupStage || round.pairingTBD) {
      result[targetIndex] = null;
      continue;
    }

    const predecessors = predecessorsOf(rounds, targetIndex);
    if (!predecessors.length) {
      result[targetIndex] = null;
      continue;
    }
    if (predecessors.some((edge) => unresolved.has(edge.sourceIndex))) {
      result[targetIndex] = null;
      unresolved.add(targetIndex);
      continue;
    }

    const cutoff = predecessors.some(
      ({ sourceIndex }) =>
        isLastPoolingRound(rounds, sourceIndex) || isLastGroupStageRound(rounds, sourceIndex),
    );
    if (cutoff) {
      result[targetIndex] = round.rooms.map((size) =>
        Array.from({ length: size }, (): ProjectedSlotLabel => ({ kind: 'qualifier-cutoff' })),
      );
      continue;
    }

    if (predecessors.some(({ sourceIndex }) => rounds[sourceIndex].isNoElim)) {
      result[targetIndex] = null;
      unresolved.add(targetIndex);
      continue;
    }

    const pool: ProjectedSlotLabel[] = [];
    for (const { sourceIndex, edge } of predecessors) {
      const source = rounds[sourceIndex];
      const sourceLabel = labels[sourceIndex]?.label ?? `Round ${source.roundNum}`;
      if (edge === 'losers') {
        for (let i = 0; i < losersSideCount(source); i += 1) {
          pool.push({
            kind: 'round-edge',
            sourceRoundIndex: sourceIndex,
            edge: 'dropped',
            label: `Dropped from ${sourceLabel}`,
          });
        }
        continue;
      }
      if (source.bracket === 'losers') {
        for (let i = 0; i < winnersSideCount(source); i += 1) {
          pool.push({
            kind: 'round-edge',
            sourceRoundIndex: sourceIndex,
            edge: 'advanced',
            label: `Advanced from ${sourceLabel}`,
          });
        }
        continue;
      }
      const advPerRoom = source.advPerRoom ?? 0;
      for (let room = 1; room <= source.rooms.length; room += 1) {
        for (let rank = 1; rank <= advPerRoom; rank += 1)
          pool.push({ kind: 'room-rank', room, rank, advPerRoom });
      }
      for (let i = 0; i < source.luckyCount; i += 1) pool.push({ kind: 'lucky' });
    }

    const expected = round.rooms.reduce((total, size) => total + size, 0);
    if (pool.length !== expected) {
      result[targetIndex] = null;
      unresolved.add(targetIndex);
      continue;
    }

    const candidates = pool.map((_, index) => ({ name: String(index) }));
    const seeded = snakeSeed(candidates, round.rooms.length);
    const byRoom: ProjectedSlotLabel[][] = round.rooms.map(() => []);
    for (const assignment of seeded) {
      if (assignment.room === null) continue;
      byRoom[assignment.room - 1]?.push(pool[Number(assignment.name)]);
    }
    result[targetIndex] = byRoom;
  }
  return result;
}
