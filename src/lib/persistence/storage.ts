import type { IdSource } from '../../domain/tournament/runtime';
import type { PersistedTournamentEnvelope } from '../../domain/tournament/types';
import { parseLiveEnvelope, serializeLiveEnvelope } from './live-state';
import { LEGACY_BRACKET_FOLLOW_KEY, LEGACY_LIVE_STATE_KEY } from './storage-keys';

export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadLiveEnvelopeResult =
  | { status: 'empty' }
  | { status: 'loaded'; envelope: PersistedTournamentEnvelope }
  | { status: 'invalid'; error: unknown };

export function loadLiveEnvelope(
  storage: BrowserStorage,
  ids: Pick<IdSource, 'tournamentId'>,
): LoadLiveEnvelopeResult {
  try {
    const raw = storage.getItem(LEGACY_LIVE_STATE_KEY);
    if (!raw) return { status: 'empty' };
    return { status: 'loaded', envelope: parseLiveEnvelope(raw, ids) };
  } catch (error) {
    return { status: 'invalid', error };
  }
}

export function saveLiveEnvelope(
  storage: BrowserStorage,
  envelope: PersistedTournamentEnvelope,
  options: { isViewer: boolean },
): { status: 'saved' | 'skipped-viewer' | 'failed'; error?: unknown } {
  if (options.isViewer) return { status: 'skipped-viewer' };
  try {
    storage.setItem(LEGACY_LIVE_STATE_KEY, serializeLiveEnvelope(envelope));
    return { status: 'saved' };
  } catch (error) {
    return { status: 'failed', error };
  }
}

export function clearLiveEnvelope(storage: BrowserStorage): void {
  storage.removeItem(LEGACY_LIVE_STATE_KEY);
}

export function readBracketFollow(storage: BrowserStorage): string | null {
  return storage.getItem(LEGACY_BRACKET_FOLLOW_KEY);
}

export function saveBracketFollow(storage: BrowserStorage, unitKey: string | null): void {
  if (unitKey === null) storage.removeItem(LEGACY_BRACKET_FOLLOW_KEY);
  else storage.setItem(LEGACY_BRACKET_FOLLOW_KEY, unitKey);
}
