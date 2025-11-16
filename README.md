# Battleships Game

A multiplayer WebSocket-based Battleships game with TypeScript backend.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Backend Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build    # Compile TypeScript
npm start        # Run the server
```

The WebSocket server will start on **port 3000**.

### 3. Run the Frontend & Play

Navigate to the UI directory and start the frontend server:
```bash
cd ui
npm install      # First time only
npm start        # Start frontend server
```

### 4. Open in Browser

Open your browser and go to:
```
http://localhost:8181
```

**To play multiplayer:**
- Open the game in two different browser windows/tabs
- Register two different players
- Player 1: Create a room
- Player 2: Join the available room
- Place your ships and start battling!

## Development

**Code quality tools:**
```bash
npm run check        # Check code quality
npm run check:fix    # Auto-fix issues
```

## Project Structure

- `src/` - TypeScript source code
  - `index.ts` - Main server entry point
  - `modules/` - Game logic modules (RoomManager, GameManager, AttackHandler, etc.)
  - `types/` - TypeScript type definitions
- `dist/` - Compiled JavaScript output
- `ui/` - Frontend application