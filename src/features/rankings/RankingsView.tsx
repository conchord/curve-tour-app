import { computeRankings, type RankingDisplay } from '../../domain/tournament/rankings';
import { rosterKeys, unitDisplay } from '../../domain/tournament/roster';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { downloadRankingsImage } from './rankings-image';
import { Position } from '../../components/tournament/TournamentUnit';
import { Alert, Badge, Button, ButtonRow, cn } from '../../components/ui';

function Unit({ entry }: { entry: RankingDisplay }) {
  return (
    <span>
      <strong>{entry.label}</strong>
      {entry.members?.length ? (
        <small className='mt-0.5 block font-normal text-muted'>{entry.members.join(' & ')}</small>
      ) : null}
    </span>
  );
}

function RankingGrid({ children }: { children: React.ReactNode }) {
  return <div className='columns-1 gap-3.5 sm:columns-2 xl:columns-3'>{children}</div>;
}

function RankingRow({ children, champion = false }: { children: React.ReactNode; champion?: boolean }) {
  return (
    <div
      className={cn(
        'mb-2 grid min-h-13 break-inside-avoid grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-surface-hover bg-surface px-2.5 py-2',
        champion && 'border-success/40 bg-success-soft',
      )}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className='mt-4.5 mb-2 text-[0.72rem] font-semibold tracking-[0.1em] text-muted uppercase'>
      {children}
    </div>
  );
}

function RoundLabel({ round }: { round: TournamentRound }) {
  return (
    <>
      {round.isFinal
        ? '🏆 Final'
        : round.isSemis
          ? '⚔ Semis'
          : round.isQual
            ? `Qual R${round.roundNum}`
            : round.isSwiss
              ? `Swiss R${round.roundNum}`
              : round.isGroupStage
                ? `Group R${round.roundNum}`
                : `Round ${round.roundNum}`}
    </>
  );
}

function RosterOnly({ state }: { state: TournamentState }) {
  const rows = [
    ...rosterKeys(state.players).map((name) => ({ name, badge: 'Registered' })),
    ...rosterKeys(state.reserves).map((name) => ({ name, badge: 'Reserve' })),
  ].sort((a, b) => unitDisplay(state, a.name).label.localeCompare(unitDisplay(state, b.name).label));
  return (
    <RankingGrid>
      {rows.map(({ name, badge }) => {
        const info = unitDisplay(state, name);
        return (
          <RankingRow key={`${badge}-${name}`}>
            <span className='text-center text-lg font-bold text-muted'>—</span>
            <span className='min-w-0'>
              <Unit entry={{ name, ...info }} />
            </span>
            <Badge>{badge}</Badge>
          </RankingRow>
        );
      })}
    </RankingGrid>
  );
}

export function RankingsContent({
  state,
  downloads = true,
}: {
  state: TournamentState;
  downloads?: boolean;
}) {
  if (!state.players.length && !state.reserves.length) {
    return <Alert>No players registered yet — check back once the organiser loads a roster in Admin.</Alert>;
  }
  const data = computeRankings(state);
  if (!data) return <RosterOnly state={state} />;
  return (
    <div id='rk-content'>
      <p className='text-muted'>
        Live tournament ranking. Active entrants remain unranked until eliminated or the Final is complete.
      </p>
      {downloads ? (
        <ButtonRow>
          <Button size='sm' onClick={() => void downloadRankingsImage(state)}>
            ⬇ Download rankings PNG
          </Button>
        </ButtonRow>
      ) : null}
      {data.stillActive.length ? (
        <>
          <SectionTitle>Still in tournament</SectionTitle>
          <RankingGrid>
            {data.stillActive.map((unit) => (
              <RankingRow key={unit.name}>
                <span className='text-center text-lg font-bold text-muted'>—</span>
                <span className='min-w-0'>
                  <Unit entry={unit} />
                  <small className='mt-1 block text-xs text-muted'>
                    <RoundLabel round={data.lastRound} /> —{' '}
                    {unit.room === null ? (
                      <strong className='text-warning'>BYE — advances automatically</strong>
                    ) : (
                      <>
                        Room <strong className='text-primary'>{unit.room}</strong>
                      </>
                    )}
                  </small>
                </span>
                <span className='flex flex-col items-end gap-1 text-[0.68rem] text-warning'>
                  <Badge>Still in tournament</Badge>
                  {unit.poolRank ? (
                    <small>
                      #{unit.poolRank.rank}
                      {unit.poolRank.fp !== null ? ` · ${unit.poolRank.fp.toFixed(3)} FP` : ''}
                    </small>
                  ) : null}
                </span>
              </RankingRow>
            ))}
          </RankingGrid>
        </>
      ) : null}
      {data.finalComplete || data.eliminatedList.length ? (
        <>
          <SectionTitle>Final standings</SectionTitle>
          <RankingGrid>
            {data.finalists.map((unit) => (
              <RankingRow champion={unit.rank === 1} key={unit.name}>
                <Position highlighted={unit.rank === 1}>{unit.rank}</Position>
                <span className='min-w-0'>
                  <Unit entry={unit} />
                </span>
                <Badge tone='primary'>🏆 Reached Final</Badge>
              </RankingRow>
            ))}
            {data.eliminatedList.map((unit) => (
              <RankingRow key={unit.name}>
                <Position>{unit.rank}</Position>
                <span className='min-w-0'>
                  <Unit entry={unit} />
                </span>
                <Badge>
                  <RoundLabel round={unit.round} />
                </Badge>
              </RankingRow>
            ))}
          </RankingGrid>
        </>
      ) : null}
    </div>
  );
}

export function RankingsView() {
  const { state } = useTournamentApp();
  return <RankingsContent state={state} />;
}
