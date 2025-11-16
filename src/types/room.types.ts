export interface RoomUser {
    name: string;
    index: string; // clientId
}

export interface Room {
    id: string;
    users: RoomUser[];
}

export interface RoomListItem {
    roomId: string;
    roomUsers: RoomUser[];
}

export interface AddUserToRoomData {
    indexRoom: string; // roomId
}

