import type { GameFormatDefinition, RoomSize, TournamentRound } from './types';

const HARD_ROOM_PLAYER_CAP = 10;

export function distributeRooms(count: number, roomSize: RoomSize): number[] {
  if (count <= 0) return [];
  if (count <= roomSize.max) return [count];

  const minRooms = Math.ceil(count / roomSize.max);
  const maxRooms = Math.floor(count / roomSize.min);
  let roomCount = minRooms;
  if (maxRooms >= minRooms) {
    const idealRooms = Math.round(count / roomSize.ideal);
    roomCount = Math.min(maxRooms, Math.max(minRooms, idealRooms));
  }

  const base = Math.floor(count / roomCount);
  const extra = count % roomCount;
  return Array.from({ length: roomCount }, (_, index) => base + (index < extra ? 1 : 0));
}

export function distributeRoomsWithBye(
  count: number,
  roomSize: RoomSize,
  oddCountStrategy?: string,
): { rooms: number[]; byeCount: number } {
  const remainder = oddCountStrategy === 'bye' && roomSize.min === roomSize.max ? count % roomSize.ideal : 0;
  return {
    rooms: distributeRooms(count - remainder, roomSize),
    byeCount: remainder,
  };
}

export function validateRoomCap(
  rounds: Array<Pick<TournamentRound, 'roundNum' | 'rooms'>>,
  format: Readonly<GameFormatDefinition>,
): string | null {
  const unitSize = format.teamSize ?? 1;
  for (const round of rounds) {
    for (const roomUnits of round.rooms) {
      const playerCount = roomUnits * unitSize;
      if (playerCount > HARD_ROOM_PLAYER_CAP) {
        return (
          `Round ${round.roundNum} would seat ${playerCount} players in one room (` +
          `${roomUnits} ${format.unitLabelPlural.toLowerCase()} × ${unitSize} players each) — ` +
          `over the game's hard cap of ${HARD_ROOM_PLAYER_CAP} players per room. If you set a Semis/Final ` +
          'size override, try a smaller value; otherwise this should not be possible with any registered ' +
          "format's current numbers — please report this before generating."
        );
      }
    }
  }
  return null;
}
