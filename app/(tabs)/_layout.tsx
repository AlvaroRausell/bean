import React from 'react';
import { Platform } from 'react-native';
import { NativeTabs } from 'expo-router/native-tabs';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES } from '@/theme/mapThemes';

export default function TabsLayout() {
  const themeId = useTravelStore((s) => s.userProfile.mapTheme);
  const theme = MAP_THEMES[themeId];

  return (
    <NativeTabs
      tintColor={theme.textPrimary}
      iconColor={{
        default: theme.textMuted,
        selected: theme.textPrimary,
      }}
      labelStyle={{
        default: { color: theme.textMuted },
        selected: { color: theme.textPrimary },
      }}
      backgroundColor={Platform.OS === 'android' ? theme.surface : undefined}
      indicatorColor={theme.accentSoft}
      blurEffect={theme.isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      disableTransparentOnScrollEdge={false}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'map', selected: 'map.fill' }}
          md="map"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="stats">
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }}
          md="bar_chart"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="goals">
        <NativeTabs.Trigger.Label>Plans</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'list.bullet.clipboard', selected: 'list.bullet.clipboard.fill' }}
          md="checklist"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
