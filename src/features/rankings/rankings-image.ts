import { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { downloadBlob, sanitizeFilename } from '../../lib/browser-download';

export async function buildRankingsImage(state: TournamentState): Promise<Blob | null> {
  const data = computeRankings(state);
  if (!data) return null;
  const rows = [
    ...data.stillActive.map((entry) => ({
      rank: '—',
      name: entry.label,
      badge: 'STILL IN TOURNAMENT',
      champion: false,
    })),
    ...data.finalists.map((entry) => ({
      rank: String(entry.rank),
      name: entry.label,
      badge: 'REACHED FINAL',
      champion: entry.rank === 1,
    })),
    ...data.eliminatedList.map((entry) => ({
      rank: String(entry.rank),
      name: entry.label,
      badge: entry.round.isFinal ? 'FINAL' : entry.round.isSemis ? 'SEMIS' : `ROUND ${entry.round.roundNum}`,
      champion: false,
    })),
  ];
  const width = 900;
  const rowHeight = 38;
  const height = 120 + rows.length * rowHeight;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(scale, scale);
  context.fillStyle = '#0D0F14';
  context.fillRect(0, 0, width, height);
  context.font = '700 22px sans-serif';
  context.fillStyle = '#00E5FF';
  context.fillText('CFP', 32, 36);
  context.fillStyle = '#E8EDF5';
  context.fillText('TOUR HUB', 82, 36);
  context.font = '600 17px sans-serif';
  context.fillText(state.title.trim() || 'Unnamed Tournament', 32, 68);
  context.font = '600 11px sans-serif';
  context.fillStyle = '#6B7A99';
  context.fillText('FINAL RANKINGS', 32, 92);
  rows.forEach((row, index) => {
    const y = 112 + index * rowHeight;
    if (row.champion) {
      context.fillStyle = 'rgba(0,224,150,.08)';
      context.fillRect(26, y - 20, width - 52, rowHeight - 2);
    }
    context.font = '700 15px sans-serif';
    context.fillStyle = row.champion ? '#00E096' : '#6B7A99';
    context.fillText(row.rank, 34, y + 4);
    context.font = '500 13px sans-serif';
    context.fillStyle = '#E8EDF5';
    context.fillText(row.name.slice(0, 80), 76, y + 4);
    context.font = '600 10px sans-serif';
    context.fillStyle = '#6B7A99';
    context.textAlign = 'right';
    context.fillText(row.badge, width - 34, y + 4);
    context.textAlign = 'left';
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function downloadRankingsImage(state: TournamentState): Promise<boolean> {
  const blob = await buildRankingsImage(state);
  if (!blob) return false;
  downloadBlob(`${sanitizeFilename(state.title || 'Unnamed Tournament')}-rankings.png`, blob);
  return true;
}
