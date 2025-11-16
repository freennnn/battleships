import type { Ship, ShipCell } from "../types/ship.types.js";

/**
 * Get all cells occupied by a ship
 */
export function getShipCells(ship: Ship): ShipCell[] {
  const cells: ShipCell[] = [];
  for (let i = 0; i < ship.length; i++) {
    cells.push({
      x: ship.direction ? ship.position.x : ship.position.x + i,
      y: ship.direction ? ship.position.y + i : ship.position.y,
    });
  }
  return cells;
}

/**
 * Get all cells surrounding a ship (including diagonals)
 * Used for marking cells as miss when ship is killed
 */
export function getSurroundingCells(ship: Ship): ShipCell[] {
  const cells: ShipCell[] = [];
  const shipCells = getShipCells(ship);

  for (const cell of shipCells) {
    // Check all 8 surrounding cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cell.x + dx;
        const y = cell.y + dy;

        // Skip if out of bounds
        if (x < 0 || x >= 10 || y < 0 || y >= 10) continue;

        // Skip if it's a ship cell
        if (shipCells.some((sc) => sc.x === x && sc.y === y)) continue;

        // Add cell if not already added
        if (!cells.some((c) => c.x === x && c.y === y)) {
          cells.push({ x, y });
        }
      }
    }
  }

  return cells;
}

/**
 * Check if a ship fits on the board
 */
export function shipFitsOnBoard(ship: Ship, boardSize = 10): boolean {
  const cells = getShipCells(ship);
  return cells.every(
    (cell) => cell.x >= 0 && cell.x < boardSize && cell.y >= 0 && cell.y < boardSize
  );
}

/**
 * Check if two ships overlap
 */
export function shipsOverlap(ship1: Ship, ship2: Ship): boolean {
  const cells1 = getShipCells(ship1);
  const cells2 = getShipCells(ship2);

  return cells1.some((c1) => cells2.some((c2) => c1.x === c2.x && c1.y === c2.y));
}

/**
 * Check if two ships are adjacent (including diagonally)
 */
export function shipsAreAdjacent(ship1: Ship, ship2: Ship): boolean {
  const surrounding = getSurroundingCells(ship1);
  const cells2 = getShipCells(ship2);

  // Check if any cell of ship2 is in the surrounding cells of ship1
  return cells2.some((c2) => surrounding.some((sc) => sc.x === c2.x && sc.y === c2.y));
}
