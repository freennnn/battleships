import { WebSocket } from "ws";
import type { WebSocketMessage } from "../types/message.types.js";
import type { ClientInfo, RegistrationData, RegistrationResponse } from "../types/user.types.js";
import type { UserManager } from "./UserManager.js";

/**
 * Handles user authentication (registration and login)
 */
export class AuthHandler {
  private userManager: UserManager;
  private clients: Map<string, ClientInfo>;

  constructor(userManager: UserManager, clients: Map<string, ClientInfo>) {
    this.userManager = userManager;
    this.clients = clients;
  }

  /**
   * Handle registration/login request
   */
  handleRegistration(ws: WebSocket, data: WebSocketMessage, clientId: string): void {
    try {
      if (ws.readyState !== WebSocket.OPEN) {
        console.log(`Cannot send registration response - client ${clientId} is not open`);
        return;
      }

      console.log(`Registration data from ${clientId}:`, data);

      // Parse player registration data
      const playerRegData = this.parseRegistrationData(data.data, clientId, ws);
      if (!playerRegData) {
        return; // Error already sent in parseRegistrationData
      }

      // Validate registration data
      const validationError = this.validateRegistrationData(playerRegData);
      if (validationError) {
        this.sendRegistrationError(ws, playerRegData.name, validationError);
        return;
      }

      const { name: providedName, password: providedPassword } = playerRegData;
      const currentClient = this.clients.get(clientId);

      if (!currentClient) {
        console.error(`Client ${clientId} not found in clients map during registration.`);
        this.sendRegistrationError(ws, providedName, "Internal server error");
        return;
      }

      // Process registration or login
      const responseData = this.processAuth(
        providedName,
        providedPassword,
        clientId,
        currentClient
      );

      // Send response
      this.sendRegistrationResponse(ws, responseData, clientId);
    } catch (err) {
      console.error(`Error in registration for ${clientId}:`, err);
      if (ws.readyState === WebSocket.OPEN) {
        this.sendRegistrationError(ws, "", "Error processing registration");
      }
    }
  }

  /**
   * Parse registration data from message
   */
  private parseRegistrationData(
    dataString: string,
    clientId: string,
    ws: WebSocket
  ): RegistrationData | null {
    try {
      const parsed = typeof dataString === "string" ? JSON.parse(dataString) : dataString;
      console.log(`Parsed player registration data from ${clientId}:`, parsed);
      return parsed as RegistrationData;
    } catch (parseError) {
      console.error(`Failed to parse player registration data from ${clientId}:`, parseError);
      this.sendRegistrationError(ws, "", "Invalid data format");
      return null;
    }
  }

  /**
   * Validate registration data
   */
  private validateRegistrationData(data: RegistrationData): string | null {
    if (
      !data ||
      typeof data !== "object" ||
      !data.name ||
      typeof data.name !== "string" ||
      data.name.trim() === "" ||
      !data.password ||
      typeof data.password !== "string" ||
      data.password === ""
    ) {
      return "Name and password are required and must be non-empty strings";
    }
    return null;
  }

  /**
   * Process authentication (registration or login)
   */
  private processAuth(
    username: string,
    password: string,
    clientId: string,
    currentClient: ClientInfo
  ): RegistrationResponse {
    const trimmedUsername = username.trim();

    if (this.userManager.userExists(trimmedUsername)) {
      // Existing user - Login attempt
      return this.processLogin(trimmedUsername, password, clientId, currentClient);
    } else {
      // New user - Registration
      return this.processRegistration(trimmedUsername, password, clientId, currentClient);
    }
  }

  /**
   * Process login for existing user
   */
  private processLogin(
    username: string,
    password: string,
    clientId: string,
    currentClient: ClientInfo
  ): RegistrationResponse {
    if (this.userManager.verifyPassword(username, password)) {
      // Password matches - Login success
      currentClient.username = username;
      console.log(`User ${username} logged in for client ${clientId}`);
      return {
        name: username,
        index: clientId,
        error: false,
        errorText: "",
      };
    } else {
      // Password mismatch
      console.log(`Invalid password for user ${username} from client ${clientId}`);
      return {
        name: username,
        index: "-1",
        error: true,
        errorText: "Invalid password",
      };
    }
  }

  /**
   * Process registration for new user
   */
  private processRegistration(
    username: string,
    password: string,
    clientId: string,
    currentClient: ClientInfo
  ): RegistrationResponse {
    this.userManager.createUser(username, password);
    currentClient.username = username;
    console.log(`User ${username} registered and logged in for client ${clientId}`);
    return {
      name: username,
      index: clientId,
      error: false,
      errorText: "",
    };
  }

  /**
   * Send registration response to client
   */
  private sendRegistrationResponse(
    ws: WebSocket,
    responseData: RegistrationResponse,
    clientId: string
  ): void {
    const response = {
      type: "reg",
      data: JSON.stringify(responseData),
      id: 0,
    };

    console.log(`Sending registration response to ${clientId}:`, response);
    ws.send(JSON.stringify(response));
  }

  /**
   * Send registration error to client
   */
  private sendRegistrationError(ws: WebSocket, name: string, errorText: string): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(
      JSON.stringify({
        type: "reg",
        data: JSON.stringify({
          name,
          index: "-1",
          error: true,
          errorText,
        }),
        id: 0,
      })
    );
  }
}
