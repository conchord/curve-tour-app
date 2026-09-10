import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { computeRankings } from '../../domain/tournament/rankings';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { createTournamentRuntime, type TournamentRuntime } from '../../domain/tournament/runtime';
import type { ActiveTab, PersistedSetup, TournamentState } from '../../domain/tournament/types';
import {
  findLatestArchiveEntryForTournament,
  loadArchiveIndex,
  writeArchiveSnapshot,
} from '../../lib/persistence/archive';
import { normalizeLiveTournamentState } from '../../lib/persistence/live-state';
import { loadLiveEnvelope, saveLiveEnvelope } from '../../lib/persistence/storage';
import { archiveEntryStorageKey } from '../../lib/persistence/storage-keys';
import { getFirebaseSyncTransport } from '../sync/firebase-client';
import { SyncCoordinator, type SyncStatus, type SyncTransport } from '../sync/live-sync';
import { useAuth } from '../auth/AuthProvider';

declare global {
  interface Window {
    __CURVE_TOUR_SYNC_TRANSPORT__?: SyncTransport;
  }
}

export interface TournamentAppContext {
  state: TournamentState;
  setup: PersistedSetup;
  activeTab: ActiveTab;
  hydrated: boolean;
  unlocked: boolean;
  isViewer: boolean;
  viewTournamentId: string | null;
  runtime: TournamentRuntime;
  syncStatus: SyncStatus;
  setActiveTab(tab: ActiveTab): void;
  updateState(updater: TournamentState | ((current: TournamentState) => TournamentState)): void;
  updateSetup(updater: PersistedSetup | ((current: PersistedSetup) => PersistedSetup)): void;
  unlockAdmin(): void;
  lockAdmin(): void;
}

const Context = createContext<TournamentAppContext | null>(null);

export function TournamentProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const runtime = useMemo(() => createTournamentRuntime(), []);
  const [state, setState] = useState(createDefaultTournamentState);
  const [setup, setSetup] = useState(createDefaultSetup);
  const [activeTab, setActiveTabState] = useState<ActiveTab>('bracket');
  const [hydrated, setHydrated] = useState(false);
  const [isViewer, setIsViewer] = useState(false);
  const [viewTournamentId, setViewTournamentId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: 'idle' });
  const sync = useRef<SyncCoordinator | null>(null);
  const stateRef = useRef(state);
  const setupRef = useRef(setup);
  const activeTabRef = useRef(activeTab);
  const isViewerRef = useRef(isViewer);
  stateRef.current = state;
  setupRef.current = setup;
  activeTabRef.current = activeTab;
  isViewerRef.current = isViewer;

  useEffect(() => {
    const queryId = new URLSearchParams(window.location.search).get('t');
    window.localStorage.removeItem('curveFFA_admin_unlocked');
    window.localStorage.removeItem('curveFFA_admin_proof_hash');
    const viewer = Boolean(queryId) && !auth.canAdmin;
    let loadedState = createDefaultTournamentState();
    let loadedSetup = createDefaultSetup();
    let loadedTab: ActiveTab = 'bracket';
    if (!viewer) {
      const loaded = loadLiveEnvelope(window.localStorage, runtime.ids);
      if (loaded.status === 'loaded') {
        loadedState = loaded.envelope.T;
        loadedSetup = loaded.envelope.setup;
        loadedTab = loaded.envelope.activeTab;
      } else if (loaded.status === 'invalid') {
        console.warn('Could not restore saved tournament state', loaded.error);
      }
      if (queryId && queryId !== loadedState.tournamentId) {
        loadedState = { ...loadedState, tournamentId: queryId };
      }
    } else if (queryId) {
      loadedState = { ...loadedState, tournamentId: queryId };
    }
    setState(loadedState);
    setSetup(loadedSetup);
    setActiveTabState(viewer ? 'bracket' : loadedTab);
    setIsViewer(viewer);
    setViewTournamentId(queryId);
    setHydrated(true);
  }, [runtime]);

  const persist = useCallback(
    (nextState: TournamentState, nextSetup: PersistedSetup, nextTab: ActiveTab, viewer = isViewer) => {
      if (typeof window === 'undefined') return;
      const result = saveLiveEnvelope(
        window.localStorage,
        { T: nextState, setup: nextSetup, activeTab: nextTab },
        { isViewer: viewer },
      );
      if (result.status === 'failed') {
        console.warn('Could not save tournament state', result.error);
      }
    },
    [isViewer],
  );

  useEffect(() => {
    if (!hydrated) return;
    const coordinator = new SyncCoordinator(stateRef.current, {
      transport: window.__CURVE_TOUR_SYNC_TRANSPORT__ ?? getFirebaseSyncTransport(),
      onStatus: setSyncStatus,
      onRemote(remote) {
        const next = normalizeLiveTournamentState(remote, runtime.ids);
        stateRef.current = next;
        setState(next);
        saveLiveEnvelope(
          window.localStorage,
          { T: next, setup: setupRef.current, activeTab: activeTabRef.current },
          { isViewer: isViewerRef.current },
        );
      },
    });
    sync.current = coordinator;
    return () => {
      coordinator.dispose();
      if (sync.current === coordinator) sync.current = null;
    };
  }, [hydrated, runtime]);

  useEffect(() => {
    if (!hydrated || !sync.current) return;
    sync.current.configure(auth.canAdmin && !isViewer ? 'writer' : 'viewer', state.tournamentId);
  }, [auth.canAdmin, hydrated, isViewer, state.tournamentId]);

  useEffect(() => {
    if (!hydrated) return;
    if (!auth.canAdmin) {
      if (activeTabRef.current === 'admin') setActiveTabState('bracket');
      if (viewTournamentId) setIsViewer(true);
      return;
    }
    if (isViewer) {
      setIsViewer(false);
      const next = { ...stateRef.current, tournamentId: viewTournamentId };
      stateRef.current = next;
      setState(next);
      persist(next, setupRef.current, 'admin', false);
      setActiveTabState('admin');
    }
  }, [auth.canAdmin, hydrated, isViewer, persist, viewTournamentId]);

  useEffect(() => {
    sync.current?.setCurrent(state);
  }, [state]);

  useEffect(() => {
    if (!hydrated || isViewer) return;
    const url =
      state.tournamentId && state.started
        ? `${window.location.pathname}?t=${encodeURIComponent(state.tournamentId)}`
        : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [hydrated, isViewer, state.started, state.tournamentId]);

  useEffect(() => {
    if (!hydrated || isViewer || state.autoSaved) return;
    const round = state.rounds[state.curRound];
    if (!round?.isFinal || !computeRankings(state)?.finalComplete) return;
    try {
      const index = loadArchiveIndex(window.localStorage);
      const existing = findLatestArchiveEntryForTournament(index, state.tournamentId);
      let id = existing?.id ?? String(runtime.clock.now());
      while (
        !existing &&
        (index.some((entry) => String(entry.id) === id) ||
          window.localStorage.getItem(archiveEntryStorageKey(id)) !== null)
      ) {
        id = String(Number(id) + 1);
      }
      writeArchiveSnapshot({
        storage: window.localStorage,
        state,
        id,
        dateSaved: new Date(runtime.clock.now()).toISOString(),
        keepAnnotations: Boolean(existing),
      });
      const next = { ...state, autoSaved: true, needsSave: false };
      setState(next);
      persist(next, setup, activeTab);
      sync.current?.updateLocal(state, next);
      window.dispatchEvent(
        new CustomEvent('curve-tour:archive-status', { detail: 'Tournament archived automatically.' }),
      );
    } catch (error) {
      console.warn('Could not automatically archive completed tournament', error);
    }
  }, [activeTab, hydrated, isViewer, persist, runtime, setup, state]);

  const setActiveTab = useCallback(
    (tab: ActiveTab) => {
      setActiveTabState(tab);
      persist(state, setup, tab);
      sync.current?.schedulePush();
    },
    [persist, setup, state],
  );
  const updateState = useCallback(
    (updater: TournamentState | ((current: TournamentState) => TournamentState)) => {
      setState((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        persist(next, setup, activeTab);
        sync.current?.updateLocal(current, next);
        return next;
      });
    },
    [activeTab, persist, setup],
  );
  const updateSetup = useCallback(
    (updater: PersistedSetup | ((current: PersistedSetup) => PersistedSetup)) => {
      setSetup((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        persist(state, next, activeTab);
        sync.current?.schedulePush();
        return next;
      });
    },
    [activeTab, persist, state],
  );
  const unlockAdmin = useCallback(() => {
    if (isViewer) {
      setIsViewer(false);
      const next = {
        ...state,
        tournamentId: viewTournamentId,
      };
      setState(next);
      persist(next, setup, 'admin', false);
    }
    setActiveTabState('admin');
  }, [isViewer, persist, setup, state, viewTournamentId]);
  const lockAdmin = useCallback(() => {
    auth.logout();
    setActiveTabState('bracket');
    if (viewTournamentId) setIsViewer(true);
    persist(state, setup, 'bracket');
  }, [auth, persist, setup, state, viewTournamentId]);

  const value = useMemo<TournamentAppContext>(
    () => ({
      state,
      setup,
      activeTab,
      hydrated,
      unlocked: auth.canAdmin,
      isViewer,
      viewTournamentId,
      runtime,
      syncStatus,
      setActiveTab,
      updateState,
      updateSetup,
      unlockAdmin,
      lockAdmin,
    }),
    [
      activeTab,
      hydrated,
      isViewer,
      lockAdmin,
      runtime,
      syncStatus,
      setActiveTab,
      setup,
      state,
      unlockAdmin,
      auth.canAdmin,
      updateSetup,
      updateState,
      viewTournamentId,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTournamentApp(): TournamentAppContext {
  const value = useContext(Context);
  if (!value) throw new Error('useTournamentApp requires TournamentProvider.');
  return value;
}
