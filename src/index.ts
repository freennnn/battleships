import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { AuthHandler } from "./modules/AuthHandler.js";
import { BroadcastService } from "./modules/BroadcastService.js";
import { RoomHandler } from "./modules/RoomHandler.js";
import { RoomManager } from "./modules/RoomManager.js";
import { UserManager } from "./modules/UserManager.js";
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
const authHandler = new AuthHandler(userManager, clients);
const broadcastService = new BroadcastService(wss, userManager);
const roomManager = new RoomManager();
const roomHandler = new RoomHandler(roomManager, clients);

// Connect room handler to broadcast service
broadcastService.setRoomHandler(roomHandler);

// Set callback for when room becomes full (triggers game creation)
roomHandler.setRoomFullCallback((room) => {
  createGame(room);
});

// Store active games
const games = new Map();

// Bot player ID
const BOT_ID = "bot";

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
          handleAttack(ws, data, clientId);
          break;
        case "randomAttack":
          handleRandomAttack(ws, data, clientId);
          break;
        case "single_play":
          createSinglePlayerGame(clientId);
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
      games.forEach((game: any, gameId: string) => {
        const playerInGame = game.players.find((p: any) => p.id === clientId);
        if (playerInGame) {
          console.log(`Player ${clientId} disconnected from active game ${gameId}`);

          // Find the other player (if not a bot)
          const otherPlayer = game.players.find((p: any) => p.id !== clientId);
          if (otherPlayer) {
            // Notify the other player that opponent disconnected
            const otherClient = clients.get(otherPlayer.id);
            if (otherClient && otherClient.ws.readyState === WebSocket.OPEN) {
              otherClient.ws.send(
                JSON.stringify({
                  type: "finish",
                  data: JSON.stringify({
                    winPlayer: otherPlayer.id,
                  }),
                  id: 0,
                })
              );
            }
          }

          // Remove the game
          games.delete(gameId);
          console.log(`Game ${gameId} ended due to player disconnection`);
        }
      });

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

// Create game when room is full
function createGame(room: any) {
  try {
    const gameId = Date.now().toString();

    // Create game state
    const game = {
      id: gameId,
      players: room.users.map((user: any) => ({
        id: user.index,
        name: user.name,
        ships: [],
        board: Array(10)
          .fill(null)
          .map(() => Array(10).fill(null)),
        ready: false,
        isBot: false,
      })),
      currentPlayerIndex: room.users[0].index,
      lastHit: null,
    };

    games.set(gameId, game);

    // Notify both players
    room.users.forEach((user: any) => {
      const client = clients.get(user.index);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        const response = {
          type: "create_game",
          data: JSON.stringify({
            idGame: gameId,
            idPlayer: user.index,
          }),
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

// Create single player game with bot
function createSinglePlayerGame(clientId: string) {
  try {
    const gameId = Date.now().toString();
    const client = clients.get(clientId);

    if (!client || !client.username) {
      console.log(`Client ${clientId} not found or not registered with a username`);
      return;
    }

    // Create game state
    const game = {
      id: gameId,
      players: [
        {
          id: clientId,
          name: client.username,
          ships: [],
          board: Array(10)
            .fill(null)
            .map(() => Array(10).fill(null)),
          ready: false,
          isBot: false,
        },
        {
          id: BOT_ID,
          name: "Bot",
          ships: generateBotShips(),
          board: Array(10)
            .fill(null)
            .map(() => Array(10).fill(null)),
          ready: true,
          isBot: true,
        },
      ],
      currentPlayerIndex: clientId,
      lastHit: null,
    };

    games.set(gameId, game);

    // Notify player
    if (client.ws.readyState === WebSocket.OPEN) {
      const response = {
        type: "create_game",
        data: JSON.stringify({
          idGame: gameId,
          idPlayer: clientId,
        }),
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
    if (!validateShips(ships)) {
      console.log(`Invalid ships configuration from player ${indexPlayer}`);
      return;
    }

    // Add ships to player's board
    player.ships = ships;
    player.ready = true;

    // Check if both players are ready
    if (game.players.every((p: any) => p.ready)) {
      startGame(game);
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

// Validate ships configuration
function validateShips(ships: any[]): boolean {
  if (!Array.isArray(ships) || ships.length !== 10) {
    return false;
  }

  const shipCounts: Record<string, number> = {
    small: 0,
    medium: 0,
    large: 0,
    huge: 0,
  };

  for (const ship of ships) {
    if (
      !ship.position ||
      typeof ship.position.x !== "number" ||
      typeof ship.position.y !== "number" ||
      typeof ship.direction !== "boolean" ||
      typeof ship.length !== "number" ||
      !ship.type
    ) {
      return false;
    }

    if (!["small", "medium", "large", "huge"].includes(ship.type)) {
      return false;
    }

    const expectedLength: Record<string, number> = {
      small: 1,
      medium: 2,
      large: 3,
      huge: 4,
    };

    if (ship.length !== expectedLength[ship.type]) {
      return false;
    }

    shipCounts[ship.type]++;

    const maxX = ship.direction ? ship.position.x : ship.position.x + ship.length - 1;
    const maxY = ship.direction ? ship.position.y + ship.length - 1 : ship.position.y;
    if (maxX >= 10 || maxY >= 10) {
      return false;
    }
  }

  return (
    shipCounts.small === 4 &&
    shipCounts.medium === 3 &&
    shipCounts.large === 2 &&
    shipCounts.huge === 1
  );
}

// Start game when both players are ready
function startGame(game: any) {
  try {
    game.players.forEach((player: any) => {
      const client = clients.get(player.id);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        const response = {
          type: "start_game",
          data: JSON.stringify({
            ships: player.ships,
            currentPlayerIndex: game.currentPlayerIndex,
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));

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

// Generate random ship positions for bot
function generateBotShips() {
  const ships: any[] = [];
  const board = Array(10)
    .fill(null)
    .map(() => Array(10).fill(null));
  const shipTypes = [
    { type: "small", length: 1, count: 4 },
    { type: "medium", length: 2, count: 3 },
    { type: "large", length: 3, count: 2 },
    { type: "huge", length: 4, count: 1 },
  ];

  for (const shipType of shipTypes) {
    for (let i = 0; i < shipType.count; i++) {
      let validPosition = false;
      let newShip: any;

      while (!validPosition) {
        const x = Math.floor(Math.random() * 10);
        const y = Math.floor(Math.random() * 10);
        const direction = Math.random() < 0.5;

        const potentialShip = {
          position: { x, y },
          direction,
          length: shipType.length,
          type: shipType.type,
        };

        const newShipCells = getShipCells(potentialShip);

        const fitsOnBoard = newShipCells.every(
          (cell) => cell.x >= 0 && cell.x < 10 && cell.y >= 0 && cell.y < 10
        );
        if (!fitsOnBoard) continue;

        const overlapsDirectly = newShipCells.some((cell) => board[cell.y][cell.x] === "ship");
        if (overlapsDirectly) continue;

        let isAdjacentToExistingShip = false;
        for (const cell of newShipCells) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const checkX = cell.x + dx;
              const checkY = cell.y + dy;

              if (checkX >= 0 && checkX < 10 && checkY >= 0 && checkY < 10) {
                if (board[checkY][checkX] === "ship") {
                  isAdjacentToExistingShip = true;
                  break;
                }
              }
            }
            if (isAdjacentToExistingShip) break;
          }
          if (isAdjacentToExistingShip) break;
        }
        if (isAdjacentToExistingShip) continue;

        newShip = potentialShip;
        validPosition = true;

        newShipCells.forEach((cell) => {
          board[cell.y][cell.x] = "ship";
        });
      }
      ships.push(newShip);
    }
  }

  console.log("\n=== Bot's Initial Board State (with no-adjacency) ===");
  console.log(
    "  " +
      Array(10)
        .fill(0)
        .map((_, i) => i)
        .join(" ")
  );
  board.forEach((row, y) => {
    console.log(`${y} ${row.map((cell) => (cell === "ship" ? "S" : ".")).join(" ")}`);
  });
  console.log("=== End Bot's Board State ===\n");

  return ships;
}

// Handle attack
function handleAttack(_ws: WebSocket, data: any, clientId: string) {
  try {
    let attackData: any;
    try {
      attackData = typeof data.data === "string" ? JSON.parse(data.data) : data.data;
    } catch (parseError) {
      console.error(`Failed to parse attack data from ${clientId}:`, parseError);
      return;
    }

    const { gameId, x, y, indexPlayer } = attackData;
    const game = games.get(gameId);

    if (!game) {
      console.log(`Game ${gameId} not found`);
      return;
    }

    if (game.currentPlayerIndex !== indexPlayer) {
      console.log(`Not player ${indexPlayer}'s turn in game ${gameId}`);
      return;
    }

    const targetPlayer = game.players.find((p: any) => p.id !== indexPlayer);
    if (!targetPlayer) {
      console.log(`Target player not found in game ${gameId}`);
      console.log(`  indexPlayer: ${indexPlayer} (type: ${typeof indexPlayer})`);
      console.log(
        `  Game players:`,
        game.players.map((p: any) => ({ id: p.id, type: typeof p.id, name: p.name }))
      );
      console.log(`  Total players in game: ${game.players.length}`);
      return;
    }

    console.log(`\n=== Attack by ${indexPlayer} at (${x}, ${y}) ===`);

    const attackResult = processAttack(targetPlayer, x, y);

    console.log(`Attack result:`, attackResult);

    game.players.forEach((player: any) => {
      const client = clients.get(player.id);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        const response = {
          type: "attack",
          data: JSON.stringify({
            position: { x, y },
            currentPlayer: indexPlayer,
            status: attackResult.status,
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));
      }
    });

    if (attackResult.status === "killed") {
      console.log(`Ship killed at (${x}, ${y})`);
      sendSurroundingMisses(game, attackResult.ship);
      game.lastHit = null;

      if (checkGameOver(targetPlayer)) {
        console.log(`Game over detected for player ${targetPlayer.name}`);
        endGame(game, indexPlayer);
        return;
      }
    } else if (attackResult.status === "shot") {
      console.log(`Ship hit at (${x}, ${y})`);
      game.lastHit = { x, y };
    }

    if (attackResult.status === "miss") {
      game.currentPlayerIndex = targetPlayer.id;
    }

    game.players.forEach((player: any) => {
      const client = clients.get(player.id);
      if (client && client.ws.readyState === WebSocket.OPEN) {
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

    if (game.currentPlayerIndex === BOT_ID) {
      setTimeout(() => makeBotMove(game), 1000);
    }

    console.log(`Attack processed for player ${indexPlayer} in game ${gameId}`);
  } catch (err) {
    console.error(`Error processing attack for player ${clientId}:`, err);
  }
}

// Process attack on player's board
function processAttack(player: any, x: number, y: number) {
  if (player.board[y][x] !== null) {
    console.log(`Cell (${x}, ${y}) already attacked with status:`, player.board[y][x]);
    return { status: "miss", ship: null };
  }

  for (const ship of player.ships) {
    const shipCells = getShipCells(ship);
    const hitCell = shipCells.find((cell: any) => cell.x === x && cell.y === y);

    if (hitCell) {
      console.log(`Ship hit! Type: ${ship.type}, Length: ${ship.length}`);
      player.board[y][x] = "hit";

      const isKilled = shipCells.every((cell: any) => {
        return player.board[cell.y][cell.x] === "hit" || player.board[cell.y][cell.x] === "killed";
      });

      if (isKilled) {
        console.log("Ship killed! Marking all cells as killed");
        shipCells.forEach((cell: any) => {
          player.board[cell.y][cell.x] = "killed";
        });
        return {
          status: "killed",
          ship: ship,
        };
      }

      return {
        status: "shot",
        ship: null,
      };
    }
  }

  console.log("Miss!");
  player.board[y][x] = "miss";
  return { status: "miss", ship: null };
}

// Get all cells occupied by a ship
function getShipCells(ship: any) {
  const cells = [];
  for (let i = 0; i < ship.length; i++) {
    cells.push({
      x: ship.direction ? ship.position.x : ship.position.x + i,
      y: ship.direction ? ship.position.y + i : ship.position.y,
    });
  }
  return cells;
}

// Send miss for cells surrounding a killed ship
function sendSurroundingMisses(game: any, ship: any) {
  const surroundingCells = getSurroundingCells(ship);
  const targetPlayer = game.players.find((p: any) => p.id !== game.currentPlayerIndex);

  surroundingCells.forEach((cell: any) => {
    const isPartOfAnotherShip = targetPlayer.ships.some((s: any) => {
      if (s === ship) return false;
      const shipCells = getShipCells(s);
      return shipCells.some((sc: any) => sc.x === cell.x && sc.y === cell.y);
    });

    if (targetPlayer.board[cell.y][cell.x] === null && !isPartOfAnotherShip) {
      targetPlayer.board[cell.y][cell.x] = "miss";
    }
  });

  game.players.forEach((player: any) => {
    const client = clients.get(player.id);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      const shipCells = getShipCells(ship);
      shipCells.forEach((cell: any) => {
        const response = {
          type: "attack",
          data: JSON.stringify({
            position: cell,
            currentPlayer: game.currentPlayerIndex,
            status: "killed",
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));
      });

      surroundingCells.forEach((cell: any) => {
        const currentCellState = targetPlayer.board[cell.y][cell.x];
        if (currentCellState !== null) {
          const response = {
            type: "attack",
            data: JSON.stringify({
              position: cell,
              currentPlayer: game.currentPlayerIndex,
              status: currentCellState,
            }),
            id: 0,
          };
          client.ws.send(JSON.stringify(response));
        }
      });
    }
  });
}

// Get cells surrounding a ship
function getSurroundingCells(ship: any) {
  const cells: any[] = [];
  const shipCells = getShipCells(ship);

  for (const cell of shipCells) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = cell.x + dx;
        const y = cell.y + dy;

        if (x < 0 || x >= 10 || y < 0 || y >= 10) continue;

        if (shipCells.some((sc: any) => sc.x === x && sc.y === y)) continue;

        if (!cells.some((c) => c.x === x && c.y === y)) {
          cells.push({ x, y });
        }
      }
    }
  }

  return cells;
}

// Handle random attack
function handleRandomAttack(ws: WebSocket, data: any, clientId: string) {
  try {
    let randomAttackData: any;
    try {
      randomAttackData = typeof data.data === "string" ? JSON.parse(data.data) : data.data;
    } catch (parseError) {
      console.error(`Failed to parse random attack data from ${clientId}:`, parseError);
      return;
    }

    const { gameId, indexPlayer } = randomAttackData;
    const game = games.get(gameId);

    if (!game) {
      console.log(`Game ${gameId} not found`);
      return;
    }

    if (game.currentPlayerIndex !== indexPlayer) {
      console.log(`Not player ${indexPlayer}'s turn in game ${gameId}`);
      return;
    }

    const targetPlayer = game.players.find((p: any) => p.id !== indexPlayer);
    if (!targetPlayer) {
      console.log(`Target player not found in game ${gameId}`);
      console.log(`  indexPlayer: ${indexPlayer} (type: ${typeof indexPlayer})`);
      console.log(
        `  Game players:`,
        game.players.map((p: any) => ({ id: p.id, type: typeof p.id, name: p.name }))
      );
      console.log(`  Total players in game: ${game.players.length}`);
      return;
    }

    let x: number, y: number;
    do {
      x = Math.floor(Math.random() * 10);
      y = Math.floor(Math.random() * 10);
    } while (targetPlayer.board[y][x] !== null);

    const attackRequest = {
      gameId,
      x,
      y,
      indexPlayer,
    };
    handleAttack(ws, { type: "attack", data: JSON.stringify(attackRequest), id: 0 }, clientId);

    console.log(`Random attack processed for player ${indexPlayer} in game ${gameId}`);
  } catch (err) {
    console.error(`Error processing random attack for player ${clientId}:`, err);
  }
}

// Check if game is over
function checkGameOver(player: any): boolean {
  console.log("\n=== Checking Game Over ===");
  console.log("Player:", player.name);

  const isGameOver = player.ships.every((ship: any) => {
    const shipCells = getShipCells(ship);
    const isShipDestroyed = shipCells.every(
      (cell: any) => player.board[cell.y][cell.x] === "killed"
    );
    console.log(`Ship ${ship.type} destroyed:`, isShipDestroyed);
    return isShipDestroyed;
  });

  console.log("\nGame over:", isGameOver);
  console.log("=== End Game Over Check ===\n");
  return isGameOver;
}

// End game
function endGame(game: any, winnerId: string) {
  try {
    console.log(`Game ${game.id} ending, winner: ${winnerId}`);

    const winnerClient = clients.get(winnerId);
    if (winnerClient?.username) {
      userManager.incrementWins(winnerClient.username);
    } else if (winnerId === BOT_ID) {
      console.log("Bot won the game.");
    } else {
      console.error(`Winner client not found or username missing for winnerId: ${winnerId}`);
    }

    game.players.forEach((player: any) => {
      const client = clients.get(player.id);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        const response = {
          type: "finish",
          data: JSON.stringify({
            winPlayer: winnerId,
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));

        const turnResponse = {
          type: "turn",
          data: JSON.stringify({
            currentPlayer: null,
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(turnResponse));
      }
    });

    broadcastService.broadcastWinnersUpdate();
    games.delete(game.id);

    console.log(`Game ${game.id} finished, winner: ${winnerId}`);
  } catch (err) {
    console.error(`Error ending game ${game.id}:`, err);
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
    if (client && client.ws.readyState === WebSocket.OPEN) {
      handleAttack(
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
