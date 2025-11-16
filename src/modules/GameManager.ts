import { WebSocket } from "ws";
import type { Board, CreateGameData, Game, StartGameData } from "../types/game.types.js";
import { BOARD_SIZE } from "../types/game.types.js";
import type { Room } from "../types/room.types.js";
import type { ClientInfo } from "../types/user.types.js";
import type { ShipGenerator } from "./ShipGenerator.js";

/**
 * Manages game lifecycle: creation, initialization, and starting games
 */
export class GameManager {
  private games: Map<string, Game>;
  private clients: Map<string, ClientInfo>;
  private shipGenerator: ShipGenerator;
  private botId: string;

  constructor(
    games: Map<string, Game>,
    clients: Map<string, ClientInfo>,
    shipGenerator: ShipGenerator,
    botId: string
  ) {
    this.games = games;
    this.clients = clients;
    this.shipGenerator = shipGenerator;
    this.botId = botId;
  }

  /**
   * Create a multiplayer game from a full room
   */
  createGame(room: Room): void {
    try {
      const gameId = Date.now().toString();

      const game: Game = {
        id: gameId,
        players: room.users.map((user) => ({
          id: user.index,
          name: user.name,
          ships: [],
          board: this.createEmptyBoard(),
          ready: false,
          isBot: false,
        })),
        currentPlayerIndex: room.users[0].index,
        lastHit: null,
      };

      this.games.set(gameId, game);

      // Notify both players
      room.users.forEach((user) => {
        const client = this.clients.get(user.index);
        if (client?.ws.readyState === WebSocket.OPEN) {
          const response = {
            type: "create_game",
            data: JSON.stringify({
              idGame: gameId,
              idPlayer: user.index,
            } as CreateGameData),
            id: 0,
          };
          client.ws.send(JSON.stringify(response));
        }
      });

      console.log(`Game ${gameId} created for room ${room.id}`);
    } catch (err) {
      console.error(`Error creating game for room ${room.id}:`, err);
    }
  }

  /**
   * Create a single player game with bot
   */
  createSinglePlayerGame(clientId: string): void {
    try {
      const gameId = Date.now().toString();
      const client = this.clients.get(clientId);

      if (!client?.username) {
        console.log(`Client ${clientId} not found or not registered with a username`);
        return;
      }

      const game: Game = {
        id: gameId,
        players: [
          {
            id: clientId,
            name: client.username,
            ships: [],
            board: this.createEmptyBoard(),
            ready: false,
            isBot: false,
          },
          {
            id: this.botId,
            name: "Bot",
            ships: this.shipGenerator.generateBotShips(),
            board: this.createEmptyBoard(),
            ready: true,
            isBot: true,
          },
        ],
        currentPlayerIndex: clientId,
        lastHit: null,
      };

      this.games.set(gameId, game);

      // Notify player
      if (client.ws.readyState === WebSocket.OPEN) {
        const response = {
          type: "create_game",
          data: JSON.stringify({
            idGame: gameId,
            idPlayer: clientId,
          } as CreateGameData),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));
      }

      console.log(
        `Single player game ${gameId} created for player ${client.username} (Client ID: ${clientId})`
      );
    } catch (err) {
      console.error(`Error creating single player game for ${clientId}:`, err);
    }
  }

  /**
   * Start game when both players are ready
   */
  startGame(game: Game): void {
    try {
      game.players.forEach((player) => {
        const client = this.clients.get(player.id);
        if (client?.ws.readyState === WebSocket.OPEN) {
          // Send start game message
          const response = {
            type: "start_game",
            data: JSON.stringify({
              ships: player.ships,
              currentPlayerIndex: game.currentPlayerIndex,
            } as StartGameData),
            id: 0,
          };
          client.ws.send(JSON.stringify(response));

          // Send turn information
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

      console.log(`Game ${game.id} started`);
    } catch (err) {
      console.error(`Error starting game ${game.id}:`, err);
    }
  }

  /**
   * Get a game by ID
   */
  getGame(gameId: string): Game | undefined {
    return this.games.get(gameId);
  }

  /**
   * Create an empty game board
   */
  private createEmptyBoard(): Board {
    return Array(BOARD_SIZE)
      .fill(null)
      .map(() => Array(BOARD_SIZE).fill(null)) as Board;
  }
}
