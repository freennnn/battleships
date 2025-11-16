import { WebSocket, WebSocketServer } from "ws";
import { UserManager } from "./UserManager.js";

/**
 * Service for broadcasting messages to clients
 */
export class BroadcastService {
    private wss: WebSocketServer;
    private userManager: UserManager;

    constructor(wss: WebSocketServer, userManager: UserManager) {
        this.wss = wss;
        this.userManager = userManager;
    }

    /**
     * Send winners update to a specific client
     */
    sendWinnersUpdate(ws: WebSocket): void {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                const winnersList = this.userManager.getAllWinners();

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

    /**
     * Broadcast winners update to all connected clients
     */
    broadcastWinnersUpdate(): void {
        try {
            const winnersList = this.userManager.getAllWinners();

            const response = {
                type: "update_winners",
                data: JSON.stringify(winnersList),
                id: 0,
            };

            this.wss.clients.forEach((clientWs) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify(response));
                }
            });

            console.log("Winners update broadcasted");
        } catch (err) {
            console.error("Error broadcasting winners update:", err);
        }
    }
}

