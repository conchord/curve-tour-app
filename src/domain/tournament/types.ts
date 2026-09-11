export type ActiveTab = 'admin' | 'scoreboard' | 'bracket' | 'rankings' | 'archive';

export type GameFormatKey =
  'ffa-individual' | 'team-2v2v2v2' | 'team-3v3v3' | 'team-3v3' | 'last-man-standing' | 'individual-1v1';

export type ImplementedGameFormatKey = Exclude<GameFormatKey, 'last-man-standing'>;

export type ScheduleLogicKey =
  'single-elimination' | 'double-elimination' | 'double-elimination-shared-final' | 'kings-valley';

export type PoolingPhaseKey = 'none' | 'qual-table' | 'swiss' | 'group-stage';

export type ScoringSystemKey = 'fairpoints';
export type OddCountStrategyKey = 'none' | 'bye' | 'flex';
export type TeamScoringRuleKey = 'sum-members' | 'designated-player';
export type RoundRobinMode = 'single' | 'double';
export type BracketKey = 'winners' | 'losers' | 'grand-final';

export interface TeamMember {
  name: string;
  userId?: string;
}

export interface TournamentTeam {
  teamId: string;
  teamName: string;
  members: Array<TeamMember | null>;
}

export type TournamentRoster = string[] | TournamentTeam[];

export interface RoomSize {
  min: number;
  max: number;
  ideal: number;
}

export interface GameFormatDefinition {
  key: ImplementedGameFormatKey;
  label: string;
  unitLabel: 'Player' | 'Team';
  unitLabelPlural: 'Players' | 'Teams';
  teamSize?: number;
  defaultRoomSize?: RoomSize;
  idealRoomSize?: number;
  supportedOddCountStrategies?: OddCountStrategyKey[];
}

export interface GroupStageMatch {
  group: string;
  pair: [string, string];
}

export interface TournamentRound {
  roundNum: number;
  players: number;
  rooms: number[];
  byeCount: number;
  isQual: boolean;
  isNoElim: boolean;
  isSemis: boolean;
  isFinal: boolean;
  advPerRoom: number | null;
  advTotal: number;
  luckyCount: number;
  isSwiss?: boolean;
  pairingTBD?: boolean;
  isGroupStage?: boolean;
  roomGroups?: string[];
  matches?: GroupStageMatch[];
  groupByes?: string[];
  numGames?: number;
  bracket?: BracketKey;
  winnersTo?: number | null;
  losersTo?: number | null;
  bracketPhaseFirstRound?: boolean;
  wbFinalistName?: string;
  isKingsValley?: boolean;
  kvPromoteCounts?: number[];
  kvDemoteCounts?: number[];
  kvEliminateCount?: number;
}

export interface RoundAssignment {
  name: string;
  room: number | null;
  isLucky?: boolean;
}

/** A double-elimination route before it is assigned to a physical room. */
export interface PendingBracketSeed {
  name: string;
  isLucky?: boolean;
}

export interface TournamentStanding {
  name: string;
  totalFP: number | null;
  totalScore: number;
  played: number;
}

export interface TournamentGroup {
  label: string;
  members: string[];
}

export interface DefenderChange {
  round: number;
  memberIdx: number;
}

export interface GeneratedTournamentConfig {
  n: number;
  poolingPhase: PoolingPhaseKey;
  qualAdv: number;
  groupSize: number;
  roundRobinMode: RoundRobinMode;
  qualifiersPerGroup: number;
  scoring: ScoringSystemKey;
  finalsGames: number;
  semisGames: number;
}

export interface MaterializedGamemodeConfig {
  qualRounds: number;
  swissRounds: number;
  teamScoringRule: TeamScoringRuleKey;
  oddCountStrategy?: OddCountStrategyKey;
  roomSize: RoomSize;
  semisSize: number;
  finalSize: number;
  lbQualifiers?: number;
  poolingPhase: PoolingPhaseKey;
  bracketPhase: ScheduleLogicKey;
  finalsGames: number;
  semisGames: number;
  grandFinalWbTarget: number;
  grandFinalLbTarget: number;
  groupSize: number;
  roundRobinMode: RoundRobinMode;
  qualifiersPerGroup: number;
}

export interface TournamentState {
  title: string;
  players: TournamentRoster;
  reserves: TournamentRoster;
  reserveIndividuals: TeamMember[];
  confirmedCount: number | null;
  tournamentId: string | null;
  rounds: TournamentRound[];
  curRound: number;
  scores: Record<string, number | null>;
  finalScores: Record<string, number | '' | null>;
  assignments: RoundAssignment[][];
  luckyLosers: string[][];
  byes: string[][];
  poolingByeCounts: Record<string, number>;
  pendingBracketSeeds: Record<string, PendingBracketSeed[]>;
  qualTable: TournamentStanding[];
  groups: TournamentGroup[];
  groupStandings: Record<string, TournamentStanding[]>;
  tieResolutions: Record<string, string | string[]>;
  defenderChanges: Record<string, DefenderChange[]>;
  reserveOpen: boolean;
  started: boolean;
  needsSave: boolean;
  autoSaved: boolean;
  cfg: Partial<GeneratedTournamentConfig>;
  scheduleLogic: ScheduleLogicKey;
  gameFormat: GameFormatKey;
  gamemodeConfig: Partial<MaterializedGamemodeConfig>;
}

export interface PersistedSetup {
  scheduleLogic: ScheduleLogicKey;
  gameFormat: GameFormatKey;
  scoring: ScoringSystemKey;
  poolingPhase: PoolingPhaseKey;
  qualAdv: string;
  groupSize: string;
  roundRobinMode: RoundRobinMode;
  qualifiersPerGroup: string;
  finalsGames: string;
  semisGames: string;
  grandFinalWbTarget: string;
  grandFinalLbTarget: string;
  semisOverride: string;
  finalOverride: string;
  oddCountStrategy: OddCountStrategyKey | '';
  teamScoringRule: TeamScoringRuleKey | '';
  roster: string;
  reserves: string;
  reserveIndividuals: string;
  /** Compatibility field used by saves from before poolingPhase existed. */
  qual?: 'yes' | 'no';
}

export interface PersistedTournamentEnvelope {
  T: TournamentState;
  setup: PersistedSetup;
  activeTab: ActiveTab;
}
