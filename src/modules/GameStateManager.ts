import { WebSocket } from "ws";
import type { Game, GameFinishData, Player, TurnData } from "../types/game.types.js";
import type { ClientInfo } from "../types/user.types.js";
import { getShipCells } from "../utils/shipUtils.js";
import type { BroadcastService } from "./BroadcastService.js";
import type { UserManager } from "./UserManager.js";

/**
 * Manages game state: checking game over conditions and ending games
 */
export class GameStateManager {
  private games: Map<string, Game>;
  private clients: Map<string, ClientInfo>;
  private userManager: UserManager;
  private broadcastService: BroadcastService;
  private botId: string;

  constructor(
    games: Map<string, Game>,
    clients: Map<string, ClientInfo>,
    userManager: UserManager,
    broadcastService: BroadcastService,
    botId: string
  ) {
    this.games = games;
    this.clients = clients;
    this.userManager = userManager;
    this.broadcastService = broadcastService;
    this.botId = botId;
  }

  /**
   * Check if all ships of a player are destroyed
   */
  checkGameOver(player: Player): boolean {
    console.log("\n=== Checking Game Over ===");
    console.log("Player:", player.name);

    const isGameOver = player.ships.every((ship) => {
      const shipCells = getShipCells(ship);
      const isShipDestroyed = shipCells.every((cell) => player.board[cell.y][cell.x] === "killed");
      console.log(`Ship ${ship.type} destroyed:`, isShipDestroyed);
      return isShipDestroyed;
    });

    console.log("\nGame over:", isGameOver);
    console.log("=== End Game Over Check ===\n");
    return isGameOver;
  }

  /**
   * End game and declare winner
   */
  endGame(game: Game, winnerId: string): void {
    try {
      console.log(`Game ${game.id} ending, winner: ${winnerId}`);

      // Update winner's stats
      const winnerClient = this.clients.get(winnerId);
      if (winnerClient?.username) {
        this.userManager.incrementWins(winnerClient.username);
      } else if (winnerId === this.botId) {
        console.log("Bot won the game.");
      } else {
        console.error(`Winner client not found or username missing for winnerId: ${winnerId}`);
      }

      // Notify all players
      game.players.forEach((player) => {
        const client = this.clients.get(player.id);
        if (client?.ws.readyState === WebSocket.OPEN) {
          // Send finish message
          const response = {
            type: "finish",
            data: JSON.stringify({
              winPlayer: winnerId,
            } as GameFinishData),
            id: 0,
          };
          client.ws.send(JSON.stringify(response));

          // Send final turn message (null = game over)
          const turnResponse = {
            type: "turn",
            data: JSON.stringify({
              currentPlayer: null,
            } as TurnData),
            id: 0,
          };
          client.ws.send(JSON.stringify(turnResponse));
        }
      });

      // Broadcast winners update to all clients
      this.broadcastService.broadcastWinnersUpdate();

      // Clean up game
      this.games.delete(game.id);

      console.log(`Game ${game.id} finished, winner: ${winnerId}`);
    } catch (err) {
      console.error(`Error ending game ${game.id}:`, err);
    }
  }

  /**
   * Handle player disconnection during game
   * Declares the other player as winner
   */
  handlePlayerDisconnectFromGame(clientId: string): void {
    this.games.forEach((game, gameId) => {
      const playerInGame = game.players.find((p) => p.id === clientId);
      if (playerInGame) {
        // Find the other player
        const otherPlayer = game.players.find((p) => p.id !== clientId);
        if (otherPlayer) {
          console.log(
            `Player ${clientId} disconnected during game ${gameId}. Declaring ${otherPlayer.id} as winner.`
          );
          this.endGame(game, otherPlayer.id);
        } else {
          // Case for single player game where bot is the other player
          console.log(`Player ${clientId} disconnected from single player game ${gameId}.`);
          this.games.delete(gameId);
        }
      }
    });
  }
}
