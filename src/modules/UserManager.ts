import type { UserAccount, WinnerEntry } from "../types/user.types.js";

/**
 * Manages user accounts and their statistics
 */
export class UserManager {
  private users: Map<string, UserAccount>;

  constructor() {
    this.users = new Map();
  }

  /**
   * Check if a user exists
   */
  userExists(username: string): boolean {
    return this.users.has(username);
  }

  /**
   * Get user account data
   */
  getUser(username: string): UserAccount | undefined {
    return this.users.get(username);
  }

  /**
   * Create a new user account
   */
  createUser(username: string, password: string): UserAccount {
    const newUser: UserAccount = {
      password,
      wins: 0,
    };
    this.users.set(username, newUser);
    console.log(`New user created: ${username}`);
    return newUser;
  }

  /**
   * Verify user password
   */
  verifyPassword(username: string, password: string): boolean {
    const user = this.users.get(username);
    if (!user) {
      return false;
    }
    return user.password === password;
  }

  /**
   * Increment user's win count
   */
  incrementWins(username: string): number {
    const user = this.users.get(username);
    if (!user) {
      console.error(`Cannot increment wins: User ${username} not found`);
      return 0;
    }
    user.wins += 1;
    console.log(`User ${username} wins updated to: ${user.wins}`);
    return user.wins;
  }

  /**
   * Get leaderboard sorted by wins (descending)
   */
  getLeaderboard(): WinnerEntry[] {
    return Array.from(this.users.entries())
      .map(([name, userData]) => ({
        name,
        wins: userData.wins,
      }))
      .sort((a, b) => b.wins - a.wins);
  }

  /**
   * Get all winners (for backward compatibility)
   */
  getAllWinners(): WinnerEntry[] {
    return Array.from(this.users.entries()).map(([name, userData]) => ({
      name,
      wins: userData.wins,
    }));
  }

  /**
   * Get total number of registered users
   */
  getUserCount(): number {
    return this.users.size;
  }
}
