import { describe, expect, it } from 'vitest';
import { distributeRooms, distributeRoomsWithBye, validateRoomCap } from './room-distribution';
import { GAME_FORMATS } from './formats';
import type { RoomSize } from './types';

const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };
const HEAD_TO_HEAD_ROOM_SIZE: RoomSize = { min: 2, max: 2, ideal: 2 };

describe('distributeRooms', () => {
  it('returns an empty array for a non-positive count', () => {
    expect(distributeRooms(0, FFA_ROOM_SIZE)).toEqual([]);
    expect(distributeRooms(-1, FFA_ROOM_SIZE)).toEqual([]);
  });

  it('returns a single room when the count fits within max', () => {
    expect(distributeRooms(8, FFA_ROOM_SIZE)).toEqual([8]);
  });

  it('splits evenly when the count is a clean multiple of ideal', () => {
    expect(distributeRooms(16, FFA_ROOM_SIZE)).toEqual([8, 8]);
  });

  it('distributes the N=17 dead-zone case to [6,6,5], not [9,8]', () => {
    // Legacy anchor case (HANDOFF_LOG "Room cap correction"): FFA's own
    // max:8 ceiling is a competitive-preference choice, not a technical
    // limit, so 17 falls back below the 6-floor rather than exceeding 8.
    expect(distributeRooms(17, FFA_ROOM_SIZE)).toEqual([6, 6, 5]);
  });

  it('spreads the remainder across the first N rooms, largest-first', () => {
    const roomSize: RoomSize = { min: 3, max: 5, ideal: 4 };
    expect(distributeRooms(13, roomSize)).toEqual([5, 4, 4]);
  });

  it('respects a team format room size (team-3v3v3, 11 teams)', () => {
    const roomSize = GAME_FORMATS['team-3v3v3'].defaultRoomSize as RoomSize;
    expect(distributeRooms(11, roomSize)).toEqual([3, 3, 3, 2]);
  });

  it('prefers the ideal room count over the bare minimum when both fit within [minRooms, maxRooms]', () => {
    // minRooms=ceil(20/10)=2, maxRooms=floor(20/4)=5, idealRooms=round(20/6)=3.
    // A regression to bare `minRooms` here would silently produce 2 oversized
    // rooms of 10 instead of 3 well-balanced rooms of ~7.
    const roomSize: RoomSize = { min: 4, max: 10, ideal: 6 };
    expect(distributeRooms(20, roomSize)).toEqual([7, 7, 6]);
  });
});

describe('distributeRoomsWithBye', () => {
  it('produces zero byeCount when oddCountStrategy is not "bye"', () => {
    const result = distributeRoomsWithBye(11, HEAD_TO_HEAD_ROOM_SIZE, 'none');
    expect(result.byeCount).toBe(0);
  });

  it('produces zero byeCount when min !== max (variable room size absorbs the odd unit)', () => {
    const result = distributeRoomsWithBye(11, FFA_ROOM_SIZE, 'bye');
    expect(result.byeCount).toBe(0);
    expect(result.rooms).toEqual([6, 5]);
  });

  it('carves exactly one bye off an odd count under "bye" with a fixed room size', () => {
    const result = distributeRoomsWithBye(11, HEAD_TO_HEAD_ROOM_SIZE, 'bye');
    expect(result.byeCount).toBe(1);
    expect(result.rooms).toEqual([2, 2, 2, 2, 2]);
  });

  it('produces zero byeCount for an even count under "bye" strategy', () => {
    const result = distributeRoomsWithBye(12, HEAD_TO_HEAD_ROOM_SIZE, 'bye');
    expect(result.byeCount).toBe(0);
    expect(result.rooms).toEqual([2, 2, 2, 2, 2, 2]);
  });
});

describe('validateRoomCap', () => {
  it('flags a room whose effective player count exceeds the hard cap for a team format', () => {
    const format = GAME_FORMATS['team-3v3v3'];
    const message = validateRoomCap([{ roundNum: 1, rooms: [4] }], format);
    expect(message).not.toBeNull();
    expect(message).toContain('Round 1');
  });

  it('passes for a room at exactly the cap boundary', () => {
    const format = GAME_FORMATS['team-2v2v2v2'];
    expect(validateRoomCap([{ roundNum: 1, rooms: [5] }], format)).toBeNull();
  });

  it('treats a format with no teamSize as 1 player per unit (ffa-individual)', () => {
    const format = GAME_FORMATS['ffa-individual'];
    expect(validateRoomCap([{ roundNum: 1, rooms: [8] }], format)).toBeNull();
  });
});
