import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Canvas, Circle, Path } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ban, Check, Plus, Star, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLACE_BY_ID, UK_NATIONS } from '@/data/places';
import {
  getPlaceSilhouettePath,
  getUkInsetMap,
  hitTestUkInset,
} from '@/map/cartography';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES } from '@/theme/mapThemes';
import { FONTS } from '@/theme/typography';
import { PlaceStatus } from '@/types';

const UK_INSET_W = 112;
const UK_INSET_H = 120;

export function PlaceDetailSheet() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isLandscape = screenWidth > screenHeight;
  const insets = useSafeAreaInsets();

  const selectedPlaceId = useTravelStore((s) => s.selectedPlaceId);
  const selectPlace = useTravelStore((s) => s.selectPlace);
  const userPlaces = useTravelStore((s) => s.userPlaces);
  const yearCollections = useTravelStore((s) => s.yearCollections);
  const collectionItems = useTravelStore((s) => s.collectionItems);
  const setPlaceStatus = useTravelStore((s) => s.setPlaceStatus);
  const togglePlaceFavorite = useTravelStore((s) => s.togglePlaceFavorite);
  const setPlaceNotes = useTravelStore((s) => s.setPlaceNotes);
  const addPlaceToYear = useTravelStore((s) => s.addPlaceToYear);
  const removePlaceFromYear = useTravelStore((s) => s.removePlaceFromYear);
  const setSheetHeight = useTravelStore((s) => s.setSheetHeight);
  const themeId = useTravelStore((s) => s.userProfile.mapTheme);

  const theme = MAP_THEMES[themeId];
  const place = selectedPlaceId ? PLACE_BY_ID[selectedPlaceId] : null;
  const userPlace = selectedPlaceId ? userPlaces[selectedPlaceId] : undefined;
  const currentStatus: PlaceStatus = userPlace?.status ?? 'none';

  const [expanded, setExpanded] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(userPlace?.notes ?? '');
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync draft notes when switching places (flush pending save for prior place)
  const prevPlaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (notesDebounceRef.current) {
      clearTimeout(notesDebounceRef.current);
      notesDebounceRef.current = null;
    }
    setNotesDraft(userPlace?.notes ?? '');
    if (prevPlaceIdRef.current !== selectedPlaceId) {
      setYearPickerOpen(false);
      prevPlaceIdRef.current = selectedPlaceId;
    }
  }, [selectedPlaceId, userPlace?.notes]);

  useEffect(() => {
    return () => {
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    };
  }, []);

  const handleNotesChange = (text: string) => {
    setNotesDraft(text);
    if (!place) return;
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    const targetId = place.id;
    notesDebounceRef.current = setTimeout(() => {
      setPlaceNotes(targetId, text);
    }, 380);
  };

  // Drag detents (peek vs expanded + swipe down to dismiss)
  const translateY = useSharedValue(480);
  const dragStartY = useSharedValue(0);

  useEffect(() => {
    if (selectedPlaceId) {
      setExpanded(false);
      translateY.value = 320;
      translateY.value = withTiming(0, {
        duration: 240,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [selectedPlaceId, translateY]);

  const dismissSheet = () => {
    selectPlace(null, false);
  };

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .onBegin(() => {
          dragStartY.value = translateY.value;
        })
        .onUpdate((e) => {
          const next = dragStartY.value + e.translationY;
          translateY.value = Math.max(-44, next);
        })
        .onEnd((e) => {
          if (e.translationY > 90 || e.velocityY > 650) {
            translateY.value = withTiming(420, { duration: 180 }, (finished) => {
              if (finished) runOnJS(dismissSheet)();
            });
            return;
          }
          if (e.translationY < -45 || e.velocityY < -500) {
            runOnJS(setExpanded)(true);
          } else if (e.translationY > 30) {
            runOnJS(setExpanded)(false);
          }
          translateY.value = withSpring(0, { damping: 24, stiffness: 260 });
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [translateY, dragStartY]
  );

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Unified Years list (merges YearCollections memberships + firstVisitedYear)
  const placeYears = useMemo(() => {
    if (!selectedPlaceId) return [] as { year: number; planned: boolean }[];
    const byYear = new Map<number, boolean>();
    const memberColIds = new Set(
      collectionItems
        .filter((i) => i.placeId === selectedPlaceId && !i.deletedAt)
        .map((i) => i.collectionId)
    );
    for (const col of yearCollections) {
      if (!col.deletedAt && memberColIds.has(col.id)) {
        byYear.set(col.year, col.collectionType === 'planned');
      }
    }
    if (
      userPlace?.firstVisitedYear &&
      (currentStatus === 'visited' || currentStatus === 'lived') &&
      !byYear.has(userPlace.firstVisitedYear)
    ) {
      byYear.set(userPlace.firstVisitedYear, false);
    }
    return [...byYear.entries()]
      .map(([year, planned]) => ({ year, planned }))
      .sort((a, b) => a.year - b.year);
  }, [selectedPlaceId, collectionItems, yearCollections, userPlace, currentStatus]);

  const silhouettePath = useMemo(
    () => (place ? getPlaceSilhouettePath(place.id, 34) : null),
    [place]
  );

  const ukInset = useMemo(
    () => (place?.parentId === 'GB' ? getUkInsetMap(UK_INSET_W, UK_INSET_H) : null),
    [place?.parentId]
  );

  const currentYear = new Date().getFullYear();
  const selectableYears = useMemo(() => {
    const out: number[] = [];
    for (let y = currentYear + 4; y >= 1960; y--) out.push(y);
    return out;
  }, [currentYear]);

  if (!place) return null;

  const isUkNation = place.parentId === 'GB';
  const isBeen = currentStatus === 'visited' || currentStatus === 'lived';
  const isLived = currentStatus === 'lived';
  const isWant = currentStatus === 'wishlist';
  const isSkipped = currentStatus === 'skipped';
  const isFavorite = Boolean(userPlace?.isFavorite);

  const handleToggleFavorite = async () => {
    Haptics.selectionAsync();
    await togglePlaceFavorite(place.id);
  };

  const handleToggleBeen = async () => {
    if (isBeen) {
      Haptics.selectionAsync();
      await setPlaceStatus(place.id, 'none');
    } else {
      // The app's sole success haptic — paired with the Skia ink-flood!
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await setPlaceStatus(place.id, 'visited');
    }
  };

  const handleToggleWant = async () => {
    if (isWant) {
      Haptics.selectionAsync();
      await setPlaceStatus(place.id, 'none');
    } else {
      Haptics.selectionAsync();
      await setPlaceStatus(place.id, 'wishlist');
    }
  };

  const handleToggleSkipped = async () => {
    Haptics.selectionAsync();
    if (isSkipped) {
      await setPlaceStatus(place.id, 'none');
    } else {
      await setPlaceStatus(place.id, 'skipped');
    }
  };

  const handleToggleLived = async (val: boolean) => {
    Haptics.selectionAsync();
    await setPlaceStatus(place.id, val ? 'lived' : 'visited');
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    setSheetHeight(e.nativeEvent.layout.height);
  };

  const maxSheetHeight = isLandscape
    ? Math.min(screenHeight * 0.8, 340)
    : expanded
    ? Math.min(screenHeight * 0.8, 640)
    : Math.min(screenHeight * 0.62, 535);

  const subtitle = isUkNation
    ? 'Part of the United Kingdom'
    : place.kind === 'territory'
    ? `Territory, ${place.continent}`
    : place.continent;

  const silhouetteFill = isLived
    ? theme.landLived
    : isBeen
    ? theme.landVisited
    : isSkipped
    ? theme.landSkipped
    : theme.landUnvisited;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.overlayWrap}
      pointerEvents="box-none"
    >
      <Animated.View
        onLayout={handleLayout}
        style={[
          styles.sheet,
          animatedSheetStyle,
          {
            maxHeight: maxSheetHeight,
            backgroundColor: theme.surface,
            borderTopColor: theme.cardBorder,
          },
        ]}
      >
        {/* Drag Handle + Header (buttons kept OUTSIDE GestureDetector so taps never get stolen) */}
        <GestureDetector gesture={panGesture}>
          <View style={styles.grabberHit}>
            <View style={[styles.grabber, { backgroundColor: theme.textMuted }]} />
          </View>
        </GestureDetector>

        <View style={styles.headerRow}>
          <GestureDetector gesture={panGesture}>
            <View style={styles.headerDraggable}>
              <View
                style={[
                  styles.silhouetteBox,
                  {
                    backgroundColor: theme.surfaceSubtle,
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                {silhouettePath ? (
                  <Canvas style={{ width: 34, height: 34 }}>
                    <Path path={silhouettePath} color={silhouetteFill} />
                    <Path
                      path={silhouettePath}
                      color={theme.border}
                      style="stroke"
                      strokeWidth={0.9}
                      strokeJoin="round"
                    />
                  </Canvas>
                ) : (
                  <Text style={styles.fallbackFlag}>{place.flag}</Text>
                )}
              </View>

              <View style={styles.headerText}>
                <Text
                  style={[styles.title, { color: theme.textPrimary }]}
                  numberOfLines={1}
                >
                  {place.name}
                </Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  {subtitle}
                </Text>
              </View>
            </View>
          </GestureDetector>

          <View style={styles.headerActions}>
            <Pressable
              onPress={handleToggleFavorite}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityState={{ selected: isFavorite }}
              accessibilityLabel={
                isFavorite
                  ? `Remove ${place.name} from favourites`
                  : `Star ${place.name} as favourite`
              }
              style={({ pressed }) => [
                styles.headerIconBtn,
                {
                  backgroundColor: isFavorite
                    ? theme.favoriteSoft
                    : theme.surfaceSubtle,
                  borderColor: isFavorite
                    ? theme.favoriteAccent
                    : theme.cardBorder,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Star
                size={17}
                color={isFavorite ? theme.favoriteAccent : theme.textSecondary}
                fill={isFavorite ? theme.favoriteAccent : 'none'}
                strokeWidth={1.9}
                absoluteStrokeWidth
              />
            </Pressable>

            <Pressable
              onPress={() => selectPlace(null, false)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Close ${place.name}`}
              style={({ pressed }) => [
                styles.headerIconBtn,
                {
                  backgroundColor: theme.surfaceSubtle,
                  borderColor: theme.cardBorder,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <X
                size={17}
                color={theme.textSecondary}
                strokeWidth={1.9}
                absoluteStrokeWidth
              />
            </Pressable>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          contentContainerStyle={{
            paddingBottom:
              Math.max(insets.bottom, 14) +
              (isLandscape ? 52 : Platform.OS === 'ios' ? 76 : 24),
          }}
        >
          {/* Three Honest Status Toggles (Been here / Want to go / Not for me) */}
          <View style={styles.statusPair}>
            <Pressable
              onPress={handleToggleBeen}
              accessibilityRole="button"
              accessibilityState={{ selected: isBeen }}
              style={({ pressed }) => [
                styles.statusBtn,
                {
                  backgroundColor: isBeen ? theme.accent : theme.surfaceElevated,
                  borderColor: isBeen ? theme.accent : theme.cardBorder,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              {isBeen && (
                <Check
                  size={14}
                  color={theme.accentInk}
                  strokeWidth={2.2}
                  absoluteStrokeWidth
                />
              )}
              <Text
                numberOfLines={1}
                style={[
                  styles.statusBtnText,
                  { color: isBeen ? theme.accentInk : theme.textPrimary },
                ]}
              >
                Been here
              </Text>
            </Pressable>

            <Pressable
              onPress={handleToggleWant}
              accessibilityRole="button"
              accessibilityState={{ selected: isWant }}
              style={({ pressed }) => [
                styles.statusBtn,
                {
                  backgroundColor: isWant ? theme.accentSoft : theme.surfaceElevated,
                  borderColor: isWant ? theme.accent : theme.cardBorder,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.hatchGlyph,
                  {
                    borderColor: isWant ? theme.accent : theme.textSecondary,
                  },
                ]}
              >
                <View
                  style={[
                    styles.hatchGlyphLine,
                    { backgroundColor: isWant ? theme.accent : theme.textSecondary },
                  ]}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.statusBtnText,
                  { color: isWant ? theme.accent : theme.textPrimary },
                ]}
              >
                Want to go
              </Text>
            </Pressable>

            <Pressable
              onPress={handleToggleSkipped}
              accessibilityRole="button"
              accessibilityState={{ selected: isSkipped }}
              accessibilityLabel={`Mark ${place.name} as not for me`}
              style={({ pressed }) => [
                styles.statusBtn,
                {
                  backgroundColor: isSkipped
                    ? theme.skippedSoft
                    : theme.surfaceElevated,
                  borderColor: isSkipped ? theme.skippedAccent : theme.cardBorder,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <Ban
                size={13}
                color={isSkipped ? theme.skippedAccent : theme.textSecondary}
                strokeWidth={1.9}
                absoluteStrokeWidth
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.statusBtnText,
                  { color: isSkipped ? theme.skippedAccent : theme.textPrimary },
                ]}
              >
                Not for me
              </Text>
            </Pressable>
          </View>

          {/* I lived here (only active under Been) */}
          {isBeen && (
            <View
              style={[styles.hairlineRow, { borderTopColor: theme.cardBorder }]}
            >
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>
                I lived here
              </Text>
              <Switch
                value={isLived}
                onValueChange={handleToggleLived}
                trackColor={{ true: theme.accent, false: theme.switchTrackOff }}
                accessibilityLabel={`I lived in ${place.name}`}
              />
            </View>
          )}

          {/* Unified Years Row (replaces separate First Visited stepper + Year Collections) */}
          <View style={[styles.hairlineRow, { borderTopColor: theme.cardBorder }]}>
            <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Years</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.yearChipsScroll}
            >
              {placeYears.map(({ year, planned }) => (
                <Pressable
                  key={year}
                  onPress={() => {
                    Haptics.selectionAsync();
                    removePlaceFromYear(place.id, year);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove year ${year}`}
                  style={({ pressed }) => [
                    styles.yearChip,
                    {
                      backgroundColor: planned ? theme.accentSoft : theme.surfaceElevated,
                      borderColor: planned ? theme.accent : theme.cardBorder,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.yearChipText,
                      { color: planned ? theme.accent : theme.textPrimary },
                    ]}
                  >
                    {year}
                  </Text>
                  <X
                    size={12}
                    color={planned ? theme.accent : theme.textMuted}
                    strokeWidth={1.9}
                    absoluteStrokeWidth
                  />
                </Pressable>
              ))}

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setYearPickerOpen((v) => !v);
                }}
                accessibilityRole="button"
                accessibilityLabel="Add visit year"
                style={({ pressed }) => [
                  styles.yearChip,
                  {
                    backgroundColor: 'transparent',
                    borderColor: theme.cardBorder,
                    borderStyle: 'dashed',
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Plus
                  size={13}
                  color={theme.accent}
                  strokeWidth={2}
                  absoluteStrokeWidth
                />
                <Text style={[styles.yearAddText, { color: theme.accent }]}>Add</Text>
              </Pressable>
            </ScrollView>
          </View>

          {/* Compact Scrollable Year Picker (no 17-tap stepper!) */}
          {yearPickerOpen && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.yearWheelRow}
            >
              {selectableYears.map((y) => {
                const alreadyAdded = placeYears.some((p) => p.year === y);
                return (
                  <Pressable
                    key={y}
                    onPress={async () => {
                      Haptics.selectionAsync();
                      if (alreadyAdded) {
                        await removePlaceFromYear(place.id, y);
                      } else {
                        await addPlaceToYear(place.id, y);
                      }
                      setYearPickerOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.wheelPill,
                      {
                        backgroundColor: alreadyAdded
                          ? theme.accent
                          : theme.surfaceSubtle,
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.wheelPillText,
                        {
                          color: alreadyAdded ? theme.accentInk : theme.textPrimary,
                        },
                      ]}
                    >
                      {y}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* UK 4-Nation Interactive Inset Map (replaces chip grid & all-caps eyebrow!) */}
          {isUkNation && ukInset && (
            <View style={[styles.ukSection, { borderTopColor: theme.cardBorder }]}>
              <Pressable
                onPress={(e) => {
                  const { locationX, locationY } = e.nativeEvent;
                  const hit = hitTestUkInset(ukInset, locationX, locationY);
                  if (hit) {
                    Haptics.selectionAsync();
                    selectPlace(hit, true);
                  }
                }}
                accessibilityRole="imagebutton"
                accessibilityLabel="United Kingdom inset map of four nations"
                style={[
                  styles.ukInsetFrame,
                  {
                    backgroundColor: theme.ocean,
                    borderColor: theme.cardBorder,
                  },
                ]}
              >
                <Canvas style={{ width: UK_INSET_W, height: UK_INSET_H }}>
                  {ukInset.places.map((p) => {
                    const st = userPlaces[p.id]?.status ?? 'none';
                    const fill =
                      st === 'lived'
                        ? theme.landLived
                        : st === 'visited'
                        ? theme.landVisited
                        : st === 'skipped'
                        ? theme.landSkipped
                        : theme.landUnvisited;
                    return (
                      <React.Fragment key={p.id}>
                        <Path path={p.skPath} color={fill} />
                        <Path
                          path={p.skPath}
                          color={theme.border}
                          style="stroke"
                          strokeWidth={0.7}
                          strokeJoin="round"
                        />
                        {st === 'lived' && (
                          <Circle
                            cx={p.centroid[0]}
                            cy={p.centroid[1]}
                            r={2.5}
                            color={theme.livedDot}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                  {ukInset.places
                    .filter((p) => p.id === place.id)
                    .map((p) => (
                      <React.Fragment key={`sel-${p.id}`}>
                        <Path
                          path={p.skPath}
                          color={theme.borderSelectedOuter}
                          style="stroke"
                          strokeWidth={2.5}
                          strokeJoin="round"
                          strokeCap="round"
                        />
                        <Path
                          path={p.skPath}
                          color={theme.borderSelected}
                          style="stroke"
                          strokeWidth={1.15}
                          strokeJoin="round"
                          strokeCap="round"
                        />
                      </React.Fragment>
                    ))}
                </Canvas>
              </Pressable>

              <View style={styles.ukList}>
                {UK_NATIONS.map((uk) => {
                  const st = userPlaces[uk.id]?.status ?? 'none';
                  const isSel = uk.id === place.id;
                  const dotFill =
                    st === 'lived'
                      ? theme.landLived
                      : st === 'visited'
                      ? theme.landVisited
                      : st === 'skipped'
                      ? theme.landSkipped
                      : 'transparent';
                  return (
                    <Pressable
                      key={uk.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        selectPlace(uk.id, true);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSel }}
                      style={({ pressed }) => [
                        styles.ukRow,
                        isSel && { backgroundColor: theme.surfaceSubtle },
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.ukRowText,
                          {
                            color: isSel ? theme.textPrimary : theme.textSecondary,
                            fontFamily: isSel ? FONTS.bodySemiBold : FONTS.bodyMedium,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {uk.name}
                      </Text>
                      <View
                        style={[
                          styles.ukDot,
                          {
                            backgroundColor: dotFill,
                            borderColor: theme.border,
                          },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Notes (debounced, auto-growing, hairline-separated) */}
          <View style={[styles.notesWrap, { borderTopColor: theme.cardBorder }]}>
            <TextInput
              value={notesDraft}
              onChangeText={handleNotesChange}
              placeholder="Notes"
              placeholderTextColor={theme.textMuted}
              multiline
              style={[styles.notesInput, { color: theme.textPrimary }]}
            />
          </View>
        </ScrollView>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlayWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 18,
  },
  grabberHit: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.32,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  headerDraggable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  silhouetteBox: {
    width: 44,
    height: 44,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackFlag: {
    fontSize: 22,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPair: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statusBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  statusBtnText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
  },
  hatchGlyph: {
    width: 13,
    height: 13,
    borderRadius: 3,
    borderWidth: 1.4,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hatchGlyphLine: {
    width: 18,
    height: 1.3,
    transform: [{ rotate: '-45deg' }],
  },
  hairlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 14.5,
  },
  yearChipsScroll: {
    gap: 6,
    paddingLeft: 8,
    alignItems: 'center',
  },
  yearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  yearChipText: {
    fontFamily: FONTS.num,
    fontSize: 13.5,
    fontVariant: ['tabular-nums'],
  },
  yearAddText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
  yearWheelRow: {
    gap: 6,
    paddingBottom: 10,
  },
  wheelPill: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelPillText: {
    fontFamily: FONTS.num,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  ukSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ukInsetFrame: {
    width: UK_INSET_W,
    height: UK_INSET_H,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  ukList: {
    flex: 1,
    gap: 2,
  },
  ukRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  ukRowText: {
    fontSize: 13.5,
    flex: 1,
  },
  ukDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  notesWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingBottom: 6,
  },
  notesInput: {
    fontFamily: FONTS.body,
    fontSize: 14.5,
    lineHeight: 20,
    minHeight: 44,
    textAlignVertical: 'top',
  },
});
