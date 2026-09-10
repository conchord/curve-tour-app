import { useState } from 'react';
import { computeQualificationStandings } from '../../domain/tournament/advancement';
import type { TournamentState } from '../../domain/tournament/types';
import { Button, ButtonRow, Field, Input, Panel, PanelTitle } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { TournamentStandings } from '../tournament/components/TournamentStandings';

export function phaseLabel(state: TournamentState) {
  const round = state.rounds[state.curRound];
  if (!round) return '—';
  if (round.isFinal) return round.bracket === 'grand-final' ? '🏆 Grand Final' : '🏆 Final';
  if (round.isSemis) return '⚔ Semi-Finals';
  if (round.isQual) return `Round ${round.roundNum} (Qual)`;
  if (round.isSwiss) return `Round ${round.roundNum} (Swiss)`;
  if (round.isGroupStage) return `Round ${round.roundNum} (Group)`;
  if (round.isNoElim) return `Round ${round.roundNum} (No elim)`;
  return `Round ${round.roundNum}`;
}

export function Standings({ state }: { state: TournamentState }) {
  const hasStandings = state.rounds
    .slice(0, state.curRound + 1)
    .some((round) => round.isQual || round.isSwiss);
  const hasGroups = state.rounds.slice(0, state.curRound + 1).some((round) => round.isGroupStage);
  if (!hasStandings && !hasGroups) return null;
  const tables = hasGroups
    ? state.groups.map((group) => [group.label, state.groupStandings[group.label] ?? []] as const)
    : [
        [
          state.cfg.poolingPhase === 'swiss' ? 'Swiss Standings' : 'Qualification Table',
          computeQualificationStandings(state),
        ] as const,
      ];
  return <TournamentStandings state={state} tables={tables} />;
}

export function LiveSyncCard() {
  const app = useTournamentApp();
  const [copied, setCopied] = useState(false);
  if (!app.state.tournamentId) return null;
  const url = `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(app.state.tournamentId)}`;
  const status =
    app.syncStatus.kind === 'unavailable' ? (
      <span className='text-danger'>
        ⚪ Live sync unavailable (couldn&apos;t reach the sync service) — viewers need to refresh manually,
        same as before.
      </span>
    ) : app.syncStatus.kind === 'error' ? (
      <span className='text-danger'>
        🔴 Sync error — viewers may be seeing stale data ({app.syncStatus.message})
      </span>
    ) : app.syncStatus.kind === 'active' ? (
      <span className='text-success'>🟢 Live sync active</span>
    ) : (
      <span className='text-muted'>🔄 Connecting…</span>
    );
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }
  return (
    <Panel id='sync-status-panel'>
      <PanelTitle>Live Sync — viewer link</PanelTitle>
      <Field className='mb-2' label='Viewer link'>
        <Input type='text' readOnly value={url} onClick={(event) => event.currentTarget.select()} />
      </Field>
      <ButtonRow className='items-center gap-2.5'>
        <Button onClick={() => void copy()}>📋 Copy Live Link</Button>
        {copied ? <span className='text-xs text-success'>Copied!</span> : null}
      </ButtonRow>
      <div className='mt-2 text-xs'>{status}</div>
    </Panel>
  );
}
