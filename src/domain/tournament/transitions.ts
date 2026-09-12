import {
  buildAdvancementTiers,
  doubleEliminationComputeAdvancement,
  hasPendingTies,
  kingsValleyComputeAdvancement,
  refreshRoundStandings,
  roomBasedComputeAdvancement,
} from './advancement';
import { nextPowerOf2AndRounds } from './double-elimination';
import { seedFromGroupStageRound } from './pooling';
import {
  avoidSameGroupInFirstBracketRound,
  recordRoomHistory,
  selectPoolingBye,
  sequentialSeed,
  swissFoldPair,
  tieredBracketSeed,
  tieredSeed,
  type SeedCandidate,
} from './seeding';
import type { RoundAssignment, TournamentRound, TournamentState } from './types';

const PENDING_TIES_MESSAGE = 'Resolve all tie-breaks before advancing.';

type RoundAdvanceBlockReason =
  'pending-ties' | 'malformed-final' | 'invalid-room-split' | 'missing-room-size';

type RoundAdvanceNoopReason = 'last-round' | 'grand-final';

type RoundAdvanceResult =
  | { status: 'advanced'; state: TournamentState }
  | {
      status: 'blocked';
      reason: RoundAdvanceBlockReason;
      message: string;
      state: TournamentState;
    }
  | {
      status: 'noop';
      reason: RoundAdvanceNoopReason;
      state: TournamentState;
    };

function cloneForTransition(state: TournamentState): TournamentState {
  return {
    ...state,
    rounds: state.rounds.map((round) => ({
      ...round,
      matches: round.matches?.map((match) => ({
        ...match,
        pair: [...match.pair] as [string, string],
      })),
      groupByes: round.groupByes ? [...round.groupByes] : undefined,
      roomGroups: round.roomGroups ? [...round.roomGroups] : undefined,
    })),
    assignments: state.assignments.map((round) => round.map((assignment) => ({ ...assignment }))),
    luckyLosers: state.luckyLosers.map((round) => [...round]),
    byes: state.byes.map((round) => [...round]),
    poolingByeCounts: { ...state.poolingByeCounts },
    roomHistory: { ...state.roomHistory },
    pendingBracketSeeds: Object.fromEntries(
      Object.entries(state.pendingBracketSeeds).map(([key, assignments]) => [
        key,
        assignments.map((assignment) => ({ ...assignment })),
      ]),
    ),
    qualTable: state.qualTable.map((entry) => ({ ...entry })),
    groupStandings: Object.fromEntries(
      Object.entries(state.groupStandings).map(([label, entries]) => [
        label,
        entries.map((entry) => ({ ...entry })),
      ]),
    ),
  };
}

function uniqueKeepingLast(candidates: SeedCandidate[]): SeedCandidate[] {
  const seen = new Set<string>();
  const output: SeedCandidate[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    output.unshift(candidate);
  }
  return output;
}

/** The state mutation performed indirectly by legacy renderAdminRound(). */
function reserveWindowAtCurrentRound(state: Pick<TournamentState, 'cfg' | 'rounds' | 'curRound'>): boolean {
  let cutRound = -1;
  if (state.cfg.poolingPhase === 'group-stage') {
    for (const [index, round] of state.rounds.entries()) {
      if (round.isGroupStage) cutRound = index;
    }
  } else if (state.cfg.poolingPhase !== 'none') {
    for (const [index, round] of state.rounds.entries()) {
      if (round.isQual || round.isSwiss) cutRound = index;
    }
  } else {
    cutRound = state.rounds.findIndex((round) => !round.isNoElim && !round.isFinal);
  }
  return cutRound !== -1 && state.curRound <= cutRound;
}

function finalizeDoubleEliminationRound(
  state: TournamentState,
  roundIndex: number,
  chosenByes: SeedCandidate[],
): void {
  const targetRound = state.rounds[roundIndex];
  let pool = [...(state.pendingBracketSeeds[roundIndex] ?? [])];
  delete state.pendingBracketSeeds[roundIndex];
  const byeNames = chosenByes.map((candidate) => candidate.name);
  if (byeNames.length) {
    const byeSet = new Set(byeNames);
    pool = pool.filter((candidate) => !byeSet.has(candidate.name));
  }
  const assignments = tieredBracketSeed({
    pool,
    roomSizes: targetRound.rooms,
    roomHistory: state.roomHistory,
    rounds: state.rounds,
    targetRoundIndex: roundIndex,
  }).seeded;
  state.byes[roundIndex] = byeNames;
  for (const name of byeNames) {
    assignments.push({ name, room: null, isLucky: false });
  }
  state.assignments[roundIndex] = assignments;
  state.roomHistory = recordRoomHistory(state.roomHistory, assignments, roundIndex);

  if (targetRound.bracket === 'grand-final') {
    const sourceIndex = state.rounds.findIndex(
      (round) => round.bracket === 'winners' && round.winnersTo === roundIndex,
    );
    if (sourceIndex !== -1) {
      const finalist = doubleEliminationComputeAdvancement(state, sourceIndex).winners[0]?.name;
      if (finalist !== undefined) targetRound.wbFinalistName = finalist;
    }
  }
}

function doubleEliminationFinalMessage(actual: number, expected: number): string {
  return `Can't advance into the Final — ${actual} entrants would arrive instead of the required ${expected}. A mid-tournament withdrawal has likely thrown off the losers bracket's balance too deeply for the usual single-bye recovery to fix automatically; check Manage Teams, or add a replacement, before advancing further.`;
}

function invalidRoomSplitMessage(actual: number, ideal: number): string {
  return `Can't advance — ${actual} units would be heading into the next round, which can't form a clean room split (needs a multiple of ${ideal}). This usually means a team was removed mid-tournament; check Manage Teams before advancing.`;
}

const MISSING_ROOM_SIZE_MESSAGE =
  "Can't advance — this tournament's gamemode configuration is missing a room size. This should never happen for a tournament generated through Setup; it may indicate corrupted or manually-edited state.";

function advanceDoubleElimination(
  input: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): RoundAdvanceResult {
  if (round.bracket === 'grand-final') {
    return { status: 'noop', reason: 'grand-final', state: input };
  }
  const roomSize = input.gamemodeConfig.roomSize;
  if (!roomSize) {
    return {
      status: 'blocked',
      reason: 'missing-room-size',
      message: MISSING_ROOM_SIZE_MESSAGE,
      state: input,
    };
  }
  const state = cloneForTransition(input);
  const result = doubleEliminationComputeAdvancement(state, roundIndex);
  if (state.byes[roundIndex]?.length) {
    result.winners = [...state.byes[roundIndex].map((name) => ({ name })), ...result.winners];
  }

  // Tag every contribution with its room-rank tier + in-tier pct at the
  // moment it's pushed -- buildAdvancementTiers already ranks EVERY occupant
  // of a room (not just advancers), so a "loser" lands at their own actual
  // room-rank position and a carried-over bye folds to rank 0/pct 1, exactly
  // like the generic reseeding path. Captured here, not at finalize time,
  // because a target round's pool can accumulate from more than one source
  // round (see transitions.ts's own pendingBracketSeeds accumulation below) --
  // by finalize time there is no single round left to re-derive this from.
  const tierByName = new Map(
    buildAdvancementTiers(state, roundIndex, [
      ...result.winners.map(({ name }) => name),
      ...result.losers.map(({ name }) => name),
    ]).flatMap((tier) =>
      tier.members.map((member) => [member.name, { tierRank: tier.rank, pct: member.pct }] as const),
    ),
  );
  const tagFor = (name: string) => tierByName.get(name) ?? { tierRank: 0, pct: 1 };

  const nextIndex = roundIndex + 1;
  const winnersTarget = round.winnersTo;
  const losersTarget = round.losersTo;
  const pendingWinners =
    winnersTarget != null
      ? [
          ...(state.pendingBracketSeeds[winnersTarget] ?? []),
          ...result.winners.map(({ name }) => ({
            name,
            isLucky: false,
            ...tagFor(name),
          })),
        ]
      : null;
  const pendingLosers =
    losersTarget != null
      ? [
          ...(state.pendingBracketSeeds[losersTarget] ?? []),
          ...result.losers.map(({ name }) => ({
            name,
            isLucky: false,
            ...tagFor(name),
          })),
        ]
      : null;

  let poolAtNext = [...(state.pendingBracketSeeds[nextIndex] ?? [])];
  if (winnersTarget === nextIndex) poolAtNext = pendingWinners ?? [];
  if (losersTarget === nextIndex) poolAtNext = pendingLosers ?? [];
  const nextRound = state.rounds[nextIndex];
  if (nextRound.isFinal && poolAtNext.length !== nextRound.players) {
    return {
      status: 'blocked',
      reason: 'malformed-final',
      message: doubleEliminationFinalMessage(poolAtNext.length, nextRound.players),
      state: input,
    };
  }

  let chosenByes: SeedCandidate[] = [];
  if (roomSize.min === roomSize.max) {
    const needed = poolAtNext.length % roomSize.ideal;
    if (needed > 0) {
      if (state.gamemodeConfig.oddCountStrategy !== 'bye') {
        return {
          status: 'blocked',
          reason: 'invalid-room-split',
          message: invalidRoomSplitMessage(poolAtNext.length, roomSize.ideal),
          state: input,
        };
      }
      chosenByes = poolAtNext.slice(0, needed);
    }
  }

  if (winnersTarget != null) {
    state.pendingBracketSeeds[winnersTarget] = pendingWinners ?? [];
  }
  if (losersTarget != null) {
    state.pendingBracketSeeds[losersTarget] = pendingLosers ?? [];
  }
  if (winnersTarget != null && result.luckyNames.length) {
    state.luckyLosers[winnersTarget] = [...(state.luckyLosers[winnersTarget] ?? []), ...result.luckyNames];
  }
  state.curRound = nextIndex;
  finalizeDoubleEliminationRound(state, nextIndex, chosenByes);
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  state.needsSave = true;
  return { status: 'advanced', state };
}

function malformedOrdinaryFinalMessage(actual: number): string {
  return `Can't advance to the Final — an odd number of teams (${actual}) would be heading into it, which can't form a clean head-to-head match. This usually means a team was removed mid-tournament; check Manage Teams before advancing.`;
}

/**
 * Kings Valley's advance step: merge each room's promote/stay/demote bands
 * into one flat best-to-worst survivor order (kingsValleyComputeAdvancement),
 * then slice that order into the next round's already-precomputed room
 * sizes (sequentialSeed). Eliminated names need no bookkeeping of their own
 * -- they're simply absent from the next round's assignments, which is
 * already computeRankings()'s existing elimination signal for any round
 * that doesn't set round.bracket.
 */
function advanceKingsValley(input: TournamentState, roundIndex: number): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const { nextRoomOrder } = kingsValleyComputeAdvancement(state, roundIndex);
  const nextIndex = roundIndex + 1;
  const nextRound = state.rounds[nextIndex];
  state.assignments[nextIndex] = sequentialSeed(nextRoomOrder, nextRound.rooms);
  state.curRound = nextIndex;
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  state.needsSave = true;
  return { status: 'advanced', state };
}

/**
 * Pure counterpart of legacy advanceRound(). UI effects (alert, render,
 * persistence and sync) are represented by the returned result/state.
 */
export function advanceTournamentRound(input: TournamentState): RoundAdvanceResult {
  const roundIndex = input.curRound;
  const round = input.rounds[roundIndex];
  const nextRound = input.rounds[roundIndex + 1];
  if (!round || !nextRound) {
    return { status: 'noop', reason: 'last-round', state: input };
  }

  const prepared = refreshRoundStandings(input, roundIndex);
  if (hasPendingTies(prepared, roundIndex)) {
    return {
      status: 'blocked',
      reason: 'pending-ties',
      message: PENDING_TIES_MESSAGE,
      state: prepared,
    };
  }
  if (round.bracket) {
    return advanceDoubleElimination(prepared, roundIndex, round);
  }
  if (round.isKingsValley) {
    return advanceKingsValley(prepared, roundIndex);
  }

  const state = cloneForTransition(prepared);
  const result = roomBasedComputeAdvancement(state, roundIndex);
  if (result.qualTable) state.qualTable = result.qualTable;
  if (result.groupStandings) state.groupStandings = result.groupStandings;
  if (result.luckyNames !== null) {
    state.luckyLosers[roundIndex + 1] = result.luckyNames;
  }

  let advancing: SeedCandidate[] = result.advancing.map((entry) => ({
    ...entry,
  }));
  if (state.byes[roundIndex]?.length) {
    advancing = [
      ...state.byes[roundIndex].map((name) => ({
        name,
        isLucky: false,
      })),
      ...advancing,
    ];
  }
  advancing = uniqueKeepingLast(advancing);

  let seeded: RoundAssignment[];
  if (nextRound.isGroupStage) {
    seeded = seedFromGroupStageRound(nextRound);
    state.byes[roundIndex + 1] = [...(nextRound.groupByes ?? [])];
  } else if (nextRound.isSwiss) {
    const roomSize = state.gamemodeConfig.roomSize;
    if (!roomSize) {
      return {
        status: 'blocked',
        reason: 'missing-room-size',
        message: MISSING_ROOM_SIZE_MESSAGE,
        state,
      };
    }
    const paired = swissFoldPair({
      activeNames: advancing.map((entry) => entry.name),
      throughRoundIndex: roundIndex,
      roomSize,
      state,
    });
    seeded = paired.seeded;
    state.poolingByeCounts = paired.poolingByeCounts;
    state.byes[roundIndex + 1] = paired.byeName ? [paired.byeName] : [];
  } else if (nextRound.isKingsValley) {
    // Kings Valley's own room sizes are already fixed exactly at generation
    // time (distributeRooms() over the shrinking survivor count -- no bye
    // concept at all) -- seed into them precisely rather than via
    // snakeSeed's count-only boustrophedon walk, which can leave a room's
    // actual occupancy off by one from the structural size its own
    // promote/demote/eliminate band counts were computed against. (Every
    // later Kings-Valley-to-Kings-Valley transition already goes through
    // advanceKingsValley()'s sequentialSeed() call above and doesn't have
    // this gap -- this is only reached for the one hop into the very first
    // Kings Valley round, from whatever pooling/no-elim round precedes it.)
    seeded = sequentialSeed(
      advancing.map((entry) => entry.name),
      nextRound.rooms,
    );
    if (round.isGroupStage) {
      seeded = avoidSameGroupInFirstBracketRound(seeded, state.groups);
    }
  } else {
    const roomSize = state.gamemodeConfig.roomSize;
    if (!roomSize) {
      return {
        status: 'blocked',
        reason: 'missing-room-size',
        message: MISSING_ROOM_SIZE_MESSAGE,
        state,
      };
    }
    const newByes: SeedCandidate[] = [];
    if (state.gamemodeConfig.oddCountStrategy === 'bye') {
      let needed = 0;
      if (nextRound.bracketPhaseFirstRound) {
        needed = nextPowerOf2AndRounds(advancing.length).bracketSize - advancing.length;
      } else if (advancing.length % roomSize.ideal !== 0) {
        needed = 1;
      }
      if (needed > 0) {
        if (nextRound.isFinal) {
          return {
            status: 'blocked',
            reason: 'malformed-final',
            message: malformedOrdinaryFinalMessage(advancing.length),
            state,
          };
        }
        if (nextRound.isNoElim && needed === 1) {
          const chosen = selectPoolingBye(advancing, state.poolingByeCounts);
          if (chosen) {
            newByes.push(chosen);
            advancing = advancing.filter((entry) => entry !== chosen);
            state.poolingByeCounts[chosen.name] = (state.poolingByeCounts[chosen.name] ?? 0) + 1;
          }
        } else {
          newByes.push(...advancing.slice(0, needed));
          advancing = advancing.slice(needed);
        }
      }
    }
    seeded = tieredSeed({ state, roundIndex, advancing }).seeded;
    if (round.isGroupStage) {
      seeded = avoidSameGroupInFirstBracketRound(seeded, state.groups);
    }
    state.roomHistory = recordRoomHistory(state.roomHistory, seeded, roundIndex + 1);
    if (newByes.length) {
      state.byes[roundIndex + 1] = newByes.map((entry) => entry.name);
      seeded.push(
        ...newByes.map((entry) => ({
          name: entry.name,
          room: null,
          isLucky: false,
        })),
      );
    }
  }

  state.curRound += 1;
  state.assignments[state.curRound] = seeded;
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  state.needsSave = true;
  return { status: 'advanced', state };
}
