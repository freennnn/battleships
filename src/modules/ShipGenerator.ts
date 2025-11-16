import type { Ship } from "../types/ship.types.js";
import { BOARD_SIZE, SHIP_CONFIGS } from "../types/ship.types.js";
import { getShipCells } from "../utils/shipUtils.js";

type BoardCell = null | "ship";

/**
 * Generates random ship placements for bot players
 */
export class ShipGenerator {
  /**
   * Generate a valid random ship configuration for bot
   */
  generateBotShips(): Ship[] {
    const ships: Ship[] = [];
    const board: BoardCell[][] = Array(BOARD_SIZE)
      .fill(null)
      .map(() => Array(BOARD_SIZE).fill(null));

    for (const shipConfig of SHIP_CONFIGS) {
      for (let i = 0; i < shipConfig.count; i++) {
        const newShip = this.generateSingleShip(shipConfig.type, shipConfig.length, board);
        ships.push(newShip);

        // Mark ship cells on board
        const shipCells = getShipCells(newShip);
        shipCells.forEach((cell) => {
          board[cell.y][cell.x] = "ship";
        });
      }
    }

    this.logBoardState(board);
    return ships;
  }

  /**
   * Generate a single ship that doesn't overlap or touch other ships
   */
  private generateSingleShip(type: string, length: number, board: BoardCell[][]): Ship {
    let validPosition = false;
    let ship: Ship | undefined;

    while (!validPosition) {
      // Random position and direction
      const x = Math.floor(Math.random() * BOARD_SIZE);
      const y = Math.floor(Math.random() * BOARD_SIZE);
      const direction = Math.random() < 0.5;

      ship = {
        position: { x, y },
        direction,
        length,
        type: type as any,
      };

      const shipCells = getShipCells(ship);

      // Check 1: Ship fits on board
      const fitsOnBoard = shipCells.every(
        (cell) => cell.x >= 0 && cell.x < BOARD_SIZE && cell.y >= 0 && cell.y < BOARD_SIZE
      );
      if (!fitsOnBoard) continue;

      // Check 2: No direct overlap
      const overlaps = shipCells.some((cell) => board[cell.y][cell.x] === "ship");
      if (overlaps) continue;

      // Check 3: No adjacency (including diagonals)
      const isAdjacent = this.isAdjacentToExistingShips(shipCells, board);
      if (isAdjacent) continue;

      // All checks passed
      validPosition = true;
    }

    // Ship is guaranteed to be defined here since we only exit the loop when valid
    if (!ship) {
      throw new Error("Failed to generate valid ship position");
    }

    return ship;
  }

  /**
   * Check if ship cells are adjacent to any existing ships
   */
  private isAdjacentToExistingShips(shipCells: any[], board: BoardCell[][]): boolean {
    for (const cell of shipCells) {
      // Check all 8 surrounding cells
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const checkX = cell.x + dx;
          const checkY = cell.y + dy;

          // Skip if out of bounds
          if (checkX < 0 || checkX >= BOARD_SIZE || checkY < 0 || checkY >= BOARD_SIZE) {
            continue;
          }

          // If there's a ship in an adjacent cell, fail
          if (board[checkY][checkX] === "ship") {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Log the board state for debugging
   */
  private logBoardState(board: BoardCell[][]): void {
    console.log("\n=== Bot's Initial Board State (with no-adjacency) ===");
    console.log(
      "  " +
        Array(BOARD_SIZE)
          .fill(0)
          .map((_, i) => i)
          .join(" ")
    );
    board.forEach((row, y) => {
      console.log(`${y} ${row.map((cell) => (cell === "ship" ? "S" : ".")).join(" ")}`);
    });
    console.log("=== End Bot's Board State ===\n");
  }
}
