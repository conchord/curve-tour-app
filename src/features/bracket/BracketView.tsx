import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  computeLuckyLoserStandings,
  detectTieBreaks,
  getAllTies,
  isTieResolved,
} from '../../domain/tournament/advancement';
import {
  bracketFollowStatus,
  bracketRoundDefaultCollapsed,
  bracketRoundLabels,
  projectedSlotLabelText,
  projectFutureRoundSlots,
  type BracketFollowStatus,
  type ProjectedSlotLabel,
} from '../../domain/tournament/bracket';
import { finalsProgressState } from '../../domain/tournament/finals';
import { getGameFormat } from '../../domain/tournament/formats';
import { setFinalScore, setRoundScore } from '../../domain/tournament/mutations';
import { buildTeamMap, resolveUnitQuery, unitDisplay } from '../../domain/tournament/roster';
import { getDefenderIndex, getUnitScore, orderRoomByScore } from '../../domain/tournament/scoring';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { readBracketFollow, saveBracketFollow } from '../../lib/persistence/storage';
import { Alert, Badge, Button, Input, ScoreInput, cn } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

const compactScoreClass = 'w-13 shrink-0 rounded-sm px-1.5 py-0.5 text-xs';
const bracketRowBase = 'rounded-sm border-l-[3px] border-l-transparent px-2 py-1 text-xs';

function FollowBanner({
  state,
  followKey,
  follow,
  clear,
}: {
  state: TournamentState;
  followKey: string | null;
  follow: BracketFollowStatus | null;
  clear(): void;
}) {
  if (!followKey) return null;
  const label = unitDisplay(state, followKey).label;
  const out = !follow || follow.eliminated;
  const roundName = follow
    ? (bracketRoundLabels(state)[follow.lastRi]?.label ?? `Round ${follow.lastRi + 1}`)
    : '';
  const where = !follow
    ? 'not in this bracket'
    : follow.eliminated
      ? `out in ${roundName}`
      : follow.isBye
        ? `${roundName} · BYE, advances automatically`
        : `${roundName} · Room ${follow.room}`;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-surface-hover bg-primary-soft py-1 pr-1.5 pl-3 text-xs',
        out && 'bg-danger/10',
      )}
    >
      <strong className={out ? 'text-muted' : 'text-primary'}>Following {label}</strong> — {where}
      <Button
        aria-label='Stop following'
        className='size-6 min-h-0 rounded-full p-0'
        onClick={clear}
        size='sm'
        title='Stop following'
        variant='ghost'
      >
        ✕
      </Button>
    </div>
  );
}

function TeamMembers({
  state,
  name,
  roundIndex,
}: {
  state: TournamentState;
  name: string;
  roundIndex: number;
}) {
  const info = unitDisplay(state, name);
  const team = buildTeamMap(state)[name];
  if (!info.members?.length) return null;
  return (
    <span className='mt-0.5 block text-[0.68rem] text-muted [overflow-wrap:anywhere]'>
      {info.members
        .map((member, index) => {
          const rawIndex = team?.members.findIndex((entry) => entry?.name === member) ?? index;
          const defender =
            state.gamemodeConfig.teamScoringRule === 'designated-player' &&
            getDefenderIndex(state, name, roundIndex) === rawIndex;
          return `${member}${defender ? ' 🛡' : ''}`;
        })
        .join(', ')}
    </span>
  );
}

function BracketScoreInput({
  state,
  scoreKey,
  roundIndex,
  room,
}: {
  state: TournamentState;
  scoreKey: string;
  roundIndex: number;
  room: number;
}) {
  const app = useTournamentApp();
  return (
    <ScoreInput
      className={cn(compactScoreClass, 'ml-auto')}
      min='0'
      value={state.scores[scoreKey] ?? ''}
      data-key={scoreKey}
      onChange={(event) =>
        app.updateState((current) => setRoundScore(current, scoreKey, event.target.value, roundIndex, room))
      }
    />
  );
}

function TeamScoreFields({ children }: { children: ReactNode }) {
  return (
    <div className='mt-1 flex flex-wrap gap-1.5 [&>label]:flex [&>label]:items-center [&>label]:gap-1 [&>label]:text-[0.68rem] [&>label]:text-muted'>
      {children}
    </div>
  );
}

function resultClasses(result: 'advance' | 'eliminate' | 'lucky' | 'pending' | '', followed: boolean) {
  return cn(
    result === 'advance' && 'border-l-success text-success',
    result === 'eliminate' && 'border-l-surface-hover text-muted line-through opacity-50',
    result === 'lucky' && 'border-l-accent text-accent',
    result === 'pending' && 'border-l-danger text-danger no-underline opacity-85',
    followed && 'bg-primary-soft shadow-[inset_0_0_0_1px_rgb(0_229_255_/_27%)]',
  );
}

function FinalColumn({
  state,
  roundIndex,
  editable,
  followed,
}: {
  state: TournamentState;
  roundIndex: number;
  editable: boolean;
  followed: string | null;
}) {
  const app = useTournamentApp();
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  const progress = finalsProgressState(state, roundIndex, round);
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const teamMap = buildTeamMap(state);
  const names = progress.complete
    ? progress.order.filter((name): name is string => Boolean(name))
    : assignments.map((entry) => entry.name);
  return (
    <>
      {progress.race ? (
        <div className='mb-2 text-xs leading-relaxed text-muted'>
          <span className='text-primary'>{unitDisplay(state, progress.race.wbName).label}</span>{' '}
          <b>{progress.race.wbWins}</b>/{progress.race.wbTarget} <span className='opacity-50'>·</span>{' '}
          <span className='text-warning'>{unitDisplay(state, progress.race.lbName).label}</span>{' '}
          <b>{progress.race.lbWins}</b>/{progress.race.lbTarget}{' '}
          {progress.race.decided ? (
            <span className='font-semibold text-success'>
              🏆 {unitDisplay(state, progress.race.winnerName as string).label} wins
            </span>
          ) : null}
        </div>
      ) : null}
      {editable && progress.nextGame !== null ? (
        <div className='mb-1 text-[0.68rem] font-semibold tracking-[0.05em] text-primary uppercase'>
          Game {progress.nextGame} — enter scores
        </div>
      ) : null}
      {names.map((name, index) => {
        const unit = progress.units.find((entry) => entry.name === name);
        if (!unit) return null;
        const winner = progress.complete && index === 0;
        const nextGame = progress.nextGame;
        const team = teamMap[name];
        return (
          <div
            className={cn(
              bracketRowBase,
              progress.complete && 'border-l-success text-success',
              followed === name && 'bg-primary-soft shadow-[inset_0_0_0_1px_rgb(0_229_255_/_27%)]',
            )}
            key={name}
          >
            <div className='flex items-center gap-1.5'>
              <span className='min-w-0 flex-1'>
                {winner ? '🏆 ' : ''}
                {unitDisplay(state, name).label}
              </span>
              <span
                className={cn('text-xs font-bold text-muted', winner && 'text-primary')}
                title={progress.isGrandFinal ? 'Games won' : 'Cumulative Final score'}
              >
                {progress.isGrandFinal ? unit.wins : unit.total}
              </span>
            </div>
            {teamSize ? <TeamMembers state={state} name={name} roundIndex={roundIndex} /> : null}
            <div className='mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.68rem] text-muted'>
              {unit.perGame.map((score, game) => (
                <span className={score === null ? 'opacity-50' : ''} key={game}>
                  G{game + 1} {score === null ? '—' : <b className='text-xs text-foreground'>{score}</b>}
                </span>
              ))}
            </div>
            {editable && nextGame !== null ? (
              <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                <span className='text-[0.68rem] text-muted'>G{nextGame}</span>
                {teamSize ? (
                  <TeamScoreFields>
                    {Array.from({ length: teamSize }, (_, memberIndex) => {
                      const member = team?.members?.[memberIndex];
                      if (!member)
                        return (
                          <ScoreInput
                            key={memberIndex}
                            className={compactScoreClass}
                            disabled
                            placeholder='—'
                          />
                        );
                      const key = `game${nextGame}-${name}-m${memberIndex}`;
                      return (
                        <label key={key}>
                          <span>{member.name}</span>
                          <ScoreInput
                            className={compactScoreClass}
                            min='0'
                            value={state.finalScores[key] ?? ''}
                            onChange={(event) =>
                              app.updateState((current) => setFinalScore(current, key, event.target.value))
                            }
                          />
                        </label>
                      );
                    })}
                  </TeamScoreFields>
                ) : (
                  (() => {
                    const key = `game${nextGame}-${name}`;
                    return (
                      <ScoreInput
                        className={compactScoreClass}
                        min='0'
                        value={state.finalScores[key] ?? ''}
                        onChange={(event) =>
                          app.updateState((current) => setFinalScore(current, key, event.target.value))
                        }
                      />
                    );
                  })()
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {editable && progress.nextGame !== null && progress.nextGame > 1 ? (
        <div className='text-[0.68rem] text-muted'>Earlier games are edited in Admin</div>
      ) : null}
    </>
  );
}

function LuckyLoserDisclaimer({ round }: { round: TournamentRound }) {
  const direct = round.advPerRoom ?? 0;
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem] text-muted'>
      <span className='font-semibold text-accent'>★ Lucky loser{round.luckyCount === 1 ? '' : 's'}: </span>
      Top {direct} advance{direct === 1 ? 's' : ''} directly from each room. {round.luckyCount} extra spot
      {round.luckyCount === 1 ? '' : 's'} go{round.luckyCount === 1 ? 'es' : ''} to whoever's next-best
      finisher scores highest as a share of their own room's total — compared across every room.
    </div>
  );
}

function LuckyLoserStandingsPanel({ state, roundIndex }: { state: TournamentState; roundIndex: number }) {
  const standings = computeLuckyLoserStandings(state, roundIndex);
  if (!standings?.length) return null;
  return (
    <div className='mb-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.68rem]'>
      <div className='mb-1 font-semibold tracking-[0.05em] text-accent uppercase'>Lucky loser race</div>
      {standings.map((entry) => (
        <div
          className={cn(
            'flex items-center justify-between gap-2 py-px',
            entry.leading ? 'font-semibold text-accent' : 'text-muted',
          )}
          key={entry.name}
        >
          <span className='min-w-0 flex-1 truncate'>
            {entry.leading ? '★ ' : ''}Room {entry.room} · {unitDisplay(state, entry.name).label}
          </span>
          <span>{(entry.pct * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function PlaceholderRound({
  round,
  state,
  projected,
}: {
  round: TournamentRound;
  state: TournamentState;
  projected: ProjectedSlotLabel[][] | null;
}) {
  if (!round.rooms.length) return <div className='text-muted'>Not yet seeded</div>;
  if (round.isGroupStage) {
    return (
      <>
        {(round.matches ?? []).map((match, roomIndex) => (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Group {match.group} · Room {roomIndex + 1} ({round.rooms[roomIndex]})
            </RoomLabel>
            {match.pair.map((name) => (
              <div
                className={cn(bracketRowBase, 'border-l-surface-hover border-l-dashed text-muted opacity-65')}
                key={name}
              >
                {unitDisplay(state, name).label}
              </div>
            ))}
          </div>
        ))}
        {(round.groupByes ?? []).map((name) => (
          <div
            className='mb-2.5 rounded-lg border border-dashed border-warning bg-surface-low px-2.5 py-2 text-xs text-warning'
            key={name}
          >
            <span className='mr-1.5 font-bold tracking-[0.05em]'>BYE</span>
            {unitDisplay(state, name).label}
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {round.rooms.map((slots, roomIndex) => {
        const roomLabels = projected?.[roomIndex] ?? null;
        return (
          <div className='mb-2' key={roomIndex}>
            <RoomLabel>
              Room {roomIndex + 1} ({slots})
            </RoomLabel>
            {Array.from({ length: slots }, (_, slot) => (
              <div
                className={cn(bracketRowBase, 'border-l-surface-hover border-l-dashed text-muted opacity-65')}
                key={slot}
              >
                {roomLabels?.[slot] ? projectedSlotLabelText(roomLabels[slot]) : '—'}
              </div>
            ))}
          </div>
        );
      })}
      {round.luckyCount > 0 && !round.isNoElim ? <LuckyLoserDisclaimer round={round} /> : null}
      {round.pairingTBD ? (
        <div className='mt-1.5 text-[0.68rem] text-warning'>Pairings determined live</div>
      ) : null}
    </>
  );
}

function RoomLabel({ children }: { children: ReactNode }) {
  return (
    <div className='mb-1 pl-0.5 text-[0.68rem] font-bold tracking-[0.05em] text-muted uppercase'>
      {children}
    </div>
  );
}

function RoundBody({
  state,
  roundIndex,
  editable,
  followKey,
  projected,
}: {
  state: TournamentState;
  roundIndex: number;
  editable: boolean;
  followKey: string | null;
  projected: ProjectedSlotLabel[][] | null;
}) {
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  if (!assignments.length) return <PlaceholderRound round={round} state={state} projected={projected} />;
  if (round.isFinal)
    return (
      <FinalColumn
        state={state}
        roundIndex={roundIndex}
        editable={editable && roundIndex === state.curRound}
        followed={followKey}
      />
    );
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const teamMap = buildTeamMap(state);
  const rowsEditable = editable && roundIndex === state.curRound && (round.numGames ?? 1) <= 1;
  const luckyNames = state.luckyLosers[round.winnersTo ?? roundIndex + 1] ?? [];
  const roomTies = detectTieBreaks(roundIndex, round, state);
  const resolvedTieNames = new Set(
    Object.entries(roomTies)
      .filter(([key]) => tieResolutionListSafe(state, key).length > 0)
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
  const pendingTieNames = new Set(
    Object.entries(getAllTies(state, roundIndex))
      .filter(([key, tie]) => !isTieResolved(key, tie, state))
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
  return (
    <>
      {round.rooms.map((_, roomIndex) => {
        const room = roomIndex + 1;
        const units = assignments.filter((entry) => entry.room === room);
        const direct = round.isNoElim ? units.length : (round.advPerRoom ?? 0);
        const scored = units.map((entry, position) => ({
          name: entry.name,
          position,
          score: getUnitScore(state, roundIndex, room, position, null),
        }));
        const complete = scored.length > 0 && scored.every((entry) => entry.score !== null);
        const showResults = roundIndex <= state.curRound && complete;
        const display = showResults
          ? orderRoomByScore(
              scored as Array<{ name: string; position: number; score: number }>,
              roundIndex,
              room,
              state,
            )
          : scored;
        return (
          <div className='mb-2' key={room}>
            <RoomLabel>
              {round.isGroupStage ? `Group ${round.roomGroups?.[roomIndex]} · ` : ''}Room {room} (
              {units.length})
            </RoomLabel>
            {display.map((entry, index) => {
              const advances = round.isNoElim || index < direct;
              const lucky = luckyNames.includes(entry.name);
              const pending = showResults && pendingTieNames.has(entry.name);
              const result = pending
                ? 'pending'
                : showResults
                  ? lucky
                    ? 'lucky'
                    : advances
                      ? 'advance'
                      : 'eliminate'
                  : '';
              const followed = followKey === entry.name;
              const badges = (
                <>
                  {showResults && lucky ? '★ ' : ''}
                  {showResults && resolvedTieNames.has(entry.name) ? (
                    <Badge className='ml-0.5 px-1.5 py-px text-[0.6rem]' tone='warning'>
                      ⚖ TB
                    </Badge>
                  ) : null}
                  {pending ? (
                    <Badge className='ml-0.5 px-1.5 py-px text-[0.6rem]' tone='danger'>
                      ⚠ TB?
                    </Badge>
                  ) : null}
                </>
              );
              if (teamSize) {
                const team = teamMap[entry.name];
                return (
                  <div className={cn(bracketRowBase, resultClasses(result, followed))} key={entry.name}>
                    <div className='flex items-center gap-1.5'>
                      <span className='min-w-0 flex-1'>
                        {badges}
                        <span>{unitDisplay(state, entry.name).label}</span>
                        <TeamMembers state={state} name={entry.name} roundIndex={roundIndex} />
                      </span>
                      {showResults ? (
                        <span className='ml-auto text-xs font-bold text-muted'>{entry.score}</span>
                      ) : null}
                    </div>
                    {rowsEditable ? (
                      <TeamScoreFields>
                        {Array.from({ length: teamSize }, (_, memberIndex) => {
                          const member = team?.members?.[memberIndex];
                          if (!member)
                            return (
                              <ScoreInput
                                key={memberIndex}
                                className={compactScoreClass}
                                disabled
                                placeholder='—'
                              />
                            );
                          const key = `r${roundIndex}-rm${room}-p${entry.position}-m${memberIndex}`;
                          return (
                            <label key={key}>
                              <span>{member.name}</span>
                              <BracketScoreInput
                                state={state}
                                scoreKey={key}
                                roundIndex={roundIndex}
                                room={room}
                              />
                            </label>
                          );
                        })}
                      </TeamScoreFields>
                    ) : null}
                  </div>
                );
              }
              const key = `r${roundIndex}-rm${room}-p${entry.position}`;
              return (
                <div
                  className={cn(bracketRowBase, 'flex items-center gap-1.5', resultClasses(result, followed))}
                  key={entry.name}
                >
                  <span>
                    {badges}
                    {entry.name}
                  </span>
                  {rowsEditable ? (
                    <BracketScoreInput state={state} scoreKey={key} roundIndex={roundIndex} room={room} />
                  ) : showResults ? (
                    <span className='ml-auto text-xs font-bold text-muted'>{entry.score}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      {round.luckyCount > 0 && !round.isNoElim ? <LuckyLoserDisclaimer round={round} /> : null}
      {round.luckyCount > 0 && !round.isNoElim && roundIndex === state.curRound ? (
        <LuckyLoserStandingsPanel state={state} roundIndex={roundIndex} />
      ) : null}
      {(state.byes[roundIndex] ?? []).map((name) => (
        <div
          className={cn(
            'mb-2.5 rounded-lg border border-dashed border-warning bg-surface-low px-2.5 py-2 text-xs text-warning',
            followKey === name && 'border-solid shadow-[0_0_0_1px_rgb(0_229_255_/_27%)]',
          )}
          key={name}
        >
          <span className='mr-1.5 font-bold tracking-[0.05em]'>BYE</span>
          {unitDisplay(state, name).label}
        </div>
      ))}
    </>
  );
}

function tieResolutionListSafe(state: TournamentState, key: string): string[] {
  const value = state.tieResolutions[key];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function RoundColumn({
  accent,
  children,
  collapsed = false,
  current = false,
  followed = false,
  label,
  onToggle,
  roundIndex,
}: {
  accent?: string;
  children: ReactNode;
  collapsed?: boolean;
  current?: boolean;
  followed?: boolean;
  label: ReactNode;
  onToggle?: () => void;
  roundIndex: number;
}) {
  const accentClass =
    accent === 'wb'
      ? 'border-t-2 border-t-success'
      : accent === 'lb'
        ? 'border-t-2 border-t-warning'
        : accent === 'gf'
          ? 'border-t-2 border-t-accent'
          : '';
  const headerClass = cn(
    'flex w-full items-center gap-1 border-b border-surface-hover bg-surface-low px-3 py-2.5 text-left text-xs font-bold tracking-[0.08em] text-muted uppercase',
    onToggle && 'cursor-pointer',
    (current || followed) && 'text-primary',
    accentClass,
    collapsed && 'h-45 border-b-0 py-2 pr-0 pl-0.5 whitespace-nowrap [writing-mode:vertical-rl]',
  );
  return (
    <div
      className={cn(
        'w-52.5 min-w-52.5 shrink-0 overflow-hidden rounded-lg border border-surface-hover bg-surface',
        collapsed && 'w-8.5 min-w-8.5',
        current && 'border-primary shadow-[0_0_0_1px_var(--app-primary-soft)]',
      )}
      data-ri={roundIndex}
    >
      {onToggle ? (
        <button className={headerClass} onClick={onToggle}>
          <span
            className={cn(
              'shrink-0 rotate-90 text-[0.68rem]',
              collapsed && 'rotate-180 [writing-mode:horizontal-tb]',
            )}
          >
            ▸
          </span>
          {label}
        </button>
      ) : (
        <div className={headerClass}>{label}</div>
      )}
      {!collapsed ? <div className='p-2.5'>{children}</div> : null}
    </div>
  );
}

export function BracketView() {
  const app = useTournamentApp();
  const [collapse, setCollapse] = useState<Record<number, boolean>>({});
  const [query, setQuery] = useState('');
  const [followKey, setFollowKey] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!app.hydrated) return;
    const stored = readBracketFollow(window.localStorage);
    setFollowKey(stored);
    if (stored) setQuery(unitDisplay(app.state, stored).label);
  }, [app.hydrated]);
  useEffect(() => setCollapse({}), [app.state.tournamentId]);
  const follow = useMemo(() => bracketFollowStatus(app.state, followKey), [app.state, followKey]);
  const labels = bracketRoundLabels(app.state);
  const projectedSlots = useMemo(() => projectFutureRoundSlots(app.state), [app.state]);
  if (!app.state.rounds.length)
    return <Alert>Start a tournament in Admin to see the bracket overview.</Alert>;
  const editable = app.unlocked && !app.isViewer && app.state.started;
  function chooseFollow(value: string) {
    setQuery(value);
    const resolved = resolveUnitQuery(app.state, value);
    setFollowKey(resolved);
    saveBracketFollow(window.localStorage, resolved);
    if (resolved)
      queueMicrotask(() => {
        const status = bracketFollowStatus(app.state, resolved);
        const column = status
          ? scroll.current?.querySelector<HTMLElement>(`[data-ri="${status.lastRi}"]`)
          : null;
        if (column && scroll.current)
          scroll.current.scrollTo({
            left: Math.max(0, column.offsetLeft - (scroll.current.clientWidth - column.offsetWidth) / 2),
            behavior: 'smooth',
          });
      });
  }
  return (
    <div id='br-content'>
      <div className='mb-2.5 flex flex-wrap items-center gap-2.5'>
        <Input
          className='max-w-65'
          id='br-follow-input'
          placeholder='Follow a player or team…'
          type='text'
          value={query}
          onChange={(event) => chooseFollow(event.target.value)}
        />
        <FollowBanner
          state={app.state}
          followKey={followKey}
          follow={follow}
          clear={() => {
            setQuery('');
            setFollowKey(null);
            saveBracketFollow(window.localStorage, null);
          }}
        />
      </div>
      <div className='mb-2.5 flex flex-wrap items-center gap-2.5'>
        <Badge tone='success'>Advanced</Badge>
        <Badge tone='accent'>Lucky loser</Badge>
        <Badge tone='danger'>Eliminated</Badge>
      </div>
      <div className='flex max-w-full gap-3.5 overflow-x-auto pb-3' id='br-rounds' ref={scroll}>
        {app.state.rounds.map((round, roundIndex) => {
          const collapsed =
            collapse[roundIndex] ?? bracketRoundDefaultCollapsed(roundIndex, app.state.curRound);
          return (
            <RoundColumn
              accent={labels[roundIndex]?.accent}
              collapsed={collapsed}
              current={roundIndex === app.state.curRound}
              followed={Boolean(follow?.rounds[roundIndex])}
              key={roundIndex}
              label={labels[roundIndex]?.label}
              onToggle={() => setCollapse((current) => ({ ...current, [roundIndex]: !collapsed }))}
              roundIndex={roundIndex}
            >
              <RoundBody
                state={app.state}
                roundIndex={roundIndex}
                editable={editable}
                followKey={followKey}
                projected={projectedSlots[roundIndex] ?? null}
              />
            </RoundColumn>
          );
        })}
      </div>
    </div>
  );
}

export function ArchivedBracket({ state }: { state: TournamentState }) {
  const labels = bracketRoundLabels(state);
  const projectedSlots = projectFutureRoundSlots(state);
  return (
    <div className='flex max-w-full gap-3.5 overflow-x-auto pb-3'>
      {state.rounds.map((_, roundIndex) => (
        <RoundColumn
          accent={labels[roundIndex]?.accent}
          key={roundIndex}
          label={labels[roundIndex]?.label}
          roundIndex={roundIndex}
        >
          <RoundBody
            state={state}
            roundIndex={roundIndex}
            editable={false}
            followKey={null}
            projected={projectedSlots[roundIndex] ?? null}
          />
        </RoundColumn>
      ))}
    </div>
  );
}
