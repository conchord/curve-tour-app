import type { TournamentStanding, TournamentState } from '../../../domain/tournament/types';
import { TournamentUnit } from '../../../components/tournament/TournamentUnit';
import {
  Panel,
  PanelTitle,
  Table,
  TableCell,
  TableHeadCell,
  TableRow,
  TableScroll,
} from '../../../components/ui';

export type StandingsTable = readonly [label: string, entries: readonly TournamentStanding[]];

export function TournamentStandings({
  state,
  tables,
}: {
  state: TournamentState;
  tables: readonly StandingsTable[];
}) {
  return (
    <div className='grid grid-cols-[repeat(auto-fit,minmax(310px,1fr))] gap-3.5'>
      {tables.map(([label, entries]) => (
        <Panel key={label}>
          <PanelTitle>{label}</PanelTitle>
          <TableScroll>
            <Table>
              <thead>
                <TableRow>
                  <TableHeadCell>Pos</TableHeadCell>
                  <TableHeadCell>Player / Team</TableHeadCell>
                  <TableHeadCell>Fair Points</TableHeadCell>
                  <TableHeadCell>Score</TableHeadCell>
                  <TableHeadCell>Played</TableHeadCell>
                </TableRow>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <TableRow key={entry.name}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <TournamentUnit state={state} name={entry.name} />
                    </TableCell>
                    <TableCell>{entry.totalFP?.toFixed(5) ?? '—'}</TableCell>
                    <TableCell>{entry.totalScore}</TableCell>
                    <TableCell>{entry.played}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Panel>
      ))}
    </div>
  );
}
