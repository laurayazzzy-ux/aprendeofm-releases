/**
 * electron-builder afterPack hook
 * Applies asarmor protection to prevent ASAR extraction.
 *
 * When someone tries `asar extract app.asar`, they get:
 * - Corrupted/bloated fake entries that fill disk space
 * - Invalid header that crashes extraction tools
 */
const path = require('path');

exports.default = async function afterPack(context) {
  try {
    const asarPath = path.join(context.appOutDir, 'resources', 'app.asar');
    const fs = require('fs');

    if (!fs.existsSync(asarPath)) {
      console.log('  [asarmor] No app.asar found, skipping protection');
      return;
    }

    console.log('  [asarmor] Applying ASAR protection...');

    const { open, createBloatPatch } = require('asarmor');
    const asarmor = await open(asarPath);

    // Add 50GB of fake file entries - anyone extracting will fill their disk
    asarmor.patch(createBloatPatch(50));

    await asarmor.write(asarPath);

    const stat = fs.statSync(asarPath);
    console.log(`  [asarmor] ASAR protected! (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    console.log('  [asarmor] Extraction attempts will be blocked/corrupted');
  } catch (err) {
    console.warn('  [asarmor] Warning: Could not apply ASAR protection:', err.message);
    console.warn('  [asarmor] Build will continue without ASAR protection');
  }
};
