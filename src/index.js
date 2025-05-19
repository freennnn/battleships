import { WebSocketServer } from "ws";
import http from "http";

// Create HTTP server
const server = http.createServer((req, res) => {
  // Handle HTTP requests if needed
  res.writeHead(404);
  res.end();
});

// Create WebSocket server
const wss = new WebSocketServer({
  noServer: true,
  // Add connection timeout
  clientTracking: true,
  perMessageDeflate: false,
});

// Store connected clients with their states
const clients = new Map();

// Store game rooms
const rooms = new Map();

// Store active games
const games = new Map();

// Store winners
const winners = new Map();

// Handle new connections
wss.on("connection", (ws, req) => {
  const clientId = Date.now().toString();
  console.log(`New client connected: ${clientId}`);

  // Store client with its state
  clients.set(clientId, {
    ws,
    isAlive: true,
    lastActivity: Date.now(),
    name: "", // Will be set during registration
    roomId: null, // Will be set when joining a room
    wins: 0, // Track wins
  });

  // Send current winners list to new client
  sendWinnersUpdate(ws);

  // Set keep-alive
  ws.isAlive = true;
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
      if (!client || !client.ws || client.ws.readyState !== ws.OPEN) {
        console.log(`Client ${clientId} is not ready to receive messages`);
        return;
      }

      console.log(`Raw message from ${clientId}:`, message.toString());
      const data = JSON.parse(message);
      console.log(`Parsed message from ${clientId}:`, data);

      // Update last activity
      client.lastActivity = Date.now();

      // Handle different message types
      switch (data.type) {
        case "reg":
          handleRegistration(ws, data, clientId);
          break;
        case "create_room":
          handleCreateRoom(ws, clientId);
          break;
        case "add_user_to_room":
          handleAddUserToRoom(ws, data, clientId);
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
        default:
          console.log(`Unknown message type from ${clientId}:`, data.type);
          if (ws.readyState === ws.OPEN) {
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
      if (ws.readyState === ws.OPEN) {
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
      if (client.roomId) {
        const room = rooms.get(client.roomId);
        if (room) {
          room.users = room.users.filter((user) => user.index !== clientId);
          if (room.users.length === 0) {
            rooms.delete(client.roomId);
          } else {
            broadcastRoomUpdate();
          }
        }
      }
      // Remove from winners if they were in the list
      if (client.name) {
        winners.delete(client.name);
        broadcastWinnersUpdate();
      }
      client.isAlive = false;
      clients.delete(clientId);
    }
  });
});

// Handle upgrade requests
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// Handle player registration
function handleRegistration(ws, data, clientId) {
  try {
    if (ws.readyState !== ws.OPEN) {
      console.log(
        `Cannot send registration response - client ${clientId} is not open`
      );
      return;
    }

    console.log(`Registration data from ${clientId}:`, data);

    // Parse data.data if it's a string, otherwise use as is
    let playerData;
    try {
      playerData =
        typeof data.data === "string" ? JSON.parse(data.data) : data.data;
      console.log(`Parsed player data from ${clientId}:`, playerData);
    } catch (parseError) {
      console.error(
        `Failed to parse player data from ${clientId}:`,
        parseError
      );
      const errorResponse = {
        type: "reg",
        data: JSON.stringify({
          name: "",
          index: "-1",
          error: true,
          errorText: "Invalid data format",
        }),
        id: 0, // Always use 0 as per protocol
      };
      ws.send(JSON.stringify(errorResponse));
      return;
    }

    // Check if playerData exists and has required fields
    if (!playerData || typeof playerData !== "object") {
      console.log(
        `Invalid registration data from ${clientId} - data is not an object:`,
        playerData
      );
      const errorResponse = {
        type: "reg",
        data: JSON.stringify({
          name: "",
          index: "-1",
          error: true,
          errorText: "Invalid registration data format",
        }),
        id: 0, // Always use 0 as per protocol
      };
      ws.send(JSON.stringify(errorResponse));
      return;
    }

    // Validate name
    if (
      !playerData.name ||
      typeof playerData.name !== "string" ||
      playerData.name.trim() === ""
    ) {
      console.log(
        `Invalid registration data from ${clientId} - invalid name:`,
        playerData.name
      );
      const errorResponse = {
        type: "reg",
        data: JSON.stringify({
          name: "",
          index: "-1",
          error: true,
          errorText: "Name is required and must be a non-empty string",
        }),
        id: 0, // Always use 0 as per protocol
      };
      ws.send(JSON.stringify(errorResponse));
      return;
    }

    // Update client with name
    const client = clients.get(clientId);
    if (client) {
      client.name = playerData.name.trim();
    }

    // Create response object with stringified data
    const response = {
      type: "reg",
      data: JSON.stringify({
        name: playerData.name.trim(),
        index: clientId,
        error: false,
        errorText: "",
      }),
      id: 0, // Always use 0 as per protocol
    };

    console.log(`Sending registration response to ${clientId}:`, response);
    ws.send(JSON.stringify(response));
  } catch (err) {
    console.error(`Error in registration for ${clientId}:`, err);
    if (ws.readyState === ws.OPEN) {
      const errorResponse = {
        type: "reg",
        data: JSON.stringify({
          name: "",
          index: "-1",
          error: true,
          errorText: "Invalid registration data",
        }),
        id: 0, // Always use 0 as per protocol
      };
      ws.send(JSON.stringify(errorResponse));
    }
  }
}

// Handle room creation
function handleCreateRoom(ws, clientId) {
  try {
    const client = clients.get(clientId);
    if (!client || !client.name) {
      console.log(`Client ${clientId} not registered`);
      return;
    }

    // Create new room
    const roomId = Date.now().toString();
    const room = {
      id: roomId,
      users: [
        {
          name: client.name,
          index: clientId,
        },
      ],
    };
    rooms.set(roomId, room);

    // Update client's room
    client.roomId = roomId;

    // Broadcast room update to all clients
    broadcastRoomUpdate();

    console.log(`Room ${roomId} created by ${clientId}`);
  } catch (err) {
    console.error(`Error creating room for ${clientId}:`, err);
  }
}

// Handle adding user to room
function handleAddUserToRoom(ws, data, clientId) {
  try {
    const client = clients.get(clientId);
    if (!client || !client.name) {
      console.log(`Client ${clientId} not registered`);
      return;
    }

    // Parse room index
    let roomData;
    try {
      roomData =
        typeof data.data === "string" ? JSON.parse(data.data) : data.data;
    } catch (parseError) {
      console.error(`Failed to parse room data from ${clientId}:`, parseError);
      return;
    }

    const roomId = roomData.indexRoom;
    const room = rooms.get(roomId);

    if (!room) {
      console.log(`Room ${roomId} not found`);
      return;
    }

    if (room.users.length >= 2) {
      console.log(`Room ${roomId} is full`);
      return;
    }

    // Add user to room
    room.users.push({
      name: client.name,
      index: clientId,
    });

    // Update client's room
    client.roomId = roomId;

    // If room is full, create game
    if (room.users.length === 2) {
      createGame(room);
    }

    // Broadcast room update to all clients
    broadcastRoomUpdate();

    console.log(`User ${clientId} added to room ${roomId}`);
  } catch (err) {
    console.error(`Error adding user to room for ${clientId}:`, err);
  }
}

// Create game when room is full
function createGame(room) {
  try {
    const gameId = Date.now().toString();

    // Create game state
    const game = {
      id: gameId,
      players: room.users.map((user) => ({
        id: user.index,
        name: user.name,
        ships: [],
        board: Array(10)
          .fill()
          .map(() => Array(10).fill(null)),
        ready: false,
      })),
      currentPlayerIndex: room.users[0].index, // First player starts
    };

    games.set(gameId, game);

    // Notify both players
    room.users.forEach((user) => {
      const client = clients.get(user.index);
      if (client && client.ws.readyState === client.ws.OPEN) {
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

// Handle adding ships
function handleAddShips(ws, data, clientId) {
  try {
    // Parse ships data
    let shipsData;
    try {
      shipsData =
        typeof data.data === "string" ? JSON.parse(data.data) : data.data;
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

    const player = game.players.find((p) => p.id === indexPlayer);
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
    if (game.players.every((p) => p.ready)) {
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
function validateShips(ships) {
  // Check if we have exactly 10 ships
  if (!Array.isArray(ships) || ships.length !== 10) {
    return false;
  }

  // Count ships by type
  const shipCounts = {
    small: 0,
    medium: 0,
    large: 0,
    huge: 0,
  };

  // Validate each ship
  for (const ship of ships) {
    // Check required fields
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

    // Check ship type
    if (!["small", "medium", "large", "huge"].includes(ship.type)) {
      return false;
    }

    // Check ship length matches type
    const expectedLength = {
      small: 1,
      medium: 2,
      large: 3,
      huge: 4,
    }[ship.type];

    if (ship.length !== expectedLength) {
      return false;
    }

    // Count ship type
    shipCounts[ship.type]++;

    // Check if ship is within board bounds
    const maxX = ship.direction
      ? ship.position.x
      : ship.position.x + ship.length - 1;
    const maxY = ship.direction
      ? ship.position.y + ship.length - 1
      : ship.position.y;
    if (maxX >= 10 || maxY >= 10) {
      return false;
    }
  }

  // Check if we have the correct number of each ship type
  return (
    shipCounts.small === 4 &&
    shipCounts.medium === 3 &&
    shipCounts.large === 2 &&
    shipCounts.huge === 1
  );
}

// Start game when both players are ready
function startGame(game) {
  try {
    // Notify both players that the game has started
    game.players.forEach((player) => {
      const client = clients.get(player.id);
      if (client && client.ws.readyState === client.ws.OPEN) {
        const response = {
          type: "start_game",
          data: JSON.stringify({
            ships: player.ships,
            currentPlayerIndex: game.currentPlayerIndex,
          }),
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

// Handle attack
function handleAttack(ws, data, clientId) {
  try {
    // Parse attack data
    let attackData;
    try {
      attackData =
        typeof data.data === "string" ? JSON.parse(data.data) : data.data;
    } catch (parseError) {
      console.error(
        `Failed to parse attack data from ${clientId}:`,
        parseError
      );
      return;
    }

    const { gameId, x, y, indexPlayer } = attackData;
    const game = games.get(gameId);

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

    // Process attack
    const attackResult = processAttack(targetPlayer, x, y);

    // Send attack result to both players
    game.players.forEach((player) => {
      const client = clients.get(player.id);
      if (client && client.ws.readyState === client.ws.OPEN) {
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

    // If ship was killed, send miss for surrounding cells
    if (attackResult.status === "killed") {
      sendSurroundingMisses(game, attackResult.ship);
    }

    // Check if game is over
    if (checkGameOver(targetPlayer)) {
      endGame(game, indexPlayer);
    } else {
      // Switch turns if it was a miss
      if (attackResult.status === "miss") {
        game.currentPlayerIndex = targetPlayer.id;

        // Send turn information to both players
        game.players.forEach((player) => {
          const client = clients.get(player.id);
          if (client && client.ws.readyState === client.ws.OPEN) {
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

    console.log(`Attack processed for player ${indexPlayer} in game ${gameId}`);
  } catch (err) {
    console.error(`Error processing attack for player ${clientId}:`, err);
  }
}

// Process attack on player's board
function processAttack(player, x, y) {
  // Check if cell was already attacked
  if (player.board[y][x] !== null) {
    return { status: "miss" };
  }

  // Check if any ship was hit
  for (const ship of player.ships) {
    const shipCells = getShipCells(ship);
    if (shipCells.some((cell) => cell.x === x && cell.y === y)) {
      // Mark cell as hit
      player.board[y][x] = "hit";

      // Check if ship is killed
      const isKilled = shipCells.every(
        (cell) => player.board[cell.y][cell.x] === "hit"
      );

      return {
        status: isKilled ? "killed" : "shot",
        ship: isKilled ? ship : null,
      };
    }
  }

  // Mark cell as miss
  player.board[y][x] = "miss";
  return { status: "miss" };
}

// Get all cells occupied by a ship
function getShipCells(ship) {
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
function sendSurroundingMisses(game, ship) {
  const surroundingCells = getSurroundingCells(ship);

  game.players.forEach((player) => {
    const client = clients.get(player.id);
    if (client && client.ws.readyState === client.ws.OPEN) {
      surroundingCells.forEach((cell) => {
        const response = {
          type: "attack",
          data: JSON.stringify({
            position: cell,
            currentPlayer: game.currentPlayerIndex,
            status: "miss",
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));
      });
    }
  });
}

// Get cells surrounding a ship
function getSurroundingCells(ship) {
  const cells = [];
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

// Handle random attack
function handleRandomAttack(ws, data, clientId) {
  try {
    // Parse random attack data
    let randomAttackData;
    try {
      randomAttackData =
        typeof data.data === "string" ? JSON.parse(data.data) : data.data;
    } catch (parseError) {
      console.error(
        `Failed to parse random attack data from ${clientId}:`,
        parseError
      );
      return;
    }

    const { gameId, indexPlayer } = randomAttackData;
    const game = games.get(gameId);

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

    // Find a random unoccupied cell
    let x, y;
    do {
      x = Math.floor(Math.random() * 10);
      y = Math.floor(Math.random() * 10);
    } while (targetPlayer.board[y][x] !== null);

    // Process the random attack
    const attackRequest = {
      gameId,
      x,
      y,
      indexPlayer,
    };
    handleAttack(
      ws,
      { type: "attack", data: JSON.stringify(attackRequest), id: 0 },
      clientId
    );

    console.log(
      `Random attack processed for player ${indexPlayer} in game ${gameId}`
    );
  } catch (err) {
    console.error(
      `Error processing random attack for player ${clientId}:`,
      err
    );
  }
}

// Check if game is over
function checkGameOver(player) {
  return player.ships.every((ship) =>
    getShipCells(ship).every((cell) => player.board[cell.y][cell.x] === "hit")
  );
}

// End game
function endGame(game, winnerId) {
  try {
    // Update winner's stats
    const winner = clients.get(winnerId);
    if (winner) {
      winner.wins = (winner.wins || 0) + 1;
      winners.set(winner.name, winner.wins);
    }

    // Notify both players
    game.players.forEach((player) => {
      const client = clients.get(player.id);
      if (client && client.ws.readyState === client.ws.OPEN) {
        const response = {
          type: "finish",
          data: JSON.stringify({
            winPlayer: winnerId,
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));
      }
    });

    // Broadcast winners update to all clients
    broadcastWinnersUpdate();

    // Clean up game
    games.delete(game.id);

    console.log(`Game ${game.id} finished, winner: ${winnerId}`);
  } catch (err) {
    console.error(`Error ending game ${game.id}:`, err);
  }
}

// Broadcast room updates to all clients
function broadcastRoomUpdate() {
  try {
    // Create room list with only rooms that have one player
    const roomList = Array.from(rooms.values())
      .filter((room) => room.users.length === 1)
      .map((room) => ({
        roomId: room.id,
        roomUsers: room.users,
      }));

    const response = {
      type: "update_room",
      data: JSON.stringify(roomList),
      id: 0,
    };

    // Send to all connected clients
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify(response));
      }
    });

    console.log("Room update broadcasted");
  } catch (err) {
    console.error("Error broadcasting room update:", err);
  }
}

// Send winners update to a specific client
function sendWinnersUpdate(ws) {
  try {
    if (ws.readyState === ws.OPEN) {
      const winnersList = Array.from(winners.entries()).map(([name, wins]) => ({
        name,
        wins,
      }));

      const response = {
        type: "update_winners",
        data: JSON.stringify(winnersList),
        id: 0,
      };
      ws.send(JSON.stringify(response));
    }
  } catch (err) {
    console.error("Error sending winners update:", err);
  }
}

// Broadcast winners update to all clients
function broadcastWinnersUpdate() {
  try {
    const winnersList = Array.from(winners.entries()).map(([name, wins]) => ({
      name,
      wins,
    }));

    const response = {
      type: "update_winners",
      data: JSON.stringify(winnersList),
      id: 0,
    };

    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify(response));
      }
    });

    console.log("Winners update broadcasted");
  } catch (err) {
    console.error("Error broadcasting winners update:", err);
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
        return ws.terminate();
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

// Start server
server.listen(3000, () => {
  console.log("Battleship WebSocket server running on port 3000");
});
