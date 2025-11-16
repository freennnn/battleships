export interface WebSocketMessage {
  type: string;
  data: string;
  id: number;
}

export interface RegistrationMessage extends WebSocketMessage {
  type: "reg";
  data: string; // JSON string of RegistrationData
}
