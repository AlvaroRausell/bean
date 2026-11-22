import React, { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, Circle, Path, Shader } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { PLACE_BY_ID } from '@/data/places';
import { PlaceSearchModal } from '@/components/map/PlaceSearchModal';
import {
  buildHatchUniforms,
  getHatchRuntimeEffect,
  getHomeRegionMiniMap,
} from '@/map/cartography';
import {
  exportBackupToShareSheet,
  pickAndValidateBackupFile,
} from '@/sync/backupFiles';
import { BackupPreview } from '@/sync/backupService';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES, THEME_ORDER } from '@/theme/mapThemes';
import { FONTS } from '@/theme/typography';
import { MapThemeId } from '@/types';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const userPlaces = useTravelStore((s) => s.userPlaces);
  const yearCollections = useTravelStore((s) => s.yearCollections);
  const collectionItems = useTravelStore((s) => s.collectionItems);
  const travelGoals = useTravelStore((s) => s.travelGoals);
  const userProfile = useTravelStore((s) => s.userProfile);
  const updateProfile = useTravelStore((s) => s.updateProfile);
  const importBackup = useTravelStore((s) => s.importBackup);
  const markBackupExported = useTravelStore((s) => s.markBackupExported);

  const theme = MAP_THEMES[userProfile.mapTheme];
  const hatchEffect = useMemo(() => getHatchRuntimeEffect(), []);

  const [homePickerOpen, setHomePickerOpen] = useState(false);
  const [birthPickerOpen, setBirthPickerOpen] = useState(false);
  const [androidPendingBackup, setAndroidPendingBackup] = useState<BackupPreview | null>(
    null
  );

  const previewW = Math.floor((Math.max(280, screenWidth - 36) - 20) / 3);
  const previewH = 68;
  const homeMini = useMemo(
    () => getHomeRegionMiniMap(userProfile.homePlaceId, previewW, previewH),
    [userProfile.homePlaceId, previewW]
  );

  const currentYear = new Date().getFullYear();
  const birthYears = useMemo(() => {
    const out: number[] = [];
    for (let y = currentYear - 10; y >= 1925; y--) out.push(y);
    return out;
  }, [currentYear]);

  const homePlace = userProfile.homePlaceId
    ? PLACE_BY_ID[userProfile.homePlaceId]
    : null;

  const handleSaveBackup = async () => {
    try {
      await exportBackupToShareSheet({
        userPlaces,
        yearCollections,
        collectionItems,
        travelGoals,
        userProfile,
      });
      await markBackupExported();
      Haptics.selectionAsync();
    } catch (e: any) {
      Alert.alert(
        'Could not save backup',
        e?.message ?? 'Try choosing a different location.'
      );
    }
  };

  const applyImport = async (preview: BackupPreview, mode: 'merge' | 'replace') => {
    try {
      await importBackup(preview.backup, mode);
      setAndroidPendingBackup(null);
      Haptics.selectionAsync();
      Alert.alert(
        'Backup restored',
        mode === 'merge'
          ? 'Your travel records were combined with this phone.'
          : 'Everything on this phone was replaced with the backup.'
      );
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message ?? 'Could not restore that backup.');
    }
  };

  const handleRestoreBackup = async () => {
    try {
      const preview = await pickAndValidateBackupFile();
      if (!preview) return;

      const summary = `Saved ${new Date(
        preview.exportedAt
      ).toLocaleDateString()}: ${preview.visitedCount} visited, ${
        preview.wishlistCount
      } want to go, ${preview.collectionsCount} years, ${preview.goalsCount} goals.`;

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: 'Restore from backup',
            message: summary,
            options: [
              'Combine with this phone',
              'Replace everything on this phone',
              'Cancel',
            ],
            destructiveButtonIndex: 1,
            cancelButtonIndex: 2,
          },
          (buttonIndex) => {
            if (buttonIndex === 0) applyImport(preview, 'merge');
            else if (buttonIndex === 1) applyImport(preview, 'replace');
          }
        );
      } else {
        setAndroidPendingBackup(preview);
      }
    } catch {
      Alert.alert('Cannot open file', "That file isn't a Bean backup.");
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.surface }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Native-feeling Back Bar */}
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to Record"
          style={({ pressed }) => [
            styles.backRow,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <ChevronLeft
            size={20}
            color={theme.accent}
            strokeWidth={2.2}
            absoluteStrokeWidth
          />
          <Text style={[styles.backText, { color: theme.accent }]}>Record</Text>
        </Pressable>

        <Text style={[styles.heading, { color: theme.textPrimary }]}>Settings</Text>

        {/* 1. Map Style (3 Live Home-Region Mini-Maps) */}
        <View style={styles.firstSection}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
            Map style
          </Text>
          <View style={styles.themeGrid}>
            {THEME_ORDER.map((tid: MapThemeId) => {
              const t = MAP_THEMES[tid];
              const selected = userProfile.mapTheme === tid;
              const hatchU = buildHatchUniforms(
                t.landUnvisited,
                t.landWishlist,
                4.2,
                1.0
              );

              return (
                <Pressable
                  key={tid}
                  onPress={() => {
                    Haptics.selectionAsync();
                    updateProfile({ mapTheme: tid });
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${t.name} map style`}
                  style={({ pressed }) => [
                    styles.themeItem,
                    { width: previewW, opacity: pressed ? 0.78 : 1 },
                  ]}
                >
                  <View
                    style={[
                      styles.themeMapFrame,
                      {
                        backgroundColor: t.ocean,
                        borderColor: selected ? theme.accent : theme.cardBorder,
                        borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <Canvas style={{ width: previewW, height: previewH }}>
                      {homeMini.places.map((p) => {
                        const st = userPlaces[p.id]?.status ?? 'none';
                        return (
                          <React.Fragment key={p.id}>
                            {st === 'wishlist' && hatchEffect ? (
                              <Path path={p.skPath}>
                                <Shader source={hatchEffect} uniforms={hatchU} />
                              </Path>
                            ) : (
                              <Path
                                path={p.skPath}
                                color={
                                  st === 'lived'
                                    ? t.landLived
                                    : st === 'visited'
                                    ? t.landVisited
                                    : t.landUnvisited
                                }
                              />
                            )}
                            <Path
                              path={p.skPath}
                              color={t.border}
                              style="stroke"
                              strokeWidth={0.55}
                              strokeJoin="round"
                            />
                            {st === 'lived' && (
                              <Circle
                                cx={p.centroid[0]}
                                cy={p.centroid[1]}
                                r={2}
                                color={t.livedDot}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </Canvas>

                    {selected && (
                      <View
                        style={[
                          styles.themeBadge,
                          { backgroundColor: theme.accent },
                        ]}
                      >
                        <Check
                          size={11}
                          color={theme.accentInk}
                          strokeWidth={2.6}
                          absoluteStrokeWidth
                        />
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.themeName,
                      {
                        color: selected ? theme.textPrimary : theme.textSecondary,
                        fontFamily: selected ? FONTS.bodySemiBold : FONTS.bodyMedium,
                      },
                    ]}
                  >
                    {t.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 2. What Counts (Single UK switch + Territories switch) */}
        <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
            What counts
          </Text>

          <View style={styles.switchRow}>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>
                UK nations separately
              </Text>
              <Text style={[styles.rowDesc, { color: theme.textSecondary }]}>
                Count England, Scotland, Wales and Northern Ireland as 196 places instead of 193.
              </Text>
            </View>
            <Switch
              value={userProfile.countingMode === 'uk_split_un'}
              onValueChange={(split) => {
                Haptics.selectionAsync();
                updateProfile({ countingMode: split ? 'uk_split_un' : 'un_strict' });
              }}
              trackColor={{ true: theme.accent, false: theme.switchTrackOff }}
              accessibilityLabel="Count UK nations separately"
            />
          </View>

          <View
            style={[
              styles.switchRow,
              {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.cardBorder,
              },
            ]}
          >
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>
                Include territories
              </Text>
              <Text style={[styles.rowDesc, { color: theme.textSecondary }]}>
                Adds 47 places such as Greenland, Puerto Rico and Hong Kong.
              </Text>
            </View>
            <Switch
              value={userProfile.includeTerritories}
              onValueChange={(v) => {
                Haptics.selectionAsync();
                updateProfile({ includeTerritories: v });
              }}
              trackColor={{ true: theme.accent, false: theme.switchTrackOff }}
              accessibilityLabel="Include territories"
            />
          </View>
        </View>

        {/* 3. About You */}
        <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
            About you
          </Text>

          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setHomePickerOpen(true);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.navRow,
              { opacity: pressed ? 0.68 : 1 },
            ]}
          >
            <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>
              Home country
            </Text>
            <View style={styles.navRight}>
              <Text style={[styles.navVal, { color: theme.textSecondary }]}>
                {homePlace ? homePlace.name : 'Not set'}
              </Text>
              <ChevronRight
                size={16}
                color={theme.textMuted}
                strokeWidth={1.8}
                absoluteStrokeWidth
              />
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setBirthPickerOpen((v) => !v);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.navRow,
              {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.cardBorder,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>
              Birth year
            </Text>
            <View style={styles.navRight}>
              <Text style={[styles.navValNum, { color: theme.textSecondary }]}>
                {userProfile.birthYear ?? 'Not set'}
              </Text>
              <ChevronRight
                size={16}
                color={theme.textMuted}
                strokeWidth={1.8}
                absoluteStrokeWidth
              />
            </View>
          </Pressable>

          {birthPickerOpen && (
            <View style={styles.birthPickerWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.birthWheel}
              >
                <Pressable
                  onPress={async () => {
                    Haptics.selectionAsync();
                    await updateProfile({ birthYear: null });
                    setBirthPickerOpen(false);
                  }}
                  style={[
                    styles.birthPill,
                    {
                      backgroundColor:
                        userProfile.birthYear == null
                          ? theme.accent
                          : theme.surfaceSubtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.birthPillText,
                      {
                        color:
                          userProfile.birthYear == null
                            ? theme.accentInk
                            : theme.textSecondary,
                      },
                    ]}
                  >
                    None
                  </Text>
                </Pressable>
                {birthYears.map((y) => {
                  const active = userProfile.birthYear === y;
                  return (
                    <Pressable
                      key={y}
                      onPress={async () => {
                        Haptics.selectionAsync();
                        await updateProfile({ birthYear: y });
                        setBirthPickerOpen(false);
                      }}
                      style={[
                        styles.birthPill,
                        {
                          backgroundColor: active
                            ? theme.accent
                            : theme.surfaceSubtle,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.birthPillNum,
                          { color: active ? theme.accentInk : theme.textPrimary },
                        ]}
                      >
                        {y}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>

        {/* 4. Your Data (plain human copy, zero JSON/SQLite jargon) */}
        <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>
            Your data
          </Text>
          <Text style={[styles.dataDesc, { color: theme.textSecondary }]}>
            Everything is stored on this phone. Save a backup file to keep a copy or move to a new phone.
          </Text>

          <Pressable
            onPress={handleSaveBackup}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.navRow,
              { opacity: pressed ? 0.65 : 1 },
            ]}
          >
            <Text style={[styles.rowTitle, { color: theme.accent }]}>
              Save a backup
            </Text>
            <ChevronRight
              size={16}
              color={theme.textMuted}
              strokeWidth={1.8}
              absoluteStrokeWidth
            />
          </Pressable>

          <Pressable
            onPress={handleRestoreBackup}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.navRow,
              {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.cardBorder,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>
              Restore from a backup
            </Text>
            <ChevronRight
              size={16}
              color={theme.textMuted}
              strokeWidth={1.8}
              absoluteStrokeWidth
            />
          </Pressable>

          <Text style={[styles.footnote, { color: theme.textMuted }]}>
            {userProfile.lastBackupAt
              ? `Last backup saved ${new Date(
                  userProfile.lastBackupAt
                ).toLocaleDateString()}`
              : 'No backup saved yet'}
          </Text>
        </View>
      </ScrollView>

      {/* Reused Shared Place Search for Home Country (no 60-item cap!) */}
      <PlaceSearchModal
        visible={homePickerOpen}
        onClose={() => setHomePickerOpen(false)}
        mode="pick_home"
        selectedId={userProfile.homePlaceId}
        onPickPlace={(p) => {
          updateProfile({ homePlaceId: p.id });
        }}
      />

      {/* Android Fallback Restore Action Sheet */}
      <Modal
        visible={Boolean(androidPendingBackup)}
        transparent
        animationType="fade"
        onRequestClose={() => setAndroidPendingBackup(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.androidDialog,
              {
                backgroundColor: theme.surfaceElevated,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <Text style={[styles.dialogTitle, { color: theme.textPrimary }]}>
              Restore from backup
            </Text>
            {androidPendingBackup && (
              <Text style={[styles.rowDesc, { color: theme.textSecondary }]}>
                Saved{' '}
                {new Date(androidPendingBackup.exportedAt).toLocaleDateString()}:{' '}
                {androidPendingBackup.visitedCount} visited,{' '}
                {androidPendingBackup.wishlistCount} want to go,{' '}
                {androidPendingBackup.collectionsCount} years,{' '}
                {androidPendingBackup.goalsCount} goals.
              </Text>
            )}
            <Pressable
              onPress={() =>
                androidPendingBackup && applyImport(androidPendingBackup, 'merge')
              }
              style={[styles.dialogRow, { borderTopColor: theme.cardBorder }]}
            >
              <Text style={[styles.rowTitle, { color: theme.accent }]}>
                Combine with this phone
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                androidPendingBackup && applyImport(androidPendingBackup, 'replace')
              }
              style={[styles.dialogRow, { borderTopColor: theme.cardBorder }]}
            >
              <Text style={[styles.rowTitle, { color: theme.danger }]}>
                Replace everything on this phone
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAndroidPendingBackup(null)}
              style={[styles.dialogRow, { borderTopColor: theme.cardBorder }]}
            >
              <Text style={[styles.rowTitle, { color: theme.textSecondary }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 18 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: -6,
    height: 44,
    alignSelf: 'flex-start',
  },
  backText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 15.5,
  },
  heading: {
    fontFamily: FONTS.display,
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.5,
    marginBottom: 18,
  },
  firstSection: {
    paddingBottom: 20,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
  },
  sectionTitle: {
    fontFamily: FONTS.display,
    fontSize: 16.5,
    letterSpacing: -0.2,
    marginBottom: 12,
  },
  themeGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  themeItem: {
    alignItems: 'center',
    gap: 6,
  },
  themeMapFrame: {
    width: '100%',
    height: 68,
    borderRadius: 11,
    overflow: 'hidden',
    position: 'relative',
  },
  themeBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeName: {
    fontSize: 13,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 10,
  },
  rowCopy: {
    flex: 1,
  },
  rowTitle: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 15,
  },
  rowDesc: {
    fontFamily: FONTS.body,
    fontSize: 12.5,
    lineHeight: 17.5,
    marginTop: 2,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: 10,
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navVal: {
    fontFamily: FONTS.body,
    fontSize: 14.5,
  },
  navValNum: {
    fontFamily: FONTS.num,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  birthPickerWrap: {
    paddingTop: 6,
    paddingBottom: 4,
  },
  birthWheel: {
    gap: 7,
  },
  birthPill: {
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthPillText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13.5,
  },
  birthPillNum: {
    fontFamily: FONTS.num,
    fontSize: 14.5,
    fontVariant: ['tabular-nums'],
  },
  dataDesc: {
    fontFamily: FONTS.body,
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: 8,
  },
  footnote: {
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 22,
  },
  androidDialog: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 6,
    gap: 8,
  },
  dialogTitle: {
    fontFamily: FONTS.display,
    fontSize: 18,
  },
  dialogRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
});
