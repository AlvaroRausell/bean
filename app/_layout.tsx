import React, { useEffect } from 'react';
import { Appearance, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RotateCcw, X } from 'lucide-react-native';
import {
  EncodeSans_400Regular,
  EncodeSans_500Medium,
  EncodeSans_600SemiBold,
} from '@expo-google-fonts/encode-sans';
import {
  EncodeSansSemiExpanded_500Medium,
  EncodeSansSemiExpanded_600SemiBold,
} from '@expo-google-fonts/encode-sans-semi-expanded';
import {
  EncodeSansCondensed_500Medium,
  EncodeSansCondensed_600SemiBold,
} from '@expo-google-fonts/encode-sans-condensed';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES } from '@/theme/mapThemes';
import { FONTS } from '@/theme/typography';

SplashScreen.preventAutoHideAsync().catch(() => {});

function GlobalUndoToast() {
  const undoBanner = useTravelStore((s) => s.undoBanner);
  const undoLastBulkAction = useTravelStore((s) => s.undoLastBulkAction);
  const dismissUndoBanner = useTravelStore((s) => s.dismissUndoBanner);
  const themeId = useTravelStore((s) => s.userProfile.mapTheme);
  const insets = useSafeAreaInsets();
  const theme = MAP_THEMES[themeId];

  useEffect(() => {
    if (!undoBanner) return;
    const t = setTimeout(() => dismissUndoBanner(), 6500);
    return () => clearTimeout(t);
  }, [undoBanner, dismissUndoBanner]);

  if (!undoBanner) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(180)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.toastOuter,
        {
          bottom: Math.max(insets.bottom, 12) + 74,
          borderColor: theme.cardBorder,
          backgroundColor: Platform.OS === 'android' ? theme.surfaceElevated : 'transparent',
        },
      ]}
    >
      <BlurView
        intensity={72}
        tint={theme.blurTint}
        style={[
          styles.toastInner,
          { backgroundColor: theme.surfaceGlass },
        ]}
      >
        <Text
          style={[styles.toastText, { color: theme.textPrimary }]}
          numberOfLines={1}
        >
          {undoBanner.message}
        </Text>
        <Pressable
          onPress={undoLastBulkAction}
          accessibilityRole="button"
          accessibilityLabel="Undo"
          hitSlop={6}
          style={({ pressed }) => [
            styles.undoBtn,
            { backgroundColor: theme.accentSoft, opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <RotateCcw size={13} color={theme.accent} strokeWidth={2} absoluteStrokeWidth />
          <Text style={[styles.undoText, { color: theme.accent }]}>Undo</Text>
        </Pressable>
        <Pressable
          onPress={dismissUndoBanner}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          hitSlop={10}
          style={({ pressed }) => [styles.dismissBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <X size={15} color={theme.textMuted} strokeWidth={1.8} absoluteStrokeWidth />
        </Pressable>
      </BlurView>
    </Animated.View>
  );
}

export default function RootLayout() {
  const hydrate = useTravelStore((s) => s.hydrate);
  const hydrated = useTravelStore((s) => s.hydrated);
  const themeId = useTravelStore((s) => s.userProfile.mapTheme);
  const theme = MAP_THEMES[themeId];

  const [fontsLoaded, fontError] = useFonts({
    EncodeSans_400Regular,
    EncodeSans_500Medium,
    EncodeSans_600SemiBold,
    EncodeSansSemiExpanded_500Medium,
    EncodeSansSemiExpanded_600SemiBold,
    EncodeSansCondensed_500Medium,
    EncodeSansCondensed_600SemiBold,
  });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    Appearance.setColorScheme(theme.isDark ? 'dark' : 'light');
  }, [theme.isDark]);

  useEffect(() => {
    if ((fontsLoaded || fontError) && hydrated) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError, hydrated]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.surface }}>
      <SafeAreaProvider>
        <StatusBar style={theme.isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            statusBarStyle: theme.isDark ? 'light' : 'dark',
            contentStyle: { backgroundColor: theme.surface },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="settings"
            options={{
              animation: 'default',
              gestureEnabled: true,
            }}
          />
        </Stack>
        <GlobalUndoToast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  toastOuter: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 100,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  toastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 10,
  },
  toastText: {
    flex: 1,
    fontFamily: FONTS.bodyMedium,
    fontSize: 13.5,
  },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 6,
    borderRadius: 10,
  },
  undoText: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 13,
  },
  dismissBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
