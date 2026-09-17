const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const srcDir = path.join(rootDir, 'src');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 1. Copy src/index.js to dist/index.js
fs.copyFileSync(path.join(srcDir, 'index.js'), path.join(distDir, 'index.js'));
console.log('✓ Copied src/index.js to dist/index.js');

// 2. Copy src/global.js to dist/global.js
fs.copyFileSync(path.join(srcDir, 'global.js'), path.join(distDir, 'global.js'));
console.log('✓ Copied src/global.js to dist/global.js');

// 3. Copy ui/ui.js to dist/ui.js
fs.copyFileSync(path.join(rootDir, 'ui/ui.js'), path.join(distDir, 'ui.js'));
console.log('✓ Synced ui/ui.js to dist/ui.js');

// 4. Validate syntax of all files
execSync('node -c dist/index.js', { cwd: rootDir, stdio: 'inherit' });
execSync('node -c dist/global.js', { cwd: rootDir, stdio: 'inherit' });
execSync('node -c dist/ui.js', { cwd: rootDir, stdio: 'inherit' });

console.log('✓ All JS bundles verified with ZERO syntax errors!');
