import { fairPoints, getUnitScore, groupByScore, orderRoomByScore, tieResolutionList } from './scoring';
import { rosterKeys } from './roster';
import type { TournamentRound, TournamentStanding, TournamentState } from './types';

interface ScoredUnit {
  name: string;
  score: number;
}

interface LuckyLoserCandidate {
  name: string;
  pct: number;
}

interface RoomTieCluster {
  players: ScoredUnit[];
  rm: number;
  score: number;
}

interface CutoffTieCluster {
  key: string;
  players: TournamentStanding[];
  fp: number;
  rm: null;
  groupLabel?: string;
}

function scoreRoom(
  state: TournamentState,
  roundIndex: number,
  room: number,
  fallback: number | null,
): ScoredUnit[] {
  return (state.assignments[roundIndex] ?? [])
    .filter((assignment) => assignment.room === room)
    .map((assignment, position) => ({
      name: assignment.name,
      score: getUnitScore(state, roundIndex, room, position, fallback),
    }))
    .filter((entry): entry is ScoredUnit => entry.score !== null);
}

function isLastStandingsRound(state: TournamentState, roundIndex: number): boolean {
  const round = state.rounds[roundIndex];
  const nextRound = state.rounds[roundIndex + 1];
  return Boolean(
    state.cfg.poolingPhase !== 'none' &&
    (round?.isQual || round?.isSwiss) &&
    !(nextRound?.isQual || nextRound?.isSwiss),
  );
}

function luckyLoserCandidate(scored: ScoredUnit[], advPerRoom: number): LuckyLoserCandidate | null {
  const candidate = scored[advPerRoom];
  if (!candidate) return null;
  const roomTotal = scored.reduce((total, entry) => total + entry.score, 0);
  if (roomTotal <= 0) return null;
  return { name: candidate.name, pct: candidate.score / roomTotal };
}

function pickLuckyLosers(candidates: LuckyLoserCandidate[], luckyCount: number): string[] {
  if (!luckyCount || candidates.length === 0) return [];
  return [...candidates]
    .sort((first, second) => second.pct - first.pct)
    .slice(0, luckyCount)
    .map((candidate) => candidate.name);
}

export function detectTieBreaks(
  roundIndex: number,
  round: TournamentRound,
  state: TournamentState,
): Record<string, RoomTieCluster> {
  if (round.isFinal) return {};
  const ties: Record<string, RoomTieCluster> = {};
  for (let room = 1; room <= round.rooms.length; room += 1) {
    const scored = scoreRoom(state, roundIndex, room, null).sort(
      (first, second) => second.score - first.score,
    );
    for (const cluster of groupByScore(scored)) {
      if (cluster.length < 2) continue;
      const key = `r${roundIndex}-rm${room}-s${cluster[0].score}`;
      ties[key] = { players: cluster, rm: room, score: cluster[0].score };
    }
  }
  return ties;
}

export function isTieResolved(
  key: string,
  cluster: Pick<RoomTieCluster, 'players'> | Pick<CutoffTieCluster, 'players'>,
  state: Pick<TournamentState, 'tieResolutions'>,
): boolean {
  return tieResolutionList(state, key).length >= cluster.players.length - 1;
}

type TournamentTieCluster = RoomTieCluster | CutoffTieCluster;

/**
 * Recompute the live cumulative tables that legacy `getAllTies` refreshes
 * before checking a last-pooling-round cutoff. Archive callers should pass
 * their frozen snapshot directly to `getAllTies` instead of calling this.
 */
export function refreshRoundStandings(state: TournamentState, roundIndex: number): TournamentState {
  const round = state.rounds[roundIndex];
  if (!round) return state;
  const nextRound = state.rounds[roundIndex + 1];
  let nextState = state;
  if (isLastStandingsRound(state, roundIndex)) {
    nextState = { ...nextState, qualTable: computeQualificationStandings(state) };
  }
  if (round.isGroupStage && !nextRound?.isGroupStage) {
    nextState = {
      ...nextState,
      groupStandings: computeGroupStandings(nextState),
    };
  }
  return nextState;
}

/** Collect every currently relevant room and standings-cutoff tie. */
export function getAllTies(state: TournamentState, roundIndex: number): Record<string, TournamentTieCluster> {
  const round = state.rounds[roundIndex];
  if (!round) return {};
  const ties: Record<string, TournamentTieCluster> = {
    ...detectTieBreaks(roundIndex, round, state),
  };
  const nextRound = state.rounds[roundIndex + 1];
  if (isLastStandingsRound(state, roundIndex)) {
    const cutoff = detectQualCutoffTie(state);
    if (cutoff) ties[cutoff.key] = cutoff;
  }
  if (round.isGroupStage && !nextRound?.isGroupStage) {
    for (const group of state.groups) {
      const cutoff = detectGroupCutoffTie(group.label, state);
      if (cutoff) ties[cutoff.key] = cutoff;
    }
  }
  return ties;
}

export function hasPendingTies(state: TournamentState, roundIndex: number): boolean {
  return Object.entries(getAllTies(state, roundIndex)).some(
    ([key, cluster]) => !isTieResolved(key, cluster, state),
  );
}

/**
 * Drop room tie decisions whose recorded names no longer belong to the same
 * score cluster. This is the immutable domain equivalent of the legacy
 * score-edit cleanup.
 */
export function invalidateStaleTieResolutions(
  state: TournamentState,
  roundIndex: number,
  room: number,
): TournamentState {
  const round = state.rounds[roundIndex];
  if (!round) return state;
  const currentTies = detectTieBreaks(roundIndex, round, state);
  const prefix = `r${roundIndex}-rm${room}-`;
  const tieResolutions = { ...state.tieResolutions };
  let changed = false;
  for (const key of Object.keys(tieResolutions)) {
    if (!key.startsWith(prefix)) continue;
    const cluster = currentTies[key];
    const resolved = tieResolutionList(state, key);
    const stillValid = Boolean(
      cluster && resolved.every((name) => cluster.players.some((player) => player.name === name)),
    );
    if (!stillValid) {
      delete tieResolutions[key];
      changed = true;
    }
  }
  return changed ? { ...state, tieResolutions } : state;
}

function detectQualCutoffTie(state: Pick<TournamentState, 'qualTable' | 'cfg'>): CutoffTieCluster | null {
  const table = state.qualTable.filter(
    (entry): entry is TournamentStanding & { totalFP: number } => entry.totalFP !== null,
  );
  const qualifiers = state.cfg.qualAdv;
  if (!qualifiers || qualifiers >= table.length) return null;
  const boundary = table[qualifiers - 1].totalFP;
  const players = table.filter((entry) => entry.totalFP === boundary);
  if (players.length < 2) return null;
  return { key: 'qual-cutoff', players, fp: boundary, rm: null };
}

function detectGroupCutoffTie(
  label: string,
  state: Pick<TournamentState, 'groupStandings' | 'cfg'>,
): CutoffTieCluster | null {
  const table = (state.groupStandings[label] ?? []).filter(
    (entry): entry is TournamentStanding & { totalFP: number } => entry.totalFP !== null,
  );
  const qualifiers = state.cfg.qualifiersPerGroup;
  if (!qualifiers || qualifiers >= table.length) return null;
  const boundary = table[qualifiers - 1].totalFP;
  const players = table.filter((entry) => entry.totalFP === boundary);
  if (players.length < 2) return null;
  return {
    key: `group-cutoff-${label}`,
    players,
    fp: boundary,
    rm: null,
    groupLabel: label,
  };
}

function applyCutoffOrder(
  table: TournamentStanding[],
  tie: CutoffTieCluster | null,
  state: Pick<TournamentState, 'tieResolutions'>,
): TournamentStanding[] {
  if (!tie) return table;
  const resolved = tieResolutionList(state, tie.key);
  const remaining = tie.players.map((entry) => entry.name).filter((name) => !resolved.includes(name));
  const byName = new Map(tie.players.map((entry) => [entry.name, entry]));
  const output = [...table];
  const start = output.findIndex((entry) => entry.totalFP === tie.fp);
  for (const [offset, name] of [...resolved, ...remaining].entries()) {
    const entry = byName.get(name);
    if (entry && output[start + offset] !== undefined) {
      output[start + offset] = entry;
    }
  }
  return output;
}

function applyQualCutoffOrder(
  table: TournamentStanding[],
  state: Pick<TournamentState, 'qualTable' | 'cfg' | 'tieResolutions'>,
): TournamentStanding[] {
  return applyCutoffOrder(table, detectQualCutoffTie(state), state);
}

function applyGroupCutoffOrder(
  label: string,
  table: TournamentStanding[],
  state: Pick<TournamentState, 'groupStandings' | 'cfg' | 'tieResolutions'>,
): TournamentStanding[] {
  return applyCutoffOrder(table, detectGroupCutoffTie(label, state), state);
}

interface StandingAccumulator {
  name: string;
  rounds: Array<{ fp: number; score: number }>;
}

function materializeStandings(entries: StandingAccumulator[]): TournamentStanding[] {
  return entries
    .map((entry) => ({
      name: entry.name,
      totalFP: entry.rounds.length ? entry.rounds.reduce((total, round) => total + round.fp, 0) : null,
      totalScore: entry.rounds.reduce((total, round) => total + round.score, 0),
      played: entry.rounds.length,
    }))
    .sort((first, second) => {
      if (first.totalFP === null && second.totalFP === null) return 0;
      if (first.totalFP === null) return 1;
      if (second.totalFP === null) return -1;
      return first.totalFP - second.totalFP;
    });
}

export function computeQualificationStandings(state: TournamentState): TournamentStanding[] {
  const accumulators = new Map<string, StandingAccumulator>(
    rosterKeys(state.players).map((name) => [name, { name, rounds: [] }]),
  );
  for (const [roundIndex, round] of state.rounds.entries()) {
    if (!(round.isQual || round.isSwiss)) continue;
    for (let room = 1; room <= round.rooms.length; room += 1) {
      for (const [index, entry] of orderRoomByScore(
        scoreRoom(state, roundIndex, room, null),
        roundIndex,
        room,
        state,
      ).entries()) {
        accumulators.get(entry.name)?.rounds.push({
          fp: fairPoints(index + 1, entry.score),
          score: entry.score,
        });
      }
    }
  }
  return materializeStandings([...accumulators.values()]);
}

export function computeGroupStandings(state: TournamentState): Record<string, TournamentStanding[]> {
  const byGroup = new Map<string, Map<string, StandingAccumulator>>();
  for (const group of state.groups) {
    byGroup.set(group.label, new Map(group.members.map((name) => [name, { name, rounds: [] }])));
  }

  for (const [roundIndex, round] of state.rounds.entries()) {
    if (!round.isGroupStage) continue;
    for (let room = 1; room <= round.rooms.length; room += 1) {
      const groupLabel = round.roomGroups?.[room - 1];
      if (!groupLabel) continue;
      for (const [index, entry] of orderRoomByScore(
        scoreRoom(state, roundIndex, room, null),
        roundIndex,
        room,
        state,
      ).entries()) {
        byGroup
          .get(groupLabel)
          ?.get(entry.name)
          ?.rounds.push({
            fp: fairPoints(index + 1, entry.score),
            score: entry.score,
          });
      }
    }
  }

  return Object.fromEntries(
    [...byGroup].map(([label, entries]) => [label, materializeStandings([...entries.values()])]),
  );
}

function computeGroupStageAdvancement(state: TournamentState): {
  advancing: Array<{ name: string; isLucky: false }>;
  luckyNames: null;
  groupStandings: Record<string, TournamentStanding[]>;
} {
  const groupStandings = computeGroupStandings(state);
  const stateWithStandings = { ...state, groupStandings };
  const qualifiersPerGroup = state.cfg.qualifiersPerGroup ?? 0;
  const perGroup = state.groups.map((group) =>
    applyGroupCutoffOrder(
      group.label,
      (groupStandings[group.label] ?? []).filter((entry) => entry.totalFP !== null),
      stateWithStandings,
    ).slice(0, qualifiersPerGroup),
  );
  const advancing: Array<{ name: string; isLucky: false }> = [];
  for (let tier = 0; tier < qualifiersPerGroup; tier += 1) {
    const finishers = perGroup
      .map((qualifiers) => qualifiers[tier])
      .filter((entry): entry is TournamentStanding => Boolean(entry))
      .sort((first, second) => (first.totalFP as number) - (second.totalFP as number));
    for (const finisher of finishers) {
      advancing.push({ name: finisher.name, isLucky: false });
    }
  }
  return { advancing, luckyNames: null, groupStandings };
}

interface AdvancementResult {
  advancing: Array<{ name: string; isLucky: boolean }>;
  luckyNames: string[] | null;
  qualTable?: TournamentStanding[];
  groupStandings?: Record<string, TournamentStanding[]>;
}

export function roomBasedComputeAdvancement(state: TournamentState, roundIndex: number): AdvancementResult {
  const round = state.rounds[roundIndex];
  const nextRound = state.rounds[roundIndex + 1];
  if (isLastStandingsRound(state, roundIndex)) {
    const qualTable = computeQualificationStandings(state);
    const ordered = applyQualCutoffOrder(
      qualTable.filter((entry) => entry.totalFP !== null),
      { ...state, qualTable },
    );
    return {
      advancing: ordered.slice(0, state.cfg.qualAdv).map((entry) => ({ name: entry.name, isLucky: false })),
      luckyNames: null,
      qualTable,
    };
  }

  if (round.isGroupStage && !nextRound?.isGroupStage) {
    return computeGroupStageAdvancement(state);
  }

  const direct: Array<{ name: string; isLucky: boolean }> = [];
  const luckyPool: LuckyLoserCandidate[] = [];
  for (let room = 1; room <= round.rooms.length; room += 1) {
    const scored = orderRoomByScore(scoreRoom(state, roundIndex, room, 0), roundIndex, room, state);
    const advancingFromRoom = round.isNoElim ? scored.length : (round.advPerRoom ?? 0);
    for (const entry of scored.slice(0, advancingFromRoom)) {
      direct.push({ name: entry.name, isLucky: false });
    }
    if (!round.isNoElim && round.luckyCount > 0 && scored.length > (round.advPerRoom ?? 0)) {
      const candidate = luckyLoserCandidate(scored, round.advPerRoom ?? 0);
      if (candidate) luckyPool.push(candidate);
    }
  }
  const luckyNames = pickLuckyLosers(luckyPool, round.luckyCount);
  return {
    advancing: [...direct, ...luckyNames.map((name) => ({ name, isLucky: true }))],
    luckyNames,
  };
}

export interface AdvancementTierMember {
  name: string;
  /** score / own-room total in the round just completed -- an in-tier tiebreak only, never meaningfully comparable across tiers (a room-winner's dominance margin only says something about their own specific opponents). */
  pct: number;
  sourceRoom: number;
}

export interface AdvancementTier {
  /** 0 = room winners (or a carried-over bye), 1 = runners-up, etc. */
  rank: number;
  members: AdvancementTierMember[];
}

/**
 * Groups `names` (an advancing/survivor list, however it was selected -- room
 * cutoffs, lucky losers, or even a global cumulative-standings cutoff like
 * Qualification Table's last round) by each unit's RANK POSITION within
 * whichever room they were actually in during `roundIndex`, using that
 * round's own scores -- independent of how `names` was chosen. This is the
 * diversity/rematch-avoidance signal for reseeding: rank position within
 * your own room is directly trustworthy, `pct` only breaks ties within a
 * rank (see the field comment above).
 */
export function buildAdvancementTiers(
  state: TournamentState,
  roundIndex: number,
  names: string[],
): AdvancementTier[] {
  const round = state.rounds[roundIndex];
  const remaining = new Set(names);
  const byRank = new Map<number, AdvancementTierMember[]>();

  if (round) {
    for (let room = 1; room <= round.rooms.length; room += 1) {
      const scored = orderRoomByScore(scoreRoom(state, roundIndex, room, 0), roundIndex, room, state);
      const roomTotal = scored.reduce((total, entry) => total + entry.score, 0);
      for (const [rank, entry] of scored.entries()) {
        if (!remaining.has(entry.name)) continue;
        remaining.delete(entry.name);
        const member: AdvancementTierMember = {
          name: entry.name,
          pct: roomTotal > 0 ? entry.score / roomTotal : 0,
          sourceRoom: room,
        };
        byRank.set(rank, [...(byRank.get(rank) ?? []), member]);
      }
    }
  }

  if (remaining.size > 0) {
    const byeMembers: AdvancementTierMember[] = [...remaining].map((name) => ({
      name,
      pct: 1,
      sourceRoom: 0,
    }));
    byRank.set(0, [...(byRank.get(0) ?? []), ...byeMembers]);
  }

  return [...byRank.entries()]
    .sort(([first], [second]) => first - second)
    .map(([rank, members]) => ({
      rank,
      members: members
        .slice()
        .sort(
          (first, second) =>
            second.pct - first.pct ||
            first.sourceRoom - second.sourceRoom ||
            first.name.localeCompare(second.name),
        ),
    }));
}

interface DoubleEliminationAdvancementResult {
  winners: Array<{ name: string }>;
  losers: Array<{ name: string }>;
  luckyNames: string[];
}

export function doubleEliminationComputeAdvancement(
  state: TournamentState,
  roundIndex: number,
): DoubleEliminationAdvancementResult {
  const round = state.rounds[roundIndex];
  const direct: Array<{ name: string }> = [];
  const losers: Array<{ name: string }> = [];
  const luckyPool: LuckyLoserCandidate[] = [];
  const advancingFromRoom = round.advPerRoom ?? 0;
  for (let room = 1; room <= round.rooms.length; room += 1) {
    const scored = orderRoomByScore(scoreRoom(state, roundIndex, room, 0), roundIndex, room, state);
    direct.push(...scored.slice(0, advancingFromRoom).map(({ name }) => ({ name })));
    losers.push(...scored.slice(advancingFromRoom).map(({ name }) => ({ name })));
    if (round.luckyCount > 0 && scored.length > advancingFromRoom) {
      const candidate = luckyLoserCandidate(scored, advancingFromRoom);
      if (candidate) luckyPool.push(candidate);
    }
  }
  const luckyNames = pickLuckyLosers(luckyPool, round.luckyCount);
  const luckySet = new Set(luckyNames);
  return {
    winners: [...direct, ...luckyNames.map((name) => ({ name }))],
    losers: losers.filter((entry) => !luckySet.has(entry.name)),
    luckyNames,
  };
}

export interface LuckyLoserStanding {
  name: string;
  room: number;
  score: number;
  roomTotal: number;
  pct: number;
  leading: boolean;
}

/**
 * Live, score-dependent ranking of every room's near-miss "lucky loser" candidate for
 * a room-based round (single-elimination/Semis, or a double-elimination WB/LB round).
 * Returns null for rounds where the lucky-loser mechanism structurally cannot apply.
 */
export function computeLuckyLoserStandings(
  state: TournamentState,
  roundIndex: number,
): LuckyLoserStanding[] | null {
  const round = state.rounds[roundIndex];
  if (!round || round.isNoElim || round.isFinal || round.luckyCount <= 0) return null;

  const advPerRoom = round.advPerRoom ?? 0;
  const candidates: Omit<LuckyLoserStanding, 'leading'>[] = [];
  for (let room = 1; room <= round.rooms.length; room += 1) {
    const scored = orderRoomByScore(scoreRoom(state, roundIndex, room, 0), roundIndex, room, state);
    const candidate = luckyLoserCandidate(scored, advPerRoom);
    if (!candidate) continue;
    const roomTotal = scored.reduce((total, entry) => total + entry.score, 0);
    candidates.push({
      name: candidate.name,
      room,
      score: scored[advPerRoom].score,
      roomTotal,
      pct: candidate.pct,
    });
  }

  return [...candidates]
    .sort((first, second) => second.pct - first.pct)
    .map((entry, index) => ({ ...entry, leading: index < round.luckyCount }));
}

/**
 * Kings Valley's per-room promote/stay/demote-or-eliminate split, merged into
 * one flat best-to-worst survivor order. Room i's next-round population is
 * (room i's own stay band) + (room i's own promote band, only for room 1,
 * which has nowhere to promote to) + (room i-1's demote band) + (room i+1's
 * promote band) -- each room's promote/demote band is counted in exactly one
 * of those places, never duplicated or dropped. The bottom room's cut band
 * is excluded from the merge entirely (surfaced only via eliminatedNames).
 */
export function kingsValleyComputeAdvancement(
  state: TournamentState,
  roundIndex: number,
): { nextRoomOrder: string[]; eliminatedNames: string[] } {
  const round = state.rounds[roundIndex];
  const roomCount = round.rooms.length;
  const promoteBands: string[][] = [];
  const demoteBands: string[][] = []; // bottom room's entry is its eliminate band
  const stayBands: string[][] = [];

  for (let room = 1; room <= roomCount; room += 1) {
    const index = room - 1;
    const names = orderRoomByScore(scoreRoom(state, roundIndex, room, 0), roundIndex, room, state).map(
      (entry) => entry.name,
    );
    const promoteCount = round.kvPromoteCounts?.[index] ?? 0;
    const isBottom = room === roomCount;
    const cutCount = isBottom ? (round.kvEliminateCount ?? 0) : (round.kvDemoteCounts?.[index] ?? 0);
    promoteBands.push(names.slice(0, promoteCount));
    stayBands.push(names.slice(promoteCount, names.length - cutCount));
    demoteBands.push(names.slice(names.length - cutCount));
  }

  const nextRoomOrder: string[] = [];
  for (let room = 1; room <= roomCount; room += 1) {
    const index = room - 1;
    const isTop = room === 1;
    const isBottom = room === roomCount;
    nextRoomOrder.push(
      ...(isTop ? [] : demoteBands[index - 1]),
      ...(isTop ? promoteBands[index] : []),
      ...stayBands[index],
      ...(isBottom ? [] : promoteBands[index + 1]),
    );
  }

  return { nextRoomOrder, eliminatedNames: demoteBands[roomCount - 1] };
}
