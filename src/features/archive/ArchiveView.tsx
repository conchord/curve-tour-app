import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { getGameFormat } from '../../domain/tournament/formats';
import {
  ARCHIVE_IMPORT_MAX_BYTES,
  archiveBundle,
  deleteArchive,
  loadArchiveEntry,
  loadArchiveIndex,
  parseArchiveImport,
  runArchiveImport,
  updateArchiveAnnotations,
  type ArchiveEntry,
  type ArchiveImportMode,
  type ArchiveSummary,
  type ParsedArchiveImport,
} from '../../lib/persistence/archive';
import { normalizeLiveTournamentState } from '../../lib/persistence/live-state';
import { archiveEntryStorageKey } from '../../lib/persistence/storage-keys';
import { downloadJson, sanitizeFilename } from '../../lib/browser-download';
import { ArchivedBracket } from '../bracket/BracketView';
import { RankingsContent } from '../rankings/RankingsView';
import { downloadRankingsImage } from '../rankings/rankings-image';
import { useTournamentApp } from '../tournament/TournamentProvider';
import {
  Alert,
  Button,
  ButtonRow,
  Modal,
  ModalActions,
  Panel,
  PanelTitle,
  StatStrip,
  Textarea,
} from '../../components/ui';

interface PendingImport {
  parsed: Extract<ParsedArchiveImport, { status: 'valid' }>;
  collisions: ArchiveSummary[];
}

function describeImport(
  counts: ReturnType<typeof runArchiveImport>,
  invalid: number,
  isBundle: boolean,
): string {
  const total = counts.added + counts.overwritten;
  if (!isBundle) {
    if (!total)
      return counts.failed
        ? "Couldn't import — your browser's storage is full."
        : "That file doesn't contain a usable tournament — nothing was imported.";
    const name = `Imported "${counts.lastTitle}"`;
    if (counts.overwritten) return `${name} — replaced the copy already in your archive.`;
    if (counts.mode === 'new') return `${name} as a second, separate archive entry.`;
    return `${name}.`;
  }
  const parts: string[] = [];
  if (counts.overwritten)
    parts.push(`${counts.overwritten} replaced existing ${counts.overwritten === 1 ? 'copy' : 'copies'}`);
  if (counts.skippedDup) parts.push(`${counts.skippedDup} skipped — already archived`);
  if (invalid) parts.push(`${invalid} skipped — invalid data`);
  if (!total) {
    if (counts.failed) return "Couldn't import — your browser's storage is full.";
    const reasons: string[] = [];
    if (counts.skippedDup) reasons.push(`${counts.skippedDup} were already archived`);
    if (invalid) reasons.push(`${invalid} contained no usable tournament data`);
    return reasons.length
      ? `Nothing was imported — of the ${counts.skippedDup + invalid} entries in that file, ${reasons.join(' and ')}.`
      : 'Nothing was imported — none of the entries in that file contained usable tournament data.';
  }
  let message = `Imported ${total} tournament${total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}.`;
  if (counts.failed)
    message += ` Ran out of browser storage — the remaining ${counts.failed} were not imported.`;
  return message;
}

export function ArchiveView() {
  const app = useTournamentApp();
  const input = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState<ArchiveSummary[]>([]);
  const [selected, setSelected] = useState<ArchiveEntry | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<PendingImport | null>(null);

  function reload() {
    setIndex(loadArchiveIndex(window.localStorage));
  }

  useEffect(reload, []);

  const sorted = useMemo(
    () => [...index].sort((a, b) => new Date(b.dateSaved).getTime() - new Date(a.dateSaved).getTime()),
    [index],
  );

  function mintId(current: ArchiveSummary[]) {
    let id = String(app.runtime.clock.now());
    while (
      current.some((entry) => String(entry.id) === id) ||
      window.localStorage.getItem(archiveEntryStorageKey(id)) !== null
    ) {
      id = String(Number(id) + 1);
    }
    return id;
  }

  function finishImport(parsed: PendingImport['parsed'], mode: ArchiveImportMode) {
    const counts = runArchiveImport({
      storage: window.localStorage,
      entries: parsed.entries,
      mode,
      now: new Date(app.runtime.clock.now()).toISOString(),
      mintId,
    });
    setPending(null);
    reload();
    setStatus(describeImport(counts, parsed.invalid, parsed.isBundle));
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > ARCHIVE_IMPORT_MAX_BYTES) {
      setStatus('That file is too large to be a tournament export — nothing was imported.');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setStatus("Couldn't read that file — it may be unreadable or no longer available.");
      return;
    }
    const parsed = parseArchiveImport(text);
    if (parsed.status === 'invalid-json') {
      setStatus("That file isn't valid JSON — it may be corrupted, or not a Curve tournament export.");
      return;
    }
    if (parsed.status === 'empty-bundle') {
      setStatus('That full-archive file contains no tournaments — nothing to import.');
      return;
    }
    if (parsed.status === 'invalid-shape') {
      setStatus(
        "That JSON file isn't a Curve tournament export — expected either a single archived tournament or a full-archive file.",
      );
      return;
    }
    const existing = new Map(index.map((entry) => [String(entry.id), entry]));
    const collisions = parsed.entries.flatMap((entry) => existing.get(String(entry.id)) ?? []);
    if (collisions.length) setPending({ parsed, collisions });
    else finishImport(parsed, 'overwrite');
  }

  if (selected) {
    const state = normalizeLiveTournamentState(selected.snapshot, app.runtime.ids);
    const format = getGameFormat(state.gameFormat);
    return (
      <div id='ar-detail-view'>
        <ButtonRow className='mt-0 mb-3.5'>
          <Button
            onClick={() => {
              setSelected(null);
              reload();
            }}
          >
            ← Back to Archive
          </Button>
          <Button
            onClick={() =>
              downloadJson(
                `curve-tournament_${sanitizeFilename(selected.title)}_${new Date(selected.dateSaved).toISOString().slice(0, 10)}.json`,
                selected,
              )
            }
          >
            ⬇ Export JSON
          </Button>
          <Button onClick={() => void downloadRankingsImage(state)}>⬇ Rankings PNG</Button>
          <Button
            variant='danger'
            onClick={() => {
              if (
                !window.confirm(
                  `Permanently delete "${selected.title}" from the archive? This cannot be undone.`,
                )
              )
                return;
              deleteArchive(window.localStorage, selected.id);
              setSelected(null);
              reload();
            }}
          >
            Delete
          </Button>
        </ButtonRow>
        <div id='ar-detail-summary'>
          <StatStrip
            items={[
              { label: 'Tournament', value: selected.title, valueClassName: 'text-primary' },
              { label: 'Saved', value: new Date(selected.dateSaved).toLocaleString() },
              { label: format?.unitLabelPlural ?? 'Players', value: state.players.length },
              { label: 'Rounds played', value: state.rounds[state.curRound]?.roundNum ?? '—' },
            ]}
          />
        </div>
        <Panel className='mt-4'>
          <PanelTitle>Organiser annotations</PanelTitle>
          <div id='ar-annotations-list'>
            {!selected.annotations.length ? (
              <div className='text-xs text-muted'>No annotations yet.</div>
            ) : (
              selected.annotations.map((annotation, annotationIndex) => (
                <div
                  className='mb-2 flex min-w-0 flex-col items-start gap-2 whitespace-pre-wrap rounded-[5px] border border-surface-hover bg-surface-low px-3 py-2'
                  key={`${annotation.timestamp}-${annotationIndex}`}
                >
                  <div className='flex w-full items-start justify-between gap-2.5 text-sm'>
                    <div>{annotation.text}</div>
                    <Button
                      size='sm'
                      title='Delete'
                      onClick={() => {
                        if (!window.confirm('Delete this annotation? This cannot be undone.')) return;
                        const annotations = selected.annotations.filter(
                          (_, indexToKeep) => indexToKeep !== annotationIndex,
                        );
                        const updated = updateArchiveAnnotations(
                          window.localStorage,
                          selected.id,
                          annotations,
                        );
                        if (updated) setSelected(updated);
                      }}
                    >
                      ✕
                    </Button>
                  </div>
                  <small className='text-[0.68rem] text-muted'>
                    {new Date(annotation.timestamp).toLocaleString()}
                  </small>
                </div>
              ))
            )}
          </div>
          <div className='flex items-start gap-2 max-[700px]:flex-col'>
            <Textarea
              className='min-h-19 flex-1 max-[700px]:w-full'
              id='ar-note-input'
              value={note}
              placeholder='Add a note about this tournament…'
              onChange={(event) => setNote(event.target.value)}
            />
            <Button
              onClick={() => {
                const text = note.trim();
                if (!text) return;
                const updated = updateArchiveAnnotations(window.localStorage, selected.id, [
                  ...selected.annotations,
                  { text, timestamp: new Date(app.runtime.clock.now()).toISOString() },
                ]);
                if (updated) setSelected(updated);
                setNote('');
              }}
            >
              Add annotation
            </Button>
          </div>
        </Panel>
        <Panel>
          <PanelTitle>Final rankings</PanelTitle>
          <RankingsContent state={state} downloads={false} />
        </Panel>
        <Panel>
          <PanelTitle>Tournament bracket</PanelTitle>
          <ArchivedBracket state={state} />
        </Panel>
      </div>
    );
  }

  return (
    <div id='ar-list-view'>
      <div className='mb-4.5 flex flex-wrap items-start justify-between gap-3.5'>
        <div>
          <h2 className='mb-1 text-2xl font-bold text-primary'>Tournament Archive</h2>
          <p className='text-muted'>Saved tournament snapshots are stored in this browser.</p>
        </div>
        <ButtonRow className='mt-0'>
          {index.length ? (
            <Button
              onClick={() => {
                const now = new Date(app.runtime.clock.now()).toISOString();
                downloadJson(
                  `curve-tournament-archive_${now.slice(0, 10)}.json`,
                  archiveBundle(window.localStorage, now),
                );
              }}
            >
              ⬇ Export full archive
            </Button>
          ) : null}
          <Button onClick={() => input.current?.click()}>⬆ Import JSON</Button>
          <input
            ref={input}
            className='sr-only'
            type='file'
            accept='application/json,.json'
            onChange={(event) => void importFile(event)}
          />
        </ButtonRow>
      </div>
      {status ? <Alert role='status'>{status}</Alert> : null}
      {!sorted.length ? (
        <Alert id='ar-empty'>
          No tournaments archived yet — completed tournaments saved from Admin will show up here, or import a
          previously exported file.
        </Alert>
      ) : (
        <div id='ar-list' className='grid gap-2'>
          {sorted.map((summary) => (
            <button
              className='flex w-full cursor-pointer flex-col items-start gap-1 rounded-lg border border-surface-hover bg-surface px-4 py-3 text-left text-foreground transition hover:border-primary hover:bg-primary-soft focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary'
              key={summary.id}
              onClick={() => {
                const entry = loadArchiveEntry(window.localStorage, summary.id);
                if (entry) setSelected(entry);
              }}
            >
              <span className='text-lg font-bold'>{summary.title}</span>
              <span className='text-xs text-muted'>
                {new Date(summary.dateSaved).toLocaleString()} · {summary.playerCount} players ·{' '}
                {summary.roundsPlayed} round{summary.roundsPlayed === 1 ? '' : 's'} played
              </span>
            </button>
          ))}
        </div>
      )}
      {pending ? (
        <Modal
          titleId='archive-import-title'
          title={pending.parsed.isBundle ? 'Some of these are already archived' : 'Already in your archive'}
        >
          <p>
            {pending.parsed.isBundle
              ? `${pending.collisions.length} of the ${pending.parsed.entries.length} tournaments in this file are already in your archive. How should those be handled? This choice applies to all ${pending.collisions.length}.`
              : `An archived tournament with this ID already exists ("${pending.collisions[0]?.title}"). Overwrite it, import it as a separate new entry, or cancel?`}
          </p>
          <ModalActions>
            <Button variant='danger' onClick={() => finishImport(pending.parsed, 'overwrite')}>
              Overwrite existing
            </Button>
            <Button onClick={() => finishImport(pending.parsed, 'new')}>
              {pending.parsed.isBundle ? 'Import all as new copies' : 'Import as new entry'}
            </Button>
            {pending.parsed.isBundle ? (
              <Button onClick={() => finishImport(pending.parsed, 'skip')}>Skip the duplicates</Button>
            ) : null}
            <Button onClick={() => setPending(null)}>Cancel</Button>
          </ModalActions>
        </Modal>
      ) : null}
    </div>
  );
}
