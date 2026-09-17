const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packageDir = path.join(rootDir, 'torrserver-stream.iinaplugin');
const archiveFile = path.join(rootDir, 'torrserver-stream.iinaplgz');

const iinaPluginsDir = path.join(
  os.homedir(),
  'Library/Application Support/com.colliderli.iina/plugins'
);

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function packagePlugin() {
  console.log('=== Packaging TorrServer Stream Plugin ===');

  // 1. Build latest JS bundles
  console.log('1. Building bundles...');
  execSync('node scripts/build.js', { cwd: rootDir, stdio: 'inherit' });

  // 2. Prepare clean .iinaplugin package directory
  console.log(`2. Creating package directory: ${packageDir}`);
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(packageDir, { recursive: true });

  // Copy Info.json and README.md
  const filesToCopy = ['Info.json', 'README.md'];
  for (const f of filesToCopy) {
    const src = path.join(rootDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(packageDir, f));
    }
  }

  // Copy dist and ui
  copyRecursive(path.join(rootDir, 'dist'), path.join(packageDir, 'dist'));
  copyRecursive(path.join(rootDir, 'ui'), path.join(packageDir, 'ui'));

  console.log('✓ Created clean package folder: torrserver-stream.iinaplugin');

  // 3. Create .iinaplgz archive (zip format)
  console.log(`3. Creating distribution archive: ${archiveFile}`);
  if (fs.existsSync(archiveFile)) {
    fs.rmSync(archiveFile, { force: true });
  }

  try {
    execSync(`cd "${packageDir}" && zip -r -q "${archiveFile}" .`, { stdio: 'inherit' });
    console.log(`✓ Successfully packed: ${archiveFile}`);
  } catch (err) {
    console.error('Error creating zip archive:', err);
  }

  // 4. Install into IINA plugins directory if flag passed or user has IINA installed
  if (process.argv.includes('--install') && fs.existsSync(iinaPluginsDir)) {
    console.log('4. Installing into IINA plugins directory...');
    const targetDir = path.join(iinaPluginsDir, 'org.colliderli.torrserver-stream.iinaplugin');
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      copyRecursive(packageDir, targetDir);
      console.log(`✓ Installed to: ${targetDir}`);
    } catch (e) {
      console.warn(`Note: Could not copy directly to ${targetDir}: ${e.message}`);
    }
  }

  console.log('\n=== DONE! ===');
  console.log(`- Distribution Package (Folder): ${packageDir}`);
  console.log(`- Distribution Installer (Archive): ${archiveFile}`);
}

packagePlugin();
