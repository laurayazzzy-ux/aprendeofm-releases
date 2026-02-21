const path = require('path');
const keyService = require('../backend/services/keyService');

const args = process.argv.slice(2);
const maxDevices = parseInt(args[0]) || 1;
const note = args[1] || '';

try {
  const key = keyService.createKey({ maxDevices, note });
  console.log('='.repeat(50));
  console.log('  NEW LICENSE KEY GENERATED');
  console.log('='.repeat(50));
  console.log(`  Key:         ${key}`);
  console.log(`  Max Devices: ${maxDevices}`);
  console.log(`  Note:        ${note || '(none)'}`);
  console.log('='.repeat(50));
  console.log('  SAVE THIS KEY! It cannot be recovered.');
  console.log('='.repeat(50));
  process.exit(0);
} catch (err) {
  console.error('Error generating key:', err.message);
  process.exit(1);
}
