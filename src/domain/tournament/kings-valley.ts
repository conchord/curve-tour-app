import { distributeRooms } from './room-distribution';
import type { RoomSize, TournamentRound } from './types';

export const KINGS_VALLEY_MOVE_FRACTION = 0.25;
export const KINGS_VALLEY_ELIMINATION_FRACTION = 0.5;
export const MAX_KINGS_VALLEY_ROUNDS = 14;

export interface KingsValleyConfig {
  roomSize: RoomSize;
  finalsGames: number;
}

function bandCount(roomSize: number, fraction: number): number {
  return Math.max(1, Math.round(roomSize * fraction));
}

function finalRound(roundNum: number, players: number, finalsGames: number): TournamentRound {
  return {
    roundNum,
    players,
    rooms: [players],
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal: true,
    advPerRoom: 1,
    advTotal: 1,
    luckyCount: 0,
    numGames: finalsGames,
  };
}

/**
 * Rooms are ranked 1 (top) .. R (bottom). Each round, a room's top band
 * promotes to the room above (room 1's promote band has nowhere to go and
 * stays instead), a bottom band demotes to the room below (room R's demote
 * band has nowhere to go and is eliminated instead), and the rest stay.
 * Room sizes are recomputed from the shrinking survivor count via
 * distributeRooms() each round -- the same pure room-sizing function every
 * other bracket phase already uses -- so room count naturally shrinks as
 * bottom-room eliminations reduce the population, with no explicit merge
 * step needed. Once the population fits in one room, that becomes the
 * dedicated Final round and the simulation stops.
 */
export function kingsValleyBracketPhase(
  seedTotal: number,
  startRoundNum: number,
  config: KingsValleyConfig,
): TournamentRound[] {
  const rounds: TournamentRound[] = [];
  let total = seedTotal;
  let roundNum = startRoundNum;

  while (true) {
    const roomSizes = distributeRooms(total, config.roomSize);
    if (roomSizes.length <= 1) {
      rounds.push(finalRound(roundNum, total, config.finalsGames));
      break;
    }

    const bottomIndex = roomSizes.length - 1;
    const kvPromoteCounts: number[] = [];
    const kvDemoteCounts: number[] = [];
    let kvEliminateCount = 0;

    for (const [index, size] of roomSizes.entries()) {
      const promoteCount = bandCount(size, KINGS_VALLEY_MOVE_FRACTION);
      kvPromoteCounts.push(promoteCount);
      if (index === bottomIndex) {
        kvDemoteCounts.push(0);
        kvEliminateCount = Math.min(bandCount(size, KINGS_VALLEY_ELIMINATION_FRACTION), size - promoteCount);
      } else {
        kvDemoteCounts.push(Math.min(bandCount(size, KINGS_VALLEY_MOVE_FRACTION), size - promoteCount));
      }
    }

    rounds.push({
      roundNum,
      players: total,
      rooms: roomSizes,
      byeCount: 0,
      isQual: false,
      isNoElim: false,
      isSemis: false,
      isFinal: false,
      advPerRoom: null,
      advTotal: total - kvEliminateCount,
      luckyCount: 0,
      isKingsValley: true,
      kvPromoteCounts,
      kvDemoteCounts,
      kvEliminateCount,
    });

    total -= kvEliminateCount;
    roundNum += 1;
    if (roundNum - startRoundNum >= MAX_KINGS_VALLEY_ROUNDS) {
      rounds.push(finalRound(roundNum, total, config.finalsGames));
      break;
    }
  }
  return rounds;
}
