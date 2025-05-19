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

// Bot player ID
const BOT_ID = "bot";

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
        case "single_play":
          createSinglePlayerGame(clientId);
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
        isBot: false,
      })),
      currentPlayerIndex: room.users[0].index, // First player starts
      lastHit: null, // Track last hit for bot's strategy
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

// Create single player game with bot
function createSinglePlayerGame(clientId) {
  try {
    const gameId = Date.now().toString();
    const client = clients.get(clientId);

    if (!client) {
      console.log(`Client ${clientId} not found`);
      return;
    }

    // Create game state
    const game = {
      id: gameId,
      players: [
        {
          id: clientId,
          name: client.name,
          ships: [],
          board: Array(10)
            .fill()
            .map(() => Array(10).fill(null)),
          ready: false,
          isBot: false,
        },
        {
          id: BOT_ID,
          name: "Bot",
          ships: generateBotShips(),
          board: Array(10)
            .fill()
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
    if (client.ws.readyState === client.ws.OPEN) {
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

    console.log(`Single player game ${gameId} created for player ${clientId}`);
  } catch (err) {
    console.error(`Error creating single player game for ${clientId}:`, err);
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

// Generate random ship positions for bot
function generateBotShips() {
  const ships = [];
  const board = Array(10)
    .fill()
    .map(() => Array(10).fill(null)); // Temporary board for placement checking
  const shipTypes = [
    { type: "small", length: 1, count: 4 },
    { type: "medium", length: 2, count: 3 },
    { type: "large", length: 3, count: 2 },
    { type: "huge", length: 4, count: 1 },
  ];

  for (const shipType of shipTypes) {
    for (let i = 0; i < shipType.count; i++) {
      let validPosition = false;
      let newShip;

      while (!validPosition) {
        const x = Math.floor(Math.random() * 10);
        const y = Math.floor(Math.random() * 10);
        const direction = Math.random() < 0.5;

        const potentialShip = {
          position: { x, y },
          direction,
          length: shipType.length,
          type: shipType.type, // Type is needed for getShipCells if it uses it, or for consistency
        };

        const newShipCells = getShipCells(potentialShip);

        // Check 1: Ship fits on board
        const fitsOnBoard = newShipCells.every(
          (cell) => cell.x >= 0 && cell.x < 10 && cell.y >= 0 && cell.y < 10
        );
        if (!fitsOnBoard) continue;

        // Check 2: Direct overlap with existing ships on the temporary board
        const overlapsDirectly = newShipCells.some(
          (cell) => board[cell.y][cell.x] === "ship"
        );
        if (overlapsDirectly) continue;

        // Check 3: Adjacency with existing ships on the temporary board
        let isAdjacentToExistingShip = false;
        for (const cell of newShipCells) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              // No need to check cell itself, dx=0 and dy=0 is fine as it would be caught by direct overlap if it was a ship cell
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

        // All checks passed
        newShip = potentialShip;
        validPosition = true;

        // Mark ship cells on the temporary board for subsequent checks
        newShipCells.forEach((cell) => {
          board[cell.y][cell.x] = "ship";
        });
      }
      ships.push(newShip);
    }
  }

  // Log the generated board for debugging (optional)
  console.log("\n=== Bot's Initial Board State (with no-adjacency) ===");
  console.log(
    "  " +
      Array(10)
        .fill()
        .map((_, i) => i)
        .join(" ")
  );
  board.forEach((row, y) => {
    console.log(
      `${y} ${row.map((cell) => (cell === "ship" ? "S" : ".")).join(" ")}`
    );
  });
  console.log("=== End Bot's Board State ===\n");

  return ships;
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

    console.log(`\n=== Attack by ${indexPlayer} at (${x}, ${y}) ===`);
    console.log(
      `Target player board state before attack:`,
      targetPlayer.board.map((row) =>
        row.map((cell) => {
          if (cell === null) return ".";
          if (cell === "hit") return "H";
          if (cell === "killed") return "K";
          return "M";
        })
      )
    );

    // Process attack
    const attackResult = processAttack(targetPlayer, x, y);

    console.log(`Attack result:`, attackResult);
    console.log(
      `Target player board state after attack:`,
      targetPlayer.board.map((row) =>
        row.map((cell) => {
          if (cell === null) return ".";
          if (cell === "hit") return "H";
          if (cell === "killed") return "K";
          return "M";
        })
      )
    );

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
      console.log(`Ship killed at (${x}, ${y})`);
      sendSurroundingMisses(game, attackResult.ship);
      game.lastHit = null; // Reset last hit when ship is killed

      // Check if game is over after a ship is killed
      if (checkGameOver(targetPlayer)) {
        console.log(`Game over detected for player ${targetPlayer.name}`);
        endGame(game, indexPlayer);
        return; // Exit early as game is over
      }
    } else if (attackResult.status === "shot") {
      console.log(`Ship hit at (${x}, ${y})`);
      game.lastHit = { x, y }; // Remember last hit for bot's strategy
    }

    // Switch turns if it was a miss
    if (attackResult.status === "miss") {
      game.currentPlayerIndex = targetPlayer.id;
    }

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

    // If next player is bot, make bot's move
    if (game.currentPlayerIndex === BOT_ID) {
      setTimeout(() => makeBotMove(game), 1000); // Add delay for better UX
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
    console.log(
      `Cell (${x}, ${y}) already attacked with status:`,
      player.board[y][x]
    );
    return { status: "miss" };
  }

  // Check if any ship was hit
  for (const ship of player.ships) {
    const shipCells = getShipCells(ship);
    const hitCell = shipCells.find((cell) => cell.x === x && cell.y === y);

    if (hitCell) {
      console.log(`Ship hit! Type: ${ship.type}, Length: ${ship.length}`);
      console.log(`Ship cells:`, shipCells);

      // Mark the hit cell
      player.board[y][x] = "hit";

      // Check if ship is killed (all cells are hit)
      const isKilled = shipCells.every((cell) => {
        return (
          player.board[cell.y][cell.x] === "hit" ||
          player.board[cell.y][cell.x] === "killed"
        );
      });

      console.log(`Ship state:`, {
        type: ship.type,
        length: ship.length,
        cells: shipCells.map((cell) => ({
          x: cell.x,
          y: cell.y,
          state: player.board[cell.y][cell.x],
        })),
      });
      console.log(`Is ship killed:`, isKilled);

      // If ship is killed, mark all cells as killed
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
  const targetPlayer = game.players.find(
    (p) => p.id !== game.currentPlayerIndex
  );

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
    const client = clients.get(player.id);
    if (client && client.ws.readyState === client.ws.OPEN) {
      // Send the killed ship cells
      const shipCells = getShipCells(ship);
      shipCells.forEach((cell) => {
        const response = {
          type: "attack",
          data: JSON.stringify({
            position: cell,
            currentPlayer: game.currentPlayerIndex,
            status: "killed", // Ship cells are always killed
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));
      });

      // Send the actual state of all surrounding cells
      surroundingCells.forEach((cell) => {
        const currentCellState = targetPlayer.board[cell.y][cell.x];
        // We only need to send an update if the cell has a defined state (hit, miss, killed)
        // If it's null, it means it's an empty part of another ship, client shouldn't mark it.
        // Or it's an empty cell the client already knows is empty.
        // The client typically only cares about changes or confirmed states.
        if (currentCellState !== null) {
          const response = {
            type: "attack",
            data: JSON.stringify({
              position: cell,
              currentPlayer: game.currentPlayerIndex,
              status: currentCellState, // Send the actual current state
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
  console.log("\n=== Checking Game Over ===");
  console.log("Player:", player.name);
  console.log("All ships status:");

  // Log each ship's status
  player.ships.forEach((ship, index) => {
    const shipCells = getShipCells(ship);
    const cellStates = shipCells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      state: player.board[cell.y][cell.x],
    }));

    console.log(`\nShip ${index + 1}:`, {
      type: ship.type,
      length: ship.length,
      position: ship.position,
      direction: ship.direction,
      cells: cellStates,
      isDestroyed: cellStates.every((cell) => cell.state === "killed"),
    });
  });

  // Log complete board state
  console.log("\nComplete board state:");
  console.log(
    "  " +
      Array(10)
        .fill()
        .map((_, i) => i)
        .join(" ")
  );
  player.board.forEach((row, y) => {
    console.log(
      `${y} ${row
        .map((cell) => {
          if (cell === null) return ".";
          if (cell === "hit") return "H";
          if (cell === "killed") return "K";
          return "M";
        })
        .join(" ")}`
    );
  });

  // Check if all ships are completely destroyed
  const isGameOver = player.ships.every((ship) => {
    const shipCells = getShipCells(ship);
    const isShipDestroyed = shipCells.every(
      (cell) => player.board[cell.y][cell.x] === "killed"
    );
    console.log(`Ship ${ship.type} destroyed:`, isShipDestroyed);
    return isShipDestroyed;
  });

  console.log("\nGame over:", isGameOver);
  console.log("=== End Game Over Check ===\n");
  return isGameOver;
}

// End game
function endGame(game, winnerId) {
  try {
    console.log(`Game ${game.id} ending, winner: ${winnerId}`);

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
        // Send game over message
        const response = {
          type: "finish",
          data: JSON.stringify({
            winPlayer: winnerId,
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(response));

        // Send final turn message to prevent UI from showing "your turn"
        const turnResponse = {
          type: "turn",
          data: JSON.stringify({
            currentPlayer: null, // Set to null to indicate game is over
          }),
          id: 0,
        };
        client.ws.send(JSON.stringify(turnResponse));
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

// Make bot's move
function makeBotMove(game) {
  try {
    const bot = game.players.find((p) => p.isBot);
    const targetPlayer = game.players.find((p) => !p.isBot);

    if (!bot || !targetPlayer) {
      console.log("Bot or target player not found");
      return;
    }

    let x, y;

    if (game.lastHit) {
      // If there was a hit, try adjacent cells
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
        const randomCell =
          validCells[Math.floor(Math.random() * validCells.length)];
        x = randomCell.x;
        y = randomCell.y;
      } else {
        // If no valid adjacent cells, make random move
        do {
          x = Math.floor(Math.random() * 10);
          y = Math.floor(Math.random() * 10);
        } while (targetPlayer.board[y][x] !== null);
      }
    } else {
      // Make random move
      do {
        x = Math.floor(Math.random() * 10);
        y = Math.floor(Math.random() * 10);
      } while (targetPlayer.board[y][x] !== null);
    }

    // Process bot's attack
    const attackData = {
      gameId: game.id,
      x,
      y,
      indexPlayer: BOT_ID,
    };

    const client = clients.get(targetPlayer.id);
    if (client && client.ws.readyState === client.ws.OPEN) {
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
function getAdjacentCells(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}
