import React, { useEffect, useMemo, useState } from 'react';
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
import { Check, Search, X } from 'lucide-react-native';
import { PLACES_CATALOG } from '@/data/places';
import { CONTINENTS, isVisitedStatus } from '@/domain/statsCalculator';
import { computeBulkWishlistExcept } from '@/domain/wishlistOps';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES } from '@/theme/mapThemes';
import { FONTS } from '@/theme/typography';
import { Continent } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function SelectAllExceptModal({ visible, onClose }: Props) {
  const userPlaces = useTravelStore((s) => s.userPlaces);
  const userProfile = useTravelStore((s) => s.userProfile);
  const bulkAddWishlistExcept = useTravelStore((s) => s.bulkAddWishlistExcept);
  const theme = MAP_THEMES[userProfile.mapTheme];

  const [scopeContinent, setScopeContinent] = useState<Continent | 'ALL'>('ALL');
  const [excludeVisited, setExcludeVisited] = useState(true);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');

  // Reset transient exclusions cleanly whenever dismissed (fixes state leak on X close)
  useEffect(() => {
    if (!visible) {
      setExcludedIds(new Set());
      setQuery('');
      setScopeContinent('ALL');
    }
  }, [visible]);

  const scopedList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PLACES_CATALOG.filter((p) => {
      if (!userProfile.includeTerritories && !p.isUnMember) return false;
      if (scopeContinent !== 'ALL' && p.continent !== scopeContinent) return false;
      if (excludeVisited && isVisitedStatus(userPlaces[p.id]?.status)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.continent.toLowerCase().includes(q) ||
        p.searchAliases?.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [
    userProfile.includeTerritories,
    scopeContinent,
    excludeVisited,
    userPlaces,
    query,
  ]);

  const preview = useMemo(
    () =>
      computeBulkWishlistExcept(PLACES_CATALOG, userPlaces, excludedIds, {
        continent: scopeContinent,
        includeTerritories: userProfile.includeTerritories,
        excludeAlreadyVisited: excludeVisited,
      }),
    [
      userPlaces,
      excludedIds,
      scopeContinent,
      userProfile.includeTerritories,
      excludeVisited,
    ]
  );

  const toggleExclude = (id: string) => {
    Haptics.selectionAsync();
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    Haptics.selectionAsync();
    await bulkAddWishlistExcept(excludedIds, {
      continent: scopeContinent,
      includeTerritories: userProfile.includeTerritories,
      excludeAlreadyVisited: excludeVisited,
    });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
      transparent={Platform.OS !== 'ios'}
      onRequestClose={onClose}
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
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.textPrimary }]}>
                Add many
              </Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Untick anywhere you don't want to go.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close Add many"
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  backgroundColor: theme.surfaceSubtle,
                  borderColor: theme.cardBorder,
                  opacity: pressed ? 0.65 : 1,
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

          {/* Scope Chips */}
          <View style={styles.scopeWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.scopeScroll}
            >
              {(['ALL', ...CONTINENTS.filter((c) => c !== 'Antarctica')] as (
                | Continent
                | 'ALL'
              )[]).map((c) => {
                const active = scopeContinent === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setScopeContinent(c);
                    }}
                    style={[
                      styles.scopeChip,
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
                        { color: active ? theme.accentInk : theme.textSecondary },
                      ]}
                    >
                      {c === 'ALL' ? 'Whole world' : c}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Controls + Search */}
          <View style={styles.controlsRow}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setExcludeVisited((v) => !v);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: excludeVisited }}
              style={[
                styles.quickChip,
                {
                  backgroundColor: excludeVisited
                    ? theme.accentSoft
                    : theme.surfaceElevated,
                  borderColor: excludeVisited ? theme.accent : theme.cardBorder,
                },
              ]}
            >
              <Check
                size={13}
                color={excludeVisited ? theme.accent : theme.textMuted}
                strokeWidth={2.2}
                absoluteStrokeWidth
              />
              <Text
                style={[
                  styles.quickChipText,
                  { color: excludeVisited ? theme.accent : theme.textSecondary },
                ]}
              >
                Skip places I've been
              </Text>
            </Pressable>

            {excludedIds.size > 0 && (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setExcludedIds(new Set());
                }}
                style={styles.clearLink}
              >
                <Text style={[styles.quickChipText, { color: theme.accent }]}>
                  Tick all ({excludedIds.size} unticked)
                </Text>
              </Pressable>
            )}
          </View>

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
              size={16}
              color={theme.textMuted}
              strokeWidth={1.8}
              absoluteStrokeWidth
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Find a place"
              placeholderTextColor={theme.textMuted}
              style={[styles.searchInput, { color: theme.textPrimary }]}
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={10}
                accessibilityLabel="Clear search"
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

          {/* Ordinary Flush Hairline Checklist (no red error styling!) */}
          <FlatList
            data={scopedList}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            renderItem={({ item, index }) => {
              const isExcluded = excludedIds.has(item.id);
              const included = !isExcluded;
              const alreadyWish = userPlaces[item.id]?.status === 'wishlist';

              return (
                <Pressable
                  onPress={() => toggleExclude(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: included }}
                  accessibilityLabel={item.name}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.cardBorder,
                    },
                    { opacity: pressed ? 0.68 : 1 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.name,
                        {
                          color: included ? theme.textPrimary : theme.textMuted,
                        },
                      ]}
                    >
                      {item.name}
                    </Text>
                    <Text style={[styles.meta, { color: theme.textSecondary }]}>
                      {alreadyWish ? 'Already on your list' : item.continent}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.checkbox,
                      {
                        backgroundColor: included ? theme.accent : 'transparent',
                        borderColor: included ? theme.accent : theme.textMuted,
                      },
                    ]}
                  >
                    {included && (
                      <Check
                        size={13}
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

          {/* Sticky High-Contrast Footer */}
          <View
            style={[
              styles.footer,
              {
                backgroundColor: theme.surface,
                borderTopColor: theme.cardBorder,
              },
            ]}
          >
            <Pressable
              onPress={handleConfirm}
              disabled={preview.addedCount === 0}
              style={({ pressed }) => [
                styles.ctaBtn,
                {
                  backgroundColor:
                    preview.addedCount > 0 ? theme.accent : theme.surfaceSubtle,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.ctaText,
                  {
                    color:
                      preview.addedCount > 0 ? theme.accentInk : theme.textMuted,
                  },
                ]}
              >
                {preview.addedCount > 0
                  ? `Add ${preview.addedCount} ${
                      preview.addedCount === 1 ? 'place' : 'places'
                    }`
                  : 'These are all on your list already'}
              </Text>
            </Pressable>
          </View>
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
  root: { flex: 1 },
  androidSheet: {
    marginTop: 48,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 12,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 22,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 13.5,
    marginTop: 2,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeWrap: { marginBottom: 10 },
  scopeScroll: { paddingHorizontal: 18, gap: 7 },
  scopeChip: {
    paddingHorizontal: 13,
    height: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  scopeText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 12,
    height: 32,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickChipText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 12.5,
  },
  clearLink: {
    paddingVertical: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 14.5,
  },
  list: {
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingVertical: 10,
  },
  name: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 15,
  },
  meta: {
    fontFamily: FONTS.body,
    fontSize: 12,
    marginTop: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 15,
  },
});
