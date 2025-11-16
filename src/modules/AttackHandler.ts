import { WebSocket } from "ws";
import type { AttackData, AttackResponse, RandomAttackData } from "../types/combat.types.js";
import type { Game } from "../types/game.types.js";
import type { WebSocketMessage } from "../types/message.types.js";
import type { ClientInfo } from "../types/user.types.js";
import type { CombatProcessor } from "./CombatProcessor.js";
import type { GameStateManager } from "./GameStateManager.js";

/**
 * Handles attack-related WebSocket messages and orchestrates combat flow
 */
export class AttackHandler {
  private games: Map<string, Game>;
  private clients: Map<string, ClientInfo>;
  private combatProcessor: CombatProcessor;
  private gameStateManager: GameStateManager;
  private botId: string;
  private makeBotMoveCallback: ((game: Game) => void) | null = null;

  constructor(
    games: Map<string, Game>,
    clients: Map<string, ClientInfo>,
    combatProcessor: CombatProcessor,
    gameStateManager: GameStateManager,
    botId: string
  ) {
    this.games = games;
    this.clients = clients;
    this.combatProcessor = combatProcessor;
    this.gameStateManager = gameStateManager;
    this.botId = botId;
  }

  /**
   * Set callback for when bot should make a move
   */
  setMakeBotMoveCallback(callback: (game: Game) => void): void {
    this.makeBotMoveCallback = callback;
  }

  /**
   * Handle attack message from client
   */
  handleAttack(_ws: WebSocket, data: WebSocketMessage, clientId: string): void {
    try {
      // Parse attack data
      let attackData: AttackData;
      try {
        attackData = typeof data.data === "string" ? JSON.parse(data.data) : data.data;
      } catch (parseError) {
        console.error(`Failed to parse attack data from ${clientId}:`, parseError);
        return;
      }

      const { gameId, x, y, indexPlayer } = attackData;
      const game = this.games.get(gameId);

      if (!game) {
        console.log(`Game ${gameId} not found`);
        return;
      }

      // Check if it's the player's turn
      if (game.currentPlayerIndex !== indexPlayer) {
        console.log(`Not player ${indexPlayer}'s turn in game ${gameId}`);
        return;
      }

      // Get target player
      const targetPlayer = game.players.find((p) => p.id !== indexPlayer);
      if (!targetPlayer) {
        console.log(`Target player not found in game ${gameId}`);
        return;
      }

      console.log(`\n=== Attack by ${indexPlayer} at (${x}, ${y}) ===`);

      // Process the attack
      const attackResult = this.combatProcessor.processAttack(targetPlayer, x, y);

      console.log(`Attack result:`, attackResult);

      // Notify all players of the attack
      this.broadcastAttackResult(game, { x, y }, indexPlayer, attackResult.status);

      // Handle different attack results
      if (attackResult.status === "killed" && attackResult.ship) {
        this.handleShipKilled(game, attackResult.ship, indexPlayer, targetPlayer);
      } else if (attackResult.status === "shot") {
        console.log(`Ship hit at (${x}, ${y})`);
        game.lastHit = { x, y };
      } else if (attackResult.status === "miss") {
        // Switch turns on miss
        game.currentPlayerIndex = targetPlayer.id;
      }

      // Send turn information to all players
      this.broadcastTurnUpdate(game);

      // If next player is bot, trigger bot move
      if (game.currentPlayerIndex === this.botId && this.makeBotMoveCallback) {
        setTimeout(() => this.makeBotMoveCallback?.(game), 1000);
      }

      console.log(`Attack processed for player ${indexPlayer} in game ${gameId}`);
    } catch (err) {
      console.error(`Error processing attack for player ${clientId}:`, err);
    }
  }

  /**
   * Handle random attack request
   */
  handleRandomAttack(ws: WebSocket, data: WebSocketMessage, clientId: string): void {
    try {
      // Parse random attack data
      let randomAttackData: RandomAttackData;
      try {
        randomAttackData = typeof data.data === "string" ? JSON.parse(data.data) : data.data;
      } catch (parseError) {
        console.error(`Failed to parse random attack data from ${clientId}:`, parseError);
        return;
      }

      const { gameId, indexPlayer } = randomAttackData;
      const game = this.games.get(gameId);

      if (!game) {
        console.log(`Game ${gameId} not found`);
        return;
      }

      // Check if it's the player's turn
      if (game.currentPlayerIndex !== indexPlayer) {
        console.log(`Not player ${indexPlayer}'s turn in game ${gameId}`);
        return;
      }

      // Get target player
      const targetPlayer = game.players.find((p) => p.id !== indexPlayer);
      if (!targetPlayer) {
        console.log(`Target player not found in game ${gameId}`);
        return;
      }

      // Find random unattacked cell
      const { x, y } = this.combatProcessor.findRandomAttackPosition(targetPlayer);

      // Process the random attack by calling handleAttack
      const attackRequest = {
        gameId,
        x,
        y,
        indexPlayer,
      };

      this.handleAttack(
        ws,
        { type: "attack", data: JSON.stringify(attackRequest), id: 0 },
        clientId
      );

      console.log(`Random attack processed for player ${indexPlayer} in game ${gameId}`);
    } catch (err) {
      console.error(`Error processing random attack for player ${clientId}:`, err);
    }
  }

  /**
   * Handle ship being killed
   */
  private handleShipKilled(game: Game, ship: any, attackerId: string, targetPlayer: any): void {
    console.log(`Ship killed`);
    this.combatProcessor.sendSurroundingMisses(game, ship);
    game.lastHit = null;

    // Check if game is over
    if (this.gameStateManager.checkGameOver(targetPlayer)) {
      console.log(`Game over detected for player ${targetPlayer.name}`);
      this.gameStateManager.endGame(game, attackerId);
    }
  }

  /**
   * Broadcast attack result to all players
   */
  private broadcastAttackResult(
    game: Game,
    position: { x: number; y: number },
    attackerId: string,
    status: string
  ): void {
    game.players.forEach((player) => {
      const client = this.clients.get(player.id);
      if (client?.ws.readyState === WebSocket.OPEN) {
        const response = {
          type: "attack",
          data: JSON.stringify({
            position,
            currentPlayer: attackerId,
            status,
          } as AttackResponse),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));
      }
    });
  }

  /**
   * Broadcast turn update to all players
   */
  private broadcastTurnUpdate(game: Game): void {
    game.players.forEach((player) => {
      const client = this.clients.get(player.id);
      if (client?.ws.readyState === WebSocket.OPEN) {
        const turnResponse = {
          type: "turn",
          data: JSON.stringify({
            currentPlayer: game.currentPlayerIndex,
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(turnResponse));
      }
    });
  }
}
