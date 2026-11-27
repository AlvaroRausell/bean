#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ANDROID_DIR = join(ROOT, 'android');
const GRADLEW = join(ANDROID_DIR, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const APK_PATH = join(
  ANDROID_DIR,
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk'
);

function parseArgs(argv) {
  const opts = {
    device: process.env.ANDROID_SERIAL ?? null,
    allowEmulator: false,
    apkOnly: false,
    installOnly: false,
    allAbis: false,
    clean: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--clean') {
      opts.clean = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--apk-only') {
      opts.apkOnly = true;
    } else if (arg === '--install-only') {
      opts.installOnly = true;
    } else if (arg === '--all-abis') {
      opts.allAbis = true;
    } else if (arg === '--emulator') {
      opts.allowEmulator = true;
    } else if ((arg === '--device' || arg === '-d') && argv[i + 1]) {
      opts.device = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: npm run install:android -- [options]',
          '',
          'Builds a standalone Release APK of Bean and installs it on a connected Android phone.',
          '',
          'Options:',
          '  -d, --device <serial>  Target Android device serial (auto-detected if omitted)',
          '      --emulator         Allow installing onto a running Android Emulator',
          '      --apk-only         Build the standalone Release APK without installing via adb',
          '      --install-only     Install the already-built Release APK without rebuilding',
          '      --all-abis         Build all 4 ABIs instead of matching the connected device ABI',
          '      --clean            Run Gradle clean before building Release APK',
          '      --dry-run          Print detected SDK, Java, adb, and device without building',
          '  -h, --help             Show this help message',
        ].join('\n')
      );
      process.exit(0);
    }
  }
  return opts;
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  const candidates = [
    '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  if (process.platform === 'darwin') {
    try {
      const detected = execFileSync('/usr/libexec/java_home', ['-v', '17+'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (detected && existsSync(detected)) return detected;
    } catch {
      // fall through
    }
  }
  return null;
}

function resolveDeviceAbi(adbPath, serial) {
  try {
    const abi = execFileSync(adbPath, ['-s', serial, 'shell', 'getprop', 'ro.product.cpu.abi'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].includes(abi)) {
      return abi;
    }
  } catch {
    // fall through
  }
  return null;
}

function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function resolveAdb(sdkDir) {
  if (sdkDir) {
    const candidate = join(
      sdkDir,
      'platform-tools',
      process.platform === 'win32' ? 'adb.exe' : 'adb'
    );
    if (existsSync(candidate)) return candidate;
  }
  try {
    const which = execFileSync('which', ['adb'], { encoding: 'utf8' }).trim();
    if (which) return which;
  } catch {
    // fall through
  }
  return null;
}

function listAdbDevices(adbPath) {
  const out = execFileSync(adbPath, ['devices', '-l'], { encoding: 'utf8' });
  const lines = out
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1] ?? 'unknown';
    const modelMatch = line.match(/model:(\S+)/);
    const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : serial;
    const isEmulator = serial.startsWith('emulator-');
    return { serial, state, model, isEmulator };
  });
}

function resolveTargetDevice(adbPath, opts) {
  const all = listAdbDevices(adbPath);
  const eligible = opts.allowEmulator || opts.device ? all : all.filter((d) => !d.isEmulator);

  if (opts.device) {
    const found = all.find((d) => d.serial === opts.device || d.model === opts.device);
    if (!found) {
      console.error(`Android device "${opts.device}" not found. Connected adb targets:`);
      for (const d of all) {
        console.error(`  - ${d.model} [${d.serial}] (${d.state})`);
      }
      process.exit(1);
    }
    return found;
  }

  const ready = eligible.find((d) => d.state === 'device');
  if (ready) return ready;

  const unauthorized = eligible.find((d) => d.state === 'unauthorized');
  if (unauthorized) {
    console.error(
      `Found Android device ${unauthorized.model} [${unauthorized.serial}], but USB debugging is unauthorized.\n` +
        'Unlock your phone and tap "Allow USB debugging", then re-run.'
    );
    process.exit(1);
  }

  console.error(
    [
      'No connected Android phone found.',
      '1. Enable Developer Options -> USB debugging on your Android phone.',
      '2. Plug it in via USB, unlock it, and tap Allow on the USB debugging prompt.',
      '3. Or run with --apk-only to build a standalone APK you can copy to your phone, or --emulator for an emulator.',
    ].join('\n')
  );
  process.exit(1);
}

function run(cmd, args, cwd, env) {
  const result = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
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
  const sdkDir = resolveAndroidSdk();
  const adbPath = resolveAdb(sdkDir);
  const javaHome = resolveJavaHome();

  if (!sdkDir) {
    console.error(
      'Android SDK not found. Install Android Studio / SDK or set ANDROID_HOME, then re-run.'
    );
    process.exit(1);
  }

  const env = {
    ...process.env,
    ANDROID_HOME: sdkDir,
    ANDROID_SDK_ROOT: sdkDir,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  };

  console.log(`Android SDK   : ${sdkDir}`);
  console.log(`Java Home     : ${javaHome ?? '(using PATH default)'}`);
  console.log(`adb           : ${adbPath ?? '(not found)'}`);

  let target = null;
  let targetAbi = null;
  if (!opts.apkOnly) {
    if (!adbPath) {
      console.error('adb not found in Android SDK platform-tools.');
      process.exit(1);
    }
    if (opts.dryRun) {
      const devices = listAdbDevices(adbPath);
      const ready = devices.find((d) => d.state === 'device' && (opts.allowEmulator || !d.isEmulator));
      if (ready && !opts.allAbis) {
        targetAbi = resolveDeviceAbi(adbPath, ready.serial);
      }
      console.log(
        `Target device : ${
          ready
            ? `${ready.model} [${ready.serial}] (${ready.state})`
            : 'none connected (plug in Android phone with USB debugging enabled, or use --apk-only)'
        }`
      );
      console.log(`Target ABI    : ${targetAbi ?? 'all (arm64-v8a, armeabi-v7a, x86, x86_64)'}`);
      console.log(`Output APK    : ${APK_PATH}`);
      console.log('\n[dry-run] Android toolchain verified.');
      return;
    }
    target = resolveTargetDevice(adbPath, opts);
    if (!opts.allAbis) {
      targetAbi = resolveDeviceAbi(adbPath, target.serial);
    }
    console.log(`Target device : ${target.model} [${target.serial}] (${target.state})`);
    console.log(`Target ABI    : ${targetAbi ?? 'all (arm64-v8a, armeabi-v7a, x86, x86_64)'}`);
  } else if (opts.dryRun) {
    console.log(`Target ABI    : all (arm64-v8a, armeabi-v7a, x86, x86_64)`);
    console.log(`Output APK    : ${APK_PATH}`);
    console.log('\n[dry-run] Ready to build standalone Release APK.');
    return;
  }

  if (!opts.installOnly) {
    if (!existsSync(GRADLEW)) {
      console.log('\nGenerating android/ project with expo prebuild…');
      run('npx', ['expo', 'prebuild', '--platform', 'android'], ROOT, env);
    }

    const gradleTasks = opts.clean ? ['clean', 'assembleRelease'] : ['assembleRelease'];
    if (targetAbi) {
      gradleTasks.push(`-PreactNativeArchitectures=${targetAbi}`);
    }
    console.log(`\nBuilding standalone Release APK (./gradlew ${gradleTasks.join(' ')})…`);
    run(GRADLEW, gradleTasks, ANDROID_DIR, env);
  }

  if (!existsSync(APK_PATH)) {
    console.error(`Expected APK not found at ${APK_PATH}`);
    process.exit(1);
  }

  if (opts.apkOnly) {
    console.log(`\nDone! Standalone Release APK built at:\n  ${APK_PATH}`);
    return;
  }

  console.log(`\nInstalling Bean Release APK onto ${target.model}…`);
  run(adbPath, ['-s', target.serial, 'install', '-r', APK_PATH], ROOT, env);
  console.log(`\nDone! Bean (Release) is installed on ${target.model}.`);
}

main();
