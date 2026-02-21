const fs = require('fs');
const path = require('path');
const db = require('../config/db');

try {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // Split by semicolons and execute each statement
  const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    db.exec(stmt);
  }
  console.log('Database schema applied successfully.');
  console.log('Database location:', path.join(__dirname, '..', 'data', 'aura.db'));
} catch (err) {
  console.error('Error applying schema:', err.message);
  process.exit(1);
}
