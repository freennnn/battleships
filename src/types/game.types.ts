import type { Ship } from "./ship.types.js";

export type CellState = null | "hit" | "miss" | "killed";
export type Board = CellState[][];

export interface Player {
  id: string;
  name: string;
  ships: Ship[];
  board: Board;
  ready: boolean;
  isBot: boolean;
}

export interface Position {
  x: number;
  y: number;
}

export interface Game {
  id: string;
  players: Player[];
  currentPlayerIndex: string;
  lastHit: Position | null;
}

export interface CreateGameData {
  idGame: string;
  idPlayer: string;
}

export interface StartGameData {
  ships: Ship[];
  currentPlayerIndex: string;
}

export interface AddShipsData {
  gameId: string;
  ships: Ship[];
  indexPlayer: string;
}

export interface GameFinishData {
  winPlayer: string;
}

export interface TurnData {
  currentPlayer: string | null;
}

export const BOT_ID = "bot";
export const BOARD_SIZE = 10;
