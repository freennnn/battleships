import type { Room, RoomListItem } from "../types/room.types.js";

/**
 * Manages game rooms and their state
 */
export class RoomManager {
  private rooms: Map<string, Room>;

  constructor() {
    this.rooms = new Map();
  }

  /**
   * Create a new room with a user as host
   */
  createRoom(roomId: string, userId: string, username: string): Room {
    const room: Room = {
      id: roomId,
      users: [
        {
          name: username,
          index: userId,
        },
      ],
    };

    this.rooms.set(roomId, room);
    console.log(`Room ${roomId} created by ${username} (User ID: ${userId})`);
    return room;
  }

  /**
   * Add a user to an existing room
   * Returns true if successful, false if room is full or doesn't exist
   */
  addUserToRoom(roomId: string, userId: string, username: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) {
      console.log(`Room ${roomId} not found`);
      return false;
    }

    if (room.users.length >= 2) {
      console.log(`Room ${roomId} is full`);
      return false;
    }

    room.users.push({
      name: username,
      index: userId,
    });

    console.log(`User ${username} (User ID: ${userId}) added to room ${roomId}`);
    return true;
  }

  /**
   * Remove a user from a room
   * If room becomes empty, it's automatically deleted
   */
  removeUserFromRoom(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) {
      return false;
    }

    const initialLength = room.users.length;
    room.users = room.users.filter((user) => user.index !== userId);

    if (room.users.length === 0) {
      this.rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (no users left)`);
    }

    return room.users.length < initialLength;
  }

  /**
   * Get a room by ID
   */
  getRoomById(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Check if a room exists
   */
  roomExists(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * Check if a room is full (2 players)
   */
  isRoomFull(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    return room ? room.users.length >= 2 : false;
  }

  /**
   * Get all available rooms (rooms with only 1 player waiting)
   */
  getAvailableRooms(): RoomListItem[] {
    return Array.from(this.rooms.values())
      .filter((room) => room.users.length === 1)
      .map((room) => ({
        roomId: room.id,
        roomUsers: room.users,
      }));
  }

  /**
   * Delete a room
   */
  deleteRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  /**
   * Get the number of active rooms
   */
  getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Get all rooms (for debugging)
   */
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Clear all rooms (for testing)
   */
  clearAllRooms(): void {
    this.rooms.clear();
  }
}
