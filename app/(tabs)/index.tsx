import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WorldMapCanvas } from '@/components/map/WorldMapCanvas';
import { PlaceDetailSheet } from '@/components/map/PlaceDetailSheet';
import { PlaceSearchModal } from '@/components/map/PlaceSearchModal';
import { useTravelStore } from '@/store/useTravelStore';

export default function MapHomeScreen() {
  const searchOpen = useTravelStore((s) => s.searchModalOpen);
  const setSearchOpen = useTravelStore((s) => s.setSearchModalOpen);

  return (
    <View style={styles.root}>
      <WorldMapCanvas onOpenSearch={() => setSearchOpen(true)} />
      <PlaceDetailSheet />
      <PlaceSearchModal
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
