import { MapThemeId } from '@/types';

export interface MapTheme {
  id: MapThemeId;
  name: string;
  subtitle: string;
  isDark: boolean;
  blurTint: 'dark' | 'light';
  // Cartography
  ocean: string;
  oceanHighlight: string;
  oceanAtmosphere: string;
  graticule: string;
  landUnvisited: string;
  landDimmed: string;
  landVisited: string;
  landLived: string;
  landWishlist: string; // diagonal hatch ink colour
  landYearHighlight: string;
  livedDot: string;
  border: string;
  borderSelected: string; // inner cased selection stroke
  borderSelectedOuter: string; // outer cased selection stroke
  labelText: string;
  labelHalo: string;
  labelOnVisited: string;
  labelHaloOnVisited: string;
  labelOnLived: string;
  labelHaloOnLived: string;
  // Paper & Ink UI Chrome
  surface: string;
  surfaceElevated: string;
  surfaceSubtle: string;
  surfaceGlass: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  wishlistAccent: string;
  livedAccent: string;
  favoriteAccent: string;
  favoriteSoft: string;
  danger: string;
  cardBorder: string; // pure neutral hairline
  switchTrackOff: string;
}

export const MAP_THEMES: Record<MapThemeId, MapTheme> = {
  midnight: {
    id: 'midnight',
    name: 'Blueprint',
    subtitle: 'Cyanotype print',
    isDark: true,
    blurTint: 'dark',
    ocean: '#0E2A47',
    oceanHighlight: '#113254',
    oceanAtmosphere: 'rgba(156, 203, 255, 0.24)',
    graticule: 'rgba(127, 162, 198, 0.16)',
    landUnvisited: '#1D4168',
    landDimmed: '#17385C',
    landVisited: '#E9F0F7',
    landLived: '#EFA43A',
    landWishlist: '#E9F0F7',
    landYearHighlight: '#9CCBFF',
    livedDot: '#0C2440',
    border: '#7FA2C6',
    borderSelected: '#EEF4FA',
    borderSelectedOuter: '#071626',
    labelText: '#EEF4FA',
    labelHalo: '#0E2A47',
    labelOnVisited: '#0C2440',
    labelHaloOnVisited: 'rgba(233, 240, 247, 0.88)',
    labelOnLived: '#0C2440',
    labelHaloOnLived: 'rgba(239, 164, 58, 0.88)',
    surface: '#0C2440',
    surfaceElevated: '#143253',
    surfaceSubtle: '#183B60',
    surfaceGlass: 'rgba(12, 36, 64, 0.78)',
    textPrimary: '#EEF4FA',
    textSecondary: '#A9C0D8',
    textMuted: '#8FAAC6',
    accent: '#9CCBFF',
    accentInk: '#0C2440',
    accentSoft: 'rgba(156, 203, 255, 0.14)',
    wishlistAccent: '#E9F0F7',
    livedAccent: '#EFA43A',
    favoriteAccent: '#F2C14E',
    favoriteSoft: 'rgba(242, 193, 78, 0.16)',
    danger: '#FF9B87',
    cardBorder: 'rgba(238, 244, 250, 0.13)',
    switchTrackOff: 'rgba(238, 244, 250, 0.22)',
  },
  parchment: {
    id: 'parchment',
    name: 'Chart',
    subtitle: 'Admiralty atlas',
    isDark: false,
    blurTint: 'light',
    ocean: '#CFE2EA',
    oceanHighlight: '#D5E5EB',
    oceanAtmosphere: 'rgba(163, 46, 87, 0.10)',
    graticule: 'rgba(133, 117, 72, 0.16)',
    landUnvisited: '#F2E8C4',
    landDimmed: '#F0EBD8',
    landVisited: '#BF4468',
    landLived: '#4A1B33',
    landWishlist: '#BF4468',
    landYearHighlight: '#A32E57',
    livedDot: '#FDFCF8',
    border: '#857548',
    borderSelected: '#FDFCF8',
    borderSelectedOuter: '#1A2233',
    labelText: '#1A2233',
    labelHalo: '#F2E8C4',
    labelOnVisited: '#FDFCF8',
    labelHaloOnVisited: 'rgba(163, 46, 87, 0.88)',
    labelOnLived: '#FDFCF8',
    labelHaloOnLived: 'rgba(74, 27, 51, 0.88)',
    surface: '#FDFCF8',
    surfaceElevated: '#FFFFFF',
    surfaceSubtle: '#F3EFE4',
    surfaceGlass: 'rgba(253, 252, 248, 0.82)',
    textPrimary: '#1A2233',
    textSecondary: '#525B6E',
    textMuted: '#666D7D',
    accent: '#A32E57',
    accentInk: '#FFFFFF',
    accentSoft: 'rgba(163, 46, 87, 0.10)',
    wishlistAccent: '#BF4468',
    livedAccent: '#4A1B33',
    favoriteAccent: '#C98A1A',
    favoriteSoft: 'rgba(201, 138, 26, 0.12)',
    danger: '#B3261E',
    cardBorder: 'rgba(26, 34, 51, 0.11)',
    switchTrackOff: 'rgba(26, 34, 51, 0.18)',
  },
  ocean: {
    id: 'ocean',
    name: 'Survey',
    subtitle: 'Topographic sheet',
    isDark: false,
    blurTint: 'light',
    ocean: '#CFE1EC',
    oceanHighlight: '#D6E6EF',
    oceanAtmosphere: 'rgba(42, 102, 66, 0.10)',
    graticule: 'rgba(100, 112, 102, 0.15)',
    landUnvisited: '#F4F3EC',
    landDimmed: '#ECECE6',
    landVisited: '#3B7A53',
    landLived: '#173A5E',
    landWishlist: '#A85A18',
    landYearHighlight: '#2A6642',
    livedDot: '#F6F7F4',
    border: '#647066',
    borderSelected: '#F6F7F4',
    borderSelectedOuter: '#18211C',
    labelText: '#18211C',
    labelHalo: '#F4F3EC',
    labelOnVisited: '#F6F7F4',
    labelHaloOnVisited: 'rgba(42, 102, 66, 0.88)',
    labelOnLived: '#F6F7F4',
    labelHaloOnLived: 'rgba(23, 58, 94, 0.88)',
    surface: '#F6F7F4',
    surfaceElevated: '#FFFFFF',
    surfaceSubtle: '#EBEEE8',
    surfaceGlass: 'rgba(246, 247, 244, 0.84)',
    textPrimary: '#18211C',
    textSecondary: '#4C5850',
    textMuted: '#616C65',
    accent: '#2A6642',
    accentInk: '#FFFFFF',
    accentSoft: 'rgba(42, 102, 66, 0.10)',
    wishlistAccent: '#A85A18',
    livedAccent: '#173A5E',
    favoriteAccent: '#C27D16',
    favoriteSoft: 'rgba(194, 125, 22, 0.12)',
    danger: '#B3261E',
    cardBorder: 'rgba(24, 33, 28, 0.11)',
    switchTrackOff: 'rgba(24, 33, 28, 0.18)',
  },
};

export const THEME_ORDER: MapThemeId[] = ['midnight', 'parchment', 'ocean'];
