import { computeQualificationStandings } from './advancement';
import type { RandomSource } from './runtime';
import type { RoomSize, RoundAssignment, TournamentGroup, TournamentState } from './types';

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

function swissPairKey(first: string, second: string): string {
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
          played.add(swissPairKey(names[first], names[second]));
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
    if (played.has(swissPairKey(...pairs[index])) && index + 1 < pairs.length) {
      const swappedFirst: [string, string] = [pairs[index][0], pairs[index + 1][1]];
      const swappedSecond: [string, string] = [pairs[index + 1][0], pairs[index][1]];
      if (!played.has(swissPairKey(...swappedFirst)) && !played.has(swissPairKey(...swappedSecond))) {
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
