import { getGameFormat } from './formats';
import type { IdSource } from './runtime';
import type { TeamMember, TournamentRoster, TournamentState, TournamentTeam } from './types';

function isTournamentTeam(entry: string | TournamentTeam): entry is TournamentTeam {
  return typeof entry === 'object' && entry !== null;
}

function rosterKey(entry: string | TournamentTeam): string {
  return isTournamentTeam(entry) ? entry.teamId : entry;
}

export function rosterKeys(players: TournamentRoster): string[] {
  return players.map(rosterKey);
}

export function buildTeamMap(
  state: Pick<TournamentState, 'players' | 'reserves'>,
): Record<string, TournamentTeam> {
  const entries: Array<string | TournamentTeam> = [...state.players, ...state.reserves];
  return Object.fromEntries(entries.filter(isTournamentTeam).map((team) => [team.teamId, team] as const));
}

export function unitDisplay(
  state: Pick<TournamentState, 'gameFormat' | 'players' | 'reserves'>,
  key: string,
): { label: string; members: string[] | null } {
  const format = getGameFormat(state.gameFormat);
  if (!format?.teamSize) return { label: key, members: null };
  const team = buildTeamMap(state)[key];
  if (!team) return { label: key, members: null };
  return {
    label: team.teamName,
    members: (team.members ?? [])
      .filter((member): member is TeamMember => member !== null)
      .map((member) => member.name),
  };
}

export function resolveUnitQuery(
  state: Pick<TournamentState, 'gameFormat' | 'players' | 'reserves'>,
  query: string,
): string | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  const keys = [...rosterKeys(state.players), ...rosterKeys(state.reserves)];
  const candidates = keys.map((key) => ({ key, info: unitDisplay(state, key) }));
  const exactLabel = candidates.find(({ info }) => info.label.toLowerCase() === normalized);
  if (exactLabel) return exactLabel.key;
  const exactMember = candidates.find(({ info }) =>
    info.members?.some((member) => member.toLowerCase() === normalized),
  );
  if (exactMember) return exactMember.key;
  const partialLabel = candidates.find(({ info }) => info.label.toLowerCase().includes(normalized));
  if (partialLabel) return partialLabel.key;
  const partialMember = candidates.find(({ info }) =>
    info.members?.some((member) => member.toLowerCase().includes(normalized)),
  );
  return partialMember?.key ?? null;
}

export function parseMemberLine(value: string): TeamMember {
  const match = value.trim().match(/^(.*?)(?:\s*\(([^)]*)\))?$/u);
  const name = (match?.[1] ?? value).trim();
  const userId = match?.[2]?.trim();
  return userId ? { name, userId } : { name };
}

export function parseIndividualLines(value: string): string[] {
  return value
    ? value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
}

export function parseTeamLines(options: {
  value: string;
  idPrefix: 'team' | 'reserveteam';
  teamSize: number;
  ids: IdSource;
}): TournamentTeam[] {
  const { value, idPrefix, teamSize, ids } = options;
  return parseIndividualLines(value).map((line, index) => {
    const parts = line.split(',').map((part) => part.trim());
    const teamName = parts[0] || `Unnamed Team ${index + 1}`;
    const parsedMembers = parts.slice(1).filter(Boolean).map(parseMemberLine);
    const members = Array.from({ length: teamSize }, (_, memberIndex) => parsedMembers[memberIndex] ?? null);
    return {
      teamId: ids.rosterUnitId(idPrefix, index),
      teamName,
      members,
    };
  });
}
