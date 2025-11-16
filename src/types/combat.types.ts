import type { Ship } from "./ship.types.js";

export interface Position {
  x: number;
  y: number;
}

export type AttackStatus = "miss" | "shot" | "killed";

export interface AttackData {
  gameId: string;
  x: number;
  y: number;
  indexPlayer: string;
}

export interface RandomAttackData {
  gameId: string;
  indexPlayer: string;
}

export interface AttackResult {
  status: AttackStatus;
  ship: Ship | null;
}

export interface AttackResponse {
  position: Position;
  currentPlayer: string;
  status: AttackStatus | string;
}
