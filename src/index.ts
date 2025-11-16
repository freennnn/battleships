import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { AttackHandler } from "./modules/AttackHandler.js";
import { AuthHandler } from "./modules/AuthHandler.js";
import { BroadcastService } from "./modules/BroadcastService.js";
import { CombatProcessor } from "./modules/CombatProcessor.js";
import { GameManager } from "./modules/GameManager.js";
import { GameStateManager } from "./modules/GameStateManager.js";
import { RoomHandler } from "./modules/RoomHandler.js";
import { RoomManager } from "./modules/RoomManager.js";
import { ShipGenerator } from "./modules/ShipGenerator.js";
import { ShipValidator } from "./modules/ShipValidator.js";
import { UserManager } from "./modules/UserManager.js";
import type { Game } from "./types/game.types.js";
import { BOT_ID } from "./types/game.types.js";
import type { WebSocketMessage } from "./types/message.types.js";
import type { ClientInfo } from "./types/user.types.js";

// Create HTTP server, needed for websocket client to handle HTTP 101 - switching protocol
const server = http.createServer((_req, res) => {
  // Handle HTTP requests if needed
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  noServer: true, // potential middleware - on('upgrade' event), e.g. JWT token verification
  clientTracking: true, // to broadcast messages to all clientwss.clients.forEach()
  perMessageDeflate: false, // message compression is off since ours are small
});

const userManager = new UserManager();
const clients = new Map<string, ClientInfo>();
const games = new Map<string, Game>();
const authHandler = new AuthHandler(userManager, clients);
const broadcastService = new BroadcastService(wss, userManager);
const roomManager = new RoomManager();
const roomHandler = new RoomHandler(roomManager, clients);
const shipValidator = new ShipValidator();
const shipGenerator = new ShipGenerator();
const gameManager = new GameManager(games, clients, shipGenerator, BOT_ID);
const gameStateManager = new GameStateManager(
  games,
  clients,
  userManager,
  broadcastService,
  BOT_ID
);
const combatProcessor = new CombatProcessor(clients);
const attackHandler = new AttackHandler(games, clients, combatProcessor, gameStateManager, BOT_ID);

// Connect room handler to broadcast service
broadcastService.setRoomHandler(roomHandler);

// Set callback for when room becomes full (triggers game creation)
roomHandler.setRoomFullCallback((room) => {
  gameManager.createGame(room);
});

// Set callback for bot moves
attackHandler.setMakeBotMoveCallback((game) => makeBotMove(game));

// Handle new connections
wss.on("connection", (ws: WebSocket, _req) => {
  const clientId = Date.now().toString();
  console.log(`New client connected: ${clientId}`);

  // Store client with its state
  clients.set(clientId, {
    ws,
    username: null,
    isAlive: true,
    lastActivity: Date.now(),
    roomId: null,
  });

  // Send current winners list to new client
  broadcastService.sendWinnersUpdate(ws);

  // Set keep-alive
  (ws as any).isAlive = true;
  ws.on("pong", () => {
    const client = clients.get(clientId);
    if (client) {
      client.isAlive = true;
      client.lastActivity = Date.now();
    }
  });

  // Send immediate confirmation of connection
  try {
    ws.send(
      JSON.stringify({
        type: "connection",
        status: "connected",
        id: clientId,
      })
    );
  } catch (err) {
    console.error("Error sending connection confirmation:", err);
  }

  // Handle incoming messages
  ws.on("message", (message) => {
    try {
      const client = clients.get(clientId);
      if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
        console.log(`Client ${clientId} is not ready to receive messages`);
        return;
      }

      console.log(`Raw message from ${clientId}:`, message.toString());
      const data: WebSocketMessage = JSON.parse(message.toString());
      console.log(`Parsed message from ${clientId}:`, data);

      // Update last activity
      client.lastActivity = Date.now();

      // Handle different message types
      switch (data.type) {
        case "reg": {
          authHandler.handleRegistration(ws, data, clientId);
          // Broadcast winners update to all clients if it was a new registration
          const registeredClient = clients.get(clientId);
          if (registeredClient?.username && userManager.userExists(registeredClient.username)) {
            broadcastService.broadcastWinnersUpdate();
          }
          break;
        }
        case "create_room":
          roomHandler.handleCreateRoom(clientId);
          broadcastService.broadcastRoomUpdate();
          break;
        case "add_user_to_room":
          roomHandler.handleAddUserToRoom(data, clientId);
          broadcastService.broadcastRoomUpdate();
          break;
        case "add_ships":
          handleAddShips(ws, data, clientId);
          break;
        case "attack":
          attackHandler.handleAttack(ws, data, clientId);
          break;
        case "randomAttack":
          attackHandler.handleRandomAttack(ws, data, clientId);
          break;
        case "single_play":
          gameManager.createSinglePlayerGame(clientId);
          break;
        default:
          console.log(`Unknown message type from ${clientId}:`, data.type);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Unknown message type",
              })
            );
          }
      }
    } catch (err) {
      console.error(`Error processing message from ${clientId}:`, err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Invalid message format",
          })
        );
      }
    }
  });

  // Handle client errors
  ws.on("error", (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
  });

  // Handle client disconnection
  ws.on("close", () => {
    console.log(`Client ${clientId} disconnected`);
    const client = clients.get(clientId);
    if (client) {
      // If client was in a room, remove them and update room state
      const wasInRoom = roomHandler.handleUserDisconnect(clientId);
      if (wasInRoom) {
        broadcastService.broadcastRoomUpdate();
      }

      // Handle active games - find and end any games this player is in
      gameStateManager.handlePlayerDisconnectFromGame(clientId);

      client.isAlive = false;
      clients.delete(clientId);
    }
  });
});

// Handle upgrade requests (http 101 - switching protocol) - conceptually analog of Middleware
// we don't actually use it, all connections are enabled and established immediately
server.on("upgrade", (request, socket, head) => {
  // potential custom logic here (auth, validation, etc.)
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// Handle adding ships
function handleAddShips(ws: WebSocket, data: any, clientId: string) {
  try {
    // Parse ships data
    let shipsData: any;
    try {
      shipsData = typeof data.data === "string" ? JSON.parse(data.data) : data.data;
    } catch (parseError) {
      console.error(`Failed to parse ships data from ${clientId}:`, parseError);
      return;
    }

    const { gameId, ships, indexPlayer } = shipsData;
    const game = games.get(gameId);

    if (!game) {
      console.log(`Game ${gameId} not found`);
      return;
    }

    const player = game.players.find((p: any) => p.id === indexPlayer);
    if (!player) {
      console.log(`Player ${indexPlayer} not found in game ${gameId}`);
      return;
    }

    // Validate ships
    if (!shipValidator.validateShips(ships)) {
      console.log(`Invalid ships configuration from player ${indexPlayer}`);
      return;
    }

    // Add ships to player's board
    player.ships = ships;
    player.ready = true;

    // Check if both players are ready
    if (game.players.every((p: any) => p.ready)) {
      gameManager.startGame(game);
    } else {
      // Notify player that their ships were received
      const response = {
        type: "start_game",
        data: JSON.stringify({
          ships: player.ships,
          currentPlayerIndex: game.currentPlayerIndex,
        }),
        id: 0,
      };
      ws.send(JSON.stringify(response));
    }

    console.log(`Ships added for player ${indexPlayer} in game ${gameId}`);
  } catch (err) {
    console.error(`Error adding ships for player ${clientId}:`, err);
  }
}

// Keep-alive interval
const interval = setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    const client = Array.from(clients.entries()).find(([_, c]) => c.ws === ws);
    if (client) {
      const [clientId, clientData] = client;
      if (!clientData.isAlive || now - clientData.lastActivity > 30000) {
        console.log(`Client ${clientId} timed out`);
        clients.delete(clientId);
        ws.terminate();
        return;
      }
      clientData.isAlive = false;
      ws.ping();
    }
  });
}, 30000);

// Clean up on server close
wss.on("close", () => {
  clearInterval(interval);
});

// Handle server errors
wss.on("error", (error) => {
  console.error("WebSocket server error:", error);
});

// Make bot's move
function makeBotMove(game: any) {
  try {
    const bot = game.players.find((p: any) => p.isBot);
    const targetPlayer = game.players.find((p: any) => !p.isBot);

    if (!bot || !targetPlayer) {
      console.log("Bot or target player not found");
      return;
    }

    let x: number, y: number;

    if (game.lastHit) {
      const adjacentCells = getAdjacentCells(game.lastHit.x, game.lastHit.y);
      const validCells = adjacentCells.filter(
        (cell) =>
          cell.x >= 0 &&
          cell.x < 10 &&
          cell.y >= 0 &&
          cell.y < 10 &&
          targetPlayer.board[cell.y][cell.x] === null
      );

      if (validCells.length > 0) {
        const randomCell = validCells[Math.floor(Math.random() * validCells.length)];
        x = randomCell.x;
        y = randomCell.y;
      } else {
        do {
          x = Math.floor(Math.random() * 10);
          y = Math.floor(Math.random() * 10);
        } while (targetPlayer.board[y][x] !== null);
      }
    } else {
      do {
        x = Math.floor(Math.random() * 10);
        y = Math.floor(Math.random() * 10);
      } while (targetPlayer.board[y][x] !== null);
    }

    const attackData = {
      gameId: game.id,
      x,
      y,
      indexPlayer: BOT_ID,
    };

    const client = clients.get(targetPlayer.id);
    if (client?.ws.readyState === WebSocket.OPEN) {
      attackHandler.handleAttack(
        client.ws,
        {
          type: "attack",
          data: JSON.stringify(attackData),
          id: 0,
        },
        BOT_ID
      );
    }
  } catch (err) {
    console.error("Error making bot move:", err);
  }
}

// Get adjacent cells for a position
function getAdjacentCells(x: number, y: number) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

// Start server
server.listen(3000, () => {
  console.log("Battleship WebSocket server running on port 3000");
});
