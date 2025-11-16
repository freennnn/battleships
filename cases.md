Scenario 1: New User Registration

// User opens the game and registers with username "alice" and password "pass123"

1. CLIENT → SERVER: WebSocket message
   {
     type: "reg",
     data: '{"name": "alice", "password": "pass123"}',
     id: 0
   }

2. SERVER (index.ts): ws.on("message") receives the message
   ↓
3. case "reg": authHandler.handleRegistration(ws, data, clientId)
   ↓
4. AuthHandler.handleRegistration()
   ├─→ parseRegistrationData() // Parse JSON string
   ├─→ validateRegistrationData() // Check name and password are valid
   ├─→ processAuth() // Determine if login or registration
   │    ↓
   │    UserManager.userExists("alice") → false (new user)
   │    ↓
   │    processRegistration()
   │    ├─→ UserManager.createUser("alice", "pass123")
   │    │    ↓
   │    │    users.set("alice", { password: "pass123", wins: 0 })
   │    │    ↓
   │    └─→ Update client: clients.get(clientId).username = "alice"
   │
   └─→ sendRegistrationResponse()
        {
          type: "reg",
          data: '{"name": "alice", "index": "1700000001", "error": false, "errorText": ""}'
        }

5. SERVER: broadcastService.broadcastWinnersUpdate()
   ↓
   Sends to ALL clients:
   {
     type: "update_winners",
     data: '[{"name": "alice", "wins": 0}]'
   }


Scenario 2: Existing User Login
// User "alice" closes browser, reopens, and logs in again

1. CLIENT → SERVER: WebSocket message
   {
     type: "reg",
     data: '{"name": "alice", "password": "pass123"}',
     id: 0
   }

2. SERVER: ws.on("message")
   ↓
3. authHandler.handleRegistration()
   ├─→ parseRegistrationData()
   ├─→ validateRegistrationData()
   ├─→ processAuth()
   │    ↓
   │    UserManager.userExists("alice") → true (existing user)
   │    ↓
   │    processLogin()
   │    ├─→ UserManager.verifyPassword("alice", "pass123") → true
   │    │    ↓
   │    │    user = users.get("alice") // { password: "pass123", wins: 5 }
   │    │    ↓
   │    │    return user.password === "pass123"
   │    │
   │    └─→ Update client: clients.get(clientId).username = "alice"
   │
   └─→ sendRegistrationResponse()
        {
          type: "reg",
          data: '{"name": "alice", "index": "1700000099", "error": false, "errorText": ""}'
        }

Scenario 3: Wrong Password
1. CLIENT → SERVER:
   {
     type: "reg",
     data: '{"name": "alice", "password": "WRONG"}',
     id: 0
   }

2. authHandler.handleRegistration()
   ├─→ processAuth()
   │    ↓
   │    UserManager.verifyPassword("alice", "WRONG") → false
   │    ↓
   │    processLogin() returns:
   │    {
   │      name: "alice",
   │      index: "-1",  // ❌ Special value indicating failure
   │      error: true,
   │      errorText: "Invalid password"
   │    }
   │
   └─→ sendRegistrationResponse() sends error to client

CLIENT receives error, shows "Invalid password" message

Scenario 4: User Wins a Game
// User "alice" destroys all opponent ships

1. SERVER detects game over in endGame(game, winnerId)
   ↓
2. const winnerClient = clients.get(winnerId)  // Get client by ID
   ↓
3. winnerClient.username → "alice"
   ↓
4. UserManager.incrementWins("alice")
   ├─→ user = users.get("alice")  // { password: "pass123", wins: 5 }
   ├─→ user.wins += 1  // Now 6
   └─→ users.set("alice", user)  // Update the Map
   ↓
5. broadcastService.broadcastWinnersUpdate()
   ↓
   ALL clients receive updated leaderboard:
   {
     type: "update_winners",
     data: '[{"name": "alice", "wins": 6}, {"name": "bob", "wins": 3}, ...]'
   }
