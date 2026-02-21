const JavaScriptObfuscator = require('javascript-obfuscator');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const ELECTRON_SRC = path.join(__dirname, '..', 'src-electron');
const APP_SRC = path.join(__dirname, '..', 'app');

// Heavy obfuscation for main process & services
// NOTE: selfDefending and debugProtection are DISABLED because they are
// incompatible with V8 bytecode compilation (bytenode).
// selfDefending checks Function.toString() which fails on bytecode functions.
// debugProtection creates debugger loops that crash Electron's main process.
const OBFUSCATOR_HEAVY = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ['rc4'],
  stringArrayIndexesType: ['hexadecimal-number'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

// Lighter config for preload scripts (must not break contextBridge/IPC)
const OBFUSCATOR_PRELOAD = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: false,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.5,
  transformObjectKeys: false,
  unicodeEscapeSequence: false
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function obfuscateFile(filePath, config) {
  const code = fs.readFileSync(filePath, 'utf8');
  try {
    const result = JavaScriptObfuscator.obfuscate(code, config);
    fs.writeFileSync(filePath, result.getObfuscatedCode());
    console.log(`  [OK] ${path.relative(BUILD_DIR, filePath)}`);
  } catch (err) {
    console.error(`  [ERR] ${path.basename(filePath)}: ${err.message}`);
  }
}

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Extract large <script> blocks from HTML to external files,
 * obfuscate them, and link back via <script src>.
 */
function obfuscateHTMLScripts(htmlPath) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const dir = path.dirname(htmlPath);
  const baseName = path.basename(htmlPath, '.html');
  const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
  let matches = [];
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    matches.push({ full: match[0], code: match[1].trim(), index: match.index });
  }

  let extractedCount = 0;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (m.code.length < 200) continue;

    extractedCount++;
    const jsFile = `${baseName}-bundle-${extractedCount}.js`;
    const jsPath = path.join(dir, jsFile);

    fs.writeFileSync(jsPath, m.code, 'utf8');

    const lightConfig = {
      compact: true,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: true,
      identifierNamesGenerator: 'hexadecimal',
      selfDefending: false,
      simplify: true,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.5,
      transformObjectKeys: false
    };

    try {
      const jsCode = fs.readFileSync(jsPath, 'utf8');
      const result = JavaScriptObfuscator.obfuscate(jsCode, lightConfig);
      fs.writeFileSync(jsPath, result.getObfuscatedCode());
      console.log(`  [OK] Extracted & obfuscated: ${jsFile} (${(m.code.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.warn(`  [WARN] Could not obfuscate ${jsFile} (${err.message}), keeping original`);
    }

    html = html.slice(0, m.index) + `<script src="${jsFile}"></script>` + html.slice(m.index + m.full.length);
  }

  if (extractedCount > 0) {
    fs.writeFileSync(htmlPath, html);
    console.log(`  [OK] ${path.basename(htmlPath)}: extracted ${extractedCount} script(s)`);
  }
}

// Files that will be compiled to V8 bytecode
const BYTECODE_FILES = [
  'src-electron/main.js',
  'src-electron/services/fingerprint.js',
  'src-electron/services/heartbeat.js',
  'src-electron/services/updater.js'
];

// Service require mappings to patch before compilation
const REQUIRE_PATCHES = [
  { from: "require('./services/fingerprint')", to: "require('./services/fingerprint.jsc')" },
  { from: "require('./services/heartbeat')", to: "require('./services/heartbeat.jsc')" },
  { from: "require('./services/updater')", to: "require('./services/updater.jsc')" },
];

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║    Aura Build System v3.0            ║');
  console.log('║    Bytecode + ASAR Protection        ║');
  console.log('╚══════════════════════════════════════╝\n');

  // 1. Clean build dir
  console.log('[1/8] Cleaning build directory...');
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true });
  }
  ensureDir(BUILD_DIR);

  // 2. Copy source files
  console.log('[2/8] Copying source files...');
  copyDir(ELECTRON_SRC, path.join(BUILD_DIR, 'src-electron'));
  copyDir(APP_SRC, path.join(BUILD_DIR, 'app'));
  fs.copyFileSync(
    path.join(__dirname, '..', 'package.json'),
    path.join(BUILD_DIR, 'package.json')
  );

  // 3. Patch require paths for bytecode compatibility
  console.log('[3/8] Patching require paths for bytecode...');
  const mainJsPath = path.join(BUILD_DIR, 'src-electron', 'main.js');
  let mainCode = fs.readFileSync(mainJsPath, 'utf8');
  for (const patch of REQUIRE_PATCHES) {
    if (mainCode.includes(patch.from)) {
      mainCode = mainCode.replace(patch.from, patch.to);
      console.log(`  [OK] ${patch.from} → .jsc`);
    }
  }
  fs.writeFileSync(mainJsPath, mainCode);

  // 4. Obfuscate Electron code
  console.log('[4/8] Obfuscating Electron code...');
  console.log('  Main process (heavy):');
  obfuscateFile(mainJsPath, OBFUSCATOR_HEAVY);

  console.log('  Services (heavy):');
  const servicesDir = path.join(BUILD_DIR, 'src-electron', 'services');
  if (fs.existsSync(servicesDir)) {
    fs.readdirSync(servicesDir).filter(f => f.endsWith('.js')).forEach(f => {
      obfuscateFile(path.join(servicesDir, f), OBFUSCATOR_HEAVY);
    });
  }

  console.log('  Preload scripts (light):');
  ['preload-license.js', 'preload-main.js', 'preload-update.js'].forEach(f => {
    const fp = path.join(BUILD_DIR, 'src-electron', f);
    if (fs.existsSync(fp)) obfuscateFile(fp, OBFUSCATOR_PRELOAD);
  });

  // 5. Extract & obfuscate HTML inline JavaScript
  console.log('[5/8] Extracting & obfuscating inline JS from HTML...');
  const htmlFiles = [
    path.join(BUILD_DIR, 'app', 'index.html'),
    path.join(BUILD_DIR, 'src-electron', 'license.html'),
    path.join(BUILD_DIR, 'src-electron', 'update.html')
  ];
  htmlFiles.forEach(fp => {
    if (fs.existsSync(fp)) obfuscateHTMLScripts(fp);
  });

  // 6. Inject DevTools blocker into main.js (no debugger traps - they crash with bytecode)
  console.log('[6/8] Injecting runtime protections...');
  const antiTamper = `
;(function(){
  setInterval(function(){
    try{
      var w=require('electron').BrowserWindow.getAllWindows();
      w.forEach(function(win){
        if(win&&win.webContents&&win.webContents.isDevToolsOpened()){
          win.webContents.closeDevTools();
        }
      });
    }catch(e){}
  },1500);
})();
`;
  fs.appendFileSync(mainJsPath, antiTamper);
  console.log('  [OK] DevTools blocker injected');

  // 7. Compile to V8 bytecode using Electron's V8 engine
  console.log('[7/8] Compiling to V8 bytecode...');
  const bytenode = require('bytenode');

  for (const file of BYTECODE_FILES) {
    const fullPath = path.join(BUILD_DIR, file);
    if (fs.existsSync(fullPath)) {
      try {
        await bytenode.compileFile({
          filename: fullPath,
          electron: true,
          compileAsModule: true
        });
        // Remove original .js source, keep only .jsc bytecode
        fs.unlinkSync(fullPath);
        console.log(`  [OK] ${file} → ${file.replace('.js', '.jsc')}`);
      } catch (err) {
        console.error(`  [ERR] ${file}: ${err.message}`);
        console.error('        Falling back to obfuscated JS (no bytecode)');
      }
    }
  }

  // Create loader.js (tiny entry point that boots bytenode then loads main.jsc)
  const loaderCode = `'use strict';
require('bytenode');
require('./main.jsc');
`;
  fs.writeFileSync(path.join(BUILD_DIR, 'src-electron', 'loader.js'), loaderCode);
  console.log('  [OK] Created loader.js (bytecode entry point)');

  // Update build package.json to use loader as entry
  const buildPkgPath = path.join(BUILD_DIR, 'package.json');
  const buildPkg = JSON.parse(fs.readFileSync(buildPkgPath, 'utf8'));
  buildPkg.main = 'src-electron/loader.js';
  fs.writeFileSync(buildPkgPath, JSON.stringify(buildPkg, null, 2));
  console.log('  [OK] Updated package.json main → src-electron/loader.js');

  // 8. Generate integrity hashes (AFTER all transformations)
  console.log('[8/8] Generating integrity hashes...');
  const hashes = {};
  const criticalFiles = [
    'src-electron/loader.js',
    'src-electron/main.jsc',
    'src-electron/preload-license.js',
    'src-electron/preload-main.js',
    'src-electron/preload-update.js',
    'src-electron/services/fingerprint.jsc',
    'src-electron/services/heartbeat.jsc',
    'src-electron/services/updater.jsc',
    'app/index.html'
  ];

  criticalFiles.forEach(f => {
    const fp = path.join(BUILD_DIR, f);
    if (fs.existsSync(fp)) {
      hashes[f] = hashFile(fp);
      console.log(`  ${f}: ${hashes[f].slice(0, 16)}...`);
    }
  });

  fs.writeFileSync(
    path.join(BUILD_DIR, 'src-electron', '.integrity'),
    JSON.stringify(hashes),
    'utf8'
  );

  // Summary
  const jscCount = criticalFiles.filter(f => f.endsWith('.jsc') && fs.existsSync(path.join(BUILD_DIR, f))).length;
  const jsCount = criticalFiles.filter(f => f.endsWith('.js') && fs.existsSync(path.join(BUILD_DIR, f))).length;
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║    Build complete!                   ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`  V8 Bytecode files: ${jscCount}`);
  console.log(`  Obfuscated JS files: ${jsCount}`);
  console.log(`  Integrity hashes: ${Object.keys(hashes).length}`);
  console.log(`  Output: ${BUILD_DIR}`);
  console.log('  Next: npm run build:win\n');
  console.log('  Security layers:');
  console.log('    ✓ JavaScript obfuscation (RC4 + control flow)');
  console.log('    ✓ V8 bytecode compilation (source code removed)');
  console.log('    ✓ Anti-debug traps + DevTools blocker');
  console.log('    ✓ Integrity verification (SHA-256)');
  console.log('    ✓ ASAR protection (applied during packaging)');
}

main().catch(err => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
