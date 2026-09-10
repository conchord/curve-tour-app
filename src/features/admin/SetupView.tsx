import { useMemo, useState } from 'react';
import {
  GAME_FORMATS,
  ODD_COUNT_STRATEGY_LABELS,
  TEAM_SCORING_RULE_LABELS,
  getGameFormat,
} from '../../domain/tournament/formats';
import { generateTournament } from '../../domain/tournament/generation';
import { parseIndividualLines, parseMemberLine, parseTeamLines } from '../../domain/tournament/roster';
import type { PersistedSetup } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import {
  Alert,
  Button,
  ButtonRow,
  Field,
  FieldDisplay,
  Input,
  Panel,
  PanelTitle,
  Select,
  Textarea,
  Timeline,
  TimelineItem,
  TwoColumnGrid,
} from '../../components/ui';

type SetupKey = keyof PersistedSetup;

export function SetupView() {
  const { state, setup, runtime, updateSetup, updateState } = useTournamentApp();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [lbQualifiers, setLbQualifiers] = useState('2');
  const format = getGameFormat(setup.gameFormat);
  const teamSize = format?.teamSize;
  const raceCompatible = format?.idealRoomSize === 2 && setup.oddCountStrategy !== 'flex';
  const scheduleOptions = useMemo(
    () =>
      raceCompatible
        ? [{ value: 'double-elimination', label: 'Double elimination' }]
        : [{ value: 'double-elimination-shared-final', label: 'Double elimination — FFA/Team' }],
    [raceCompatible],
  );

  function change(key: SetupKey, value: string) {
    updateSetup((current) => ({ ...current, [key]: value }));
  }

  function changeFormat(value: string) {
    const nextFormat = getGameFormat(value as PersistedSetup['gameFormat']);
    const defaultOdd = nextFormat?.supportedOddCountStrategies?.[0] ?? '';
    const compatible = nextFormat?.idealRoomSize === 2 && defaultOdd !== 'flex';
    updateSetup((current) => ({
      ...current,
      gameFormat: value as PersistedSetup['gameFormat'],
      oddCountStrategy: defaultOdd,
      teamScoringRule: nextFormat?.teamSize ? 'sum-members' : '',
      scheduleLogic:
        current.scheduleLogic === 'double-elimination' && !compatible
          ? 'single-elimination'
          : current.scheduleLogic === 'double-elimination-shared-final' && compatible
            ? 'single-elimination'
            : current.scheduleLogic,
    }));
  }

  function loadRoster() {
    if (!format) return;
    if (teamSize) {
      const players = parseTeamLines({
        value: setup.roster.trim(),
        idPrefix: 'team',
        teamSize,
        ids: runtime.ids,
      });
      const reserves = parseTeamLines({
        value: setup.reserves.trim(),
        idPrefix: 'reserveteam',
        teamSize,
        ids: runtime.ids,
      });
      const empty = [...players, ...reserves].filter((team) => team.members.every((member) => !member));
      if (empty.length) {
        const message = `These team(s) have no players listed at all — add at least one "TeamName, Player1, ..." member, or remove the line:\n\n${empty.map((team) => team.teamName).join('\n')}`;
        window.alert(message);
        return;
      }
      const reserveIndividuals = parseIndividualLines(setup.reserveIndividuals).map(parseMemberLine);
      updateState({
        ...state,
        players,
        reserves,
        reserveIndividuals,
        confirmedCount: players.length,
      });
      setStatus(
        `${players.length} confirmed, ${reserves.length} reserves, ${reserveIndividuals.length} individual reserves`,
      );
    } else {
      const players = parseIndividualLines(setup.roster.trim());
      const reserves = parseIndividualLines(setup.reserves.trim());
      updateState({
        ...state,
        players,
        reserves,
        reserveIndividuals: [],
        confirmedCount: players.length,
      });
      setStatus(`${players.length} confirmed, ${reserves.length} reserves`);
    }
    setError('');
  }

  function generate() {
    const result = generateTournament(state, { ...setup, lbQualifiers }, runtime);
    if (result.status === 'invalid') {
      setError(result.message);
      return;
    }
    setError('');
    updateState(result.state);
  }

  const isGroup = setup.poolingPhase === 'group-stage';
  const isSingle = setup.scheduleLogic === 'single-elimination';
  const isRace = setup.scheduleLogic === 'double-elimination';
  const isShared = setup.scheduleLogic === 'double-elimination-shared-final';
  return (
    <div id='panel-setup'>
      <Panel>
        <PanelTitle>Tournament Name</PanelTitle>
        <Field label='Tournament name'>
          <Input
            id='cfg-title'
            type='text'
            placeholder='Unnamed Tournament — click to name'
            value={state.title}
            onChange={(event) => updateState({ ...state, title: event.target.value, needsSave: true })}
          />
        </Field>
      </Panel>
      <TwoColumnGrid>
        <Panel>
          <PanelTitle>Tournament Settings</PanelTitle>
          <Field label='Game format'>
            <Select
              id='cfg-game-format'
              value={setup.gameFormat}
              onChange={(e) => changeFormat(e.target.value)}
            >
              {Object.values(GAME_FORMATS).map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
              <option value='last-man-standing' disabled>
                Last Man Standing (coming soon)
              </option>
            </Select>
          </Field>
          <Field label='Schedule logic'>
            <Select
              id='cfg-schedule-logic'
              value={setup.scheduleLogic}
              onChange={(e) => change('scheduleLogic', e.target.value)}
            >
              <option value='single-elimination'>Single elimination</option>
              {scheduleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value='kings-valley' disabled>
                Kings Valley (coming soon)
              </option>
            </Select>
          </Field>
          {teamSize ? (
            <Field label='Team scoring'>
              <Select
                id='cfg-team-scoring-rule'
                value={setup.teamScoringRule || 'sum-members'}
                onChange={(e) => change('teamScoringRule', e.target.value)}
              >
                {Object.entries(TEAM_SCORING_RULE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label='Pooling phase'>
            <Select
              id='cfg-pooling-phase'
              value={setup.poolingPhase}
              onChange={(e) => change('poolingPhase', e.target.value)}
            >
              <option value='none'>None — standard elimination from R1</option>
              <option value='qual-table'>Qualification Table — R1/R2/R3 feed cumulative table</option>
              <option value='swiss'>Swiss — fold-paired rounds feed cumulative standings</option>
              <option value='group-stage'>Group Stage — round-robin groups, top finishers advance</option>
            </Select>
          </Field>
          {isGroup ? (
            <>
              <Field label='Group size'>
                <Input
                  id='cfg-group-size'
                  type='number'
                  min='3'
                  max='5'
                  value={setup.groupSize}
                  onChange={(e) => change('groupSize', e.target.value)}
                />
              </Field>
              <Field label='Round-robin'>
                <Select
                  id='cfg-round-robin-mode'
                  value={setup.roundRobinMode}
                  onChange={(e) => change('roundRobinMode', e.target.value)}
                >
                  <option value='single'>Single — every pair meets once</option>
                  <option value='double'>Double — every pair meets twice</option>
                </Select>
              </Field>
              <Field label='Qualifiers per group'>
                <Input
                  id='cfg-qualifiers-per-group'
                  type='number'
                  min='1'
                  value={setup.qualifiersPerGroup}
                  onChange={(e) => change('qualifiersPerGroup', e.target.value)}
                />
              </Field>
            </>
          ) : setup.poolingPhase !== 'none' ? (
            <Field label='Advance to bracket'>
              <Input
                id='cfg-qual-adv'
                type='number'
                min='1'
                value={setup.qualAdv}
                onChange={(e) => change('qualAdv', e.target.value)}
              />
            </Field>
          ) : null}
          {format?.supportedOddCountStrategies && format.supportedOddCountStrategies.length > 1 ? (
            <Field label='Odd-count strategy'>
              <Select
                id='cfg-odd-count-strategy'
                value={setup.oddCountStrategy || format.supportedOddCountStrategies[0]}
                onChange={(e) => change('oddCountStrategy', e.target.value)}
              >
                {format.supportedOddCountStrategies.map((key) => (
                  <option key={key} value={key}>
                    {ODD_COUNT_STRATEGY_LABELS[key]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label='Scoring system'>
            <Select id='cfg-scoring' value='fairpoints' disabled>
              <option value='fairpoints'>Fair Points (rank − score ÷ 100000)</option>
            </Select>
          </Field>
          {!isRace ? (
            <Field label='Finals format'>
              <Select
                id='cfg-finals-games'
                value={setup.finalsGames}
                onChange={(e) => change('finalsGames', e.target.value)}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'Single game' : `${n} games (sum)`}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label='Grand Final — wins needed to take the title'>
              <div className='flex gap-2.5'>
                <Input
                  aria-label='Winners bracket target'
                  type='number'
                  min='1'
                  value={setup.grandFinalWbTarget}
                  onChange={(e) => change('grandFinalWbTarget', e.target.value)}
                />
                <Input
                  aria-label='Losers bracket target'
                  type='number'
                  min='1'
                  value={setup.grandFinalLbTarget}
                  onChange={(e) => change('grandFinalLbTarget', e.target.value)}
                />
              </div>
            </Field>
          )}
          {isSingle ? (
            <>
              <Field label='Semis size override (optional)'>
                <Input
                  id='cfg-semis-override'
                  type='number'
                  min='1'
                  placeholder='derived'
                  value={setup.semisOverride}
                  onChange={(e) => change('semisOverride', e.target.value)}
                />
              </Field>
              <Field label='Semis format'>
                <Select
                  id='cfg-semis-games'
                  value={setup.semisGames}
                  onChange={(e) => change('semisGames', e.target.value)}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'Single game' : `${n} games (sum)`}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          {isShared ? (
            <Field label='LB qualifiers into the Final'>
              <Input
                id='cfg-lb-qualifiers'
                type='number'
                min='1'
                value={lbQualifiers}
                onChange={(e) => setLbQualifiers(e.target.value)}
              />
            </Field>
          ) : null}
          {isSingle || isShared ? (
            <Field label='Final size override (optional)'>
              <Input
                id='cfg-final-override'
                type='number'
                min='1'
                placeholder='derived'
                value={setup.finalOverride}
                onChange={(e) => change('finalOverride', e.target.value)}
              />
            </Field>
          ) : null}
          {error ? (
            <Alert id='generate-error' tone='danger'>
              {error}
            </Alert>
          ) : null}
          <ButtonRow>
            <Button variant='primary' onClick={generate}>
              ▶ Generate Schedule
            </Button>
          </ButtonRow>
        </Panel>
        <Panel>
          <Field label='Registered players'>
            <FieldDisplay id='cfg-n-display'>
              {state.confirmedCount ?? '—'}
              {state.reserves.length ? ` (+ ${state.reserves.length} reserves)` : ''}
            </FieldDisplay>
          </Field>
          <PanelTitle hint={<>— confirmed {teamSize ? 'teams' : 'players'}, one per line</>}>
            Roster
          </PanelTitle>
          <Textarea
            id='cfg-roster'
            value={setup.roster}
            onChange={(e) => change('roster', e.target.value)}
            placeholder={
              teamSize
                ? `Team Rocket, ${Array.from({ length: teamSize }, (_, i) => `Player${i + 1}`).join(', ')}`
                : 'Harald\nLagtop\nArisu\n...'
            }
          />
          <PanelTitle className='mt-4' hint='— one per line'>
            Reserves
          </PanelTitle>
          <Textarea
            id='cfg-reserves'
            className='min-h-15'
            value={setup.reserves}
            onChange={(e) => change('reserves', e.target.value)}
          />
          {teamSize ? (
            <>
              <PanelTitle className='mt-4' hint='— substitutes for one member'>
                Individual reserves
              </PanelTitle>
              <Textarea
                id='cfg-reserve-individuals'
                className='min-h-15'
                value={setup.reserveIndividuals}
                onChange={(e) => change('reserveIndividuals', e.target.value)}
              />
            </>
          ) : null}
          <ButtonRow>
            <Button onClick={loadRoster}>Load roster & reserves</Button>
            <span className='self-center text-xs text-muted'>{status}</span>
          </ButtonRow>
        </Panel>
      </TwoColumnGrid>
      {state.rounds.length && !state.started ? (
        <Panel id='preview-wrap'>
          <PanelTitle>Schedule Preview</PanelTitle>
          <Timeline>
            {state.rounds.map((round, index) => (
              <TimelineItem
                key={index}
                label={
                  round.isFinal
                    ? 'Final'
                    : round.bracket === 'winners'
                      ? 'WB'
                      : round.bracket === 'losers'
                        ? 'LB'
                        : `${round.players} ${format?.unitLabelPlural ?? 'Players'}`
                }
              >
                {round.roundNum}
              </TimelineItem>
            ))}
          </Timeline>
          <ButtonRow>
            <Button variant='success' onClick={() => updateState({ ...state, curRound: 0, started: true })}>
              ✓ Confirm & Start
            </Button>
          </ButtonRow>
        </Panel>
      ) : null}
    </div>
  );
}
