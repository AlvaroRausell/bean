import React, { useMemo, useState } from 'react';
import {
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
  DashPathEffect,
  Line,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { Minus, Plus, Search, Star, Trash2, X } from 'lucide-react-native';
import { PLACES_CATALOG } from '@/data/places';
import { evaluateGoalProgress, GoalProgress } from '@/domain/goalsCalculator';
import { computeYearlyStats, CONTINENTS } from '@/domain/statsCalculator';
import { SelectAllExceptModal } from '@/components/wishlist/SelectAllExceptModal';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES, MapTheme } from '@/theme/mapThemes';
import { FONTS } from '@/theme/typography';
import { Continent, GoalScope, Place } from '@/types';

function pluralYears(n: number): string {
  const abs = Math.abs(n);
  return `${abs} ${abs === 1 ? 'year' : 'years'}`;
}

function GoalBurnUpChart({
  gp,
  yearlyTotals,
  width,
  theme,
}: {
  gp: GoalProgress;
  yearlyTotals: { year: number; cumulative: number }[];
  width: number;
  theme: MapTheme;
}) {
  const H = 96;
  const padL = 28;
  const padR = 10;
  const padT = 12;
  const padB = 14;
  const plotW = Math.max(120, width - padL - padR);
  const plotH = H - padT - padB;

  const currentYear = new Date().getFullYear();
  const minYear =
    yearlyTotals.length > 0
      ? Math.min(currentYear - 4, yearlyTotals[0].year)
      : currentYear - 4;
  const maxYear = Math.max(
    gp.goal.targetYear,
    gp.projectedYear && gp.projectedYear < gp.goal.targetYear + 25
      ? gp.projectedYear
      : gp.goal.targetYear
  );
  const spanYears = Math.max(1, maxYear - minYear);
  const maxVal = Math.max(gp.targetCount, gp.currentCount, 1);

  const xOf = (yr: number) => padL + ((yr - minYear) / spanYears) * plotW;
  const yOf = (val: number) => padT + plotH - (Math.min(maxVal, val) / maxVal) * plotH;

  const actualPath = useMemo(() => {
    const pts =
      yearlyTotals.length > 0
        ? yearlyTotals
        : [
            { year: minYear, cumulative: 0 },
            { year: currentYear, cumulative: gp.currentCount },
          ];
    // Anchor end at currentCount in currentYear
    const series =
      pts[pts.length - 1].year < currentYear
        ? [...pts, { year: currentYear, cumulative: gp.currentCount }]
        : pts.map((pt, idx) =>
            idx === pts.length - 1 ? { ...pt, cumulative: gp.currentCount } : pt
          );

    const cmds = series
      .map(
        (pt, i) =>
          `${i === 0 ? 'M' : 'L'} ${xOf(pt.year).toFixed(1)} ${yOf(pt.cumulative).toFixed(1)}`
      )
      .join(' ');
    return Skia.Path.MakeFromSVGString(cmds) ?? Skia.Path.Make();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearlyTotals, gp.currentCount, gp.targetCount, minYear, maxYear, width]);

  const curX = xOf(currentYear);
  const curY = yOf(gp.currentCount);
  const targetX = xOf(gp.goal.targetYear);
  const topY = yOf(gp.targetCount);
  const projYearClamped =
    gp.projectedYear && !gp.isCompleted
      ? Math.min(maxYear, Math.max(currentYear + 1, gp.projectedYear))
      : null;
  const projX = projYearClamped ? xOf(projYearClamped) : null;

  return (
    <View style={styles.chartWrap}>
      <View style={styles.chartRow}>
        <View style={styles.yAxis}>
          <Text style={[styles.axisNum, { color: theme.textMuted }]}>
            {gp.targetCount}
          </Text>
          <Text style={[styles.axisNum, { color: theme.textMuted }]}>0</Text>
        </View>
        <Canvas style={{ width: width - 26, height: H }}>
          {/* Target ceiling & baseline rules */}
          <Line
            p1={vec(2, topY)}
            p2={vec(width - 30, topY)}
            color={theme.cardBorder}
            strokeWidth={1}
          />
          <Line
            p1={vec(2, yOf(0))}
            p2={vec(width - 30, yOf(0))}
            color={theme.cardBorder}
            strokeWidth={1}
          />

          {/* Required pace line */}
          {!gp.isCompleted && (
            <Line
              p1={vec(curX - padL + 2, curY)}
              p2={vec(targetX - padL + 2, topY)}
              color={theme.textMuted}
              strokeWidth={1.1}
              opacity={0.45}
            />
          )}

          {/* Projected pace dashed line */}
          {projX != null && (
            <>
              <Line
                p1={vec(curX - padL + 2, curY)}
                p2={vec(projX - padL + 2, topY)}
                color={theme.accent}
                strokeWidth={1.8}
              >
                <DashPathEffect intervals={[4, 4]} />
              </Line>
              <Circle cx={projX - padL + 2} cy={topY} r={3.5} color={theme.accent} />
            </>
          )}

          {/* Actual history curve */}
          <Path
            path={actualPath}
            color={theme.textPrimary}
            style="stroke"
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
            transform={[{ translateX: -padL + 2 }]}
          />
          <Circle cx={curX - padL + 2} cy={curY} r={3.5} color={theme.textPrimary} />
        </Canvas>
      </View>

      <View style={styles.xAxis}>
        {(() => {
          const milestones: { year: number; color: string }[] = [
            { year: minYear, color: theme.textMuted },
            { year: currentYear, color: theme.textPrimary },
          ];
          if (gp.projectedYear && !gp.isCompleted && gp.projectedYear !== gp.goal.targetYear) {
            milestones.push({ year: gp.projectedYear, color: theme.accent });
          }
          milestones.push({ year: gp.goal.targetYear, color: theme.textMuted });
          const dedup = new Map<number, string>();
          for (const m of milestones) {
            if (!dedup.has(m.year) || m.color === theme.accent || m.color === theme.textPrimary) {
              dedup.set(m.year, m.color);
            }
          }
          return [...dedup.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([yr, color]) => (
              <Text key={yr} style={[styles.axisNum, { color }]}>
                {yr}
              </Text>
            ));
        })()}
      </View>
    </View>
  );
}

export default function PlansScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const userPlaces = useTravelStore((s) => s.userPlaces);
  const yearCollections = useTravelStore((s) => s.yearCollections);
  const collectionItems = useTravelStore((s) => s.collectionItems);
  const travelGoals = useTravelStore((s) => s.travelGoals);
  const userProfile = useTravelStore((s) => s.userProfile);
  const createGoal = useTravelStore((s) => s.createGoal);
  const deleteGoal = useTravelStore((s) => s.deleteGoal);
  const setPlaceStatus = useTravelStore((s) => s.setPlaceStatus);
  const selectPlace = useTravelStore((s) => s.selectPlace);
  const selectExceptOpen = useTravelStore((s) => s.selectExceptModalOpen);
  const setSelectExceptOpen = useTravelStore((s) => s.setSelectExceptModalOpen);

  const theme = MAP_THEMES[userProfile.mapTheme];
  const currentYear = new Date().getFullYear();

  // Sentence-style New Goal modal state (no Alert-validated text inputs!)
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goalScope, setGoalScope] = useState<GoalScope>('world');
  const [goalScopeContinent, setGoalScopeContinent] = useState<Continent>('Europe');
  const [goalTarget, setGoalTarget] = useState(100);
  const [goalYear, setGoalYear] = useState(currentYear + 10);

  // Wishlist filter (shown cleanly when list grows past 6 items)
  const [wishQuery, setWishQuery] = useState('');

  const evaluatedGoals = useMemo(
    () =>
      travelGoals.map((g) =>
        evaluateGoalProgress(
          g,
          PLACES_CATALOG,
          userPlaces,
          yearCollections,
          collectionItems,
          {
            countingMode: userProfile.countingMode,
            includeTerritories: userProfile.includeTerritories,
          }
        )
      ),
    [travelGoals, userPlaces, yearCollections, collectionItems, userProfile]
  );

  const allYearlyStats = useMemo(
    () => computeYearlyStats(userPlaces, yearCollections, collectionItems),
    [userPlaces, yearCollections, collectionItems]
  );

  const getScopedCumulative = (gp: GoalProgress) => {
    const eligibleIds = new Set(
      PLACES_CATALOG.filter((p) => {
        if (gp.goal.scope === 'uk_nations') return p.parentId === 'GB';
        if (!userProfile.includeTerritories && !p.isUnMember) return false;
        if (gp.goal.scope === 'continent' && gp.goal.scopeValue) {
          return p.continent === gp.goal.scopeValue;
        }
        return true;
      }).map((p) => p.id)
    );
    const seen = new Set<string>();
    const out: { year: number; cumulative: number }[] = [];
    for (const row of allYearlyStats) {
      let added = 0;
      for (const id of row.placeIds) {
        if (eligibleIds.has(id) && !seen.has(id)) {
          seen.add(id);
          added += 1;
        }
      }
      if (added > 0 || out.length > 0) {
        out.push({ year: row.year, cumulative: Math.min(gp.currentCount, seen.size) });
      }
    }
    return out;
  };

  const wishlistAll = useMemo(
    () => PLACES_CATALOG.filter((p) => userPlaces[p.id]?.status === 'wishlist'),
    [userPlaces]
  );

  // Continent-grouped wishlist (replaces flat 165-card wall!)
  const groupedWishlist = useMemo(() => {
    const q = wishQuery.trim().toLowerCase();
    const filtered = wishlistAll.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.continent.toLowerCase().includes(q)
      );
    });
    const byCont = new Map<Continent, Place[]>();
    for (const p of filtered) {
      const list = byCont.get(p.continent) ?? [];
      list.push(p);
      byCont.set(p.continent, list);
    }
    return CONTINENTS.map((continent) => ({
      continent,
      places: byCont.get(continent) ?? [],
    })).filter((g) => g.places.length > 0);
  }, [wishlistAll, wishQuery]);

  const maxTargetForScope = useMemo(() => {
    if (goalScope === 'uk_nations') return 4;
    if (goalScope === 'continent') {
      return Math.max(
        4,
        PLACES_CATALOG.filter(
          (p) =>
            p.continent === goalScopeContinent &&
            (userProfile.includeTerritories || p.isUnMember)
        ).length
      );
    }
    return userProfile.includeTerritories
      ? PLACES_CATALOG.length
      : userProfile.countingMode === 'uk_split_un'
      ? 196
      : 193;
  }, [goalScope, goalScopeContinent, userProfile]);

  const selectableTargetYears = useMemo(() => {
    const out: number[] = [];
    for (let y = currentYear + 1; y <= currentYear + 45; y++) out.push(y);
    return out;
  }, [currentYear]);

  const handleSaveGoal = async () => {
    const clampedTarget = Math.max(1, Math.min(maxTargetForScope, goalTarget));
    const title =
      goalScope === 'uk_nations'
        ? `${clampedTarget} UK nations by ${goalYear}`
        : goalScope === 'continent'
        ? `${clampedTarget} in ${goalScopeContinent} by ${goalYear}`
        : `${clampedTarget} countries by ${goalYear}`;

    Haptics.selectionAsync();
    await createGoal({
      title,
      targetCount: clampedTarget,
      targetYear: goalYear,
      scope: goalScope,
      scopeValue: goalScope === 'continent' ? goalScopeContinent : null,
    });
    setGoalModalOpen(false);
  };

  const renderGoalSummary = (gp: GoalProgress) => {
    if (gp.isCompleted) {
      return `Reached ${gp.targetCount} ahead of ${gp.goal.targetYear}.`;
    }
    if (gp.currentAnnualPace == null) {
      return `${gp.remainingCount} to go. You need ${gp.requiredPerYear} a year. Add years to your trips to see your pace.`;
    }
    const base = `${gp.remainingCount} to go. You need ${gp.requiredPerYear} a year and average ${gp.currentAnnualPace}.`;
    if (!gp.projectedYear) return base;
    if (gp.yearsAheadOrBehind != null && gp.yearsAheadOrBehind > 0) {
      return `${base} At this pace you reach ${gp.targetCount} in ${gp.projectedYear}, ${pluralYears(
        gp.yearsAheadOrBehind
      )} early.`;
    }
    if (gp.yearsAheadOrBehind != null && gp.yearsAheadOrBehind < 0) {
      return `${base} At this pace you reach ${gp.targetCount} in ${gp.projectedYear}, ${pluralYears(
        gp.yearsAheadOrBehind
      )} late.`;
    }
    return `${base} Right on track for ${gp.goal.targetYear}.`;
  };

  const contentW = Math.max(280, screenWidth - 36);

  return (
    <View style={[styles.root, { backgroundColor: theme.surface }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 104 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header: Plans + Quiet + Button */}
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: theme.textPrimary }]}>Plans</Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setGoalScope('world');
              setGoalTarget(100);
              setGoalYear(Math.max(currentYear + 10, 2040));
              setGoalModalOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Add a travel goal"
            style={({ pressed }) => [
              styles.addIconBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Plus
              size={22}
              color={theme.accent}
              strokeWidth={2}
              absoluteStrokeWidth
            />
          </Pressable>
        </View>

        {/* Goals Section */}
        {evaluatedGoals.length === 0 ? (
          <View style={styles.emptyGoals}>
            <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
              No goals yet
            </Text>
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
              Set a target like 50 countries by {currentYear + 10} to track your yearly pace.
            </Text>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setGoalModalOpen(true);
              }}
              style={({ pressed }) => [
                styles.inlineAction,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[styles.inlineActionText, { color: theme.accent }]}>
                Add a goal
              </Text>
            </Pressable>
          </View>
        ) : (
          evaluatedGoals.map((gp, idx) => (
            <View
              key={gp.goal.id}
              style={[
                styles.goalBlock,
                idx > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.cardBorder,
                  paddingTop: 18,
                },
              ]}
            >
              <View style={styles.goalHeaderRow}>
                <Text style={[styles.goalTitle, { color: theme.textPrimary }]}>
                  {gp.goal.title}
                </Text>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    deleteGoal(gp.goal.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove goal ${gp.goal.title}`}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.iconHit,
                    { opacity: pressed ? 0.55 : 1 },
                  ]}
                >
                  <Trash2
                    size={16}
                    color={theme.textMuted}
                    strokeWidth={1.7}
                    absoluteStrokeWidth
                  />
                </Pressable>
              </View>

              <Text style={[styles.goalSentence, { color: theme.textSecondary }]}>
                {renderGoalSummary(gp)}
              </Text>

              <GoalBurnUpChart
                gp={gp}
                yearlyTotals={getScopedCumulative(gp)}
                width={contentW}
                theme={theme}
              />
            </View>
          ))
        )}

        {/* Want to go Section (Continent-Grouped Flush List) */}
        <View style={[styles.wishSection, { borderTopColor: theme.cardBorder }]}>
          <View style={styles.wishHeaderRow}>
            <View style={styles.wishTitlePair}>
              <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
                Want to go
              </Text>
              <Text style={[styles.wishCount, { color: theme.textMuted }]}>
                {wishlistAll.length}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setSelectExceptOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Add many places to want to go"
              style={({ pressed }) => [
                styles.addManyBtn,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[styles.addManyText, { color: theme.accent }]}>
                Add many
              </Text>
            </Pressable>
          </View>

          {wishlistAll.length > 6 && (
            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: theme.surfaceSubtle,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <Search
                size={15}
                color={theme.textMuted}
                strokeWidth={1.8}
                absoluteStrokeWidth
              />
              <TextInput
                value={wishQuery}
                onChangeText={setWishQuery}
                placeholder="Filter list"
                placeholderTextColor={theme.textMuted}
                style={[styles.searchInput, { color: theme.textPrimary }]}
              />
              {wishQuery.length > 0 && (
                <Pressable
                  onPress={() => setWishQuery('')}
                  hitSlop={10}
                  accessibilityLabel="Clear filter"
                >
                  <X
                    size={15}
                    color={theme.textMuted}
                    strokeWidth={1.8}
                    absoluteStrokeWidth
                  />
                </Pressable>
              )}
            </View>
          )}

          {wishlistAll.length === 0 ? (
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
              Tap any country on the map to add it here, or use Add many to pick a whole region.
            </Text>
          ) : groupedWishlist.length === 0 ? (
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
              No places match "{wishQuery}".
            </Text>
          ) : (
            groupedWishlist.map((group) => (
              <View key={group.continent} style={styles.contGroup}>
                <Text style={[styles.contGroupLabel, { color: theme.textMuted }]}>
                  {group.continent}
                </Text>
                {group.places.map((item, idx) => (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      Haptics.selectionAsync();
                      selectPlace(item.id, true);
                      router.navigate('/(tabs)');
                    }}
                    style={({ pressed }) => [
                      styles.wishRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.cardBorder,
                      },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <View style={styles.wishNameRow}>
                      <Text
                        style={[styles.wishName, { color: theme.textPrimary }]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      {userPlaces[item.id]?.isFavorite && (
                        <Star
                          size={12}
                          color={theme.favoriteAccent}
                          fill={theme.favoriteAccent}
                          strokeWidth={1.8}
                          absoluteStrokeWidth
                        />
                      )}
                    </View>

                    <Pressable
                      onPress={() => {
                        Haptics.notificationAsync(
                          Haptics.NotificationFeedbackType.Success
                        );
                        setPlaceStatus(item.id, 'visited', undefined, {
                          withUndo: true,
                        });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark ${item.name} as been`}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.markBeenBtn,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={[styles.markBeenText, { color: theme.accent }]}>
                        Mark as been
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setPlaceStatus(item.id, 'none', undefined, {
                          silentInk: true,
                          withUndo: true,
                        });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.name} from want to go`}
                      hitSlop={10}
                      style={({ pressed }) => [
                        styles.removeWishBtn,
                        { opacity: pressed ? 0.55 : 1 },
                      ]}
                    >
                      <X
                        size={15}
                        color={theme.textMuted}
                        strokeWidth={1.8}
                        absoluteStrokeWidth
                      />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Add Many Modal */}
      <SelectAllExceptModal
        visible={selectExceptOpen}
        onClose={() => setSelectExceptOpen(false)}
      />

      {/* Sentence-Style New Goal Sheet */}
      <Modal
        visible={goalModalOpen}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
        transparent={Platform.OS !== 'ios'}
        onRequestClose={() => setGoalModalOpen(false)}
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
                New goal
              </Text>
              <Pressable
                onPress={() => setGoalModalOpen(false)}
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

            <ScrollView contentContainerStyle={styles.modalBody}>
              {/* Live sentence preview */}
              <Text style={[styles.sentencePreview, { color: theme.textPrimary }]}>
                Visit{' '}
                <Text style={[styles.sentenceNum, { color: theme.accent }]}>
                  {Math.min(goalTarget, maxTargetForScope)}
                </Text>{' '}
                {goalScope === 'uk_nations'
                  ? 'UK nations'
                  : goalScope === 'continent'
                  ? `places in ${goalScopeContinent}`
                  : 'countries'}{' '}
                by{' '}
                <Text style={[styles.sentenceNum, { color: theme.accent }]}>
                  {goalYear}
                </Text>
                .
              </Text>

              {/* Scope picker */}
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                Where
              </Text>
              <View style={styles.scopeRow}>
                {(
                  [
                    { id: 'world', label: 'World' },
                    { id: 'continent', label: 'Continent' },
                    { id: 'uk_nations', label: 'UK nations' },
                  ] as { id: GoalScope; label: string }[]
                ).map((s) => {
                  const active = goalScope === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setGoalScope(s.id);
                        if (s.id === 'uk_nations') setGoalTarget(4);
                        else if (s.id === 'continent') setGoalTarget(20);
                        else setGoalTarget(100);
                      }}
                      style={[
                        styles.scopePill,
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
                          styles.scopeText,
                          { color: active ? theme.accentInk : theme.textPrimary },
                        ]}
                      >
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {goalScope === 'continent' && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.contPickerScroll}
                >
                  {CONTINENTS.filter((c) => c !== 'Antarctica').map((c) => {
                    const active = goalScopeContinent === c;
                    return (
                      <Pressable
                        key={c}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setGoalScopeContinent(c);
                        }}
                        style={[
                          styles.scopePill,
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
                            styles.scopeText,
                            { color: active ? theme.accentInk : theme.textPrimary },
                          ]}
                        >
                          {c}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              {/* Target Count Stepper + Quick Presets */}
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                How many (up to {maxTargetForScope})
              </Text>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    const step = goalScope === 'uk_nations' ? 1 : 5;
                    setGoalTarget((v) => Math.max(1, v - step));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease target"
                  style={[
                    styles.stepBtn,
                    {
                      backgroundColor: theme.surfaceSubtle,
                      borderColor: theme.cardBorder,
                    },
                  ]}
                >
                  <Minus
                    size={18}
                    color={theme.textPrimary}
                    strokeWidth={2}
                    absoluteStrokeWidth
                  />
                </Pressable>
                <Text style={[styles.stepValue, { color: theme.textPrimary }]}>
                  {Math.min(goalTarget, maxTargetForScope)}
                </Text>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    const step = goalScope === 'uk_nations' ? 1 : 5;
                    setGoalTarget((v) => Math.min(maxTargetForScope, v + step));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Increase target"
                  style={[
                    styles.stepBtn,
                    {
                      backgroundColor: theme.surfaceSubtle,
                      borderColor: theme.cardBorder,
                    },
                  ]}
                >
                  <Plus
                    size={18}
                    color={theme.textPrimary}
                    strokeWidth={2}
                    absoluteStrokeWidth
                  />
                </Pressable>
              </View>

              {/* Target Year Scroll Picker */}
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                By year
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.yearWheel}
              >
                {selectableTargetYears.map((y) => {
                  const active = goalYear === y;
                  return (
                    <Pressable
                      key={y}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setGoalYear(y);
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
                onPress={handleSaveGoal}
                style={({ pressed }) => [
                  styles.saveBtn,
                  { backgroundColor: theme.accent, opacity: pressed ? 0.78 : 1 },
                ]}
              >
                <Text style={[styles.saveBtnText, { color: theme.accentInk }]}>
                  Save goal
                </Text>
              </Pressable>
            </ScrollView>
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
  addIconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyGoals: {
    paddingBottom: 20,
    gap: 6,
  },
  emptyTitle: {
    fontFamily: FONTS.display,
    fontSize: 17,
  },
  emptyBody: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
  },
  inlineAction: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginTop: 2,
  },
  inlineActionText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14.5,
  },
  goalBlock: {
    paddingBottom: 18,
  },
  goalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  goalTitle: {
    flex: 1,
    fontFamily: FONTS.display,
    fontSize: 18,
    letterSpacing: -0.2,
  },
  iconHit: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalSentence: {
    fontFamily: FONTS.body,
    fontSize: 13.5,
    lineHeight: 19.5,
    marginTop: 4,
    marginBottom: 10,
  },
  chartWrap: {
    gap: 4,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  yAxis: {
    width: 26,
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 8,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 26,
  },
  axisNum: {
    fontFamily: FONTS.numMedium,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  wishSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
  },
  wishHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  wishTitlePair: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  sectionTitle: {
    fontFamily: FONTS.display,
    fontSize: 18,
    letterSpacing: -0.2,
  },
  wishCount: {
    fontFamily: FONTS.num,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  addManyBtn: {
    paddingVertical: 8,
    paddingLeft: 10,
  },
  addManyText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 14,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 14,
  },
  contGroup: {
    marginTop: 10,
  },
  contGroupLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 12.5,
    marginBottom: 4,
  },
  wishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 10,
    gap: 10,
  },
  wishNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wishName: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 15,
    flexShrink: 1,
  },
  markBeenBtn: {
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  markBeenText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
  removeWishBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
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
  modalBody: {
    padding: 18,
    gap: 14,
  },
  sentencePreview: {
    fontFamily: FONTS.display,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  sentenceNum: {
    fontFamily: FONTS.num,
    fontVariant: ['tabular-nums'],
  },
  fieldLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  contPickerScroll: {
    gap: 8,
  },
  scopePill: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  scopeText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13.5,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    fontFamily: FONTS.num,
    fontSize: 26,
    minWidth: 56,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
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
  saveBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 15,
  },
});
