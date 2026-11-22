import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Check, ChevronRight, Search, Star, X } from 'lucide-react-native';
import { PLACE_BY_ID, searchPlaces } from '@/data/places';
import { REGION_PRESETS } from '@/map/cameraMath';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES } from '@/theme/mapThemes';
import { FONTS } from '@/theme/typography';
import { Place } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Optional override when reused as Home Country picker from Settings */
  mode?: 'map' | 'pick_home';
  selectedId?: string | null;
  onPickPlace?: (place: Place) => void;
}

export function PlaceSearchModal({
  visible,
  onClose,
  mode = 'map',
  selectedId = null,
  onPickPlace,
}: Props) {
  const [query, setQuery] = useState('');
  const includeTerritories = useTravelStore((s) => s.userProfile.includeTerritories);
  const themeId = useTravelStore((s) => s.userProfile.mapTheme);
  const userPlaces = useTravelStore((s) => s.userPlaces);
  const recentSearchIds = useTravelStore((s) => s.recentSearchIds);
  const recordRecentSearch = useTravelStore((s) => s.recordRecentSearch);
  const selectPlace = useTravelStore((s) => s.selectPlace);
  const setPlaceStatus = useTravelStore((s) => s.setPlaceStatus);
  const requestCameraBbox = useTravelStore((s) => s.requestCameraBbox);

  const theme = MAP_THEMES[themeId];
  const trimmed = query.trim();

  const results = useMemo(
    () => searchPlaces(query, mode === 'pick_home' ? true : includeTerritories),
    [query, includeTerritories, mode]
  );

  const recentPlaces = useMemo(
    () =>
      recentSearchIds
        .map((id) => PLACE_BY_ID[id])
        .filter((p): p is Place => Boolean(p)),
    [recentSearchIds]
  );

  const favoritePlaces = useMemo(
    () =>
      Object.values(userPlaces)
        .filter((up) => !up.deletedAt && up.isFavorite)
        .map((up) => PLACE_BY_ID[up.placeId])
        .filter((p): p is Place => Boolean(p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [userPlaces]
  );

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  const handleSelectRow = (place: Place) => {
    Haptics.selectionAsync();
    if (mode === 'pick_home' && onPickPlace) {
      onPickPlace(place);
      handleClose();
      return;
    }
    recordRecentSearch(place.id);
    handleClose();
    selectPlace(place.id, true);
  };

  const handleJumpRegion = (bbox: [number, number, number, number]) => {
    Haptics.selectionAsync();
    handleClose();
    requestCameraBbox(bbox);
  };

  const handleToggleBeen = async (place: Place) => {
    const cur = userPlaces[place.id]?.status ?? 'none';
    const isBeen = cur === 'visited' || cur === 'lived';
    if (isBeen) {
      Haptics.selectionAsync();
      await setPlaceStatus(place.id, 'none');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await setPlaceStatus(place.id, 'visited');
    }
  };

  const showEmptyLanding = mode === 'map' && trimmed.length === 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
      transparent={Platform.OS !== 'ios'}
      onRequestClose={handleClose}
    >
      <View
        style={[
          styles.modalBackdrop,
          Platform.OS !== 'ios' && { backgroundColor: 'rgba(0,0,0,0.42)' },
        ]}
      >
        <SafeAreaView
          edges={['top', 'bottom']}
          style={[
            styles.root,
            { backgroundColor: theme.surface },
            Platform.OS !== 'ios' && styles.androidSheet,
          ]}
        >
          {/* Search Input Header */}
          <View style={[styles.header, { borderBottomColor: theme.cardBorder }]}>
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
                size={17}
                color={theme.textMuted}
                strokeWidth={1.8}
                absoluteStrokeWidth
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={
                  mode === 'pick_home' ? 'Search home country' : 'Search places'
                }
                placeholderTextColor={theme.textMuted}
                autoFocus={mode === 'map'}
                returnKeyType="search"
                style={[styles.input, { color: theme.textPrimary }]}
              />
              {query.length > 0 && (
                <Pressable
                  onPress={() => setQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={10}
                >
                  <X
                    size={16}
                    color={theme.textMuted}
                    strokeWidth={1.9}
                    absoluteStrokeWidth
                  />
                </Pressable>
              )}
            </View>

            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close search"
              style={({ pressed }) => [
                styles.doneBtn,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[styles.doneText, { color: theme.accent }]}>Done</Text>
            </Pressable>
          </View>

          {showEmptyLanding ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.landingContent}
            >
              {favoritePlaces.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                    Favourites
                  </Text>
                  <View style={styles.regionGrid}>
                    {favoritePlaces.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => handleSelectRow(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open favourite ${item.name}`}
                        style={({ pressed }) => [
                          styles.favChip,
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
                        <Text style={[styles.regionText, { color: theme.textPrimary }]}>
                          {item.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {recentPlaces.length > 0 && (
                <View
                  style={[
                    styles.section,
                    favoritePlaces.length > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.cardBorder,
                      paddingTop: 16,
                    },
                  ]}
                >
                  <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                    Recent
                  </Text>
                  {recentPlaces.map((item, idx) => (
                    <Pressable
                      key={item.id}
                      onPress={() => handleSelectRow(item)}
                      style={({ pressed }) => [
                        styles.row,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.cardBorder,
                        },
                        { opacity: pressed ? 0.68 : 1 },
                      ]}
                    >
                      <View style={styles.rowTextWrap}>
                        <Text style={[styles.name, { color: theme.textPrimary }]}>
                          {item.name}
                        </Text>
                        <Text style={[styles.meta, { color: theme.textSecondary }]}>
                          {item.parentId === 'GB' ? 'United Kingdom' : item.continent}
                        </Text>
                      </View>
                      <ChevronRight
                        size={16}
                        color={theme.textMuted}
                        strokeWidth={1.8}
                        absoluteStrokeWidth
                      />
                    </Pressable>
                  ))}
                </View>
              )}

              <View
                style={[
                  styles.section,
                  (recentPlaces.length > 0 || favoritePlaces.length > 0) && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.cardBorder,
                    paddingTop: 16,
                  },
                ]}
              >
                <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                  Regions
                </Text>
                <View style={styles.regionGrid}>
                  {REGION_PRESETS.map((preset) => (
                    <Pressable
                      key={preset.id}
                      onPress={() => handleJumpRegion(preset.bbox)}
                      accessibilityRole="button"
                      accessibilityLabel={`Jump map to ${preset.label}`}
                      style={({ pressed }) => [
                        styles.regionChip,
                        {
                          backgroundColor: theme.surfaceElevated,
                          borderColor: theme.cardBorder,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.regionText, { color: theme.textPrimary }]}>
                        {preset.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </ScrollView>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                    No matching places for "{trimmed}".
                  </Text>
                </View>
              }
              renderItem={({ item, index }) => {
                const status = userPlaces[item.id]?.status ?? 'none';
                const isBeen = status === 'visited' || status === 'lived';
                const isPickedHome = mode === 'pick_home' && selectedId === item.id;

                return (
                  <Pressable
                    onPress={() => handleSelectRow(item)}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.cardBorder,
                      },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <View style={styles.rowTextWrap}>
                      <View style={styles.nameWithStar}>
                        <Text style={[styles.name, { color: theme.textPrimary }]}>
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
                      <Text style={[styles.meta, { color: theme.textSecondary }]}>
                        {item.parentId === 'GB' ? 'United Kingdom' : item.continent}
                      </Text>
                    </View>

                    {mode === 'pick_home' ? (
                      isPickedHome ? (
                        <Check
                          size={18}
                          color={theme.accent}
                          strokeWidth={2.2}
                          absoluteStrokeWidth
                        />
                      ) : null
                    ) : (
                      <Pressable
                        onPress={() => handleToggleBeen(item)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isBeen }}
                        accessibilityLabel={`Been to ${item.name}`}
                        hitSlop={6}
                        style={({ pressed }) => [
                          styles.beenToggle,
                          { opacity: pressed ? 0.65 : 1 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.beenLabel,
                            { color: isBeen ? theme.accent : theme.textMuted },
                          ]}
                        >
                          Been here
                        </Text>
                        <View
                          style={[
                            styles.checkbox,
                            {
                              backgroundColor: isBeen ? theme.accent : 'transparent',
                              borderColor: isBeen ? theme.accent : theme.textMuted,
                            },
                          ]}
                        >
                          {isBeen && (
                            <Check
                              size={12}
                              color={theme.accentInk}
                              strokeWidth={2.5}
                              absoluteStrokeWidth
                            />
                          )}
                        </View>
                      </Pressable>
                    )}
                  </Pressable>
                );
              }}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  root: {
    flex: 1,
  },
  androidSheet: {
    marginTop: 56,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 15,
  },
  doneBtn: {
    height: 42,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  doneText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 15,
  },
  landingContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 18,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
    marginBottom: 2,
  },
  regionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  regionChip: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  favChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 11,
    paddingRight: 13,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nameWithStar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  regionText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 18,
    paddingBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    minHeight: 54,
  },
  rowTextWrap: {
    flex: 1,
  },
  name: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 15.5,
  },
  meta: {
    fontFamily: FONTS.body,
    fontSize: 12.5,
    marginTop: 1,
  },
  beenToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingLeft: 8,
  },
  beenLabel: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 12.5,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: FONTS.body,
    fontSize: 14,
  },
});
