const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('../backend/config/db');

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main() {
  const username = await ask('Admin username: ');
  const password = await ask('Admin password: ');

  if (!username || !password) {
    console.error('Username and password are required.');
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    // Try insert, if exists update
    const existing = db.prepare(`SELECT id FROM admin_users WHERE username = ?`).get(username);
    if (existing) {
      db.prepare(`UPDATE admin_users SET password_hash = ? WHERE username = ?`).run(hash, username);
    } else {
      db.prepare(`INSERT INTO admin_users (username, password_hash) VALUES (?, ?)`).run(username, hash);
    }
    console.log(`Admin user "${username}" created successfully.`);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    rl.close();
  }
}

main();
