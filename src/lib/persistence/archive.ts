import type { TournamentState } from '../../domain/tournament/types';
import type { BrowserStorage } from './storage';
import { archiveEntryStorageKey, LEGACY_ARCHIVE_INDEX_KEY } from './storage-keys';

export const ARCHIVE_IMPORT_MAX_BYTES = 25 * 1024 * 1024;

export interface ArchiveAnnotation {
  text: string;
  timestamp: string;
}

export interface ArchiveSummary {
  id: string;
  title: string;
  dateSaved: string;
  tournamentId: string | null;
  playerCount: number;
  roundsPlayed: number;
}

export interface ArchiveEntry {
  id: string;
  title: string;
  dateSaved: string;
  tournamentId: string | null;
  snapshot: TournamentState;
  annotations: ArchiveAnnotation[];
}

export interface ArchiveBundle {
  exportedAt: string;
  tournaments: ArchiveEntry[];
}

export function loadArchiveIndex(storage: BrowserStorage): ArchiveSummary[] {
  try {
    const value = JSON.parse(storage.getItem(LEGACY_ARCHIVE_INDEX_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveArchiveIndex(storage: BrowserStorage, index: ArchiveSummary[]): void {
  storage.setItem(LEGACY_ARCHIVE_INDEX_KEY, JSON.stringify(index));
}

export function loadArchiveEntry(storage: BrowserStorage, id: string): ArchiveEntry | null {
  try {
    return JSON.parse(storage.getItem(archiveEntryStorageKey(id)) ?? 'null') as ArchiveEntry | null;
  } catch {
    return null;
  }
}

export function saveArchiveEntry(storage: BrowserStorage, entry: ArchiveEntry): void {
  storage.setItem(archiveEntryStorageKey(entry.id), JSON.stringify(entry));
}

export function buildArchiveSummary(entry: ArchiveEntry): ArchiveSummary {
  return {
    id: entry.id,
    title: entry.title,
    dateSaved: entry.dateSaved,
    tournamentId: entry.snapshot.tournamentId,
    playerCount: entry.snapshot.players.length,
    roundsPlayed: entry.snapshot.rounds[entry.snapshot.curRound]?.roundNum ?? 0,
  };
}

export function findLatestArchiveEntryForTournament(
  index: ArchiveSummary[],
  tournamentId: string | null,
): ArchiveSummary | undefined {
  if (!tournamentId) return undefined;
  const matches = index.filter((entry) => entry.tournamentId === tournamentId);
  return matches.reduce<ArchiveSummary | undefined>(
    (latest, entry) => (!latest || new Date(entry.dateSaved) > new Date(latest.dateSaved) ? entry : latest),
    undefined,
  );
}

export function writeArchiveSnapshot(options: {
  storage: BrowserStorage;
  state: TournamentState;
  id: string;
  dateSaved: string;
  keepAnnotations?: boolean;
}): ArchiveEntry {
  const { storage, state, id, dateSaved, keepAnnotations = false } = options;
  const title = state.title.trim() || 'Unnamed Tournament';
  const previous = keepAnnotations ? loadArchiveEntry(storage, id) : null;
  const entry: ArchiveEntry = {
    id,
    title,
    dateSaved,
    tournamentId: state.tournamentId,
    snapshot: JSON.parse(JSON.stringify(state)) as TournamentState,
    annotations: previous?.annotations ?? [],
  };
  saveArchiveEntry(storage, entry);
  const index = loadArchiveIndex(storage);
  const summary = buildArchiveSummary(entry);
  const existingIndex = index.findIndex((item) => item.id === id);
  if (existingIndex < 0) index.push(summary);
  else index[existingIndex] = summary;
  saveArchiveIndex(storage, index);
  return entry;
}

export function deleteArchive(storage: BrowserStorage, id: string): void {
  storage.removeItem(archiveEntryStorageKey(id));
  saveArchiveIndex(
    storage,
    loadArchiveIndex(storage).filter((entry) => String(entry.id) !== String(id)),
  );
}

export function updateArchiveAnnotations(
  storage: BrowserStorage,
  id: string,
  annotations: ArchiveAnnotation[],
): ArchiveEntry | null {
  const entry = loadArchiveEntry(storage, id);
  if (!entry) return null;
  const next = { ...entry, annotations };
  saveArchiveEntry(storage, next);
  return next;
}

export function archiveBundle(storage: BrowserStorage, exportedAt: string): ArchiveBundle {
  return {
    exportedAt,
    tournaments: loadArchiveIndex(storage)
      .map((summary) => loadArchiveEntry(storage, summary.id))
      .filter((entry): entry is ArchiveEntry => Boolean(entry)),
  };
}

export function isValidArchiveImportEntry(raw: unknown): raw is ArchiveEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const candidate = raw as Partial<ArchiveEntry>;
  if (candidate.id === undefined || candidate.id === null) return false;
  const snapshot = candidate.snapshot as Partial<TournamentState> | undefined;
  return Boolean(
    snapshot &&
    typeof snapshot === 'object' &&
    !Array.isArray(snapshot) &&
    Array.isArray(snapshot.players) &&
    Array.isArray(snapshot.rounds) &&
    Array.isArray(snapshot.assignments),
  );
}

export type ParsedArchiveImport =
  | { status: 'valid'; entries: ArchiveEntry[]; isBundle: boolean; invalid: number }
  | { status: 'invalid-json' }
  | { status: 'invalid-shape' }
  | { status: 'empty-bundle' };

export function parseArchiveImport(text: string): ParsedArchiveImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: 'invalid-json' };
  }
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray((data as { tournaments?: unknown }).tournaments)
  ) {
    const raws = (data as { tournaments: unknown[] }).tournaments;
    if (!raws.length) return { status: 'empty-bundle' };
    const entries = raws.filter(isValidArchiveImportEntry);
    return entries.length
      ? { status: 'valid', entries, isBundle: true, invalid: raws.length - entries.length }
      : { status: 'invalid-shape' };
  }
  return isValidArchiveImportEntry(data)
    ? { status: 'valid', entries: [data], isBundle: false, invalid: 0 }
    : { status: 'invalid-shape' };
}

export type ArchiveImportMode = 'overwrite' | 'new' | 'skip';
export interface ArchiveImportCounts {
  added: number;
  overwritten: number;
  skippedDup: number;
  failed: number;
  lastTitle: string | null;
  mode: ArchiveImportMode;
}

function validArchiveDate(value: unknown, fallback: string): string {
  return typeof value === 'string' && value && !Number.isNaN(new Date(value).getTime()) ? value : fallback;
}

export function runArchiveImport(options: {
  storage: BrowserStorage;
  entries: ArchiveEntry[];
  mode: ArchiveImportMode;
  now: string;
  mintId(index: ArchiveSummary[]): string;
}): ArchiveImportCounts {
  const { storage, entries, mode, now, mintId } = options;
  const index = loadArchiveIndex(storage);
  const counts: ArchiveImportCounts = {
    added: 0,
    overwritten: 0,
    skippedDup: 0,
    failed: 0,
    lastTitle: null,
    mode,
  };
  for (let position = 0; position < entries.length; position += 1) {
    const raw = entries[position];
    const existingIndex = index.findIndex((entry) => String(entry.id) === String(raw.id));
    let id = String(raw.id);
    let overwrite = false;
    if (existingIndex >= 0 && mode === 'skip') {
      counts.skippedDup += 1;
      continue;
    }
    if (existingIndex >= 0 && mode === 'new') id = mintId(index);
    if (existingIndex >= 0 && mode === 'overwrite') overwrite = true;
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Unnamed Tournament';
    const snapshot = raw.snapshot;
    const entry: ArchiveEntry = {
      id,
      title,
      dateSaved: validArchiveDate(raw.dateSaved, now),
      tournamentId: snapshot.tournamentId !== undefined ? snapshot.tournamentId : (raw.tournamentId ?? null),
      snapshot,
      annotations: Array.isArray(raw.annotations) ? raw.annotations : [],
    };
    try {
      saveArchiveEntry(storage, entry);
    } catch {
      counts.failed = entries.length - position;
      break;
    }
    const summary = buildArchiveSummary(entry);
    const target = index.findIndex((item) => String(item.id) === id);
    if (target < 0) index.push(summary);
    else index[target] = summary;
    if (overwrite) counts.overwritten += 1;
    else counts.added += 1;
    counts.lastTitle = title;
  }
  try {
    saveArchiveIndex(storage, index);
  } catch {
    /* mirrors legacy best effort */
  }
  return counts;
}
