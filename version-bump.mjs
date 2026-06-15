import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;

// Guard: only run when npm_package_version is set (inside npm version hook)
if (!targetVersion) {
  console.error('version-bump.mjs: npm_package_version is not set. This script must run via "npm version".');
  process.exit(1);
}

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');

// Verify the version was written correctly
const verify = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (verify.version !== targetVersion) {
  console.error(`version-bump.mjs: Failed to write version ${targetVersion} to manifest.json`);
  process.exit(1);
}
console.log(`version-bump.mjs: manifest.json and versions.json updated to ${targetVersion}`);
