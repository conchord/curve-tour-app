import { useState } from 'react';
import { getGameFormat } from '../../domain/tournament/formats';
import {
  addReserveUnit,
  addWalkUpIndividual,
  fillTeamSlot,
  removeReserveUnit,
  removeRosterUnit,
  renameIndividual,
  setTeamDefender,
  swapIndividual,
  swapTeam,
  updateTeam,
  type ReserveAddResult,
} from '../../domain/tournament/mutations';
import { parseTeamLines } from '../../domain/tournament/roster';
import { getDefenderIndex } from '../../domain/tournament/scoring';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { TournamentUnit } from '../../components/tournament/TournamentUnit';
import { Button, Input, Panel, PanelTitle, Select } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

function handleReserveResult(
  result: ReserveAddResult,
  retry: () => ReserveAddResult,
  apply: (state: TournamentState) => void,
) {
  if (result.status === 'added') return apply(result.state);
  if (result.status === 'confirm-over-cap') {
    if (window.confirm(`All rooms are full. Adding this reserve will create an over-cap room. Proceed?`)) {
      const retried = retry();
      if (retried.status === 'added') apply(retried.state);
    }
    return;
  }
  const messages = {
    closed: 'Reserve window has closed — eliminations have begun.',
    'group-stage':
      "Reserves can't be added during Group Stage — group membership and the round-robin schedule are fixed once the tournament starts.",
    'strict-room':
      "Can't add this reserve — the selected strict odd-count strategy requires every room to remain even.",
    'room-cap': "Can't add this reserve — it would push a future round over the game's hard room cap.",
  };
  window.alert(messages[result.reason]);
}

export function ReservePanel({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const [walkup, setWalkup] = useState('');
  const format = getGameFormat(state.gameFormat);
  if (!state.reserves.length && !state.reserveOpen && format?.teamSize) return null;
  const keys = state.reserves.map((entry) => (typeof entry === 'string' ? entry : entry.teamId));
  const add = (key: string) =>
    handleReserveResult(
      addReserveUnit(state, key),
      () => addReserveUnit(state, key, { allowOverCap: true }),
      app.updateState,
    );
  return (
    <div className='mb-4.5 rounded-lg border border-dashed border-warning bg-surface px-4.5 py-3.5'>
      <div className='mb-2.5 text-[0.72rem] font-semibold tracking-[0.12em] text-warning uppercase'>
        Reserves
      </div>
      {!state.reserveOpen ? (
        <div className='mt-1 text-xs text-danger'>⛔ Reserve window closed — eliminations have started.</div>
      ) : (
        <>
          {!format?.teamSize ? (
            <div className='flex items-center gap-2'>
              <Input
                className='max-w-75'
                type='text'
                placeholder='Name of a new/walk-up player'
                value={walkup}
                onChange={(event) => setWalkup(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  handleReserveResult(
                    addWalkUpIndividual(state, walkup),
                    () => addWalkUpIndividual(state, walkup, { allowOverCap: true }),
                    app.updateState,
                  );
                  setWalkup('');
                }}
              />
              <Button
                size='sm'
                variant='warning'
                onClick={() => {
                  handleReserveResult(
                    addWalkUpIndividual(state, walkup),
                    () => addWalkUpIndividual(state, walkup, { allowOverCap: true }),
                    app.updateState,
                  );
                  setWalkup('');
                }}
              >
                ＋ Add new player
              </Button>
            </div>
          ) : null}
          <div className='my-2.5 flex flex-wrap gap-2'>
            {keys.map((key) => (
              <div
                className='flex items-center gap-2 rounded-full border border-surface-hover bg-surface-low px-3 py-1 text-xs'
                key={key}
              >
                <TournamentUnit state={state} name={key} />
                <Button
                  aria-label={`Add ${key}`}
                  className='size-6 min-h-0 p-0 text-warning'
                  onClick={() => add(key)}
                  size='sm'
                  variant='ghost'
                >
                  ＋
                </Button>
                <Button
                  aria-label={`Remove ${key}`}
                  className='size-6 min-h-0 p-0 text-warning'
                  onClick={() => app.updateState((current) => removeReserveUnit(current, key))}
                  size='sm'
                  variant='ghost'
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
          <div className='mt-1 text-xs text-muted'>
            {keys.length
              ? 'Click ＋ to add a reserve to the smallest available room.'
              : `No ${format?.teamSize ? 'reserve teams' : 'reserves'} on the bench.`}
          </div>
        </>
      )}
    </div>
  );
}

export function ManageRoster({ state }: { state: TournamentState }) {
  const app = useTournamentApp();
  const format = getGameFormat(state.gameFormat);
  if (!state.players.length) return null;
  if (!format?.teamSize) {
    return (
      <Panel>
        <PanelTitle hint='— rename, swap, or remove'>Manage Players</PanelTitle>
        <div className='grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2'>
          {[...(state.players as string[])].sort().map((name) => (
            <div
              className='flex min-w-0 items-center justify-between gap-2 rounded-[5px] border border-surface-hover bg-surface-low px-3 py-2'
              key={name}
            >
              <span className='min-w-0 flex-1 truncate text-sm font-medium'>{name}</span>
              <span className='flex gap-1'>
                <Button
                  size='sm'
                  title='Rename'
                  onClick={() => {
                    const value = window.prompt(`Rename "${name}" to:`, name);
                    if (value !== null) app.updateState((current) => renameIndividual(current, name, value));
                  }}
                >
                  ✎
                </Button>
                <Button
                  size='sm'
                  title='Swap'
                  onClick={() => {
                    const value = window.prompt(`Swap out "${name}". Enter the replacement's name:`);
                    if (value !== null) app.updateState((current) => swapIndividual(current, name, value));
                  }}
                >
                  ⇄
                </Button>
                <Button
                  size='sm'
                  title='Remove'
                  onClick={() => {
                    if (window.confirm(`Remove "${name}" from the tournament? This cannot be undone.`))
                      app.updateState((current) => removeRosterUnit(current, name));
                  }}
                >
                  ✕
                </Button>
              </span>
            </div>
          ))}
        </div>
      </Panel>
    );
  }
  const teams = state.players as TournamentTeam[];
  return (
    <Panel>
      <PanelTitle hint='— rename/remove teams and manage members'>Manage Teams</PanelTitle>
      <div className='grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2'>
        {[...teams]
          .sort((a, b) => a.teamName.localeCompare(b.teamName))
          .map((team) => {
            const defender = getDefenderIndex(state, team.teamId, state.curRound);
            return (
              <div
                className='flex min-w-0 flex-col items-stretch gap-2 rounded-[5px] border border-surface-hover bg-surface-low px-3 py-2'
                key={team.teamId}
              >
                <div className='flex items-center justify-between gap-2'>
                  <strong>{team.teamName}</strong>
                  <span className='flex gap-1'>
                    <Button
                      size='sm'
                      title='Rename team'
                      onClick={() => {
                        const value = window.prompt(`Rename team "${team.teamName}" to:`, team.teamName);
                        if (value?.trim())
                          app.updateState((current) =>
                            updateTeam(current, team.teamId, (entry) => ({
                              ...entry,
                              teamName: value.trim(),
                            })),
                          );
                      }}
                    >
                      ✎
                    </Button>
                    <Button
                      size='sm'
                      title='Swap team'
                      onClick={() => {
                        const reserves = state.reserves as TournamentTeam[];
                        let replacement: TournamentTeam | undefined;
                        if (reserves.length) {
                          const menu = `Swap out "${team.teamName}".\n\n  0 — type a brand-new walk-up team\n${reserves.map((entry, index) => `  ${index + 1} — ${entry.teamName}`).join('\n')}\n\nEnter a number:`;
                          const choice = window.prompt(menu);
                          if (choice === null || !choice.trim()) return;
                          const selected = Number.parseInt(choice, 10);
                          if (
                            String(selected) !== choice.trim() ||
                            selected < 0 ||
                            selected > reserves.length
                          ) {
                            window.alert(`"${choice}" isn't one of the listed numbers.`);
                            return;
                          }
                          if (selected > 0) replacement = reserves[selected - 1];
                        }
                        if (!replacement) {
                          const placeholders = Array.from(
                            { length: format.teamSize ?? 0 },
                            (_, index) => `Player${index + 1}`,
                          ).join(', ');
                          const line = window.prompt(
                            `Enter the replacement team, same format as the roster:\n\nTeamName, ${placeholders}`,
                            `Team name, ${placeholders}`,
                          );
                          if (!line?.trim()) return;
                          replacement = parseTeamLines({
                            value: line,
                            idPrefix: 'team',
                            teamSize: format.teamSize ?? 0,
                            ids: app.runtime.ids,
                          })[0];
                          if (!replacement || replacement.members.every((member) => !member)) {
                            window.alert(
                              `"${replacement?.teamName ?? 'Team'}" has no players listed — add at least one member.`,
                            );
                            return;
                          }
                        }
                        if (
                          teams.some((entry) => entry.teamName === replacement?.teamName) &&
                          !window.confirm(
                            `A team called "${replacement.teamName}" is already competing. Add it anyway?`,
                          )
                        )
                          return;
                        app.updateState((current) => swapTeam(current, team.teamId, replacement));
                      }}
                    >
                      ⇄
                    </Button>
                    <Button
                      size='sm'
                      title='Remove team'
                      onClick={() => {
                        if (
                          state.gamemodeConfig.oddCountStrategy === 'none' &&
                          (state.assignments[state.curRound] ?? []).some(
                            (entry) => entry.name === team.teamId,
                          )
                        ) {
                          const ideal = state.gamemodeConfig.roomSize?.ideal ?? 1;
                          const remaining = (state.assignments[state.curRound] ?? []).length - 1;
                          if (remaining % ideal !== 0) {
                            window.alert(
                              `Can't remove "${team.teamName}" — the strict odd-count strategy requires rooms of ${ideal} teams.`,
                            );
                            return;
                          }
                        }
                        if (
                          window.confirm(
                            `Remove team "${team.teamName}" from the tournament? This cannot be undone.`,
                          )
                        )
                          app.updateState((current) => removeRosterUnit(current, team.teamId));
                      }}
                    >
                      ✕
                    </Button>
                  </span>
                </div>
                {Array.from({ length: format.teamSize ?? 0 }, (_, memberIndex) => {
                  const member = team.members[memberIndex];
                  if (!member)
                    return (
                      <div
                        className='flex items-center justify-between gap-2 border-t border-surface-hover pt-1.5 text-xs'
                        key={memberIndex}
                      >
                        <span className='text-muted'>Vacant slot</span>
                        {state.reserveOpen ? (
                          <span className='flex gap-1'>
                            {state.reserveIndividuals.length ? (
                              <Select
                                className='py-1 text-xs'
                                aria-label={`Reserve for ${team.teamName} slot ${memberIndex + 1}`}
                                defaultValue=''
                                onChange={(event) => {
                                  const reserveIndex = Number.parseInt(event.target.value, 10);
                                  const reserve = state.reserveIndividuals[reserveIndex];
                                  if (reserve)
                                    app.updateState((current) =>
                                      fillTeamSlot(current, team.teamId, memberIndex, reserve, reserveIndex),
                                    );
                                }}
                              >
                                <option value=''>— pick a reserve —</option>
                                {state.reserveIndividuals.map((reserve, index) => (
                                  <option key={`${reserve.name}-${index}`} value={index}>
                                    {reserve.name}
                                  </option>
                                ))}
                              </Select>
                            ) : null}
                            <Button
                              size='sm'
                              variant='warning'
                              onClick={() => {
                                const value = window.prompt(
                                  'Name of the new/walk-up player filling this slot:',
                                );
                                if (value?.trim())
                                  app.updateState((current) =>
                                    fillTeamSlot(current, team.teamId, memberIndex, { name: value.trim() }),
                                  );
                              }}
                            >
                              ＋ New
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    );
                  return (
                    <div
                      className='flex items-center justify-between gap-2 border-t border-surface-hover pt-1.5 text-xs'
                      key={memberIndex}
                    >
                      <span>
                        {member.name}
                        {state.gamemodeConfig.teamScoringRule === 'designated-player' &&
                        defender === memberIndex
                          ? ' 🛡 Defender'
                          : ''}
                      </span>
                      <span className='flex gap-1'>
                        {state.gamemodeConfig.teamScoringRule === 'designated-player' &&
                        defender !== memberIndex ? (
                          <Button
                            size='sm'
                            title='Make defender'
                            onClick={() =>
                              app.updateState((current) => setTeamDefender(current, team.teamId, memberIndex))
                            }
                          >
                            🛡
                          </Button>
                        ) : null}
                        <Button
                          size='sm'
                          title='Rename member'
                          onClick={() => {
                            const value = window.prompt(`Rename "${member.name}" to:`, member.name);
                            if (value?.trim())
                              app.updateState((current) =>
                                updateTeam(current, team.teamId, (entry) => ({
                                  ...entry,
                                  members: entry.members.map((item, index) =>
                                    index === memberIndex && item ? { ...item, name: value.trim() } : item,
                                  ),
                                })),
                              );
                          }}
                        >
                          ✎
                        </Button>
                        <Button
                          size='sm'
                          title='Remove member'
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove "${member.name}" from team "${team.teamName}"? This cannot be undone.`,
                              )
                            )
                              app.updateState((current) =>
                                updateTeam(current, team.teamId, (entry) => ({
                                  ...entry,
                                  members: entry.members.map((item, index) =>
                                    index === memberIndex ? null : item,
                                  ),
                                })),
                              );
                          }}
                        >
                          ✕
                        </Button>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
      </div>
    </Panel>
  );
}
