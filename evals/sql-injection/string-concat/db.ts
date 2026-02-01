import { Database } from 'sqlite3';

const db = new Database(':memory:');

export async function getUserByUsername(username: string): Promise<User | null> {
  // BUG: SQL injection - user input directly concatenated into query
  const query = `SELECT * FROM users WHERE username = '${username}'`;

  return new Promise((resolve, reject) => {
    db.get(query, (err, row) => {
      if (err) reject(err);
      else resolve(row as User | null);
    });
  });
}

export async function getUserById(id: number): Promise<User | null> {
  // Safe: parameterized query
  const query = 'SELECT * FROM users WHERE id = ?';

  return new Promise((resolve, reject) => {
    db.get(query, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row as User | null);
    });
  });
}

interface User {
  id: number;
  username: string;
  email: string;
}
