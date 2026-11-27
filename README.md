<p align="center">
  <img src="./assets/icon.png" alt="Bean app icon" width="96" height="96" />
</p>

<h1 align="center">Bean</h1>

<p align="center">
  An offline-first world travel map, country log, and goal tracker for iOS and Android.
</p>

---

## Features

### Interactive World Map
- **243 countries & territories** — Every sovereign state, territory, and microstate is tappable, searchable, and labelled, including an optional UK home-nation split (*England, Scotland, Wales, Northern Ireland*).
- **60/120fps Skia cartography** — GPU-rendered via `@shopify/react-native-skia` with merged color-bucket paths, deduplicated TopoJSON borders, diagonal hatched wishlist shaders, and ink-flood status transitions.
- **Jump-free multi-touch navigation** — Unified `Gesture.Manual()` pointer-slot state machine supporting smooth single-finger pan/fling, two-finger pinch & simultaneous pan, double-tap zoom-in, and two-finger tap zoom-out.
- **Landscape full-world view** — Rotate to landscape anytime to view the full world map edge-to-edge.
- **Three cartographic themes** — **Chart** (Admiralty atlas), **Blueprint** (dark cyanotype print), and **Survey** (topographic sheet).

### Place Logging
- Mark any country or territory as **Been here**, **Want to go**, **Not for me**, or **I lived here**.
- **Star favourites** to surface them on the map, in search, and in your travel record.
- Log **visit years** and personal **notes**, and filter the map live by visited, wishlist, favourites, skipped, or a specific year.

### Record & Analytics
- World and continent completion percentages, UK nation breakdown, hemisphere coverage, and furthest place from home.
- Year-by-year travel history and first-visit timeline.
- **Age Percentile & Target Calculator** — See an estimated percentile for your age (offline log-normal heuristic calibrated around UK/European traveler medians), pick any target percentile (`50th–99th`) to see how many countries it takes, and set it as a travel goal in one tap.

### Plans & Goals
- Create country-count travel goals with pace tracking and burn-up charts.
- Manage your wishlist, yearly travel collections, and *Not for me* list.

### Local-First Data & Exports
- **100% offline SQLite storage** (`expo-sqlite`) — No account, backend, or tracking required.
- **JSON backup & restore** — Export or import your full travel history anytime.
- **PNG map poster export** — Render and share a high-resolution `1080 × 1350` PNG of your current map directly from Settings.

---

## Tech Stack

- **Framework:** Expo SDK 58 / React Native 0.88 / Expo Router
- **Rendering & Gestures:** `@shopify/react-native-skia`, `react-native-reanimated` 4, `react-native-gesture-handler` 3
- **Cartography:** `d3-geo`, `topojson-client` (precompiled offline TopoJSON)
- **State & Storage:** Zustand, `expo-sqlite`
- **Testing & Types:** TypeScript, Jest

---

## Getting Started

### Prerequisites
- Node.js 20+
- For iOS builds: macOS with Xcode installed
- For Android builds: Android SDK (`ANDROID_HOME` or `~/Library/Android/sdk`) and JDK 17+

### Install & Run (Development)

```bash
npm install
npm start          # Start Expo dev server
npm run ios        # Build & run dev client on iOS Simulator
npm run android    # Build & run dev client on Android Emulator / device
```

### Tests & Typecheck

```bash
npx tsc --noEmit   # TypeScript typecheck
npm test           # Run Jest unit tests
```

---

## Installing Standalone Builds on Your Phone

Bean includes helper scripts to build and sideload offline **Release** builds onto your own phone (no Metro dev server required).

### iOS (Physical iPhone)

```bash
npm run install:ios                  # Build & install Release build (alias: npm run renew:ios)
npm run install:ios -- --dry-run     # Verify detected iPhone & Xcode signing team
npm run install:ios -- --clean       # Clear cached Xcode DerivedData before building
```

> With a free Apple Personal Team account, iOS sideloaded builds expire after 7 days — plug in your iPhone (or connect over Wi-Fi) and re-run `npm run renew:ios` to renew without losing app data.

### Android (Physical Phone or Emulator)

```bash
npm run install:android              # Build (device ABI only) & install Release APK via adb
npm run install:android:apk          # Reinstall the already-built APK immediately (skips Gradle)
npm run build:android:apk            # Build a universal standalone Release APK (--all-abis)
npm run install:android -- --dry-run # Verify Android SDK, Java Home, adb, and target ABI
npm run install:android -- --emulator # Allow installing onto a running Android Emulator
```

> By default, `install:android` detects your connected phone's CPU ABI (e.g. `arm64-v8a`) so Gradle only compiles that architecture instead of all four. Pass `--all-abis` if you want a universal APK to share across devices.

---

## Project Structure

```text
app/                    # Expo Router screens (Map, Record, Plans tabs + Settings modal)
src/
  components/           # WorldMapCanvas, PlaceSheet, SearchSheet, UI primitives
  data/                 # Offline places catalog (243 places) & UK-split TopoJSON
  db/                   # SQLite schema, migrations, and repositories
  domain/               # Stats, age-percentile, goal, and wishlist calculators
  map/                  # Skia geo engine, camera math, cartography shaders, PNG exporter
  store/                # Zustand travel store
  sync/                 # JSON backup export/import service
  theme/                # Chart, Blueprint, and Survey map themes + typography
scripts/
  build-geo-data.mjs    # Rebuilds offline TopoJSON & places catalog (`npm run build:geo`)
  renew-ios.mjs         # Standalone iOS Release build & install helper
  install-android.mjs   # Standalone Android Release APK build & install helper
assets/                 # Light, dark, tinted, Android adaptive, and splash icons
__tests__/              # Jest unit tests
```

---

## Roadmap

Tracked in GitHub Issues:
- [#1 — Trips: central hub for reservations and flight tickets](https://github.com/AlvaroRausell/bean/issues/1)
- [#2 — Trip Journal: daily notes and travel memories](https://github.com/AlvaroRausell/bean/issues/2)
- [#3 — Trip Photos: attach and browse photos per trip and place](https://github.com/AlvaroRausell/bean/issues/3)

---

## License

[MIT](./LICENSE) © Álvaro Rausell Guiard
