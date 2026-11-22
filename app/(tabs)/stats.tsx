import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Canvas,
  Circle,
  Path,
  Shader,
  Skia,
  useFont,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import {
  Check,
  ChevronRight,
  Info,
  Minus,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  X,
} from 'lucide-react-native';
import { PLACES_CATALOG, searchPlaces } from '@/data/places';
import {
  calculateAgePercentile,
  calculateCountriesForPercentile,
  computeWorldStats,
} from '@/domain/statsCalculator';
import { REGION_PRESETS } from '@/map/cameraMath';
import {
  buildHatchUniforms,
  CONTINENT_MINI_SPECS,
  getContinentMiniMap,
  getHatchRuntimeEffect,
  getWorldMiniMap,
} from '@/map/cartography';
import { exportTravelMapPng } from '@/map/exportMapPng';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES } from '@/theme/mapThemes';
import { FONTS } from '@/theme/typography';
import { CollectionType, Continent } from '@/types';

const FONT_DISPLAY_TTF = require('@expo-google-fonts/encode-sans-semi-expanded/600SemiBold/EncodeSansSemiExpanded_600SemiBold.ttf');
const FONT_NUM_TTF = require('@expo-google-fonts/encode-sans-condensed/600SemiBold/EncodeSansCondensed_600SemiBold.ttf');
const FONT_BODY_TTF = require('@expo-google-fonts/encode-sans/400Regular/EncodeSans_400Regular.ttf');

const CONTINENT_TO_PRESET: Partial<Record<Continent, string>> = {
  Europe: 'europe',
  Asia: 'asia',
  Africa: 'africa',
  'North America': 'north_america',
  'South America': 'south_america',
  Oceania: 'oceania',
};

function formatLat(lat: number): string {
  const abs = Math.round(Math.abs(lat));
  return `${abs}°${lat >= 0 ? 'N' : 'S'}`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function formatAgeCopy(percentile: number, age: number): string {
  const inTen = Math.round(percentile / 10);
  if (percentile >= 95) {
    return `More than 95% of people aged ${age} have been to fewer countries.`;
  }
  if (inTen >= 1 && inTen <= 9) {
    return `About ${inTen} in 10 people aged ${age} have been to fewer countries.`;
  }
  return `You've been to more countries than about ${Math.round(percentile)}% of people aged ${age}.`;
}

export default function RecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const userPlaces = useTravelStore((s) => s.userPlaces);
  const yearCollections = useTravelStore((s) => s.yearCollections);
  const collectionItems = useTravelStore((s) => s.collectionItems);
  const travelGoals = useTravelStore((s) => s.travelGoals);
  const userProfile = useTravelStore((s) => s.userProfile);
  const selectPlace = useTravelStore((s) => s.selectPlace);
  const requestCameraBbox = useTravelStore((s) => s.requestCameraBbox);
  const setOverlayMode = useTravelStore((s) => s.setOverlayMode);
  const createYearCollection = useTravelStore((s) => s.createYearCollection);
  const deleteYearCollection = useTravelStore((s) => s.deleteYearCollection);
  const togglePlaceInCollection = useTravelStore((s) => s.togglePlaceInCollection);
  const createGoal = useTravelStore((s) => s.createGoal);

  const theme = MAP_THEMES[userProfile.mapTheme];
  const hatchEffect = useMemo(() => getHatchRuntimeEffect(), []);

  // Fonts for offscreen 1080x1350 share poster
  const posterTitleFont = useFont(FONT_NUM_TTF, 88);
  const posterHeadingFont = useFont(FONT_DISPLAY_TTF, 44);
  const posterBodyFont = useFont(FONT_BODY_TTF, 28);
  const posterSmallFont = useFont(FONT_BODY_TTF, 24);

  const [showAgeNote, setShowAgeNote] = useState(false);
  const [targetPercentile, setTargetPercentile] = useState(95);
  const [sharing, setSharing] = useState(false);

  // Add / Edit Year Collection modals (migrated into Record's unified Years timeline)
  const [yearModalOpen, setYearModalOpen] = useState(false);
  const currentYear = new Date().getFullYear();
  const [newColYear, setNewColYear] = useState(currentYear);
  const [newColType, setNewColType] = useState<CollectionType>('visited');
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');

  const stats = useMemo(
    () =>
      computeWorldStats(
        PLACES_CATALOG,
        userPlaces,
        yearCollections,
        collectionItems,
        {
          countingMode: userProfile.countingMode,
          includeTerritories: userProfile.includeTerritories,
          homePlaceId: userProfile.homePlaceId,
        }
      ),
    [userPlaces, yearCollections, collectionItems, userProfile]
  );

  const agePercentile = useMemo(() => {
    if (!userProfile.birthYear) return null;
    const age = currentYear - userProfile.birthYear;
    if (age < 10 || age > 105) return null;
    return calculateAgePercentile(age, stats.visitedCount);
  }, [userProfile.birthYear, currentYear, stats.visitedCount]);

  const percentileTarget = useMemo(() => {
    if (!agePercentile) return null;
    return calculateCountriesForPercentile(
      agePercentile.age,
      targetPercentile,
      stats.totalCount
    );
  }, [agePercentile, targetPercentile, stats.totalCount]);

  const matchingPercentileGoal = useMemo(() => {
    if (!percentileTarget) return null;
    return (
      travelGoals.find(
        (g) =>
          !g.deletedAt &&
          g.scope === 'world' &&
          g.targetCount === percentileTarget.requiredCountries
      ) ?? null
    );
  }, [travelGoals, percentileTarget]);

  const handleSetPercentileGoal = async () => {
    if (!percentileTarget) return;
    Haptics.selectionAsync();
    await createGoal({
      title: `${ordinal(percentileTarget.targetPercentile)} percentile (${percentileTarget.requiredCountries} countries)`,
      targetCount: percentileTarget.requiredCountries,
      targetYear: currentYear + 1,
      scope: 'world',
    });
  };

  // Hero uncropped world mini-map geometry
  const contentWidth = Math.max(280, screenWidth - 36);
  const worldMapH = Math.round(contentWidth * 0.48);
  const worldMini = useMemo(
    () => getWorldMiniMap(contentWidth, worldMapH, 4),
    [contentWidth, worldMapH]
  );

  // 6 Continent mini-maps (3x2 grid)
  const contTileW = Math.floor((contentWidth - 20) / 3);
  const contTileH = 58;
  const continentTiles = useMemo(() => {
    const statMap = new Map(stats.continents.map((c) => [c.continent, c]));
    return CONTINENT_MINI_SPECS.map((spec) => ({
      spec,
      stat: statMap.get(spec.continent) ?? {
        continent: spec.continent,
        visited: 0,
        wishlist: 0,
        total: 0,
        percent: 0,
      },
      mini: getContinentMiniMap(spec, contTileW, contTileH),
    }));
  }, [stats.continents, contTileW]);

  const hatchWorldUniforms = useMemo(
    () => buildHatchUniforms(theme.landUnvisited, theme.landWishlist, 4.4, 1.0),
    [theme.landUnvisited, theme.landWishlist]
  );

  const hatchContUniforms = useMemo(
    () => buildHatchUniforms(theme.landUnvisited, theme.landWishlist, 4.0, 0.95),
    [theme.landUnvisited, theme.landWishlist]
  );

  // Collection memberships map
  const collectionMemberMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of collectionItems) {
      if (item.deletedAt) continue;
      const list = map.get(item.collectionId) ?? [];
      list.push(item.placeId);
      map.set(item.collectionId, list);
    }
    return map;
  }, [collectionItems]);

  // Unified Years Timeline: planned collections above 'now', past years (with gap years!) below
  const timeline = useMemo(() => {
    const plannedCols = yearCollections
      .filter((c) => !c.deletedAt && c.collectionType === 'planned')
      .sort((a, b) => b.year - a.year)
      .map((col) => ({
        col,
        count: (collectionMemberMap.get(col.id) ?? []).length,
      }));

    const yearlyByYear = new Map(stats.yearlyStats.map((y) => [y.year, y]));
    const visitedColByYear = new Map<number, (typeof yearCollections)[number]>();
    for (const c of yearCollections) {
      if (!c.deletedAt && c.collectionType === 'visited' && !visitedColByYear.has(c.year)) {
        visitedColByYear.set(c.year, c);
      }
    }

    const allPastYears = new Set<number>([
      ...yearlyByYear.keys(),
      ...visitedColByYear.keys(),
    ]);
    const pastRows: {
      year: number;
      newCount: number;
      repeatCount: number;
      total: number;
      collectionId: string | null;
      placeIds: string[];
    }[] = [];

    if (allPastYears.size > 0) {
      const maxY = Math.max(currentYear, ...allPastYears);
      const minY = Math.min(...allPastYears);
      const clampedMin = Math.max(minY, maxY - 9); // show up to 10-year continuous span including gaps
      for (let y = maxY; y >= clampedMin; y--) {
        const ys = yearlyByYear.get(y);
        const col = visitedColByYear.get(y);
        const total = ys?.totalVisited ?? 0;
        const newCount = ys?.newCountries ?? 0;
        // Skip empty current year if no trips logged yet unless it's the only row
        if (y === currentYear && total === 0 && !col && allPastYears.size > 0) continue;
        pastRows.push({
          year: y,
          newCount,
          repeatCount: Math.max(0, total - newCount),
          total,
          collectionId: col?.id ?? null,
          placeIds: ys?.placeIds ?? [],
        });
      }
    }

    return { plannedCols, pastRows };
  }, [yearCollections, collectionMemberMap, stats.yearlyStats, currentYear]);

  // Bell curve path for quiet inline age context
  const bellCurvePath = useMemo(() => {
    return (
      Skia.Path.MakeFromSVGString('M 2 17 C 12 17 17 3 25 3 C 33 3 42 14 62 17') ??
      Skia.Path.Make()
    );
  }, []);

  const pickerPlaces = useMemo(() => searchPlaces(pickerQuery, true), [pickerQuery]);

  const selectableYears = useMemo(() => {
    const out: number[] = [];
    for (let y = currentYear + 4; y >= 1970; y--) out.push(y);
    return out;
  }, [currentYear]);

  const handleJumpContinent = (continent: Continent) => {
    const presetId = CONTINENT_TO_PRESET[continent];
    const preset = REGION_PRESETS.find((r) => r.id === presetId) ?? REGION_PRESETS[0];
    Haptics.selectionAsync();
    requestCameraBbox(preset.bbox);
    router.navigate('/(tabs)');
  };

  const handleJumpPlace = (placeId: string) => {
    Haptics.selectionAsync();
    selectPlace(placeId, true);
    router.navigate('/(tabs)');
  };

  const handleViewYearOnMap = (collectionId: string) => {
    Haptics.selectionAsync();
    setOverlayMode('year', collectionId);
    const ids = collectionMemberMap.get(collectionId) ?? [];
    if (ids.length > 0) {
      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;
      for (const id of ids) {
        const p = PLACES_CATALOG.find((x) => x.id === id);
        if (!p) continue;
        minLon = Math.min(minLon, p.frameBbox[0]);
        minLat = Math.min(minLat, p.frameBbox[1]);
        maxLon = Math.max(maxLon, p.frameBbox[2]);
        maxLat = Math.max(maxLat, p.frameBbox[3]);
      }
      if (Number.isFinite(minLon)) {
        requestCameraBbox([minLon - 6, minLat - 6, maxLon + 6, maxLat + 6]);
      }
    }
    router.navigate('/(tabs)');
  };

  const handleCreateYear = async () => {
    Haptics.selectionAsync();
    const created = await createYearCollection(newColYear, `${newColYear}`, newColType);
    setYearModalOpen(false);
    setPickerQuery('');
    setEditingCollectionId(created.id);
  };

  // Dedicated 1080×1350 offscreen Skia Share Poster (shared with Settings -> Export map as PNG)
  const handleSharePoster = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await exportTravelMapPng({
        userPlaces,
        yearCollections,
        collectionItems,
        userProfile,
        fonts: {
          title: posterTitleFont,
          heading: posterHeadingFont,
          body: posterBodyFont,
          small: posterSmallFont,
        },
      });
    } catch (e: any) {
      Alert.alert('Could not share', e?.message ?? 'Unable to save the map image.');
    } finally {
      setSharing(false);
    }
  };

  // Latitude span bar positions (90N -> 0%, 90S -> 100%)
  const northLat = stats.extremes.northernmost?.centroid[1] ?? null;
  const southLat = stats.extremes.southernmost?.centroid[1] ?? null;
  const latStartPct = northLat != null ? Math.max(0, Math.min(98, ((90 - northLat) / 180) * 100)) : 0;
  const latEndPct = southLat != null ? Math.max(latStartPct + 2, Math.min(100, ((90 - southLat) / 180) * 100)) : 0;

  return (
    <View style={[styles.root, { backgroundColor: theme.surface }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 104 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Bar: Record + Share + Gear (Settings) */}
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: theme.textPrimary }]}>Record</Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={handleSharePoster}
              disabled={sharing}
              accessibilityRole="button"
              accessibilityLabel="Share travel map image"
              style={({ pressed }) => [
                styles.textActionBtn,
                { opacity: pressed || sharing ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.textActionLabel, { color: theme.accent }]}>
                {sharing ? 'Preparing…' : 'Share'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                router.push('/settings');
              }}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              style={({ pressed }) => [
                styles.gearBtn,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Settings
                size={20}
                color={theme.textSecondary}
                strokeWidth={1.8}
                absoluteStrokeWidth
              />
            </Pressable>
          </View>
        </View>

        {/* Hero: Count Title Line + Uncropped Full-Width World Map (NO donut ring, NO SaaS card!) */}
        <View style={styles.heroBlock}>
          <Text style={[styles.heroTitle, { color: theme.textPrimary }]}>
            <Text style={styles.heroNum}>{stats.visitedCount}</Text> of{' '}
            <Text style={styles.heroNum}>{stats.totalCount}</Text> countries
          </Text>
          <Text style={[styles.heroSub, { color: theme.textSecondary }]}>
            {userProfile.countingMode === 'uk_split_un'
              ? 'Counting UK nations separately'
              : 'United Nations standard'}
            {userProfile.includeTerritories ? ', with territories' : ''}
            {`, ${stats.remainingCount} to go`}
          </Text>

          <View style={styles.worldMapWrap}>
            <Canvas style={{ width: contentWidth, height: worldMapH }}>
              {worldMini.spherePath && (
                <>
                  <Path path={worldMini.spherePath} color={theme.ocean} />
                  <Path
                    path={worldMini.spherePath}
                    color={theme.cardBorder}
                    style="stroke"
                    strokeWidth={0.9}
                  />
                </>
              )}
              {worldMini.places.map((item) => {
                const st = userPlaces[item.id]?.status ?? 'none';
                return (
                  <React.Fragment key={item.id}>
                    {st === 'wishlist' && hatchEffect ? (
                      <Path path={item.skPath}>
                        <Shader source={hatchEffect} uniforms={hatchWorldUniforms} />
                      </Path>
                    ) : (
                      <Path
                        path={item.skPath}
                        color={
                          st === 'lived'
                            ? theme.landLived
                            : st === 'visited'
                            ? theme.landVisited
                            : st === 'skipped'
                            ? theme.landSkipped
                            : theme.landUnvisited
                        }
                      />
                    )}
                    <Path
                      path={item.skPath}
                      color={theme.border}
                      style="stroke"
                      strokeWidth={0.4}
                      strokeJoin="round"
                    />
                    {st === 'lived' && (
                      <Circle
                        cx={item.centroid[0]}
                        cy={item.centroid[1]}
                        r={2}
                        color={theme.livedDot}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </Canvas>
          </View>

          {userProfile.countingMode === 'uk_split_un' && (
            <Text style={[styles.ukSummaryLine, { color: theme.textSecondary }]}>
              United Kingdom nations:{' '}
              <Text style={[styles.inlineNum, { color: theme.textPrimary }]}>
                {stats.ukVisitedCount} of 4
              </Text>
            </Text>
          )}
        </View>

        {/* 6 Tappable Continent Mini-Maps (3x2 grid, hairline separated) */}
        <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
          <View style={styles.contGrid}>
            {continentTiles.map(({ spec, stat, mini }) => (
              <Pressable
                key={spec.continent}
                onPress={() => handleJumpContinent(spec.continent)}
                accessibilityRole="button"
                accessibilityLabel={`${spec.continent}, ${stat.visited} of ${stat.total} visited. View on map`}
                style={({ pressed }) => [
                  styles.contCell,
                  { width: contTileW, opacity: pressed ? 0.72 : 1 },
                ]}
              >
                <View
                  style={[
                    styles.contMapBox,
                    {
                      backgroundColor: theme.ocean,
                      borderColor: theme.cardBorder,
                    },
                  ]}
                >
                  <Canvas style={{ width: contTileW, height: contTileH }}>
                    {mini.places.map((p) => {
                      const st = userPlaces[p.id]?.status ?? 'none';
                      return (
                        <React.Fragment key={p.id}>
                          {st === 'wishlist' && hatchEffect ? (
                            <Path path={p.skPath}>
                              <Shader source={hatchEffect} uniforms={hatchContUniforms} />
                            </Path>
                          ) : (
                            <Path
                              path={p.skPath}
                              color={
                                st === 'lived'
                                  ? theme.landLived
                                  : st === 'visited'
                                  ? theme.landVisited
                                  : st === 'skipped'
                                  ? theme.landSkipped
                                  : theme.landUnvisited
                              }
                            />
                          )}
                          <Path
                            path={p.skPath}
                            color={theme.border}
                            style="stroke"
                            strokeWidth={0.45}
                            strokeJoin="round"
                          />
                        </React.Fragment>
                      );
                    })}
                  </Canvas>
                </View>
                <Text style={[styles.contName, { color: theme.textPrimary }]}>
                  {spec.shortLabel}
                </Text>
                <Text style={[styles.contStat, { color: theme.textMuted }]}>
                  {stat.visited} of {stat.total}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Favourites (shown cleanly when the user has starred places) */}
        {stats.favoritePlaces.length > 0 && (
          <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
                Favourites
              </Text>
              <Text style={[styles.favCount, { color: theme.textMuted }]}>
                {stats.favoritesCount}
              </Text>
            </View>
            <View style={styles.favWrap}>
              {stats.favoritePlaces.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => handleJumpPlace(p.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name}, favourite. View on map`}
                  style={({ pressed }) => [
                    styles.favPill,
                    {
                      backgroundColor: theme.surfaceElevated,
                      borderColor: theme.cardBorder,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <Star
                    size={12}
                    color={theme.favoriteAccent}
                    fill={theme.favoriteAccent}
                    strokeWidth={1.8}
                    absoluteStrokeWidth
                  />
                  <Text style={[styles.favPillText, { color: theme.textPrimary }]}>
                    {p.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Unified Years Timeline (planned future years + past years with gap years) */}
        <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
              Years
            </Text>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setNewColYear(currentYear);
                setNewColType('visited');
                setYearModalOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Add year"
              style={({ pressed }) => [
                styles.smallLinkBtn,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Plus size={14} color={theme.accent} strokeWidth={2} absoluteStrokeWidth />
              <Text style={[styles.smallLinkText, { color: theme.accent }]}>
                Add year
              </Text>
            </Pressable>
          </View>

          {timeline.plannedCols.length === 0 && timeline.pastRows.length === 0 ? (
            <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
              Add years to places you've been, or plan an upcoming year to build your timeline.
            </Text>
          ) : (
            <View style={styles.timelineList}>
              {timeline.plannedCols.map(({ col, count }) => (
                <Pressable
                  key={col.id}
                  onPress={() => handleViewYearOnMap(col.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${col.year} planned, ${count} places. View on map`}
                  style={({ pressed }) => [
                    styles.tlRow,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.tlYear, { color: theme.textSecondary }]}>
                    {col.year}
                  </Text>
                  <View style={styles.tlSquares}>
                    {Array.from({ length: Math.min(14, count) }).map((_, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.sqPlanned,
                          {
                            borderColor: theme.landWishlist,
                            backgroundColor: theme.landUnvisited,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.sqHatch1,
                            { backgroundColor: theme.landWishlist },
                          ]}
                        />
                        <View
                          style={[
                            styles.sqHatch2,
                            { backgroundColor: theme.landWishlist },
                          ]}
                        />
                      </View>
                    ))}
                    {count > 14 && (
                      <Text style={[styles.tlMore, { color: theme.textMuted }]}>
                        +{count - 14}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.tlRight, { color: theme.textMuted }]}>
                    planned
                  </Text>
                  <Pressable
                    onPress={() => {
                      setPickerQuery('');
                      setEditingCollectionId(col.id);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit places in ${col.year}`}
                  >
                    <Text style={[styles.editTiny, { color: theme.accent }]}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync();
                      deleteYearCollection(col.id);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${col.year}`}
                  >
                    <Trash2
                      size={14}
                      color={theme.textMuted}
                      strokeWidth={1.7}
                      absoluteStrokeWidth
                    />
                  </Pressable>
                </Pressable>
              ))}

              {timeline.plannedCols.length > 0 && timeline.pastRows.length > 0 && (
                <View style={styles.nowRow}>
                  <View style={[styles.nowLine, { backgroundColor: theme.cardBorder }]} />
                  <Text style={[styles.nowLabel, { color: theme.textMuted }]}>now</Text>
                  <View style={[styles.nowLine, { backgroundColor: theme.cardBorder }]} />
                </View>
              )}

              {timeline.pastRows.map((row) => (
                <Pressable
                  key={row.year}
                  disabled={!row.collectionId}
                  onPress={() => {
                    if (row.collectionId) handleViewYearOnMap(row.collectionId);
                  }}
                  style={({ pressed }) => [
                    styles.tlRow,
                    { opacity: pressed && row.collectionId ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.tlYear, { color: theme.textSecondary }]}>
                    {row.year}
                  </Text>
                  <View style={styles.tlSquares}>
                    {Array.from({ length: Math.min(12, row.newCount) }).map((_, i) => (
                      <View
                        key={`n-${i}`}
                        style={[
                          styles.sqSolid,
                          {
                            backgroundColor: theme.landVisited,
                            borderColor: theme.border,
                          },
                        ]}
                      />
                    ))}
                    {Array.from({
                      length: Math.min(Math.max(0, 14 - row.newCount), row.repeatCount),
                    }).map((_, i) => (
                      <View
                        key={`r-${i}`}
                        style={[styles.sqRepeat, { borderColor: theme.accent }]}
                      />
                    ))}
                    {row.total > 14 && (
                      <Text style={[styles.tlMore, { color: theme.textMuted }]}>
                        +{row.total - 14}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.tlRight, { color: theme.textMuted }]}>
                    {row.total === 0
                      ? 'no trips'
                      : `${row.newCount} new`}
                  </Text>
                  {row.collectionId && (
                    <Pressable
                      onPress={() => {
                        setPickerQuery('');
                        setEditingCollectionId(row.collectionId);
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit places in ${row.year}`}
                    >
                      <Text style={[styles.editTiny, { color: theme.accent }]}>Edit</Text>
                    </Pressable>
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Geographic Reach: 90°N–90°S Latitude Ruler + Furthest Sentence */}
        {stats.visitedCount > 0 && (
          <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
            <View style={styles.latBarRow}>
              <Text style={[styles.latEnd, { color: theme.textMuted }]}>90°N</Text>
              <View style={[styles.latTrack, { backgroundColor: theme.cardBorder }]}>
                <View style={[styles.latEquator, { backgroundColor: theme.textMuted }]} />
                <View
                  style={[
                    styles.latSpan,
                    {
                      left: `${latStartPct}%`,
                      width: `${Math.max(3, latEndPct - latStartPct)}%`,
                      backgroundColor: theme.accent,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.latEnd, { color: theme.textMuted }]}>90°S</Text>
            </View>

            <Text style={[styles.reachSentence, { color: theme.textSecondary }]}>
              {stats.extremes.northernmost && stats.extremes.southernmost ? (
                <>
                  <Text
                    onPress={() => handleJumpPlace(stats.extremes.northernmost!.id)}
                    style={[styles.reachLink, { color: theme.textPrimary }]}
                  >
                    {stats.extremes.northernmost.name}
                  </Text>{' '}
                  ({formatLat(stats.extremes.northernmost.centroid[1])}) to{' '}
                  <Text
                    onPress={() => handleJumpPlace(stats.extremes.southernmost!.id)}
                    style={[styles.reachLink, { color: theme.textPrimary }]}
                  >
                    {stats.extremes.southernmost.name}
                  </Text>{' '}
                  ({formatLat(stats.extremes.southernmost.centroid[1])}).
                </>
              ) : null}
              {stats.extremes.furthestFromHome ? (
                <>
                  {' '}Furthest from home:{' '}
                  <Text
                    onPress={() =>
                      handleJumpPlace(stats.extremes.furthestFromHome!.place.id)
                    }
                    style={[styles.reachLink, { color: theme.textPrimary }]}
                  >
                    {stats.extremes.furthestFromHome.place.name}
                  </Text>
                  ,{' '}
                  <Text style={styles.inlineNum}>
                    {stats.extremes.furthestFromHome.distanceKm.toLocaleString()} km
                  </Text>
                  .
                </>
              ) : null}
            </Text>
          </View>
        )}

        {/* Quiet Inline Age Distribution Context + Percentile Target Planner */}
        <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
          {agePercentile && percentileTarget ? (
            <View style={styles.ageBlock}>
              <View style={styles.ageInline}>
                <Canvas style={{ width: 64, height: 20 }}>
                  <Path
                    path={bellCurvePath}
                    color={theme.textMuted}
                    style="stroke"
                    strokeWidth={1.4}
                    opacity={0.6}
                  />
                  {targetPercentile > agePercentile.percentile && (
                    <Circle
                      cx={Math.max(4, Math.min(60, 4 + (targetPercentile / 100) * 56))}
                      cy={14.5 - Math.exp(-Math.pow((targetPercentile - 42) / 28, 2)) * 10}
                      r={3}
                      color={theme.accent}
                      style="stroke"
                      strokeWidth={1.4}
                    />
                  )}
                  <Circle
                    cx={Math.max(4, Math.min(60, 4 + (agePercentile.percentile / 100) * 56))}
                    cy={14.5 - Math.exp(-Math.pow((agePercentile.percentile - 42) / 28, 2)) * 10}
                    r={3.2}
                    color={theme.accent}
                  />
                </Canvas>
                <Text style={[styles.ageCopy, { color: theme.textSecondary }]}>
                  {formatAgeCopy(agePercentile.percentile, agePercentile.age)}
                </Text>
                <Pressable
                  onPress={() => setShowAgeNote((v) => !v)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="How this estimate is calculated"
                >
                  <Info
                    size={16}
                    color={theme.textMuted}
                    strokeWidth={1.7}
                    absoluteStrokeWidth
                  />
                </Pressable>
              </View>
              {showAgeNote && (
                <Text style={[styles.ageFootnote, { color: theme.textMuted }]}>
                  Rough offline log-normal estimate calibrated to a UK/European adult baseline (median ~6 at 28, ~10 at 45), not a live survey. Exact percentiles vary widely by home region — US (Pew) and global medians are significantly lower.
                </Text>
              )}

              {/* Target Percentile Calculator & 1-Tap Goal */}
              <View style={[styles.pctTargetBox, { borderTopColor: theme.cardBorder }]}>
                <View style={styles.pctControlRow}>
                  <View style={styles.pctPresetRow}>
                    {[75, 90, 95, 99].map((pct) => {
                      const active = targetPercentile === pct;
                      return (
                        <Pressable
                          key={pct}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setTargetPercentile(pct);
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`Target ${ordinal(pct)} percentile`}
                          style={({ pressed }) => [
                            styles.pctChip,
                            {
                              backgroundColor: active
                                ? theme.accentSoft
                                : theme.surfaceElevated,
                              borderColor: active ? theme.accent : theme.cardBorder,
                              opacity: pressed ? 0.72 : 1,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.pctChipText,
                              { color: active ? theme.accent : theme.textSecondary },
                            ]}
                          >
                            {ordinal(pct)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View
                    style={[
                      styles.pctStepper,
                      {
                        backgroundColor: theme.surfaceSubtle,
                        borderColor: theme.cardBorder,
                      },
                    ]}
                  >
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setTargetPercentile((v) => Math.max(50, v - 1));
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease target percentile"
                      style={styles.pctStepBtn}
                    >
                      <Minus
                        size={13}
                        color={theme.textSecondary}
                        strokeWidth={2}
                        absoluteStrokeWidth
                      />
                    </Pressable>
                    <Text style={[styles.pctStepVal, { color: theme.textPrimary }]}>
                      {targetPercentile}%
                    </Text>
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setTargetPercentile((v) => Math.min(99, v + 1));
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Increase target percentile"
                      style={styles.pctStepBtn}
                    >
                      <Plus
                        size={13}
                        color={theme.textSecondary}
                        strokeWidth={2}
                        absoluteStrokeWidth
                      />
                    </Pressable>
                  </View>
                </View>

                {(() => {
                  const needed = percentileTarget.requiredCountries;
                  const moreToGo = Math.max(0, needed - stats.visitedCount);
                  return (
                    <>
                      <Text style={[styles.pctSummary, { color: theme.textSecondary }]}>
                        {moreToGo > 0 ? (
                          <>
                            Reach the{' '}
                            <Text style={[styles.inlineNum, { color: theme.textPrimary }]}>
                              {ordinal(percentileTarget.targetPercentile)}
                            </Text>{' '}
                            percentile (top {percentileTarget.topPercent}%) for age{' '}
                            <Text style={styles.inlineNum}>{percentileTarget.age}</Text> at{' '}
                            <Text style={[styles.inlineNum, { color: theme.textPrimary }]}>
                              {needed}
                            </Text>{' '}
                            countries —{' '}
                            <Text style={[styles.inlineNum, { color: theme.accent }]}>
                              {moreToGo} more
                            </Text>{' '}
                            to go.
                          </>
                        ) : (
                          <>
                            Already at the{' '}
                            <Text style={[styles.inlineNum, { color: theme.textPrimary }]}>
                              {ordinal(percentileTarget.targetPercentile)}
                            </Text>{' '}
                            percentile for age{' '}
                            <Text style={styles.inlineNum}>{percentileTarget.age}</Text> (
                            <Text style={styles.inlineNum}>{needed}</Text> countries needed).
                          </>
                        )}
                      </Text>

                      {moreToGo > 0 && (
                        <View style={styles.pctGoalActionRow}>
                          {matchingPercentileGoal ? (
                            <Pressable
                              onPress={() => {
                                Haptics.selectionAsync();
                                router.navigate('/(tabs)/goals');
                              }}
                              accessibilityRole="button"
                              accessibilityLabel="View percentile goal in Plans"
                              style={({ pressed }) => [
                                styles.pctGoalLink,
                                { opacity: pressed ? 0.65 : 1 },
                              ]}
                            >
                              <Check
                                size={14}
                                color={theme.accent}
                                strokeWidth={2.2}
                                absoluteStrokeWidth
                              />
                              <Text style={[styles.pctGoalLinkText, { color: theme.accent }]}>
                                Goal in Plans
                              </Text>
                              <ChevronRight
                                size={14}
                                color={theme.accent}
                                strokeWidth={2}
                                absoluteStrokeWidth
                              />
                            </Pressable>
                          ) : (
                            <Pressable
                              onPress={handleSetPercentileGoal}
                              accessibilityRole="button"
                              accessibilityLabel={`Set ${needed} countries as a travel goal`}
                              style={({ pressed }) => [
                                styles.pctGoalBtn,
                                {
                                  backgroundColor: theme.surfaceElevated,
                                  borderColor: theme.cardBorder,
                                  opacity: pressed ? 0.72 : 1,
                                },
                              ]}
                            >
                              <Plus
                                size={14}
                                color={theme.accent}
                                strokeWidth={2.1}
                                absoluteStrokeWidth
                              />
                              <Text style={[styles.pctGoalBtnText, { color: theme.accent }]}>
                                Set {needed} countries as a goal
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      )}
                    </>
                  );
                })()}
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
            >
              <Text style={[styles.agePrompt, { color: theme.textSecondary }]}>
                Add your birth year in{' '}
                <Text style={{ color: theme.accent, fontFamily: FONTS.bodyMedium }}>
                  Settings
                </Text>{' '}
                to see how you compare for your age.
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* New Year Sheet */}
      <Modal
        visible={yearModalOpen}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
        transparent={Platform.OS !== 'ios'}
        onRequestClose={() => setYearModalOpen(false)}
      >
        <View
          style={[
            styles.modalBackdrop,
            Platform.OS !== 'ios' && { backgroundColor: 'rgba(0,0,0,0.42)' },
          ]}
        >
          <SafeAreaView
            style={[
              styles.modalRoot,
              { backgroundColor: theme.surface },
              Platform.OS !== 'ios' && styles.androidSheet,
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: theme.cardBorder }]}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                Add year
              </Text>
              <Pressable
                onPress={() => setYearModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={10}
              >
                <X
                  size={20}
                  color={theme.textSecondary}
                  strokeWidth={1.9}
                  absoluteStrokeWidth
                />
              </Pressable>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.typeToggleRow}>
                {(
                  [
                    { id: 'visited', label: 'Visited' },
                    { id: 'planned', label: 'Planned' },
                  ] as { id: CollectionType; label: string }[]
                ).map((opt) => {
                  const active = newColType === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setNewColType(opt.id);
                      }}
                      style={[
                        styles.typeToggleBtn,
                        {
                          backgroundColor: active
                            ? theme.accent
                            : theme.surfaceElevated,
                          borderColor: active ? theme.accent : theme.cardBorder,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.typeToggleText,
                          { color: active ? theme.accentInk : theme.textPrimary },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                Year
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.yearWheel}
              >
                {selectableYears.map((y) => {
                  const active = newColYear === y;
                  return (
                    <Pressable
                      key={y}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setNewColYear(y);
                        if (y > currentYear) setNewColType('planned');
                      }}
                      style={[
                        styles.wheelPill,
                        {
                          backgroundColor: active
                            ? theme.accent
                            : theme.surfaceSubtle,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.wheelText,
                          { color: active ? theme.accentInk : theme.textPrimary },
                        ]}
                      >
                        {y}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Pressable
                onPress={handleCreateYear}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: theme.accent, opacity: pressed ? 0.78 : 1 },
                ]}
              >
                <Text style={[styles.primaryBtnText, { color: theme.accentInk }]}>
                  Choose countries
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Edit Places in Year Modal */}
      <Modal
        visible={Boolean(editingCollectionId)}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
        transparent={Platform.OS !== 'ios'}
        onRequestClose={() => setEditingCollectionId(null)}
      >
        <View
          style={[
            styles.modalBackdrop,
            Platform.OS !== 'ios' && { backgroundColor: 'rgba(0,0,0,0.42)' },
          ]}
        >
          <SafeAreaView
            style={[
              styles.modalRoot,
              { backgroundColor: theme.surface },
              Platform.OS !== 'ios' && styles.androidSheet,
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: theme.cardBorder }]}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                {yearCollections.find((c) => c.id === editingCollectionId)?.title ??
                  'Edit places'}
              </Text>
              <Pressable
                onPress={() => setEditingCollectionId(null)}
                accessibilityRole="button"
                accessibilityLabel="Done editing year"
              >
                <Text style={[styles.doneText, { color: theme.accent }]}>Done</Text>
              </Pressable>
            </View>

            <View
              style={[
                styles.pickerSearch,
                {
                  backgroundColor: theme.surfaceSubtle,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <Search
                size={16}
                color={theme.textMuted}
                strokeWidth={1.8}
                absoluteStrokeWidth
              />
              <TextInput
                value={pickerQuery}
                onChangeText={setPickerQuery}
                placeholder="Search places"
                placeholderTextColor={theme.textMuted}
                style={[styles.pickerInput, { color: theme.textPrimary }]}
              />
            </View>

            <FlatList
              data={pickerPlaces}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.pickerList}
              renderItem={({ item, index }) => {
                const members = editingCollectionId
                  ? collectionMemberMap.get(editingCollectionId) ?? []
                  : [];
                const checked = members.includes(item.id);
                return (
                  <Pressable
                    onPress={() => {
                      if (!editingCollectionId) return;
                      Haptics.selectionAsync();
                      togglePlaceInCollection(editingCollectionId, item.id);
                    }}
                    style={[
                      styles.pickerRow,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.cardBorder,
                      },
                    ]}
                  >
                    <Text style={[styles.pickerName, { color: theme.textPrimary }]}>
                      {item.name}
                    </Text>
                    <View
                      style={[
                        styles.checkBox,
                        {
                          backgroundColor: checked ? theme.accent : 'transparent',
                          borderColor: checked ? theme.accent : theme.textMuted,
                        },
                      ]}
                    >
                      {checked && (
                        <Check
                          size={12}
                          color={theme.accentInk}
                          strokeWidth={2.5}
                          absoluteStrokeWidth
                        />
                      )}
                    </View>
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 18 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heading: {
    fontFamily: FONTS.display,
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  textActionBtn: {
    height: 44,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  textActionLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 15,
  },
  gearBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBlock: {
    paddingBottom: 18,
  },
  heroTitle: {
    fontFamily: FONTS.display,
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  heroNum: {
    fontFamily: FONTS.num,
    fontVariant: ['tabular-nums'],
  },
  heroSub: {
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 3,
    marginBottom: 14,
  },
  worldMapWrap: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  ukSummaryLine: {
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 12,
  },
  inlineNum: {
    fontFamily: FONTS.num,
    fontVariant: ['tabular-nums'],
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: FONTS.display,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  smallLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingLeft: 8,
  },
  smallLinkText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13.5,
  },
  contGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  contCell: {
    marginBottom: 6,
  },
  contMapBox: {
    height: 58,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: 5,
  },
  contName: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
  contStat: {
    fontFamily: FONTS.num,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  favCount: {
    fontFamily: FONTS.num,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  favWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  favPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 12,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  favPillText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13.5,
  },
  emptyCopy: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
  },
  timelineList: {
    gap: 9,
  },
  tlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 26,
  },
  tlYear: {
    width: 38,
    fontFamily: FONTS.num,
    fontSize: 13.5,
    fontVariant: ['tabular-nums'],
  },
  tlSquares: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
  },
  sqSolid: {
    width: 11,
    height: 11,
    borderRadius: 2.5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sqRepeat: {
    width: 11,
    height: 11,
    borderRadius: 2.5,
    borderWidth: 1.5,
  },
  sqPlanned: {
    width: 11,
    height: 11,
    borderRadius: 2.5,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sqHatch1: {
    position: 'absolute',
    width: 16,
    height: 1.3,
    top: 2,
    left: -3,
    transform: [{ rotate: '-45deg' }],
  },
  sqHatch2: {
    position: 'absolute',
    width: 16,
    height: 1.3,
    top: 6.5,
    left: -2,
    transform: [{ rotate: '-45deg' }],
  },
  tlMore: {
    fontFamily: FONTS.num,
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  tlRight: {
    fontFamily: FONTS.numMedium,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  editTiny: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 12.5,
  },
  nowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 2,
  },
  nowLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  nowLabel: {
    fontFamily: FONTS.body,
    fontSize: 11,
  },
  latBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  latEnd: {
    fontFamily: FONTS.numMedium,
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  latTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  latEquator: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    opacity: 0.45,
  },
  latSpan: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 3,
  },
  reachSentence: {
    fontFamily: FONTS.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
  reachLink: {
    fontFamily: FONTS.bodyMedium,
  },
  ageBlock: {
    gap: 8,
  },
  ageInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ageCopy: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 13.5,
    lineHeight: 19,
  },
  ageFootnote: {
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 17,
  },
  agePrompt: {
    fontFamily: FONTS.body,
    fontSize: 13.5,
    lineHeight: 19,
  },
  pctTargetBox: {
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  pctControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pctPresetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pctChip: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctChipText: {
    fontFamily: FONTS.numMedium,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  pctStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 2,
  },
  pctStepBtn: {
    width: 28,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctStepVal: {
    minWidth: 34,
    textAlign: 'center',
    fontFamily: FONTS.num,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  pctSummary: {
    fontFamily: FONTS.body,
    fontSize: 13.5,
    lineHeight: 19.5,
  },
  pctGoalActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pctGoalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pctGoalBtnText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13.5,
  },
  pctGoalLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
  },
  pctGoalLinkText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13.5,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalRoot: {
    flex: 1,
  },
  androidSheet: {
    marginTop: 72,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontFamily: FONTS.display,
    fontSize: 19,
  },
  doneText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 15,
  },
  modalBody: {
    padding: 18,
    gap: 14,
  },
  typeToggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  typeToggleBtn: {
    flex: 1,
    height: 44,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeToggleText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
  },
  fieldLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
  yearWheel: {
    gap: 8,
    paddingVertical: 4,
  },
  wheelPill: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelText: {
    fontFamily: FONTS.num,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  primaryBtn: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  primaryBtnText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 15,
  },
  pickerSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginVertical: 12,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickerInput: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 14.5,
  },
  pickerList: {
    paddingHorizontal: 18,
    paddingBottom: 32,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingVertical: 10,
  },
  pickerName: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 15,
    flex: 1,
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
