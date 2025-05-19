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

// Handle new connections
wss.on("connection", (ws, req) => {
  const clientId = Date.now().toString();
  console.log(`New client connected: ${clientId}`);

  // Store client with its state
  clients.set(clientId, {
    ws,
    isAlive: true,
    lastActivity: Date.now(),
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
          // Stringify the data object
          name: "",
          index: "-1",
          error: true,
          errorText: "Invalid data format",
        }),
        id: data.id,
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
          // Stringify the data object
          name: "",
          index: "-1",
          error: true,
          errorText: "Invalid registration data format",
        }),
        id: data.id,
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
          // Stringify the data object
          name: "",
          index: "-1",
          error: true,
          errorText: "Name is required and must be a non-empty string",
        }),
        id: data.id,
      };
      ws.send(JSON.stringify(errorResponse));
      return;
    }

    // Create response object with stringified data
    const response = {
      type: "reg",
      data: JSON.stringify({
        // Stringify the data object
        name: playerData.name.trim(),
        index: clientId,
        error: false,
        errorText: "",
      }),
      id: data.id,
    };

    console.log(`Sending registration response to ${clientId}:`, response);
    ws.send(JSON.stringify(response));
  } catch (err) {
    console.error(`Error in registration for ${clientId}:`, err);
    if (ws.readyState === ws.OPEN) {
      const errorResponse = {
        type: "reg",
        data: JSON.stringify({
          // Stringify the data object
          name: "",
          index: "-1",
          error: true,
          errorText: "Invalid registration data",
        }),
        id: data.id || 0,
      };
      ws.send(JSON.stringify(errorResponse));
    }
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
