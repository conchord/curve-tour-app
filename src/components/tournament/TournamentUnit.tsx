import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../ui';

export function TournamentUnit({
  name,
  separator = ' · ',
  state,
}: {
  name: string;
  separator?: string;
  state: TournamentState;
}) {
  const info = unitDisplay(state, name);
  return (
    <span>
      <strong>{info.label}</strong>
      {info.members?.length ? (
        <small className='mt-0.5 block font-normal text-muted'>{info.members.join(separator)}</small>
      ) : null}
    </span>
  );
}

export function Position({
  children,
  highlighted = false,
}: {
  children: React.ReactNode;
  highlighted?: boolean;
}) {
  return (
    <span className={cn('text-xl font-bold text-muted', highlighted && 'text-primary')}>{children}</span>
  );
}

export function ByeCard({ children }: { children: React.ReactNode }) {
  return (
    <div className='mb-4 flex items-center gap-3 rounded-lg border border-accent bg-accent-soft px-4 py-3'>
      {children}
    </div>
  );
}
