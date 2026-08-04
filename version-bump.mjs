import { readFileSync, writeFileSync } from 'node:fs';

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
	throw new Error('npm_package_version is unavailable. Run this script through npm.');
}

const manifestPath = 'manifest.json';
const versionsPath = 'versions.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const versions = JSON.parse(readFileSync(versionsPath, 'utf8'));

manifest.version = targetVersion;
versions[targetVersion] = manifest.minAppVersion;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
writeFileSync(versionsPath, `${JSON.stringify(versions, null, '\t')}\n`);
