import type {
  GameFormatDefinition,
  GameFormatKey,
  ImplementedGameFormatKey,
  OddCountStrategyKey,
  RoomSize,
} from "./types";

export const GAME_FORMATS: Readonly<
  Record<ImplementedGameFormatKey, Readonly<GameFormatDefinition>>
> = {
  "ffa-individual": {
    key: "ffa-individual",
    label: "FFA — Individual",
    unitLabel: "Player",
    unitLabelPlural: "Players",
    defaultRoomSize: { min: 6, max: 8, ideal: 8 },
  },
  "team-2v2v2v2": {
    key: "team-2v2v2v2",
    label: "2v2v2v2",
    unitLabel: "Team",
    unitLabelPlural: "Teams",
    teamSize: 2,
    defaultRoomSize: { min: 3, max: 4, ideal: 4 },
  },
  "team-3v3v3": {
    key: "team-3v3v3",
    label: "3v3v3",
    unitLabel: "Team",
    unitLabelPlural: "Teams",
    teamSize: 3,
    defaultRoomSize: { min: 2, max: 3, ideal: 3 },
  },
  "team-3v3": {
    key: "team-3v3",
    label: "3v3",
    unitLabel: "Team",
    unitLabelPlural: "Teams",
    teamSize: 3,
    idealRoomSize: 2,
    supportedOddCountStrategies: ["none", "bye", "flex"],
  },
  "individual-1v1": {
    key: "individual-1v1",
    label: "1v1",
    unitLabel: "Player",
    unitLabelPlural: "Players",
    idealRoomSize: 2,
    supportedOddCountStrategies: ["none", "bye"],
  },
};

export const TEAM_SCORING_RULE_LABELS = {
  "sum-members": "Sum of all members",
  "designated-player": "Save your Buddy (defender only)",
} as const;

export const ODD_COUNT_STRATEGY_LABELS = {
  none: "None — strict, refuse to generate on an odd count",
  bye: "Bye — a team can sit out a round when needed",
  flex: "Flex — a room can occasionally hold one extra team",
} as const;

export function getGameFormat(
  key: GameFormatKey,
): Readonly<GameFormatDefinition> | undefined {
  if (key === "last-man-standing") return undefined;
  return GAME_FORMATS[key];
}

export function deriveRoomSize(
  format: Readonly<GameFormatDefinition>,
  oddCountStrategy?: OddCountStrategyKey,
): RoomSize {
  if (format.defaultRoomSize) return { ...format.defaultRoomSize };
  const ideal = format.idealRoomSize;
  if (ideal === undefined) {
    throw new Error(`Format ${format.key} has no room-size definition.`);
  }
  if (oddCountStrategy === "flex") {
    return { min: ideal, max: ideal + 1, ideal };
  }
  return { min: ideal, max: ideal, ideal };
}
