import { TextStyle } from 'react-native';

/**
 * Encode Sans superfamily — width carries cartographic hierarchy:
 * - Semi Expanded 600: place names, screen titles, map labels
 * - Normal 400 / 500 / 600: body copy, controls, interactive rows
 * - Condensed 500 / 600: counts, dates, coordinates (always tabular-nums)
 */
export const FONTS = {
  display: 'EncodeSansSemiExpanded_600SemiBold',
  displayMedium: 'EncodeSansSemiExpanded_500Medium',
  body: 'EncodeSans_400Regular',
  bodyMedium: 'EncodeSans_500Medium',
  bodySemiBold: 'EncodeSans_600SemiBold',
  num: 'EncodeSansCondensed_600SemiBold',
  numMedium: 'EncodeSansCondensed_500Medium',
} as const;

export const TYPE = {
  screenTitle: {
    fontFamily: FONTS.display,
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.5,
  } satisfies TextStyle,
  sectionTitle: {
    fontFamily: FONTS.display,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  } satisfies TextStyle,
  placeTitle: {
    fontFamily: FONTS.display,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.3,
  } satisfies TextStyle,
  heroCount: {
    fontFamily: FONTS.num,
    fontSize: 28,
    lineHeight: 32,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  body: {
    fontFamily: FONTS.body,
    fontSize: 15,
    lineHeight: 21,
  } satisfies TextStyle,
  bodyMedium: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 15,
    lineHeight: 20,
  } satisfies TextStyle,
  secondary: {
    fontFamily: FONTS.body,
    fontSize: 13,
    lineHeight: 18,
  } satisfies TextStyle,
  caption: {
    fontFamily: FONTS.body,
    fontSize: 11.5,
    lineHeight: 15,
  } satisfies TextStyle,
  num: {
    fontFamily: FONTS.num,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
  numMedium: {
    fontFamily: FONTS.numMedium,
    fontVariant: ['tabular-nums'],
  } satisfies TextStyle,
} as const;
