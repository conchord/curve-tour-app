import { useState } from 'react';
import type { ActiveTab } from '../../domain/tournament/types';
import { CfpLoginModal } from '../auth/CfpLoginModal';
import { formatAccountRole } from '../auth/auth.shared';
import { useAuth } from '../auth/AuthProvider';
import { BracketView } from '../bracket/BracketView';
import { SetupView } from '../admin/SetupView';
import { RunningAdmin } from '../admin/RunningAdmin';
import { RankingsView } from '../rankings/RankingsView';
import { ScoreboardView } from '../scoreboard/ScoreboardView';
import { ArchiveView } from '../archive/ArchiveView';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { Alert, Button, ButtonRow, Modal, Panel, PanelTitle, cn } from '../../components/ui';

const TABS: Array<{ key: ActiveTab; label: string }> = [
  { key: 'admin', label: '⚙ Admin' },
  { key: 'scoreboard', label: '📊 Scoreboard' },
  { key: 'bracket', label: '🗂 Bracket' },
  { key: 'rankings', label: '🏆 Rankings' },
  { key: 'archive', label: '🗄 Archive' },
];

export function AppShell() {
  const app = useTournamentApp();
  const auth = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const currentRound = app.state.rounds[app.state.curRound];

  function chooseTab(tab: ActiveTab) {
    if (tab === 'admin' && !app.unlocked) {
      setLoginOpen(true);
      return;
    }
    app.setActiveTab(tab);
  }

  return (
    <div className='min-h-screen bg-background text-foreground'>
      <header className='sticky top-0 z-50 flex h-14 items-center justify-between border-b border-surface-hover bg-background/95 px-6 backdrop-blur-md max-[700px]:px-3.5'>
        <div className='whitespace-nowrap text-lg font-bold tracking-[0.16em] text-primary uppercase max-[700px]:text-base max-[700px]:tracking-[0.12em]'>
          CFP <span className='text-foreground'>Tour Hub</span>
        </div>
        <div className='flex min-w-0 items-center gap-2.5'>
          <button
            className={cn(
              'max-w-55 cursor-pointer overflow-hidden rounded-[5px] px-2 py-1 text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground transition hover:bg-surface-low focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-[700px]:max-w-31',
              !app.state.title && 'font-normal text-muted italic',
            )}
            onClick={() => chooseTab('admin')}
            title={app.state.title}
          >
            {app.state.title || 'Unnamed Tournament — click to name'}
          </button>
          <div className='text-[0.68rem] tracking-[0.1em] text-muted uppercase'>Round</div>
          <div className='text-3xl leading-none font-bold text-primary drop-shadow-[0_0_9px_rgb(0_229_255_/_40%)]'>
            {currentRound?.roundNum ?? '—'}
          </div>
        </div>
      </header>
      <nav
        aria-label='Tournament sections'
        className='sticky top-14 z-40 flex flex-wrap gap-0.5 border-b border-surface-hover bg-background/95 px-6 pt-2.5 backdrop-blur-md max-[700px]:px-2.5 max-[700px]:pt-2'
      >
        {TABS.filter((tab) => !(app.isViewer && tab.key === 'archive')).map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'cursor-pointer border-b-2 border-transparent px-4 py-2 text-sm text-muted transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary max-[700px]:flex-auto max-[700px]:px-2',
              app.activeTab === tab.key && 'border-primary text-primary',
            )}
            aria-current={app.activeTab === tab.key ? 'page' : undefined}
            onClick={() => chooseTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {app.isViewer && app.syncStatus.kind === 'stale' ? (
        <Alert className='mx-auto mt-2.5 w-[min(1100px,calc(100%-24px))]' tone='danger'>
          ⚠ Live connection lost — what you&apos;re seeing may be out of date. Reload to try reconnecting.
        </Alert>
      ) : null}
      <main
        className='mx-auto max-w-7xl px-6 py-5 max-[700px]:px-3 max-[700px]:py-3.5'
        data-hydrated={app.hydrated ? 'true' : 'false'}
      >
        {app.activeTab === 'admin' ? (
          <section id='view-admin'>
            <Panel>
              <PanelTitle>Admin Access</PanelTitle>
              <Alert tone='success'>
                Signed in as <strong>{auth.username}</strong>
                {auth.roles.length ? ` · ${auth.roles.map(formatAccountRole).join(', ')}` : ''}
              </Alert>
              <ButtonRow>
                <Button size='sm' variant='warning' onClick={app.lockAdmin}>
                  Sign out
                </Button>
              </ButtonRow>
            </Panel>
            {app.state.started ? <RunningAdmin /> : <SetupView />}
          </section>
        ) : null}
        {app.activeTab === 'scoreboard' ? (
          <section id='view-scoreboard'>
            <ScoreboardView />
          </section>
        ) : null}
        <section id='view-bracket' hidden={app.activeTab !== 'bracket'}>
          <BracketView />
        </section>
        {app.activeTab === 'rankings' ? (
          <section id='view-rankings'>
            <RankingsView />
          </section>
        ) : null}
        {app.activeTab === 'archive' ? (
          <section id='view-archive'>
            <ArchiveView />
          </section>
        ) : null}
      </main>
      {app.isViewer && ['connecting', 'waiting', 'unavailable'].includes(app.syncStatus.kind) ? (
        <div role='status'>
          <Modal
            className='text-center'
            title={
              app.syncStatus.kind === 'waiting'
                ? 'Waiting for the tournament to start…'
                : app.syncStatus.kind === 'unavailable'
                  ? 'Live sync unavailable'
                  : 'Connecting…'
            }
          >
            <p>
              {app.syncStatus.kind === 'waiting'
                ? 'This link is valid, but the organiser hasn’t generated a schedule yet. This page updates automatically once they do.'
                : app.syncStatus.kind === 'unavailable'
                  ? 'The live-sync library couldn’t load — check your connection and reload the page.'
                  : 'Loading the live tournament.'}
            </p>
          </Modal>
        </div>
      ) : null}
      <CfpLoginModal
        open={loginOpen}
        onCancel={() => setLoginOpen(false)}
        onSignedIn={() => {
          app.unlockAdmin();
          setLoginOpen(false);
        }}
      />
    </div>
  );
}
