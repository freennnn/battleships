import { WebSocket } from "ws";

// username is the ID - it's a key in users Map
export interface UserAccount {
    password: string;
    wins: number;
}


// Connection state + link to user account
export interface ClientInfo {
    ws: WebSocket;

    // Links the WebSocket connection to a user account
    // initially null when client connects, after login/registration - link to user account
    // aka foreign key between clients Map and users Map
    // LEVEL 2: Username (persistent, unique per user)
    username: string | null;

    // Detect dead connections (browser closed without disconnect event, network failure, etc.)
    // sending ping every 30s and expect to receive ws.on('pong') for previous 'ping' by next ping
    isAlive: boolean;

    // addtioonal timeout detection (update on any ws.on('anyEvent') - if 30s not events, aka idle - terminate ws)
    lastActivity: number; // timeout detection (kick inactive)

    // is set when user creates a room, null when user starts single player game or in lobby
    // LEVEL 3: Room/Game IDs (temporary, for multiplayer)
    roomId: string | null;
}

/**
 * Registration/Login request data
 */
export interface RegistrationData {
    name: string;
    password: string;
}

/**
 * Registration response data
 */
export interface RegistrationResponse {
    name: string;
    // CLIENT stores the index after login, and uses it for subsequent requests
    // aka clientID (unique indentifier for this Websocket connection)
    // LEVEL 1: Connection ID (temporary, changes on reconnect)
    index: string;
    error: boolean;
    errorText: string;
}

/**
 * Winner leaderboard entry
 */
export interface WinnerEntry {
    name: string;
    wins: number;
}

