# Bean — Session Handoff

Use this document to resume work seamlessly in a fresh agent session.

---

## 1. Project Overview & Product Scope

**Bean** is a cross-platform iOS & Android travel tracking app (inspired by *Been*, built to be faster, cleaner, and more capable) living at `/Users/alvaro/Documents/projects/bean`.

### Core User Requirements
1. **Map-first home screen** — full-bleed interactive 2D flat map + 3D orthographic globe toggle, zero map-API fees, and **effortless portrait-mode zoom & pan** without needing landscape mode (focal-point pinch `1x`–`24x`, inertial flick pan, one-handed double-tap-and-drag zoom, region quick-jump presets, bottom-sheet-aware camera framing).
2. **UK divided by constituent countries** — England (`GB-ENG`), Scotland (`GB-SCT`), Wales (`GB-WLS`), and Northern Ireland (`GB-NIR`) rendered as separate polygons on an extensible regional data model (`parentId: 'GB'`), with user-selectable counting rules: **UK Split (`196` base)** vs **UN Strict (`193` base)** + toggleable **+47 territories**.
3. **Counter & stats** — world total/percentage, continent breakdown (tap to jump on map), UK Nations (`X/4`), countries per year chart, geographic extremes, shareable PNG map card, plus **secondary stat: "Top N% of travelers for your age"** (local offline benchmark model).
4. **Wishlist, goals & year collections**:
   - Travel goals (e.g., *"Visit 100 countries by 2050"*) with required countries/year pace, current annual pace, and projected completion year.
   - Wishlist with a **"Select All Except..."** bulk flow (with atomic Undo).
   - Past (`visited`) and future (`planned`) **Year Collections** with **"View on Map"** highlighting.
5. **100% Offline-First MVP** — Supabase/cloud sync was explicitly deferred out of the MVP. Persistence is local SQLite (`expo-sqlite`, sync-ready schema with UUIDs, `updated_at`, and `deleted_at` tombstones) + portable versioned JSON Export/Import backup (Merge LWW or Replace).

---

## 2. Current Status & Repository Map

All 5 MVP phases are implemented, typechecked, unit-tested, and verified natively on **iPhone 18 Pro** iOS Simulator.

### Verification Status (Last Run)
- `npx tsc --noEmit`: **PASS (0 errors)**
- `npm test`: **PASS (5/5 suites, 17/17 tests)**
- `npx expo export --platform ios --platform android`: **PASS** (both iOS & Android Hermes bundles compile cleanly)
- Native iOS Debug build (`com.bean.travel` on iPhone 18 Pro): **PASS (0 build errors, 0 Metro/LogBox warnings)**
- Visual walkthrough report with 12 live simulator screenshots: [walkthrough-report.html](./walkthrough-report.html)

### Tech Stack
- Expo SDK `~58.0.26`, React Native `0.88.1`, React `19.3.0`, TypeScript `~6.0.3`
- Expo Router (`app/_layout.tsx`, `app/(tabs)/*`), Zustand (`src/store/useTravelStore.ts`)
- `@shopify/react-native-skia` (`2.14.0`), `d3-geo`, `topojson-client`
- `react-native-reanimated` (`4.7.1`) + `react-native-worklets`, `react-native-gesture-handler` (`~3.3.0`)
- `expo-sqlite`, `expo-haptics`, `expo-file-system`, `expo-sharing`, `expo-document-picker`, `expo-crypto`, `lucide-react-native`

### Key Files
- **Cartography Pipeline & Data**:
  - `scripts/build-geo-data.mjs` — builds Natural Earth `50m` UK-split TopoJSON (`241.2 KB`) & catalog (`104.2 KB`)
  - `src/data/world-uk-split.topo.json`, `src/data/places-catalog.json`, `src/data/places.ts`
- **Map Engine & Components**:
  - `src/map/cameraMath.ts` — portrait camera math, focal-point zoom, safe-viewport framing, region presets
  - `src/map/geoEngine.ts` — Skia 2D pre-compiled paths, 3D orthographic globe, hit-testing
  - `src/components/map/WorldMapCanvas.tsx` — full-bleed 2D/3D canvas, gestures, HUD, labels
  - `src/components/map/PlaceDetailSheet.tsx` — country detail card, UK 4-nations switcher, year collections, notes
  - `src/components/map/PlaceSearchModal.tsx` — instant place search & quick-mark
- **Domain, Persistence & Backup**:
  - `src/db/schema.ts`, `src/db/repositories.ts`, `src/store/useTravelStore.ts`
  - `src/domain/statsCalculator.ts`, `src/domain/goalsCalculator.ts`, `src/domain/wishlistOps.ts`
  - `src/sync/backupService.ts`, `src/sync/backupFiles.ts`
- **Screens & Styling**:
  - `src/theme/mapThemes.ts`
  - `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/stats.tsx`, `app/(tabs)/goals.tsx`, `app/(tabs)/settings.tsx`
  - `src/components/wishlist/SelectAllExceptModal.tsx`
- **Tests**: `__tests__/places.test.ts`, `__tests__/cameraMath.test.ts`, `__tests__/statsCalculator.test.ts`, `__tests__/goalsCalculator.test.ts`, `__tests__/backupAndWishlist.test.ts`

### Local Environment & Simulator Notes
- **Installed Skill**: `.agents/skills/better-ui/SKILL.md` (installed via `npx skills add https://github.com/jakubkrehel/skills --skill better-ui`). **Read `.agents/skills/better-ui/SKILL.md` and its references (`surfaces.md`, `icons.md`) before touching UI code.**
- **Expo Rules**: Read `AGENTS.md` (use `npx expo install` for Expo packages; don't hand-edit generated `ios/`/`android/`).
- **Important Port Note**: Port `8081` may be occupied by another local project (`@outbox/mobile`). Do **not** kill port `8081`; use port `8082` (`RCT_METRO_PORT=8082` / `npx expo start --port 8082`).
- **iOS Simulator**: `iPhone 18 Pro` (`F9334949-4178-4EAF-B22A-1DDEF9BDB490`) has `com.bean.travel` installed. Note that `npx expo install` on this project occasionally needs `-- --legacy-peer-deps` due to `react@19.3.0` vs `react-dom@19.3.1` peer resolution.
- **Note on `expo-blur`**: Not installed yet; install via `npx expo install expo-blur -- --legacy-peer-deps` if using blurred glass overlays (note that adding a new native module requires rebuilding the iOS dev client with `RCT_METRO_PORT=8082 npx expo run:ios --device F9334949-4178-4EAF-B22A-1DDEF9BDB490 --no-bundler`).
- **Live Screenshots from Previous Audit**: Embedded in `walkthrough-report.html` (originals also at `/Users/alvaro/.gemini/antigravity-cli/brain/bc91312e-009f-48c5-8e5a-317acec00887/scratch/screenshots/`).

---

## 3. Immediate Next Task: UI Craft Overhaul (Eliminate the "Vibe-Coded" Look)

The user reviewed the working app and said: **"It looks too vibe-coded."**
We installed `.agents/skills/better-ui` and ran a dedicated UI Craft Reviewer audit against all 12 live screenshots and every UI file. **No redesign code has been applied yet — this is the next task to execute.**

### Open User Preferences to Confirm Before Coding
1. **Tab Bar Style**:
   - *(Recommended)* Switch to Expo SDK 58's native **`NativeTabs`** (`expo-router/native-tabs`) using SF Symbols (`map`/`map.fill`, `chart.bar`/`chart.bar.fill`, `checklist`, `gearshape`/`gearshape.fill`) for native iOS 26 Liquid Glass & Material tabs, **OR**
   - Keep custom JS `<Tabs>` docked flush to `bottom: 0` with `BlurView` + `StyleSheet.hairlineWidth` top divider.
2. **Map `+ / − / Reset` Vertical Stack**:
   - Remove the permanent `+ / − / Reset` stack (relying on pinch, double-tap, one-handed double-tap-drag zoom, and region quick-jump pills, showing only a subtle `Reset` pill when zoomed), **OR**
   - Keep a compact translucent `+ / −` pill stack for one-handed tapping.

---

## 4. Detailed UI Audit & Redesign Blueprint (from `better-ui` + Live Screenshots)

### A. Core `better-ui` Principles to Apply
1. **Concentric border radius (`outerRadius = innerRadius + padding + borderWidth`)**:
   - Cards (`borderRadius: 24`, `padding: 12`) → nested tiles/frames (`borderRadius: 12`).
   - Segmented controls (`borderRadius: 14`, `padding: 3`, no outer border) → active thumb (`borderRadius: 11`).
   - Inset-grouped lists: single outer container (`borderRadius: 18`) with flush rows (`borderRadius: 0`) separated by `StyleSheet.hairlineWidth` (`0.5px`) inset dividers (`marginLeft: 52`).
2. **Shadows for elevation, hairlines for structure**:
   - Dark mode: single pure neutral hairline (`rgba(255, 255, 255, 0.08)`), **never** Tailwind `slate-400` (`rgba(148,163,184,0.16)`) or bright colored accent borders around tiles/toasts/buttons.
   - Light mode: `#FFFFFF` surfaces + `rgba(0, 0, 0, 0.07)` hairline + soft elevation shadow (`shadowOpacity: 0.05–0.10`, `shadowRadius: 8–12`).
3. **Icons & Optical Alignment**:
   - Pass `absoluteStrokeWidth` on all `lucide-react-native` icons (`strokeWidth={1.6}` beside `400` text, `1.9` beside `500–600`, `2.2` standalone).
   - Apply `2px` less horizontal padding on the icon side of icon+text pills (`paddingLeft: 10, paddingRight: 12`).
   - Use distinct outline (inactive) vs filled (active) icons on tab navigation.
4. **Typography Discipline**:
   - Stop overusing `fontWeight: '800'` (currently on 35+ styles). Cap UI chrome at `600` (rows, buttons, pills) and `700` (large screen titles `30px` & hero figures `32px`).
   - Apply `fontVariant: ['tabular-nums']` to **every** numeric readout (year stepper, goal percentages, pace figures, bar chart labels, counters).

### B. Specific Visual Bugs & Anti-Patterns Caught in Screenshots
1. **Tailwind v3 Dark SaaS Palette (`src/theme/mapThemes.ts`)**: Currently uses `slate-950`/`900`/`800` + neon `#10B981` for everything (data + CTAs + active tabs + borders + toasts). Also `#FFFFFF` on `#F59E0B` (`Select All Except...` / `Add 165 Places`) fails WCAG AA (`~2.15:1` contrast).
2. **Broken Floating Tab Bar (`app/(tabs)/_layout.tsx:21-39`)**: `bottom: 38` lifts the full-width bar off the bottom edge so scrolling list content (`Asia 4/46`, `Cyprus`, `Birth Year`) visibly bleeds underneath the bar behind the iPhone Home Indicator.
3. **"Box Soup" Lists (`PlaceSearchModal.tsx`, `SelectAllExceptModal.tsx`, `goals.tsx`)**: 196+ individual bordered cards in lists, 165 repeated `[✓ Included]` pills, 4 nested bordered layers inside `PlaceDetailSheet`, and a glowing `1.5px` green border around the Undo toast (`app/_layout.tsx`).
4. **Loud Full-Width Neon CTAs (`goals.tsx:252,395,510`, `SelectAllExceptModal.tsx:317`)**: Giant 50px solid green/amber banners push actual user content below the fold.
5. **Clipped Stats Mini-Map (`app/(tabs)/stats.tsx:249-276`)**: `BASE_MAP_HEIGHT = 520` at `scale: 0.305` + `translateY: 4` = `162.6px` inside a `120px` Canvas — chops Antarctica flat along the bottom edge.
6. **Map Label Collisions (`src/components/map/WorldMapCanvas.tsx:680-717`)**: No screen-space collision check → produces `WalEngland` and `NorwSweden` overlapping labels.
7. **Scotland Selection Miter Blob (`src/components/map/WorldMapCanvas.tsx:802-807`)**: Default Skia miter join + thick `#F8FAFC` selection stroke turns the Hebrides islands into a jagged white blob obscuring the fill. Fix with `strokeJoin="round"`, `strokeCap="round"`, and capped selection stroke (`~1.35px`).
8. **Abrupt 2D Ocean Oval Cutoff (`src/components/map/WorldMapCanvas.tsx:782`)**: High contrast between `ocean` (`#0B1220`) and `oceanHighlight` (`#132038`) creates a sharp cutout shape when zoomed in.
9. **Small UX & Copy Bugs**:
   - `PlaceSearchModal.tsx:77,146`: Placeholder `"Search countries, UK nations, contin..."` clips; `[🧭 Mark]` uses a `Compass` icon even though tapping toggles `Visited`.
   - `goals.tsx:300,374,349`: Hardcoded `"1 yrs"` pluralization (`"1 remaining in 1 yrs"`, `"(1 yrs behind)"`); `"0 / 1 new"` renders bright green at `0`.
   - `WorldMapCanvas.tsx:1056-1095`: Region strip clips `"N. Am"` mid-word on the right edge; `+/-/Reset` covers countries on the 3D globe.

### C. Proposed Refined Color Tokens (`src/theme/mapThemes.ts`)

Decouple cartographic colors from UI chrome. Primary buttons use crisp monochrome ink/paper (`buttonPrimaryBg` / `buttonPrimaryText`) so only the map, progress bars, and small semantic dots carry heavy saturation:

| Token | **Obsidian Atlas** (Dark — replaces `midnight`) | **Warm Parchment** (Light) | **Nordic Mist** (Light — replaces `ocean`) |
| :--- | :--- | :--- | :--- |
| `surface` | `#0A0B0D` | `#F6F3EC` | `#F5F7FA` |
| `surfaceElevated` | `#14161A` | `#FFFFFF` | `#FFFFFF` |
| `surfaceSubtle` *(new)* | `#1C1F24` | `#EFEAE0` | `#EBF0F5` |
| `surfaceGlass` | `rgba(20, 22, 26, 0.78)` | `rgba(255, 255, 255, 0.82)` | `rgba(255, 255, 255, 0.82)` |
| `cardBorder` (hairline) | `rgba(255, 255, 255, 0.08)` | `rgba(0, 0, 0, 0.07)` | `rgba(0, 0, 0, 0.07)` |
| `textPrimary` | `#F4F4F5` | `#181715` | `#111418` |
| `textSecondary` | `#A1A1AA` | `#635E56` | `#556070` |
| `textMuted` | `#71717A` | `#9A9389` | `#8C97A6` |
| `buttonPrimaryBg` / `Text` *(new)* | `#F4F4F5` / `#0A0B0D` | `#181715` / `#FFFFFF` | `#111418` / `#FFFFFF` |
| `accent` | `#2DD49A` | `#C85A3A` | `#2563EB` |
| `accentSoft` | `rgba(45, 212, 154, 0.14)` | `rgba(200, 90, 58, 0.12)` | `rgba(37, 99, 235, 0.11)` |
| `wishlistAccent` / `wishlistText` *(new)* | `#EAB308` / `#181203` | `#D9911E` / `#1C1304` | `#D97706` / `#FFFFFF` |
| `livedAccent` | `#38BDF8` | `#246E7A` | `#6D28D9` |
| `ocean` / `oceanHighlight` | `#080B10` / `#0E141E` | `#DAE6F0` / `#E4EEF6` | `#D4E4F0` / `#DFECF6` |
| `landUnvisited` / `border` | `#1C2026` / `#2C323B` | `#ECE6DA` / `#C9C0B2` | `#F2F5F8` / `#BDCCD9` |
| `landVisited` / `borderSelected` | `#1FA97A` / `#FFFFFF` | `#D46E4E` / `#181715` | `#2563EB` / `#111418` |

### D. Prioritized Implementation Checklist
1. **Tokens, Tab Bar & Toast (`src/theme/mapThemes.ts`, `app/(tabs)/_layout.tsx`, `app/_layout.tsx`)**
   - Update theme tokens (keep theme IDs `'midnight' | 'parchment' | 'ocean'` backward-compatible with existing SQLite profiles, updating display names & hex values).
   - Upgrade tab bar per user's choice (`NativeTabs` or flush blurred dock) so scroll content never bleeds behind the home indicator.
   - Clean up `GlobalUndoToast`: remove green `1.5px` border, use neutral hairline + clean tinted `Undo` text button + `absoluteStrokeWidth`.
2. **Map Home & Place Sheet (`WorldMapCanvas.tsx`, `PlaceDetailSheet.tsx`)**
   - Add native blur (`BlurView`) + subtle shadow to floating HUD pills; tighten filter pills (`Visited 24` without neon green); clean up region quick-jump & zoom controls per user preference.
   - Add greedy screen-space bounding-box collision rejection (`dx < 72 && dy < 16`) in `visibleLabels`.
   - Fix Scotland/island selection stroke (`strokeJoin="round"`, `strokeCap="round"`, capped width) and soften `ocean` vs `oceanHighlight`.
   - Anchor `PlaceDetailSheet` cleanly to the bottom with swipe/drag expand-or-dismiss, flatten nested bordered boxes, fix concentric radii (`14` → `11`), remove glowing green borders on UK chips, and add `tabular-nums` to `yearVal`.
3. **Lists & Modals (`PlaceSearchModal.tsx`, `SelectAllExceptModal.tsx`, `goals.tsx` Wishlist)**
   - Replace per-row bordered cards with clean full-width/inset-grouped rows separated by `StyleSheet.hairlineWidth` dividers (`marginLeft: 52`).
   - In `PlaceSearchModal`: shorten placeholder to `"Search countries or regions..."` and replace `Compass` icon with `Plus` / circular toggle control.
   - In `SelectAllExceptModal`: replace 165 `[✓ Included]` pills with trailing `CheckCircle2` vs `MinusCircle` icons and switch footer CTA to monochrome `buttonPrimaryBg` / `buttonPrimaryText`.
4. **Stats, Goals & Settings (`stats.tsx`, `goals.tsx`, `settings.tsx`)**
   - `stats.tsx`: Dynamically compute mini-map scale so Antarctica is never clipped, match concentric `borderRadius: 12`, remove accent outlines on UK tiles, replace fat orange percentile bar with a thin spectrum track + marker dot, add `ChevronRight` to tappable continent rows, thin bars to `5px`.
   - `goals.tsx`: Move `+ New Goal` / `+ New Year` to a crisp top-right header action button, fix `1 yr` vs `yrs` pluralization, stop coloring `0 / N new` green, replace 3 heavy `paceBox` blocks with hairline-separated typographic columns, remove accent outline on `View on Map`.
   - `settings.tsx`: Convert to iOS Inset Grouped sections (uppercase muted section headers outside cards, `hairlineWidth` dividers inside cards, monochrome `Export JSON` button, clean theme preview cards without harsh `2px` neon border).
5. **Re-Verify & Update Walkthrough**:
   - Run `npx tsc --noEmit && npm test`.
   - Rebuild/reload on `iPhone 18 Pro` (`F9334949-4178-4EAF-B22A-1DDEF9BDB490`, port `8082`), visually inspect all screens, and regenerate `walkthrough-report.html`.
