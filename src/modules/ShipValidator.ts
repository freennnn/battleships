import type { Ship, ShipType } from "../types/ship.types.js";
import {
  BOARD_SIZE,
  EXPECTED_SHIP_COUNTS,
  SHIP_TYPE_LENGTH,
  TOTAL_SHIPS,
} from "../types/ship.types.js";
import { getShipCells } from "../utils/shipUtils.js";

/**
 * Validates ship configurations for the game
 */
export class ShipValidator {
  /**
   * Validate an array of ships for a player
   */
  validateShips(ships: unknown): ships is Ship[] {
    // Check if it's an array
    if (!Array.isArray(ships)) {
      console.log("Ships validation failed: not an array");
      return false;
    }

    // Check total count
    if (ships.length !== TOTAL_SHIPS) {
      console.log(`Ships validation failed: expected ${TOTAL_SHIPS} ships, got ${ships.length}`);
      return false;
    }

    // Validate each ship individually
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i];
      if (!this.validateSingleShip(ship)) {
        console.log(`Ships validation failed: ship at index ${i} is invalid`);
        return false;
      }
    }

    // Check ship type counts
    if (!this.validateShipCounts(ships)) {
      console.log("Ships validation failed: incorrect ship type counts");
      return false;
    }

    return true;
  }

  /**
   * Validate a single ship structure
   */
  private validateSingleShip(ship: any): ship is Ship {
    // Check required fields exist
    if (
      !ship.position ||
      typeof ship.position.x !== "number" ||
      typeof ship.position.y !== "number"
    ) {
      return false;
    }

    if (typeof ship.direction !== "boolean") {
      return false;
    }

    if (typeof ship.length !== "number") {
      return false;
    }

    if (!ship.type || typeof ship.type !== "string") {
      return false;
    }

    // Check ship type is valid
    if (!this.isValidShipType(ship.type)) {
      return false;
    }

    // Check ship length matches type
    if (ship.length !== SHIP_TYPE_LENGTH[ship.type as ShipType]) {
      return false;
    }

    // Check ship fits on board
    const cells = getShipCells(ship as Ship);
    for (const cell of cells) {
      if (cell.x < 0 || cell.x >= BOARD_SIZE || cell.y < 0 || cell.y >= BOARD_SIZE) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a string is a valid ship type
   */
  private isValidShipType(type: string): type is ShipType {
    return ["small", "medium", "large", "huge"].includes(type);
  }

  /**
   * Validate that the correct number of each ship type is present
   */
  private validateShipCounts(ships: Ship[]): boolean {
    const shipCounts: Record<ShipType, number> = {
      small: 0,
      medium: 0,
      large: 0,
      huge: 0,
    };

    // Count ships by type
    for (const ship of ships) {
      shipCounts[ship.type]++;
    }

    // Check counts match expected
    for (const [type, expectedCount] of Object.entries(EXPECTED_SHIP_COUNTS)) {
      if (shipCounts[type as ShipType] !== expectedCount) {
        console.log(`Expected ${expectedCount} ${type} ships, got ${shipCounts[type as ShipType]}`);
        return false;
      }
    }

    return true;
  }
}
