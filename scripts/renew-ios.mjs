#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE = join(ROOT, 'ios', 'Bean.xcworkspace');
const DERIVED_DATA = '/tmp/bean-release-build';
const APP_PATH = join(DERIVED_DATA, 'Build', 'Products', 'Release-iphoneos', 'Bean.app');

function parseArgs(argv) {
  const opts = {
    device: process.env.IOS_DEVICE_UDID ?? null,
    team: process.env.APPLE_TEAM_ID ?? null,
    clean: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--clean') {
      opts.clean = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if ((arg === '--device' || arg === '-d') && argv[i + 1]) {
      opts.device = argv[++i];
    } else if ((arg === '--team' || arg === '-t') && argv[i + 1]) {
      opts.team = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: pnpm renew:ios [options]',
          '',
          'Builds a standalone Release binary of Bean and installs it on a connected iPhone.',
          '',
          'Options:',
          '  -d, --device <udid|name>  Target iPhone UDID or name (auto-detected if omitted)',
          '  -t, --team <teamId>       Apple Development Team ID (auto-detected from Xcode if omitted)',
          '      --clean               Clear cached derived data before building',
          '      --dry-run             Print detected device, team, and commands without building',
          '  -h, --help                Show this help message',
        ].join('\n'),
      );
      process.exit(0);
    }
  }
  return opts;
}

function listPhysicalIosDevices() {
  const tempDir = mkdtempSync(join(tmpdir(), 'bean-devicectl-'));
  const jsonPath = join(tempDir, 'devices.json');
  try {
    execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', jsonPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const devices = parsed?.result?.devices ?? [];
    return devices
      .filter(
        (d) =>
          d?.hardwareProperties?.reality === 'physical' &&
          d?.hardwareProperties?.platform === 'iOS' &&
          d?.hardwareProperties?.udid,
      )
      .map((d) => ({
        name: d?.deviceProperties?.name ?? 'iPhone',
        udid: d.hardwareProperties.udid,
        model: d?.hardwareProperties?.marketingName ?? d?.hardwareProperties?.productType ?? 'iPhone',
        state: d?.connectionProperties?.tunnelState ?? 'unknown',
        transport: d?.connectionProperties?.transportType ?? 'unknown',
        pairing: d?.connectionProperties?.pairingState ?? 'unknown',
      }));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function resolveDevice(requested) {
  const devices = listPhysicalIosDevices();
  if (devices.length === 0) {
    console.error(
      'No physical iPhone found. Plug your iPhone in via USB, unlock it, and tap Trust if prompted.',
    );
    process.exit(1);
  }

  let match;
  if (requested) {
    match = devices.find(
      (d) => d.udid.toLowerCase() === requested.toLowerCase() || d.name.toLowerCase() === requested.toLowerCase(),
    );
    if (!match) {
      console.error(`Device "${requested}" not found. Detected physical iOS devices:`);
      for (const d of devices) {
        console.error(`  - ${d.name} (${d.model}) [${d.udid}] (${d.state}, ${d.transport})`);
      }
      process.exit(1);
    }
  } else {
    match =
      devices.find((d) => d.state === 'connected' || d.state === 'available') ??
      devices.find((d) => d.transport === 'wired') ??
      devices.find((d) => d.pairing === 'paired') ??
      devices[0];
  }

  return match;
}

function resolveTeamId(requested) {
  if (requested) return requested;

  try {
    const raw = execFileSync(
      'defaults',
      ['read', 'com.apple.dt.Xcode', 'IDEProvisioningTeamByIdentifier'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = raw.match(/teamID\s*=\s*"?([A-Z0-9]{10})"?\s*;/);
    if (match?.[1]) return match[1];
  } catch {
    // Fall through to helpful error below.
  }

  console.error(
    [
      'Could not detect an Apple Development Team in Xcode.',
      'Sign in under Xcode -> Settings -> Accounts, or pass APPLE_TEAM_ID=<TEAM_ID> / --team <TEAM_ID>.',
    ].join('\n'),
  );
  process.exit(1);
}

function run(cmd, args, cwd = ROOT) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to run ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const device = resolveDevice(opts.device);
  const teamId = resolveTeamId(opts.team);

  console.log(`Target device : ${device.name} (${device.model}) [${device.udid}]`);
  console.log(`Device state  : ${device.state} (${device.transport}, ${device.pairing})`);
  console.log(`Signing team  : ${teamId}`);

  if (device.state === 'unavailable') {
    if (opts.dryRun) {
      console.log(
        '\n[dry-run] Note: device is currently unavailable — plug it in via USB (or unlock on the same Wi-Fi) before building.',
      );
      return;
    }
    console.error(
      `\n"${device.name}" is currently unavailable. Plug it in via USB (or unlock it on the same Wi-Fi) and re-run.`,
    );
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log('\n[dry-run] Ready to build Release and install to device.');
    return;
  }

  if (!existsSync(WORKSPACE)) {
    console.log('\nGenerating ios/ project with expo prebuild…');
    run('npx', ['expo', 'prebuild', '--platform', 'ios']);
  }

  if (opts.clean && existsSync(DERIVED_DATA)) {
    console.log(`\nClearing ${DERIVED_DATA}…`);
    rmSync(DERIVED_DATA, { recursive: true, force: true });
  }

  console.log('\nBuilding standalone Release binary for iOS…');
  run('xcodebuild', [
    '-workspace',
    WORKSPACE,
    '-scheme',
    'Bean',
    '-configuration',
    'Release',
    '-destination',
    `id=${device.udid}`,
    `DEVELOPMENT_TEAM=${teamId}`,
    'CODE_SIGN_STYLE=Automatic',
    '-allowProvisioningUpdates',
    '-allowProvisioningDeviceRegistration',
    '-derivedDataPath',
    DERIVED_DATA,
    'build',
  ]);

  console.log(`\nInstalling Bean.app onto ${device.name}…`);
  run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.udid, APP_PATH]);

  console.log(`\nDone! Bean (Release) is installed and renewed on ${device.name}.`);
}

main();
