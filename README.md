# Battleships Game

A WebSocket-based Battleships game backend implementation.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm run dev
```

The WebSocket server will start on port 3000.

## WebSocket Protocol

The server accepts JSON messages with the following format:

### Initialize Game
```json
{
  "type": "init",
  "positions": [[x1,y1], [x2,y2], [x3,y3]]
}
```
Response: `{"type": "init", "message": "OK"}`

### Make a Move
```json
{
  "type": "move",
  "x": number,
  "y": number
}
```
Response: `{"type": "move", "message": "hit" | "miss" | "sunk"}`

## Game Rules
- The game board is 10x10
- Each ship is 3 cells long
- Ships are placed vertically
- Ships cannot overlap
- Coordinates start from bottom-left (0,0) 