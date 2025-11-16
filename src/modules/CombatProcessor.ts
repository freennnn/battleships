import { WebSocket } from "ws";
import type { AttackResponse, AttackResult, Position } from "../types/combat.types.js";
import type { Game, Player } from "../types/game.types.js";
import type { Ship } from "../types/ship.types.js";
import type { ClientInfo } from "../types/user.types.js";
import { getShipCells, getSurroundingCells } from "../utils/shipUtils.js";

/**
 * Processes combat logic: damage application, ship destruction, and surrounding cell marking
 */
export class CombatProcessor {
  private clients: Map<string, ClientInfo>;

  constructor(clients: Map<string, ClientInfo>) {
    this.clients = clients;
  }

  /**
   * Process an attack on a player's board
   * @param player The player being attacked
   * @param x X coordinate of attack
   * @param y Y coordinate of attack
   * @returns Attack result with status and destroyed ship (if any)
   */
  processAttack(player: Player, x: number, y: number): AttackResult {
    // Check if cell was already attacked
    if (player.board[y][x] !== null) {
      console.log(`Cell (${x}, ${y}) already attacked with status:`, player.board[y][x]);
      return { status: "miss", ship: null };
    }

    // Check if any ship was hit
    for (const ship of player.ships) {
      const shipCells = getShipCells(ship);
      const hitCell = shipCells.find((cell) => cell.x === x && cell.y === y);

      if (hitCell) {
        console.log(`Ship hit! Type: ${ship.type}, Length: ${ship.length}`);

        // Mark the hit cell
        player.board[y][x] = "hit";

        // Check if ship is killed (all cells are hit)
        const isKilled = shipCells.every(
          (cell) =>
            player.board[cell.y][cell.x] === "hit" || player.board[cell.y][cell.x] === "killed"
        );

        if (isKilled) {
          console.log("Ship killed! Marking all cells as killed");
          shipCells.forEach((cell) => {
            player.board[cell.y][cell.x] = "killed";
          });
          return {
            status: "killed",
            ship: ship,
          };
        }

        // If not killed, return shot status
        return {
          status: "shot",
          ship: null,
        };
      }
    }

    // Mark cell as miss
    console.log("Miss!");
    player.board[y][x] = "miss";
    return { status: "miss", ship: null };
  }

  /**
   * Mark cells surrounding a killed ship as miss and notify clients
   * @param game The game state
   * @param ship The destroyed ship
   */
  sendSurroundingMisses(game: Game, ship: Ship): void {
    const surroundingCells = getSurroundingCells(ship);
    const targetPlayer = game.players.find((p) => p.id !== game.currentPlayerIndex);

    if (!targetPlayer) {
      console.error("Target player not found when sending surrounding misses");
      return;
    }

    // First update the board state on the server
    surroundingCells.forEach((cell) => {
      const isPartOfAnotherShip = targetPlayer.ships.some((s) => {
        if (s === ship) return false; // Don't consider the ship that was just killed
        const shipCells = getShipCells(s);
        return shipCells.some((sc) => sc.x === cell.x && sc.y === cell.y);
      });

      if (targetPlayer.board[cell.y][cell.x] === null && !isPartOfAnotherShip) {
        targetPlayer.board[cell.y][cell.x] = "miss";
      }
    });

    // Then send updates to players
    game.players.forEach((player) => {
      const client = this.clients.get(player.id);
      if (client?.ws.readyState === WebSocket.OPEN) {
        // Send the killed ship cells
        const shipCells = getShipCells(ship);
        shipCells.forEach((cell) => {
          const response = {
            type: "attack",
            data: JSON.stringify({
              position: cell,
              currentPlayer: game.currentPlayerIndex,
              status: "killed",
            } as AttackResponse),
            id: 0,
          };
          client.ws.send(JSON.stringify(response));
        });

        // Send the actual state of all surrounding cells
        surroundingCells.forEach((cell) => {
          const currentCellState = targetPlayer.board[cell.y][cell.x];
          // Only send updates for cells with defined state
          if (currentCellState !== null) {
            const response = {
              type: "attack",
              data: JSON.stringify({
                position: cell,
                currentPlayer: game.currentPlayerIndex,
                status: currentCellState,
              } as AttackResponse),
              id: 0,
            };
            client.ws.send(JSON.stringify(response));
          }
        });
      }
    });
  }

  /**
   * Find a random unattacked cell on the target player's board
   * @param targetPlayer The player whose board to attack
   * @returns Position of random unattacked cell
   */
  findRandomAttackPosition(targetPlayer: Player): Position {
    let x: number;
    let y: number;

    do {
      x = Math.floor(Math.random() * 10);
      y = Math.floor(Math.random() * 10);
    } while (targetPlayer.board[y][x] !== null);

    return { x, y };
  }
}
