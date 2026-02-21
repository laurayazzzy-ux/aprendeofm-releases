/**
 * Aura Release Helper
 *
 * Usage:
 *   node scripts/release.js patch   - Bump patch (1.0.0 -> 1.0.1)
 *   node scripts/release.js minor   - Bump minor (1.0.0 -> 1.1.0)
 *   node scripts/release.js major   - Bump major (1.0.0 -> 2.0.0)
 *
 * What it does:
 *   1. Bumps version in package.json
 *   2. Runs the build (obfuscation + electron-builder)
 *   3. Outputs the installer files in dist/
 *   4. Shows instructions for uploading to your update server
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkgPath = path.join(ROOT, 'package.json');

function run(cmd, label) {
  console.log(`\n> ${label || cmd}`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    console.error(`\nFailed: ${label || cmd}`);
    process.exit(1);
  }
}

function main() {
  const bumpType = process.argv[2] || 'patch';
  if (!['patch', 'minor', 'major'].includes(bumpType)) {
    console.error('Usage: node scripts/release.js [patch|minor|major]');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const oldVersion = pkg.version;

  console.log('╔══════════════════════════════════════╗');
  console.log('║     Aura Release Builder             ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\nCurrent version: ${oldVersion}`);
  console.log(`Bump type: ${bumpType}`);

  // 1. Bump version
  run(`npm version ${bumpType} --no-git-tag-version`, `Bumping version (${bumpType})`);

  const newPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const newVersion = newPkg.version;
  console.log(`New version: ${newVersion}`);

  // 2. Build with obfuscation
  run('node scripts/build.js', 'Running code protection & obfuscation');

  // 3. Build Electron installer
  run('npx electron-builder --win --publish never', 'Building Windows installer');

  // 4. Show results
  const distDir = path.join(ROOT, 'dist');
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     Release Complete!                ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\nVersion: ${newVersion}`);
  console.log(`\nFiles in dist/:`);

  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir).filter(f => {
      return f.endsWith('.exe') || f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.blockmap');
    });
    files.forEach(f => {
      const stat = fs.statSync(path.join(distDir, f));
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      console.log(`  ${f} (${sizeMB} MB)`);
    });
  }

  console.log('\n─── Para actualizar tus usuarios: ───');
  console.log('1. Sube estos archivos a tu servidor de updates:');
  console.log('   - Aura-Setup-' + newVersion + '.exe');
  console.log('   - latest.yml');
  console.log('2. La app de tus usuarios detectará la nueva versión automáticamente');
  console.log('3. Les aparecerá un diálogo para actualizar\n');
}

main();
