#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const pluginDir = resolve(rootDir, 'plugin');

console.log('📦 Step 1: Building Onyx Obsidian Plugin bundle...');
execSync('pnpm build:plugin', { cwd: rootDir, stdio: 'inherit' });

const manifestPath = resolve(pluginDir, 'manifest.json');
const mainJsPath = resolve(pluginDir, 'main.js');
const readmePath = resolve(pluginDir, 'README.md');
const licensePath = resolve(rootDir, 'LICENSE');

if (!existsSync(manifestPath) || !existsSync(mainJsPath)) {
  console.error('❌ Error: manifest.json or main.js not found in plugin/');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = manifest.version;

console.log(`\n✅ Plugin build verified! Version: ${version}`);

const targetDir = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : null;

if (targetDir) {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  console.log(`\n🚀 Copying release files to target directory: ${targetDir}`);
  copyFileSync(manifestPath, resolve(targetDir, 'manifest.json'));
  copyFileSync(mainJsPath, resolve(targetDir, 'main.js'));
  if (existsSync(readmePath)) copyFileSync(readmePath, resolve(targetDir, 'README.md'));
  if (existsSync(licensePath)) copyFileSync(licensePath, resolve(targetDir, 'LICENSE'));

  console.log(`\n🎉 Files successfully copied to ${targetDir}:`);
  console.log('   - manifest.json');
  console.log('   - main.js');
  console.log('   - README.md');
  console.log('   - LICENSE');
  console.log('\n👉 Next steps in your plugin repository:');
  console.log(`   cd "${targetDir}"`);
  console.log(`   git add .`);
  console.log(`   git commit -m "release: ${version}"`);
  console.log(`   git tag ${version}`);
  console.log(`   git push origin main --tags`);
  console.log(`   gh release create ${version} main.js manifest.json --title "${version}" --notes "Release ${version}"`);
} else {
  console.log('\n💡 Tip: To copy files automatically to your standalone plugin repo:');
  console.log('   node scripts/sync-plugin-release.mjs <path-to-onyx-obsidian-plugin-repo>');
}
