import {
  computeGroupStandings,
  computeQualificationStandings,
  roomBasedComputeAdvancement,
} from '../../domain/tournament/advancement';
import { getGameFormat } from '../../domain/tournament/formats';
import { getFinalUnitScore, getUnitScore, orderRoomByScore } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { TournamentStandings } from '../tournament/components/TournamentStandings';
import { ByeCard, Position, TournamentUnit } from '../../components/tournament/TournamentUnit';
import {
  Alert,
  Badge,
  StatStrip,
  Table,
  TableCell,
  TableHeadCell,
  TableRow,
  TableScroll,
} from '../../components/ui';

function ScoreboardStandings({ state }: { state: TournamentState }) {
  const hasGroups = state.rounds.slice(0, state.curRound + 1).some((round) => round.isGroupStage);
  const hasStandings = state.rounds
    .slice(0, state.curRound + 1)
    .some((round) => round.isQual || round.isSwiss);
  if (!hasGroups && !hasStandings) return null;
  const groupStandings = hasGroups ? computeGroupStandings(state) : null;
  const tables = hasGroups
    ? state.groups.map((group) => [group.label, groupStandings?.[group.label] ?? []] as const)
    : [
        [
          state.cfg.poolingPhase === 'swiss' ? 'Swiss Standings' : 'Qualification Table',
          computeQualificationStandings(state),
        ] as const,
      ];
  return <TournamentStandings state={state} tables={tables} />;
}

export function ScoreboardView() {
  const { state } = useTournamentApp();
  if (!state.rounds.length || !state.started) {
    return <Alert>Start a tournament in Admin to see the live scoreboard.</Alert>;
  }
  const roundIndex = state.curRound;
  const round = state.rounds[roundIndex];
  const assignments = state.assignments[roundIndex] ?? [];
  const format = getGameFormat(state.gameFormat);
  let luckyNames: string[] = [];
  if (!round.bracket && !round.isFinal) {
    try {
      luckyNames = roomBasedComputeAdvancement(state, roundIndex).luckyNames ?? [];
    } catch (error) {
      console.error(`Lucky-loser computation failed for round ${round.roundNum}`, error);
    }
  }
  const phase = round.isFinal
    ? '🏆 Grand Final'
    : round.isSemis
      ? '⚔ Semi-Finals'
      : `Round ${round.roundNum}`;
  return (
    <div id='sb-content'>
      <StatStrip
        items={[
          { label: 'Round', value: phase },
          { label: format?.unitLabelPlural, value: assignments.length },
          { label: 'Rooms', value: round.rooms.length },
          { label: 'Advancing', value: round.isNoElim ? 'All' : round.isFinal ? '—' : round.advTotal },
        ]}
      />
      <ScoreboardStandings state={state} />
      {Array.from({ length: round.rooms.length }, (_, roomIndex) => {
        const room = roomIndex + 1;
        const units = assignments.filter((entry) => entry.room === room);
        const direct = round.isNoElim || round.isFinal ? units.length : (round.advPerRoom ?? 0);
        const scored = units.map((entry, position) => ({
          name: entry.name,
          score: round.isFinal
            ? Array.from({ length: round.numGames ?? 1 }, (_, game) =>
                getFinalUnitScore(state, entry.name, game + 1, null),
              ).every((score) => score !== null)
              ? Array.from(
                  { length: round.numGames ?? 1 },
                  (_, game) => getFinalUnitScore(state, entry.name, game + 1, 0) ?? 0,
                ).reduce((sum, score) => sum + score, 0)
              : null
            : getUnitScore(state, roundIndex, room, position, null),
        }));
        const rankedScored = orderRoomByScore(
          scored.filter((entry): entry is { name: string; score: number } => entry.score !== null),
          roundIndex,
          room,
          state,
        );
        const ranked = [...rankedScored, ...scored.filter((entry) => entry.score === null)];
        return (
          <div className='mb-5' key={room}>
            <div className='flex flex-wrap items-center justify-between gap-1.5 rounded-t-lg border border-b-0 border-surface-hover bg-surface-low px-4 py-2.5'>
              <div className='text-xl font-bold tracking-[0.05em] text-primary'>
                {round.isGroupStage ? `Group ${round.roomGroups?.[roomIndex]} · ` : ''}Room {room}
              </div>
              <div className='mt-0.5 text-xs text-muted'>Top {round.isNoElim ? 'all' : direct} advance</div>
            </div>
            <TableScroll>
              <Table>
                <thead>
                  <TableRow>
                    <TableHeadCell>Pos</TableHeadCell>
                    <TableHeadCell>{format?.unitLabel}</TableHeadCell>
                    <TableHeadCell>Score</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                  </TableRow>
                </thead>
                <tbody>
                  {ranked.map((entry, index) => {
                    const scoredEntry = entry.score !== null;
                    const advances =
                      round.isNoElim || round.isFinal || index < direct || luckyNames.includes(entry.name);
                    return (
                      <TableRow
                        key={entry.name}
                        tone={!scoredEntry ? 'default' : advances ? 'advance' : 'eliminate'}
                      >
                        <TableCell>
                          <Position highlighted={scoredEntry && advances}>
                            {scoredEntry ? index + 1 : '—'}
                          </Position>
                        </TableCell>
                        <TableCell>
                          <TournamentUnit state={state} name={entry.name} />
                        </TableCell>
                        <TableCell className='text-base font-bold text-primary'>
                          {entry.score ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Badge tone={!scoredEntry ? 'neutral' : advances ? 'success' : 'danger'}>
                            {!scoredEntry ? '—' : advances ? 'Advances' : 'Eliminated'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          </div>
        );
      })}
      {(state.byes[roundIndex] ?? []).map((name) => (
        <ByeCard key={name}>
          <strong>BYE</strong>
          <TournamentUnit state={state} name={name} />
          <Badge className='ml-auto' tone='success'>
            Advances
          </Badge>
        </ByeCard>
      ))}
    </div>
  );
}
