export interface Position {
  x: number;
  y: number;
}

export type ShipType = "small" | "medium" | "large" | "huge";

export interface Ship {
  position: Position;
  direction: boolean; // true = vertical, false = horizontal
  length: number;
  type: ShipType;
}

export interface ShipConfig {
  type: ShipType;
  length: number;
  count: number;
}

export interface ShipCell {
  x: number;
  y: number;
}

// Standard ship configuration for the game
export const SHIP_CONFIGS: ShipConfig[] = [
  { type: "small", length: 1, count: 4 },
  { type: "medium", length: 2, count: 3 },
  { type: "large", length: 3, count: 2 },
  { type: "huge", length: 4, count: 1 },
];

// Expected ship counts
export const EXPECTED_SHIP_COUNTS: Record<ShipType, number> = {
  small: 4,
  medium: 3,
  large: 2,
  huge: 1,
};

// Ship type to length mapping
export const SHIP_TYPE_LENGTH: Record<ShipType, number> = {
  small: 1,
  medium: 2,
  large: 3,
  huge: 4,
};

// Total number of ships required
export const TOTAL_SHIPS = 10;

// Board size
export const BOARD_SIZE = 10;
