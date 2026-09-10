import { useEffect, useMemo, useState } from 'react';
import { getAllTies, isTieResolved } from '../../domain/tournament/advancement';
import { getGameFormat } from '../../domain/tournament/formats';
import { resetTournamentState } from '../../domain/tournament/mutations';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import {
  findLatestArchiveEntryForTournament,
  loadArchiveIndex,
  writeArchiveSnapshot,
  type ArchiveSummary,
} from '../../lib/persistence/archive';
import { saveBracketFollow } from '../../lib/persistence/storage';
import { archiveEntryStorageKey } from '../../lib/persistence/storage-keys';
import { ByeCard, TournamentUnit } from '../../components/tournament/TournamentUnit';
import {
  Alert,
  Button,
  ButtonRow,
  Field,
  Input,
  Modal,
  ModalActions,
  Panel,
  PanelTitle,
  StatStrip,
  Timeline,
  TimelineItem,
  cn,
} from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { FinalsScores, RoomScores, TieBanners } from './RunningAdminScores';
import { ManageRoster, ReservePanel } from './RunningAdminRoster';
import { LiveSyncCard, Standings, phaseLabel } from './RunningAdminStatus';

type AdminPrompt =
  { kind: 'save'; sameTournament?: ArchiveSummary; titleCollision?: ArchiveSummary } | { kind: 'reset' };

export function RunningAdmin() {
  const app = useTournamentApp();
  const state = app.state;
  const round = state.rounds[state.curRound];
  const [message, setMessage] = useState('');
  const [archiveStatus, setArchiveStatus] = useState('');
  const [prompt, setPrompt] = useState<AdminPrompt | null>(null);
  useEffect(() => {
    const showStatus = (event: Event) => setArchiveStatus((event as CustomEvent<string>).detail);
    window.addEventListener('curve-tour:archive-status', showStatus);
    return () => window.removeEventListener('curve-tour:archive-status', showStatus);
  }, []);
  const pendingTies = useMemo(
    () =>
      Object.entries(getAllTies(state, state.curRound)).some(([key, tie]) => !isTieResolved(key, tie, state)),
    [state],
  );
  if (!round) return <Alert tone='danger'>The saved tournament has no current round.</Alert>;
  const assignments = state.assignments[state.curRound] ?? [];
  const last = state.curRound >= state.rounds.length - 1 || round.bracket === 'grand-final';

  function mintArchiveId(index = loadArchiveIndex(window.localStorage)) {
    let id = String(app.runtime.clock.now());
    while (
      index.some((entry) => String(entry.id) === id) ||
      window.localStorage.getItem(archiveEntryStorageKey(id)) !== null
    ) {
      id = String(Number(id) + 1);
    }
    return id;
  }

  function saveArchive(id: string, keepAnnotations: boolean, status = 'Tournament saved to archive.') {
    writeArchiveSnapshot({
      storage: window.localStorage,
      state,
      id,
      dateSaved: new Date(app.runtime.clock.now()).toISOString(),
      keepAnnotations,
    });
    app.updateState((current) => ({ ...current, needsSave: false }));
    setArchiveStatus(status);
    setPrompt(null);
  }

  function saveSilently() {
    const index = loadArchiveIndex(window.localStorage);
    const existing = findLatestArchiveEntryForTournament(index, state.tournamentId);
    saveArchive(existing?.id ?? mintArchiveId(index), Boolean(existing));
  }

  function requestArchiveSave() {
    const index = loadArchiveIndex(window.localStorage);
    const title = state.title.trim() || 'Unnamed Tournament';
    const sameTournament = findLatestArchiveEntryForTournament(index, state.tournamentId);
    if (sameTournament) {
      setPrompt({ kind: 'save', sameTournament });
      return;
    }
    const titleCollision = index.find((entry) => entry.title === title);
    if (titleCollision) {
      setPrompt({ kind: 'save', titleCollision });
      return;
    }
    saveArchive(mintArchiveId(index), false);
  }

  function resetNow() {
    saveBracketFollow(window.localStorage, null);
    app.updateState(resetTournamentState(state));
    setPrompt(null);
  }
  return (
    <div id='panel-running'>
      <Panel className='pb-1.5'>
        <PanelTitle>Tournament running</PanelTitle>
        <Field htmlFor='running-title' label='Tournament name'>
          <Input
            id='running-title'
            type='text'
            value={state.title}
            placeholder='Unnamed Tournament'
            onChange={(event) =>
              app.updateState((current) => ({ ...current, title: event.target.value, needsSave: true }))
            }
          />
        </Field>
      </Panel>
      <TieBanners state={state} />
      {message ? <Alert tone='danger'>{message}</Alert> : null}
      {archiveStatus ? (
        <Alert tone='success' id='archive-save-status'>
          {archiveStatus}
        </Alert>
      ) : null}
      <LiveSyncCard />
      <StatStrip
        items={[
          { label: 'Round', value: phaseLabel(state) },
          { label: getGameFormat(state.gameFormat)?.unitLabelPlural, value: assignments.length },
          { label: 'Rooms', value: round.rooms.length },
          {
            label: 'Advancing',
            value: round.isNoElim
              ? 'All'
              : round.isFinal
                ? '—'
                : `${round.advTotal}${round.luckyCount ? ` + ${round.luckyCount} LL` : ''}`,
          },
        ]}
      />
      <Panel>
        <PanelTitle>Tournament progress</PanelTitle>
        <Timeline>
          {state.rounds.map((entry, index) => (
            <TimelineItem
              key={index}
              label={entry.isFinal ? 'Final' : entry.isSemis ? 'Semis' : `R${entry.roundNum}`}
              state={index < state.curRound ? 'done' : index === state.curRound ? 'current' : 'upcoming'}
            >
              {index < state.curRound ? '✓' : entry.isFinal ? '🏆' : entry.isSemis ? 'S' : entry.roundNum}
            </TimelineItem>
          ))}
        </Timeline>
      </Panel>
      <ReservePanel state={state} />
      <ManageRoster state={state} />
      <Standings state={state} />
      {state.curRound > 0 && assignments.length && !round.isQual && !round.isSwiss && !round.isGroupStage ? (
        <div className='mb-4.5 rounded-lg border border-surface-hover bg-surface-low px-4 py-3.5'>
          <div className='mb-2.5 text-[0.72rem] font-semibold tracking-[0.12em] text-warning uppercase'>
            Room Assignments — {phaseLabel(state)}
          </div>
          <div className='grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2'>
            {[...assignments]
              .sort((a, b) => (a.room ?? 0) - (b.room ?? 0))
              .map((entry) => (
                <div
                  className={cn(
                    'flex min-w-0 items-center justify-between gap-2 rounded-[5px] border border-surface-hover bg-surface px-3 py-2',
                    entry.room === null && 'border-accent',
                  )}
                  key={entry.name}
                >
                  <TournamentUnit state={state} name={entry.name} />
                  <span className='shrink-0 rounded-sm bg-primary-soft px-2.5 py-0.5 text-sm font-bold text-primary'>
                    {entry.room === null ? 'BYE' : `Room ${entry.room}`}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ) : null}
      {round.isFinal ? (
        <FinalsScores state={state} />
      ) : (
        <>
          {Array.from({ length: round.rooms.length }, (_, index) => (
            <RoomScores key={index} state={state} room={index + 1} />
          ))}
          {(state.byes[state.curRound] ?? []).map((name) => (
            <ByeCard key={name}>
              <strong>BYE</strong>
              <TournamentUnit state={state} name={name} />
              <span className='ml-auto text-xs text-muted'>Advances automatically — no room this round</span>
            </ByeCard>
          ))}
        </>
      )}
      <ButtonRow className='sticky bottom-2.5 z-20 rounded-lg border border-surface-hover bg-background/90 p-2.5 backdrop-blur-md'>
        {!last ? (
          <Button
            variant='success'
            disabled={pendingTies}
            title={pendingTies ? 'Resolve tie-breaks first' : undefined}
            onClick={() => {
              const result = advanceTournamentRound(state);
              if (result.status === 'advanced') {
                setMessage('');
                app.updateState(result.state);
              } else if (result.status === 'blocked') setMessage(result.message);
            }}
          >
            Next Round →
          </Button>
        ) : null}
        {state.curRound > 0 ? (
          <Button
            onClick={() => app.updateState((current) => ({ ...current, curRound: current.curRound - 1 }))}
          >
            ← Previous
          </Button>
        ) : null}
        <Button variant='accent' onClick={requestArchiveSave}>
          💾 Save to Archive
        </Button>
        <Button
          onClick={() => {
            if (state.needsSave) setPrompt({ kind: 'reset' });
            else if (window.confirm('Reset the full tournament? All scores will be lost.')) resetNow();
          }}
        >
          ↺ Reset
        </Button>
      </ButtonRow>
      {prompt?.kind === 'save' ? (
        <Modal
          titleId='archive-save-title'
          title={prompt.sameTournament ? 'Tournament already archived' : 'Title already used'}
        >
          <p>
            {prompt.sameTournament
              ? `A tournament named "${state.title.trim() || 'Unnamed Tournament'}" already exists. Overwrite, save as a new entry, or cancel?`
              : `A different archived tournament is also named "${state.title.trim() || 'Unnamed Tournament'}". Save this as a new entry, or cancel to rename it first?`}
          </p>
          <ModalActions>
            {prompt.sameTournament ? (
              <Button variant='danger' onClick={() => saveArchive(prompt.sameTournament!.id, true)}>
                Overwrite existing
              </Button>
            ) : null}
            <Button onClick={() => saveArchive(mintArchiveId(), false)}>Save as new entry</Button>
            <Button onClick={() => setPrompt(null)}>Cancel</Button>
          </ModalActions>
        </Modal>
      ) : null}
      {prompt?.kind === 'reset' ? (
        <Modal titleId='reset-title' title='Unsaved tournament'>
          <p>
            This tournament has changes that are not in the archive. Save a snapshot before resetting, discard
            the changes, or cancel?
          </p>
          <ModalActions>
            <Button
              variant='success'
              onClick={() => {
                saveSilently();
                resetNow();
              }}
            >
              Save &amp; reset
            </Button>
            <Button variant='danger' onClick={resetNow}>
              Reset without saving
            </Button>
            <Button onClick={() => setPrompt(null)}>Cancel</Button>
          </ModalActions>
        </Modal>
      ) : null}
    </div>
  );
}
