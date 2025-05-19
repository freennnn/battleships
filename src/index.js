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
  });

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

    // Notify both players
    room.users.forEach((user, index) => {
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
