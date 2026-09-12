import { buildAdvancementTiers, computeQualificationStandings } from './advancement';
import type { RandomSource } from './runtime';
import type {
  PendingBracketSeed,
  RoomSize,
  RoundAssignment,
  TournamentGroup,
  TournamentRound,
  TournamentState,
} from './types';

export interface SeedCandidate {
  name: string;
  isLucky?: boolean;
}

function candidateName(candidate: string | SeedCandidate): string {
  return typeof candidate === 'string' ? candidate : candidate.name;
}

export function snakeSeed(candidates: Array<string | SeedCandidate>, roomCount: number): RoundAssignment[] {
  const assignments: RoundAssignment[] = [];
  let direction = 1;
  let roomIndex = 0;
  for (const candidate of candidates) {
    assignments.push({
      name: candidateName(candidate),
      room: roomIndex + 1,
      isLucky: typeof candidate === 'string' ? false : Boolean(candidate.isLucky),
    });
    roomIndex += direction;
    if (roomIndex >= roomCount) {
      roomIndex = roomCount - 1;
      direction = -1;
    } else if (roomIndex < 0) {
      roomIndex = 0;
      direction = 1;
    }
  }
  return assignments;
}

/**
 * Slices an already-ordered (best-to-worst) list of names into consecutive
 * chunks matching `roomSizes` -- unlike snakeSeed, this does not reorder or
 * interleave anything, since the input is already globally meaningful (Kings
 * Valley's per-room promote/stay/demote merge). The target round's room
 * sizes are decided independently at generation time and are trusted as-is.
 */
export function sequentialSeed(orderedNames: string[], roomSizes: number[]): RoundAssignment[] {
  const assignments: RoundAssignment[] = [];
  let index = 0;
  for (const [roomIndex, size] of roomSizes.entries()) {
    for (let position = 0; position < size; position += 1) {
      const name = orderedNames[index];
      index += 1;
      if (name === undefined) continue;
      assignments.push({ name, room: roomIndex + 1, isLucky: false });
    }
  }
  return assignments;
}

export function randomSeed(names: string[], rooms: number[], random: RandomSource): RoundAssignment[] {
  const shuffled = [...names];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const assignments: RoundAssignment[] = [];
  let playerIndex = 0;
  for (const [roomIndex, roomSize] of rooms.entries()) {
    for (let position = 0; position < roomSize; position += 1) {
      playerIndex += 1;
      assignments.push({
        name: shuffled[playerIndex - 1] ?? `Player ${playerIndex}`,
        room: roomIndex + 1,
        isLucky: false,
      });
    }
  }
  return assignments;
}

export function avoidSameGroupInFirstBracketRound(
  input: RoundAssignment[],
  groups: TournamentGroup[],
): RoundAssignment[] {
  const seeded = input.map((entry) => ({ ...entry }));
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const member of group.members) groupOf.set(member, group.label);
  }
  const byRoom = new Map<number, number[]>();
  for (const [index, entry] of seeded.entries()) {
    if (entry.room === null) continue;
    byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), index]);
  }

  for (const [room, originalIndices] of byRoom) {
    let indices = originalIndices;
    let progress = true;
    while (progress) {
      progress = false;
      const seen = new Set<string>();
      let collisionIndex = -1;
      for (const index of indices) {
        const group = groupOf.get(seeded[index].name);
        if (group === undefined) continue;
        if (seen.has(group)) {
          collisionIndex = index;
          break;
        }
        seen.add(group);
      }
      if (collisionIndex === -1) break;

      const roomGroups = indices.map((index) => groupOf.get(seeded[index].name));
      const movedGroup = groupOf.get(seeded[collisionIndex].name);
      for (const [otherRoom, originalOtherIndices] of byRoom) {
        if (otherRoom === room || progress) continue;
        let otherIndices = originalOtherIndices;
        const otherGroups = otherIndices.map((index) => groupOf.get(seeded[index].name));
        if (movedGroup !== undefined && otherGroups.includes(movedGroup)) continue;
        for (const candidateIndex of otherIndices) {
          const candidateGroup = groupOf.get(seeded[candidateIndex].name);
          if (candidateGroup === undefined || roomGroups.includes(candidateGroup)) {
            continue;
          }
          const temporaryRoom = seeded[collisionIndex].room;
          seeded[collisionIndex].room = seeded[candidateIndex].room;
          seeded[candidateIndex].room = temporaryRoom;
          indices = indices.map((index) => (index === collisionIndex ? candidateIndex : index));
          otherIndices = otherIndices.map((index) => (index === candidateIndex ? collisionIndex : index));
          byRoom.set(room, indices);
          byRoom.set(otherRoom, otherIndices);
          progress = true;
          break;
        }
      }
    }
  }
  return seeded;
}

export function selectPoolingBye(
  advancing: SeedCandidate[],
  counts: Record<string, number>,
): SeedCandidate | undefined {
  let minimum = Number.POSITIVE_INFINITY;
  for (const candidate of advancing) {
    minimum = Math.min(minimum, counts[candidate.name] ?? 0);
  }
  return advancing.find((candidate) => (counts[candidate.name] ?? 0) === minimum);
}

export function roomPairKey(first: string, second: string): string {
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function collectPlayedSwissPairs(
  state: Pick<TournamentState, 'rounds' | 'assignments'>,
  throughRoundIndex: number,
): Set<string> {
  const played = new Set<string>();
  for (let roundIndex = 0; roundIndex <= throughRoundIndex; roundIndex += 1) {
    if (!state.rounds[roundIndex]?.isSwiss) continue;
    const byRoom = new Map<number, string[]>();
    for (const assignment of state.assignments[roundIndex] ?? []) {
      if (assignment.room === null) continue;
      byRoom.set(assignment.room, [...(byRoom.get(assignment.room) ?? []), assignment.name]);
    }
    for (const names of byRoom.values()) {
      for (let first = 0; first < names.length; first += 1) {
        for (let second = first + 1; second < names.length; second += 1) {
          played.add(roomPairKey(names[first], names[second]));
        }
      }
    }
  }
  return played;
}

export function swissFoldPair(options: {
  activeNames: string[];
  throughRoundIndex: number;
  roomSize: RoomSize;
  state: TournamentState;
}): {
  seeded: RoundAssignment[];
  byeName: string | null;
  poolingByeCounts: Record<string, number>;
} {
  const { activeNames, throughRoundIndex, roomSize, state } = options;
  if (roomSize.ideal !== 2) {
    throw new Error(
      `swissFoldPair requires a head-to-head room shape (roomSize.ideal === 2) — got ${roomSize.ideal}.`,
    );
  }
  const standings = computeQualificationStandings(state);
  const sorted = standings.filter((entry) => activeNames.includes(entry.name)).map((entry) => entry.name);
  for (const name of activeNames) {
    if (!sorted.includes(name)) sorted.push(name);
  }

  const poolingByeCounts = { ...state.poolingByeCounts };
  let byeName: string | null = null;
  if (sorted.length % 2 !== 0) {
    const minimum = Math.min(...sorted.map((name) => poolingByeCounts[name] ?? 0));
    const median = Math.floor(sorted.length / 2);
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const name of sorted.filter((candidate) => (poolingByeCounts[candidate] ?? 0) === minimum)) {
      const distance = Math.abs(sorted.indexOf(name) - median);
      if (distance < bestDistance) {
        bestDistance = distance;
        byeName = name;
      }
    }
    sorted.splice(sorted.indexOf(byeName as string), 1);
    poolingByeCounts[byeName as string] = (poolingByeCounts[byeName as string] ?? 0) + 1;
  }

  const half = sorted.length / 2;
  const pairs: Array<[string, string]> = Array.from({ length: half }, (_, index) => [
    sorted[index],
    sorted[index + half],
  ]);
  const played = collectPlayedSwissPairs(state, throughRoundIndex);
  for (let index = 0; index < pairs.length; index += 1) {
    if (played.has(roomPairKey(...pairs[index])) && index + 1 < pairs.length) {
      const swappedFirst: [string, string] = [pairs[index][0], pairs[index + 1][1]];
      const swappedSecond: [string, string] = [pairs[index + 1][0], pairs[index][1]];
      if (!played.has(roomPairKey(...swappedFirst)) && !played.has(roomPairKey(...swappedSecond))) {
        pairs[index] = swappedFirst;
        pairs[index + 1] = swappedSecond;
      }
    }
  }

  const seeded: RoundAssignment[] = [];
  for (const [index, pair] of pairs.entries()) {
    seeded.push(
      { name: pair[0], room: index + 1, isLucky: false },
      { name: pair[1], room: index + 1, isLucky: false },
    );
  }
  if (byeName) seeded.push({ name: byeName, room: null, isLucky: false });
  return { seeded, byeName, poolingByeCounts };
}

/**
 * Records every co-occurring pair in `seeded` (skipping byes, room:null)
 * against `targetRoundIndex` -- the round `seeded` actually belongs to, not
 * the round being advanced from. Only the most recent shared round is kept
 * per pair (not a full occurrence log), which is exactly what
 * `recencyWeight` needs. Pure -- returns a fresh object.
 */
export function recordRoomHistory(
  roomHistory: Record<string, number>,
  seeded: RoundAssignment[],
  targetRoundIndex: number,
): Record<string, number> {
  const updated = { ...roomHistory };
  const byRoom = new Map<number, string[]>();
  for (const assignment of seeded) {
    if (assignment.room === null) continue;
    byRoom.set(assignment.room, [...(byRoom.get(assignment.room) ?? []), assignment.name]);
  }
  for (const names of byRoom.values()) {
    for (let first = 0; first < names.length; first += 1) {
      for (let second = first + 1; second < names.length; second += 1) {
        updated[roomPairKey(names[first], names[second])] = targetRoundIndex;
      }
    }
  }
  return updated;
}

/**
 * Small premium on avoiding a MORE RECENT repeat over an older one, never a
 * large one: 1.1x at roundsAgo=1 (played together last round), decaying
 * toward 1x as roundsAgo grows. Bound: for a candidate joining a room with up
 * to n existing occupants this reseed, the worst-case cost spread within a
 * FIXED repeat-count is n*K, so a same-repeat-count permutation can never
 * out-cost a +1-repeat-count permutation as long as K < 1/n. This app's
 * largest configured room is FFA individual's defaultRoomSize (ideal 8,
 * formats.ts), so n <= 7 and K must stay below ~0.143 -- 0.1 leaves a
 * comfortable margin. Tunable, but keep this derivation in mind: raising K
 * much further risks letting recency override the base repeat-count
 * priority, which is not the intent.
 */
export const RECENCY_REPEAT_WEIGHT_K = 0.1;

export function recencyWeight(roundsAgo: number): number {
  return 1 + RECENCY_REPEAT_WEIGHT_K / roundsAgo;
}

/** Repeat-avoidance vs room-average-balance priority at the very start of the
 * no-elim/pooling phase (progress=0) and at the reseed deciding Semis'
 * own room composition (progress=1) -- see semisApproachProgress. Both pairs
 * are naturally comparable small-integer magnitudes (repeat-pair counts and
 * tier-rank deviations are both typically single digits per candidate), so
 * no extra normalization is needed between them. The most "taste"-driven
 * constants in this feature -- tunable, unlike RECENCY_REPEAT_WEIGHT_K these
 * have no independent empirical validation beyond reproducing the originally
 * validated (progress=0) prototype's behavior. */
export const DIVERSITY_PRIORITY_WEIGHT_AT_WARMUP = 10;
export const DIVERSITY_PRIORITY_WEIGHT_AT_SEMIS = 1;
export const BALANCE_PRIORITY_WEIGHT_AT_WARMUP = 1;
export const BALANCE_PRIORITY_WEIGHT_AT_SEMIS = 6;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * 0 throughout the no-elim/pooling phase (nothing is ever cut there, so
 * diversity should stay fully prioritized) and at the very first real
 * elimination round; rises to 1 exactly at the round transitioning INTO
 * Semis (the last round with a genuine multi-room split to reseed -- the
 * Final is always a single literal room). Reasoning: room composition FOR
 * round K (decided by the reseed transitioning into K) determines how fair
 * round K's own cut is, since advPerRoom/lucky-loser selection both depend
 * on who's actually in your room -- so the transition feeding into Semis is
 * the highest-stakes one for "did skill legitimately decide who reached the
 * Final," and should lean toward balance, not freshness.
 */
export function semisApproachProgress(rounds: TournamentRound[], roundIndex: number): number {
  if (rounds[roundIndex]?.isNoElim) return 0;
  const firstElimIndex = rounds.findIndex((round) => !round.isNoElim);
  if (firstElimIndex === -1) return 0;
  const semisIndex = rounds.findIndex((round) => round.isSemis);
  const finalIndex = rounds.findIndex((round) => round.isFinal);
  const beforeLastSplit = (semisIndex !== -1 ? semisIndex : finalIndex) - 1;
  if (beforeLastSplit <= firstElimIndex) {
    return roundIndex >= beforeLastSplit ? 1 : 0;
  }
  return clamp01((roundIndex - firstElimIndex) / (beforeLastSplit - firstElimIndex));
}

export interface WaveMember {
  name: string;
  tierRank: number;
}

/**
 * Tries every way (roomNumbers.length! permutations -- trivially small,
 * roomCount is never large enough in this app for this to matter) to assign
 * `members` (one candidate per room this wave) to `roomNumbers`, and picks
 * whichever minimizes a weighted blend of (a) new repeat-pairs against
 * `roomHistory`, recency-weighted, and (b) how far this choice pushes each
 * target room's running tierRank total from the mean across every room in
 * the next round (not just this wave's subset -- rooms untouched this wave
 * keep their prior total). `diversityWeight`/`balanceWeight` set the blend;
 * see semisApproachProgress for how callers derive them. Deterministic:
 * exact ties are broken by permutation-generation order.
 */
export function assignWaveToRooms(
  members: WaveMember[],
  roomNumbers: number[],
  roomMembersSoFar: Map<number, string[]>,
  roomBalanceSoFar: Map<number, number>,
  options: {
    roomHistory: Record<string, number>;
    targetRoundIndex: number;
    allRoomNumbers: number[];
    diversityWeight: number;
    balanceWeight: number;
  },
): Array<{ name: string; room: number }> {
  if (members.length !== roomNumbers.length) {
    throw new Error(
      `assignWaveToRooms: members.length (${members.length}) must equal roomNumbers.length (${roomNumbers.length}).`,
    );
  }
  let best: { assignment: Array<{ name: string; room: number }>; cost: number } | null = null;
  for (const perm of permutationsOf(roomNumbers)) {
    let repeatScore = 0;
    let balanceCost = 0;
    const wouldBeTotals = new Map(
      options.allRoomNumbers.map((room) => [room, roomBalanceSoFar.get(room) ?? 0]),
    );
    for (const [index, member] of members.entries()) {
      const room = perm[index];
      for (const existing of roomMembersSoFar.get(room) ?? []) {
        const key = roomPairKey(member.name, existing);
        const lastRound = options.roomHistory[key];
        if (lastRound === undefined) continue;
        repeatScore += recencyWeight(options.targetRoundIndex - lastRound);
      }
      wouldBeTotals.set(room, (wouldBeTotals.get(room) ?? 0) + member.tierRank);
    }
    const totals = [...wouldBeTotals.values()];
    const mean = totals.reduce((sum, value) => sum + value, 0) / (totals.length || 1);
    for (const total of totals) balanceCost += Math.abs(total - mean);

    const cost = options.diversityWeight * repeatScore + options.balanceWeight * balanceCost;
    if (!best || cost < best.cost) {
      best = { assignment: members.map((member, index) => ({ name: member.name, room: perm[index] })), cost };
    }
  }
  return best?.assignment ?? [];
}

function permutationsOf<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const permutation of permutationsOf(rest)) result.push([values[index], ...permutation]);
  }
  return result;
}

/**
 * Replaces snakeSeed for every ordinary room-based reseed (no-elim/pooling
 * warmup, Qualification Table, and real single-elimination/team-format
 * cuts) -- NOT Kings Valley, double-elimination's WB/LB pooled pipeline,
 * Swiss, or group-stage, all of which use their own mechanisms already.
 * Builds a diversity-ordered pool from per-room rank tiers (see
 * buildAdvancementTiers), then walks it in capacity-derived "waves" sized by
 * nextRound.rooms so it works whether the room count/shape stays the same
 * (the no-elim case) or shrinks (a real cut), picking each wave's room
 * assignment via assignWaveToRooms with weights tapered by
 * semisApproachProgress. No isNoElim branching of its own -- the taper
 * already encodes that distinction.
 */
export function tieredSeed(options: {
  state: TournamentState;
  roundIndex: number;
  advancing: SeedCandidate[];
}): { seeded: RoundAssignment[] } {
  const { state, roundIndex, advancing } = options;
  const nextRound = state.rounds[roundIndex + 1];
  const targetRoundIndex = roundIndex + 1;
  if (!nextRound || nextRound.rooms.length === 0) return { seeded: [] };

  const isLuckyByName = new Map(advancing.map((entry) => [candidateName(entry), Boolean(entry.isLucky)]));
  const tiers = buildAdvancementTiers(
    state,
    roundIndex,
    advancing.map((entry) => candidateName(entry)),
  );
  const flat: WaveMember[] = tiers.flatMap((tier) =>
    tier.members.map((member) => ({ name: member.name, tierRank: tier.rank })),
  );

  const allRoomNumbers = nextRound.rooms.map((_, index) => index + 1);
  const maxWave = Math.max(0, ...nextRound.rooms);
  const progress = semisApproachProgress(state.rounds, roundIndex);
  const diversityWeight = lerp(
    DIVERSITY_PRIORITY_WEIGHT_AT_WARMUP,
    DIVERSITY_PRIORITY_WEIGHT_AT_SEMIS,
    progress,
  );
  const balanceWeight = lerp(BALANCE_PRIORITY_WEIGHT_AT_WARMUP, BALANCE_PRIORITY_WEIGHT_AT_SEMIS, progress);

  const roomMembersSoFar = new Map<number, string[]>(allRoomNumbers.map((room) => [room, []]));
  const roomBalanceSoFar = new Map<number, number>(allRoomNumbers.map((room) => [room, 0]));
  const result: Array<{ name: string; room: number }> = [];
  let cursor = 0;
  for (let wave = 0; wave < maxWave; wave += 1) {
    const waveRooms = nextRound.rooms
      .map((size, index) => ({ size, room: index + 1 }))
      .filter(({ size }) => size > wave)
      .map(({ room }) => room);
    const members = flat.slice(cursor, cursor + waveRooms.length).map((entry) => ({
      name: entry.name,
      tierRank: entry.tierRank,
    }));
    cursor += waveRooms.length;
    if (members.length === 0) continue;
    const assigned = assignWaveToRooms(members, waveRooms, roomMembersSoFar, roomBalanceSoFar, {
      roomHistory: state.roomHistory,
      targetRoundIndex,
      allRoomNumbers,
      diversityWeight,
      balanceWeight,
    });
    for (const { name, room } of assigned) {
      roomMembersSoFar.set(room, [...(roomMembersSoFar.get(room) ?? []), name]);
      const tierRank = members.find((member) => member.name === name)?.tierRank ?? 0;
      roomBalanceSoFar.set(room, (roomBalanceSoFar.get(room) ?? 0) + tierRank);
      result.push({ name, room });
    }
  }

  const seeded: RoundAssignment[] = result.map(({ name, room }) => ({
    name,
    room,
    isLucky: isLuckyByName.get(name) ?? false,
  }));
  return { seeded };
}

/**
 * Progress toward the terminal round (Grand Final, or the shared-final
 * variant's untagged terminal Final round) for a double-elimination target
 * round, computed PER BRACKET SIDE -- winners and losers are two parallel
 * tracks each independently approaching one shared terminal round, unlike
 * the generic path's single linear ladder (see semisApproachProgress), so
 * "how close is THIS side to running out of its own rounds" is the right
 * question, not "how close is the whole tournament to Semis." A
 * 'grand-final'-tagged round, or a Final round with no .bracket tag at all
 * (the shared-final variant's terminal round), always gets progress 1 --
 * reaching the actual Final is the single highest-stakes reseed, same
 * reasoning semisApproachProgress uses for the round feeding Semis. New,
 * not organiser-validated the way semisApproachProgress was -- see the
 * "Open judgment calls" note in the plan this was built from.
 */
export function doubleEliminationApproachProgress(
  rounds: TournamentRound[],
  targetRoundIndex: number,
): number {
  const targetRound = rounds[targetRoundIndex];
  const side = targetRound?.bracket;
  if (side !== 'winners' && side !== 'losers') return 1;
  const sameSideIndices = rounds
    .map((round, index) => ({ round, index }))
    .filter(({ round }) => round.bracket === side)
    .map(({ index }) => index);
  if (sameSideIndices.length <= 1) return 1;
  const position = sameSideIndices.indexOf(targetRoundIndex);
  return position / (sameSideIndices.length - 1);
}

/**
 * Replaces snakeSeed for double-elimination's WB/LB routing
 * (finalizeDoubleEliminationRound, transitions.ts) -- structurally a thin
 * sibling of tieredSeed, not a variant that re-derives tiers: `pool` already
 * carries each entry's tierRank/pct, tagged at push time by
 * advanceDoubleElimination (see the tagging note there and on
 * PendingBracketSeed), since a double-elimination target round's pool can
 * accumulate from more than one source round by the time it's finalized.
 * Sorts once by (tierRank asc, pct desc, name asc) -- the same deterministic
 * order buildAdvancementTiers itself produces -- then walks the same
 * capacity-derived wave logic tieredSeed uses, so uneven room sizes (e.g.
 * `[8,8,7,7,7]`) are still respected exactly rather than approximated by a
 * plain room-count bounce.
 */
export function tieredBracketSeed(options: {
  pool: PendingBracketSeed[];
  roomSizes: number[];
  roomHistory: Record<string, number>;
  rounds: TournamentRound[];
  targetRoundIndex: number;
}): { seeded: RoundAssignment[] } {
  const { pool, roomSizes, roomHistory, rounds, targetRoundIndex } = options;
  if (roomSizes.length === 0) return { seeded: [] };

  const progress = doubleEliminationApproachProgress(rounds, targetRoundIndex);
  const diversityWeight = lerp(
    DIVERSITY_PRIORITY_WEIGHT_AT_WARMUP,
    DIVERSITY_PRIORITY_WEIGHT_AT_SEMIS,
    progress,
  );
  const balanceWeight = lerp(BALANCE_PRIORITY_WEIGHT_AT_WARMUP, BALANCE_PRIORITY_WEIGHT_AT_SEMIS, progress);

  const sorted = [...pool].sort(
    (first, second) =>
      first.tierRank - second.tierRank || second.pct - first.pct || first.name.localeCompare(second.name),
  );

  const allRoomNumbers = roomSizes.map((_, index) => index + 1);
  const maxWave = Math.max(0, ...roomSizes);
  const roomMembersSoFar = new Map<number, string[]>(allRoomNumbers.map((room) => [room, []]));
  const roomBalanceSoFar = new Map<number, number>(allRoomNumbers.map((room) => [room, 0]));
  const result: Array<{ name: string; room: number }> = [];
  let cursor = 0;
  for (let wave = 0; wave < maxWave; wave += 1) {
    const waveRooms = roomSizes
      .map((size, index) => ({ size, room: index + 1 }))
      .filter(({ size }) => size > wave)
      .map(({ room }) => room);
    const members = sorted.slice(cursor, cursor + waveRooms.length).map((entry) => ({
      name: entry.name,
      tierRank: entry.tierRank,
    }));
    cursor += waveRooms.length;
    if (members.length === 0) continue;
    const assigned = assignWaveToRooms(members, waveRooms, roomMembersSoFar, roomBalanceSoFar, {
      roomHistory,
      targetRoundIndex,
      allRoomNumbers,
      diversityWeight,
      balanceWeight,
    });
    for (const { name, room } of assigned) {
      roomMembersSoFar.set(room, [...(roomMembersSoFar.get(room) ?? []), name]);
      const tierRank = members.find((member) => member.name === name)?.tierRank ?? 0;
      roomBalanceSoFar.set(room, (roomBalanceSoFar.get(room) ?? 0) + tierRank);
      result.push({ name, room });
    }
  }

  const isLuckyByName = new Map(pool.map((entry) => [entry.name, Boolean(entry.isLucky)]));
  const seeded: RoundAssignment[] = result.map(({ name, room }) => ({
    name,
    room,
    isLucky: isLuckyByName.get(name) ?? false,
  }));
  return { seeded };
}
