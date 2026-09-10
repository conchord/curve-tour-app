import type { TournamentState } from '../../domain/tournament/types';

export const FIREBASE_NULL_SENTINEL_KEY = '__ffaNull';

export interface SyncTransport {
  write(tournamentId: string, payload: unknown): Promise<void>;
  subscribe(
    tournamentId: string,
    onValue: (payload: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

export type SyncMode = 'writer' | 'viewer';
export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'unavailable' }
  | { kind: 'connecting' }
  | { kind: 'waiting' }
  | { kind: 'active' }
  | { kind: 'error'; message: string }
  | { kind: 'stale' };

export function marshalNullsForFirebase(value: unknown): unknown {
  if (value === null) return { [FIREBASE_NULL_SENTINEL_KEY]: true };
  if (Array.isArray(value)) return value.map(marshalNullsForFirebase);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, marshalNullsForFirebase(child)]),
    );
  }
  return value;
}

export function unmarshalNullsFromFirebase(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)[FIREBASE_NULL_SENTINEL_KEY]
  )
    return null;
  if (Array.isArray(value)) return value.map(unmarshalNullsFromFirebase);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, unmarshalNullsFromFirebase(child)]),
    );
  }
  return value;
}

function changedKeys(previous: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].filter((key) => previous[key] !== next[key]);
}

export function mergeRemoteWriterState(
  current: TournamentState,
  remoteValue: unknown,
  dirtyScoreKeys: ReadonlySet<string>,
  dirtyFinalScoreKeys: ReadonlySet<string>,
): TournamentState | null {
  const decoded = unmarshalNullsFromFirebase(remoteValue);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const remote = { ...(decoded as Partial<TournamentState> & { adminProof?: unknown }) };
  delete remote.adminProof;
  const scores = { ...current.scores };
  for (const [key, value] of Object.entries(remote.scores ?? {})) {
    if (!dirtyScoreKeys.has(key)) scores[key] = value;
  }
  const finalScores = { ...current.finalScores };
  for (const [key, value] of Object.entries(remote.finalScores ?? {})) {
    if (!dirtyFinalScoreKeys.has(key)) finalScores[key] = value;
  }
  delete remote.scores;
  delete remote.finalScores;
  return { ...current, ...remote, scores, finalScores };
}

export interface SyncCoordinatorOptions {
  transport: SyncTransport | null;
  onRemote(state: TournamentState): void;
  onStatus(status: SyncStatus): void;
  delayMs?: number;
}

export class SyncCoordinator {
  private readonly transport: SyncTransport | null;
  private readonly onRemote: (state: TournamentState) => void;
  private readonly onStatus: (status: SyncStatus) => void;
  private readonly delayMs: number;
  private current: TournamentState;
  private mode: SyncMode = 'writer';
  private tournamentId: string | null = null;
  private dirtyScores = new Set<string>();
  private dirtyFinalScores = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private pushInFlight = false;

  constructor(initial: TournamentState, options: SyncCoordinatorOptions) {
    this.current = initial;
    this.transport = options.transport;
    this.onRemote = options.onRemote;
    this.onStatus = options.onStatus;
    this.delayMs = options.delayMs ?? 400;
  }

  configure(mode: SyncMode, tournamentId: string | null): void {
    const subscriptionChanged = mode !== this.mode || tournamentId !== this.tournamentId;
    this.mode = mode;
    this.tournamentId = tournamentId;
    if (!subscriptionChanged) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!tournamentId) {
      this.onStatus({ kind: 'idle' });
      return;
    }
    if (!this.transport) {
      this.onStatus({ kind: 'unavailable' });
      return;
    }
    this.onStatus({ kind: 'connecting' });
    this.unsubscribe = this.transport.subscribe(
      tournamentId,
      (payload) => this.receive(payload),
      (error) => {
        if (this.mode === 'viewer') this.onStatus({ kind: 'stale' });
        else
          this.onStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
  }

  setCurrent(state: TournamentState): void {
    this.current = state;
  }

  updateLocal(previous: TournamentState, next: TournamentState): void {
    this.current = next;
    changedKeys(previous.scores, next.scores).forEach((key) => this.dirtyScores.add(key));
    changedKeys(previous.finalScores, next.finalScores).forEach((key) => this.dirtyFinalScores.add(key));
    this.schedulePush();
  }

  schedulePush(): void {
    if (this.mode === 'viewer' || !this.transport || !this.tournamentId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), this.delayMs);
  }

  private async push(): Promise<void> {
    this.timer = null;
    if (this.mode === 'viewer' || !this.transport || !this.tournamentId) return;
    if (this.pushInFlight) {
      // A previous push (e.g. a slow or hung write) is still settling — coalesce
      // instead of firing another concurrent request on top of it, so a stalled
      // sync backend can never accumulate an unbounded backlog of open writes.
      this.schedulePush();
      return;
    }
    const stateAtPush = JSON.parse(JSON.stringify(this.current)) as TournamentState;
    const pushedScores = Object.fromEntries(
      [...this.dirtyScores].map((key) => [key, stateAtPush.scores[key]]),
    );
    const pushedFinalScores = Object.fromEntries(
      [...this.dirtyFinalScores].map((key) => [key, stateAtPush.finalScores[key]]),
    );
    const payload = marshalNullsForFirebase(stateAtPush);
    this.pushInFlight = true;
    try {
      await this.transport.write(this.tournamentId, payload);
      for (const [key, value] of Object.entries(pushedScores))
        if (this.current.scores[key] === value) this.dirtyScores.delete(key);
      for (const [key, value] of Object.entries(pushedFinalScores))
        if (this.current.finalScores[key] === value) this.dirtyFinalScores.delete(key);
      this.onStatus({ kind: 'active' });
    } catch (error) {
      this.onStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.pushInFlight = false;
    }
  }

  private receive(payload: unknown): void {
    if (!payload) {
      if (this.mode === 'viewer') this.onStatus({ kind: 'waiting' });
      return;
    }
    const next =
      this.mode === 'viewer'
        ? mergeRemoteWriterState(this.current, payload, new Set(), new Set())
        : mergeRemoteWriterState(this.current, payload, this.dirtyScores, this.dirtyFinalScores);
    if (!next) return;
    this.current = next;
    this.onRemote(next);
    this.onStatus({ kind: 'active' });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
