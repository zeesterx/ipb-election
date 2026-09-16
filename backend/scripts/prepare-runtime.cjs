const { cpSync, readFileSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const backendDirectory = resolve(__dirname, '..');
const outputDirectory = resolve(backendDirectory, 'dist');
const sourcePackage = JSON.parse(readFileSync(resolve(backendDirectory, 'package.json'), 'utf8'));
const buildOnlyDependencies = new Set([
  '@types/express',
  '@types/jsonwebtoken',
  '@types/node',
  '@types/pdfkit',
  '@types/pg',
  'typescript'
]);
const runtimeDependencies = Object.fromEntries(
  Object.entries(sourcePackage.dependencies).filter(([name]) => !buildOnlyDependencies.has(name))
);

cpSync(
  resolve(backendDirectory, '../supabase/migrations'),
  resolve(outputDirectory, 'migrations'),
  { recursive: true }
);
writeFileSync(resolve(outputDirectory, 'package.json'), JSON.stringify({
  name: 'ipb-election-backend-runtime',
  private: true,
  dependencies: runtimeDependencies,
  overrides: sourcePackage.overrides
}, null, 2));

execFileSync('npm', [
  'install',
  '--omit=dev',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--workspaces=false'
], { cwd: outputDirectory, stdio: 'inherit' });
