import { useState } from 'react';
import { getAllTies, isTieResolved, roomBasedComputeAdvancement } from '../../domain/tournament/advancement';
import { finalsProgressState } from '../../domain/tournament/finals';
import { getGameFormat } from '../../domain/tournament/formats';
import { resolveTournamentTie, setFinalScore, setRoundScore } from '../../domain/tournament/mutations';
import { unitDisplay } from '../../domain/tournament/roster';
import { getUnitScore, orderRoomByScore, tieResolutionList } from '../../domain/tournament/scoring';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { Position, TournamentUnit } from '../../components/tournament/TournamentUnit';
import {
  Badge,
  Button,
  ButtonRow,
  Panel,
  ScoreInput as ScoreField,
  Table,
  TableCell,
  TableHeadCell,
  TableRow,
  TableScroll,
  cn,
} from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

export function TieBanners({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const ties = getAllTies(state, state.curRound);
  return Object.entries(ties)
    .filter(([key, tie]) => !isTieResolved(key, tie, state))
    .map(([key, tie]) => {
      const resolved = tieResolutionList(state, key);
      const remaining = tie.players.filter((player) => !resolved.includes(player.name));
      const heading =
        'groupLabel' in tie && tie.groupLabel
          ? `⚠ Tie-break required — Group ${tie.groupLabel} qualification cutoff (${tie.fp.toFixed(5)} FP)`
          : 'score' in tie
            ? `⚠ Tie-break required — Room ${tie.rm} (score ${tie.score})`
            : `⚠ Tie-break required — Qualification cutoff (${tie.fp.toFixed(5)} FP)`;
      return (
        <div
          className='mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-danger bg-danger-soft px-4.5 py-3.5'
          key={key}
        >
          <div>
            <div className='font-semibold text-danger'>{heading}</div>
            <div className='mt-1 text-xs text-muted'>
              {resolved.length
                ? `Ranked so far: ${resolved.map((name) => unitDisplay(state, name).label).join(' > ')} — `
                : ''}
              tied: {tie.players.map((player) => unitDisplay(state, player.name).label).join(', ')} — pick who
              ranks next
            </div>
          </div>
          <ButtonRow className='mt-0'>
            {remaining.map((player) => (
              <Button
                size='sm'
                variant='warning'
                key={player.name}
                onClick={() => app.updateState((current) => resolveTournamentTie(current, key, player.name))}
              >
                {unitDisplay(state, player.name).label} ranks next
              </Button>
            ))}
          </ButtonRow>
        </div>
      );
    });
}

function ScoreInput({
  scoreKey,
  value,
  roundIndex,
  room,
}: {
  scoreKey: string;
  value: number | null | '' | undefined;
  roundIndex: number;
  room: number;
}) {
  const app = useTournamentApp();
  return (
    <ScoreField
      className='w-16 text-sm'
      min='0'
      data-key={scoreKey}
      data-rm={room}
      data-ri={roundIndex}
      value={value ?? ''}
      onChange={(event) =>
        app.updateState((current) => setRoundScore(current, scoreKey, event.target.value, roundIndex, room))
      }
    />
  );
}

export function RoomScores({ state, room }: { state: TournamentState; room: number }) {
  const roundIndex = state.curRound;
  const round = state.rounds[roundIndex];
  const format = getGameFormat(state.gameFormat);
  const assignments = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
  const games = (round.numGames ?? 1) > 1 ? (round.numGames ?? 1) : 1;
  const teamSize = format?.teamSize ?? 0;
  const direct = round.isNoElim ? assignments.length : (round.advPerRoom ?? 0);
  const isBottomRoom = round.isKingsValley && room === round.rooms.length;
  const promoteCount = round.kvPromoteCounts?.[room - 1] ?? 0;
  const cutCount = isBottomRoom ? (round.kvEliminateCount ?? 0) : (round.kvDemoteCounts?.[room - 1] ?? 0);
  const ranked = orderRoomByScore(
    assignments
      .map((entry, position) => ({
        name: entry.name,
        position,
        score: getUnitScore(state, roundIndex, room, position, null),
      }))
      .filter((entry): entry is { name: string; position: number; score: number } => entry.score !== null),
    roundIndex,
    room,
    state,
  );
  const rankByName = new Map(ranked.map((entry, index) => [entry.name, index + 1]));
  let luckyNames: string[] = [];
  if (!round.bracket && !round.isKingsValley) {
    try {
      luckyNames = roomBasedComputeAdvancement(state, roundIndex).luckyNames ?? [];
    } catch (error) {
      console.error(`Lucky-loser computation failed for round ${round.roundNum}, room ${room}`, error);
    }
  }
  const ties = getAllTies(state, roundIndex);
  const unresolvedNames = new Set(
    Object.entries(ties)
      .filter(([key, tie]) => !isTieResolved(key, tie, state))
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
  return (
    <div className='mb-5'>
      <div className='flex flex-wrap items-center justify-between gap-1.5 rounded-t-lg border border-b-0 border-surface-hover bg-surface-low px-4 py-2.5'>
        <div className='text-xl font-bold tracking-[0.05em] text-primary'>
          {round.isGroupStage ? `Group ${round.roomGroups?.[room - 1]} · ` : ''}Room {room}
        </div>
        <div className='mt-1 text-xs text-muted'>
          {round.isKingsValley
            ? `${assignments.length} ${format?.unitLabelPlural.toLowerCase()} · top ${promoteCount} promote · bottom ${cutCount} ${isBottomRoom ? 'eliminated' : 'demote'}`
            : `${assignments.length} ${format?.unitLabelPlural.toLowerCase()} · top ${round.isNoElim ? 'all' : direct} advance directly${round.luckyCount ? ' + lucky losers' : ''}`}
        </div>
      </div>
      <TableScroll>
        <Table>
          <thead>
            <TableRow>
              <TableHeadCell>Pos</TableHeadCell>
              <TableHeadCell>{format?.unitLabel ?? 'Player'}</TableHeadCell>
              <TableHeadCell>Score{games > 1 ? ` (${games} games)` : ''}</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
            </TableRow>
          </thead>
          <tbody>
            {assignments.map((assignment, position) => {
              const rank = rankByName.get(assignment.name);
              const status = !rank
                ? '—'
                : unresolvedNames.has(assignment.name)
                  ? '⚠ Tie'
                  : round.isKingsValley
                    ? rank <= promoteCount
                      ? '▲ Promotes'
                      : rank > assignments.length - cutCount
                        ? isBottomRoom
                          ? '☠ Eliminated'
                          : '▼ Demotes'
                        : '— Stays'
                    : round.isNoElim || rank <= direct
                      ? 'Advances'
                      : luckyNames.includes(assignment.name)
                        ? '★ Lucky Loser'
                        : 'Eliminated';
              const team = teamSize
                ? (state.players as TournamentTeam[]).find((entry) => entry.teamId === assignment.name)
                : null;
              return (
                <TableRow
                  key={assignment.name}
                  tone={
                    status === 'Advances' || status === '▲ Promotes'
                      ? 'advance'
                      : status.includes('Lucky')
                        ? 'lucky'
                        : status === 'Eliminated' || status === '☠ Eliminated'
                          ? 'eliminate'
                          : status.includes('Tie')
                            ? 'tie'
                            : status === '▼ Demotes'
                              ? 'warning'
                              : 'default'
                  }
                >
                  <TableCell>
                    <Position
                      highlighted={Boolean(
                        rank && (round.isKingsValley ? rank <= promoteCount : rank <= direct),
                      )}
                    >
                      {rank ?? '—'}
                    </Position>
                  </TableCell>
                  <TableCell>
                    <TournamentUnit state={state} name={assignment.name} />
                  </TableCell>
                  <TableCell>
                    {teamSize ? (
                      <div className='grid gap-1.5'>
                        {Array.from({ length: teamSize }, (_, memberIndex) => {
                          const member = team?.members?.[memberIndex];
                          if (!member)
                            return (
                              <span className='text-muted' key={memberIndex}>
                                Vacant slot
                              </span>
                            );
                          return (
                            <div className='flex flex-wrap items-center gap-1.5' key={memberIndex}>
                              {Array.from({ length: games }, (_, gameIndex) => {
                                const key = `r${roundIndex}-rm${room}-p${position}${games > 1 ? `-g${gameIndex + 1}` : ''}-m${memberIndex}`;
                                return (
                                  <ScoreInput
                                    key={key}
                                    scoreKey={key}
                                    value={state.scores[key]}
                                    roundIndex={roundIndex}
                                    room={room}
                                  />
                                );
                              })}
                              <span>{member.name}</span>
                            </div>
                          );
                        })}
                        {games > 1 ? (
                          <strong>Total: {getUnitScore(state, roundIndex, room, position, 0)}</strong>
                        ) : null}
                      </div>
                    ) : games > 1 ? (
                      <div className='flex flex-wrap items-center gap-1.5'>
                        {Array.from({ length: games }, (_, gameIndex) => {
                          const key = `r${roundIndex}-rm${room}-p${position}-g${gameIndex + 1}`;
                          return (
                            <ScoreInput
                              key={key}
                              scoreKey={key}
                              value={state.scores[key]}
                              roundIndex={roundIndex}
                              room={room}
                            />
                          );
                        })}
                        <strong>{getUnitScore(state, roundIndex, room, position, 0)}</strong>
                      </div>
                    ) : (
                      <ScoreInput
                        scoreKey={`r${roundIndex}-rm${room}-p${position}`}
                        value={state.scores[`r${roundIndex}-rm${room}-p${position}`]}
                        roundIndex={roundIndex}
                        room={room}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        status === 'Advances' || status === '▲ Promotes'
                          ? 'success'
                          : status.includes('Lucky')
                            ? 'accent'
                            : status === 'Eliminated' || status === '☠ Eliminated' || status.includes('Tie')
                              ? 'danger'
                              : status === '▼ Demotes'
                                ? 'warning'
                                : 'neutral'
                      }
                    >
                      {status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
      {round.isKingsValley ? (
        <div className='rounded-b-[5px] border border-t-0 border-surface-hover bg-success-soft p-1.5 text-center text-[0.68rem] italic'>
          ▲ Top {promoteCount} promote
          {isBottomRoom
            ? ` · bottom ${cutCount} eliminated`
            : ` · bottom ${cutCount} demote to Room ${room + 1}`}
        </div>
      ) : !round.isNoElim && !round.isFinal ? (
        <div className='rounded-b-[5px] border border-t-0 border-surface-hover bg-success-soft p-1.5 text-center text-[0.68rem] italic'>
          ▲ Top {direct} advance directly
          {round.luckyCount ? ` · ${round.luckyCount} lucky loser spot(s) across all rooms` : ''}
        </div>
      ) : null}
    </div>
  );
}

export function FinalsScores({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const [tab, setTab] = useState(1);
  const round = state.rounds[state.curRound];
  const assignments = state.assignments[state.curRound] ?? [];
  const teamSize = getGameFormat(state.gameFormat)?.teamSize ?? 0;
  const progress = finalsProgressState(state, state.curRound, round);
  const games = round.numGames ?? 1;
  const activeTab = Math.min(tab, games);
  return (
    <Panel>
      {progress.race ? (
        <div className='mb-3 flex flex-wrap gap-3.5'>
          <span>
            {unitDisplay(state, progress.race.wbName).label} (Winners&apos; bracket):{' '}
            <strong>
              {progress.race.wbWins} / {progress.race.wbTarget}
            </strong>
          </span>
          <span>
            {unitDisplay(state, progress.race.lbName).label} (Losers&apos; bracket):{' '}
            <strong>
              {progress.race.lbWins} / {progress.race.lbTarget}
            </strong>
          </span>
          {progress.race.decided ? (
            <span>
              🏆 {unitDisplay(state, progress.race.winnerName as string).label} wins the Grand Final!
            </span>
          ) : null}
        </div>
      ) : null}
      <div className='mb-3.5 flex flex-wrap gap-1.5'>
        {Array.from({ length: games }, (_, index) => (
          <Button
            key={index}
            className={cn(
              activeTab === index + 1 && tab !== 0 && 'border-primary bg-primary-soft text-primary',
            )}
            size='sm'
            onClick={() => setTab(index + 1)}
          >
            Game {index + 1}
          </Button>
        ))}
        <Button
          className={cn(tab === 0 && 'border-primary bg-primary-soft text-primary')}
          size='sm'
          onClick={() => setTab(0)}
        >
          📊 Total
        </Button>
      </div>
      {tab === 0 ? (
        <TableScroll>
          <Table>
            <thead>
              <TableRow>
                <TableHeadCell>Pos</TableHeadCell>
                <TableHeadCell>{teamSize ? 'Team' : 'Player'}</TableHeadCell>
                {Array.from({ length: games }, (_, index) => (
                  <TableHeadCell key={index}>G{index + 1}</TableHeadCell>
                ))}
                <TableHeadCell>Total</TableHeadCell>
              </TableRow>
            </thead>
            <tbody>
              {[...progress.units]
                .sort((a, b) => b.total - a.total)
                .map((unit, index) => (
                  <TableRow key={unit.name} tone={index === 0 ? 'advance' : 'default'}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <TournamentUnit state={state} name={unit.name} />
                    </TableCell>
                    {unit.perGame.map((score, game) => (
                      <TableCell key={game}>{score ?? '—'}</TableCell>
                    ))}
                    <TableCell className='text-base font-bold text-primary'>{unit.total}</TableCell>
                  </TableRow>
                ))}
            </tbody>
          </Table>
        </TableScroll>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <TableRow>
                <TableHeadCell>{teamSize ? 'Team' : 'Player'}</TableHeadCell>
                <TableHeadCell>Score G{activeTab}</TableHeadCell>
              </TableRow>
            </thead>
            <tbody>
              {assignments.map((assignment) => {
                const team = teamSize
                  ? (state.players as TournamentTeam[]).find((entry) => entry.teamId === assignment.name)
                  : null;
                return (
                  <TableRow key={assignment.name}>
                    <TableCell>
                      <TournamentUnit state={state} name={assignment.name} />
                    </TableCell>
                    <TableCell>
                      {teamSize ? (
                        <div className='grid gap-1.5'>
                          {Array.from({ length: teamSize }, (_, memberIndex) => {
                            const member = team?.members?.[memberIndex];
                            if (!member)
                              return (
                                <span className='text-muted' key={memberIndex}>
                                  Vacant
                                </span>
                              );
                            const key = `game${activeTab}-${assignment.name}-m${memberIndex}`;
                            return (
                              <div className='flex flex-wrap items-center gap-1.5' key={key}>
                                <ScoreField
                                  min='0'
                                  value={state.finalScores[key] ?? ''}
                                  onChange={(event) =>
                                    app.updateState((current) =>
                                      setFinalScore(current, key, event.target.value),
                                    )
                                  }
                                />
                                <span>{member.name}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        (() => {
                          const key = `game${activeTab}-${assignment.name}`;
                          return (
                            <ScoreField
                              min='0'
                              value={state.finalScores[key] ?? ''}
                              onChange={(event) =>
                                app.updateState((current) => setFinalScore(current, key, event.target.value))
                              }
                            />
                          );
                        })()
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Panel>
  );
}
