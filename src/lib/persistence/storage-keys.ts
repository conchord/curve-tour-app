export const LEGACY_LIVE_STATE_KEY = 'curveFFA_state_v1';
export const LEGACY_ARCHIVE_INDEX_KEY = 'curveFFA_archive_index';
export const LEGACY_BRACKET_FOLLOW_KEY = 'curveFFA_bracket_follow';

const LEGACY_ARCHIVE_ENTRY_PREFIX = 'curveFFA_archive_';

export function archiveEntryStorageKey(id: string | number): string {
  return `${LEGACY_ARCHIVE_ENTRY_PREFIX}${id}`;
}
