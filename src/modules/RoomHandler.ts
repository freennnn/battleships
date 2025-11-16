import type { WebSocketMessage } from "../types/message.types.js";
import type { AddUserToRoomData, Room } from "../types/room.types.js";
import type { ClientInfo } from "../types/user.types.js";
import type { RoomManager } from "./RoomManager.js";

/**
 * Callback type for when a room becomes full (2 players)
 */
export type RoomFullCallback = (room: Room) => void;

/**
 * Handles room-related WebSocket messages
 */
export class RoomHandler {
  private roomManager: RoomManager;
  private clients: Map<string, ClientInfo>;
  private onRoomFull?: RoomFullCallback;

  constructor(
    roomManager: RoomManager,
    clients: Map<string, ClientInfo>,
    onRoomFull?: RoomFullCallback
  ) {
    this.roomManager = roomManager;
    this.clients = clients;
    this.onRoomFull = onRoomFull;
  }

  /**
   * Set callback for when room becomes full
   */
  setRoomFullCallback(callback: RoomFullCallback): void {
    this.onRoomFull = callback;
  }

  /**
   * Handle room creation request
   */
  handleCreateRoom(clientId: string): void {
    try {
      const client = this.clients.get(clientId);

      if (!client || !client.username) {
        console.log(`Client ${clientId} not registered or username missing`);
        return;
      }

      // Create new room with unique ID
      const roomId = Date.now().toString();
      this.roomManager.createRoom(roomId, clientId, client.username);

      // Update client's room reference
      client.roomId = roomId;

      console.log(`Room ${roomId} created by ${client.username} (Client ID: ${clientId})`);
    } catch (err) {
      console.error(`Error creating room for ${clientId}:`, err);
    }
  }

  /**
   * Handle user joining a room
   */
  handleAddUserToRoom(data: WebSocketMessage, clientId: string): void {
    try {
      const client = this.clients.get(clientId);

      if (!client || !client.username) {
        console.log(`Client ${clientId} not registered or username missing`);
        return;
      }

      // Parse room data
      const roomData = this.parseRoomData(data.data, clientId);
      if (!roomData) {
        return;
      }

      const roomId = roomData.indexRoom;

      // Validate room exists
      if (!this.roomManager.roomExists(roomId)) {
        console.log(`Room ${roomId} not found`);
        return;
      }

      // Check if room is full
      if (this.roomManager.isRoomFull(roomId)) {
        console.log(`Room ${roomId} is full`);
        return;
      }

      // Add user to room
      const success = this.roomManager.addUserToRoom(roomId, clientId, client.username);

      if (!success) {
        return;
      }

      // Update client's room reference
      client.roomId = roomId;

      // Check if room is now full (2 players)
      const room = this.roomManager.getRoomById(roomId);
      if (room && room.users.length === 2 && this.onRoomFull) {
        this.onRoomFull(room);
      }

      console.log(`User ${client.username} (Client ID: ${clientId}) added to room ${roomId}`);
    } catch (err) {
      console.error(`Error adding user to room for ${clientId}:`, err);
    }
  }

  /**
   * Handle user disconnection - remove from room
   */
  handleUserDisconnect(clientId: string): boolean {
    const client = this.clients.get(clientId);

    if (!client || !client.roomId) {
      return false;
    }

    const removed = this.roomManager.removeUserFromRoom(client.roomId, clientId);

    if (removed) {
      console.log(`User ${clientId} removed from room ${client.roomId}`);
    }

    return removed;
  }

  /**
   * Parse room data from message
   */
  private parseRoomData(dataString: string, clientId: string): AddUserToRoomData | null {
    try {
      const parsed = typeof dataString === "string" ? JSON.parse(dataString) : dataString;
      return parsed as AddUserToRoomData;
    } catch (parseError) {
      console.error(`Failed to parse room data from ${clientId}:`, parseError);
      return null;
    }
  }

  /**
   * Get available rooms for broadcast
   */
  getAvailableRooms() {
    return this.roomManager.getAvailableRooms();
  }
}
