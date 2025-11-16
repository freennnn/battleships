┌─────────────────────────────────────────────────┐
│ clients Map (WebSocket connections)             │
│                                                  │
│ clientId → ClientInfo                            │
│ "1700000001" → {                                 │
│   ws: WebSocket,                                 │
│   username: "alice", ←───────────┐              │
│   isAlive: true,                 │              │
│   lastActivity: 1700000001,      │              │
│   roomId: "1700000050" ────┐     │              │
│ }                          │     │              │
└────────────────────────────┼─────┼──────────────┘
                             │     │
                             │     │ Links to username
                             │     │
                             │     ▼
                 ┌───────────┼─────────────────────┐
                 │           │  users Map (Accounts)│
                 │           │                      │
                 │           │  username → UserAcct │
                 │           │  "alice" → {         │
                 │           │    password: "***",  │
                 │           │    wins: 5           │
                 │           │  }                   │
                 │           └──────────────────────┘
                 │
                 │ Links to roomId
                 │
                 ▼
┌────────────────────────────────────────────────┐
│ rooms Map (Game rooms)                         │
│                                                 │
│ roomId → Room                                   │
│ "1700000050" → {                                │
│   id: "1700000050",                             │
│   users: [                                      │
│     {                                           │
│       name: "alice",                            │
│       index: "1700000001" ←───── Links back to │
│     }                             clientId      │
│   ]                                             │
│ }                                               │
└─────────────────────────────────────────────────┘