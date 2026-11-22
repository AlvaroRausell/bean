import React from 'react';
import {
  Circle,
  drawAsImage,
  Group,
  Path,
  Rect,
  RoundedRect,
  Shader,
  Skia,
  Text as SkiaText,
  type SkFont,
} from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PLACES_CATALOG } from '@/data/places';
import { computeWorldStats } from '@/domain/statsCalculator';
import {
  buildHatchUniforms,
  getHatchRuntimeEffect,
  getWorldMiniMap,
} from '@/map/cartography';
import { MAP_THEMES } from '@/theme/mapThemes';
import { CollectionItem, UserPlace, UserProfile, YearCollection } from '@/types';

const POSTER_STAR_PATH =
  Skia.Path.MakeFromSVGString(
    'M 0 -9.5 L 2.45 -3.05 L 9.05 -2.9 L 3.8 1.25 L 5.6 7.7 L 0 3.9 L -5.6 7.7 L -3.8 1.25 L -9.05 -2.9 L -2.45 -3.05 Z'
  ) ?? Skia.Path.Make();

export interface ExportMapPngInput {
  userPlaces: Record<string, UserPlace>;
  yearCollections: YearCollection[];
  collectionItems: CollectionItem[];
  userProfile: UserProfile;
  fonts: {
    title: SkFont | null;
    heading: SkFont | null;
    body: SkFont | null;
    small: SkFont | null;
  };
}

/**
 * Renders a crisp 1080×1350 editorial cartographic PNG poster offscreen with Skia
 * and opens the native Share Sheet (Save Image / Save to Files / AirDrop / Messages).
 */
export async function exportTravelMapPng({
  userPlaces,
  yearCollections,
  collectionItems,
  userProfile,
  fonts,
}: ExportMapPngInput): Promise<boolean> {
  const theme = MAP_THEMES[userProfile.mapTheme];
  const hatchEffect = getHatchRuntimeEffect();
  const stats = computeWorldStats(
    PLACES_CATALOG,
    userPlaces,
    yearCollections,
    collectionItems,
    {
      countingMode: userProfile.countingMode,
      includeTerritories: userProfile.includeTerritories,
      homePlaceId: userProfile.homePlaceId,
    }
  );

  const W = 1080;
  const H = 1350;
  const posterMap = getWorldMiniMap(960, 500, 8);
  const posterHatch = buildHatchUniforms(
    theme.landUnvisited,
    theme.landWishlist,
    12,
    2.6
  );

  const posterEl = (
    <Group>
      {/* Paper background */}
      <Rect x={0} y={0} width={W} height={H} color={theme.surface} />
      {/* Subtle cartographic neatline border */}
      <RoundedRect
        x={36}
        y={36}
        width={W - 72}
        height={H - 72}
        r={28}
        color={theme.cardBorder}
        style="stroke"
        strokeWidth={2}
      />

      {/* Count headline */}
      {fonts.title && (
        <SkiaText
          x={84}
          y={176}
          text={`${stats.visitedCount} of ${stats.totalCount}`}
          font={fonts.title}
          color={theme.textPrimary}
        />
      )}
      {fonts.heading && (
        <SkiaText
          x={84}
          y={236}
          text={userProfile.includeTerritories ? 'places' : 'countries'}
          font={fonts.heading}
          color={theme.textSecondary}
        />
      )}
      {fonts.body && (
        <SkiaText
          x={84}
          y={284}
          text={
            userProfile.countingMode === 'uk_split_un'
              ? 'Counting UK nations separately'
              : 'United Nations standard'
          }
          font={fonts.body}
          color={theme.textMuted}
        />
      )}

      {/* Centered uncropped world map */}
      <Group transform={[{ translateX: 60 }, { translateY: 380 }]}>
        {posterMap.spherePath && (
          <>
            <Path path={posterMap.spherePath} color={theme.ocean} />
            <Path
              path={posterMap.spherePath}
              color={theme.cardBorder}
              style="stroke"
              strokeWidth={2}
            />
          </>
        )}
        {posterMap.places.map((item) => {
          const st = userPlaces[item.id]?.status ?? 'none';
          return (
            <React.Fragment key={item.id}>
              {st === 'wishlist' && hatchEffect ? (
                <Path path={item.skPath}>
                  <Shader source={hatchEffect} uniforms={posterHatch} />
                </Path>
              ) : (
                <Path
                  path={item.skPath}
                  color={
                    st === 'lived'
                      ? theme.landLived
                      : st === 'visited'
                      ? theme.landVisited
                      : st === 'skipped'
                      ? theme.landSkipped
                      : theme.landUnvisited
                  }
                />
              )}
              <Path
                path={item.skPath}
                color={theme.border}
                style="stroke"
                strokeWidth={1.1}
                strokeJoin="round"
              />
              {st === 'lived' && (
                <Circle
                  cx={item.centroid[0]}
                  cy={item.centroid[1]}
                  r={4.5}
                  color={theme.livedDot}
                />
              )}
            </React.Fragment>
          );
        })}

        {/* Favourite stars */}
        {posterMap.places.map((item) => {
          const up = userPlaces[item.id];
          if (!up?.isFavorite || up.deletedAt) return null;
          return (
            <Group
              key={`star-${item.id}`}
              transform={[
                { translateX: item.centroid[0] },
                { translateY: item.centroid[1] },
              ]}
            >
              <Path
                path={POSTER_STAR_PATH}
                color={theme.surface}
                style="stroke"
                strokeWidth={3.2}
                strokeJoin="round"
              />
              <Path path={POSTER_STAR_PATH} color={theme.favoriteAccent} />
            </Group>
          );
        })}
      </Group>

      {/* Hairline footer rule */}
      <Rect x={84} y={1020} width={W - 168} height={2} color={theme.cardBorder} />

      {/* Legend */}
      <RoundedRect
        x={84}
        y={1074}
        width={26}
        height={26}
        r={6}
        color={theme.landVisited}
      />
      {fonts.body && (
        <SkiaText
          x={124}
          y={1097}
          text={`Been ${stats.visitedCount}`}
          font={fonts.body}
          color={theme.textPrimary}
        />
      )}

      <RoundedRect
        x={310}
        y={1074}
        width={26}
        height={26}
        r={6}
        color={theme.landUnvisited}
      />
      <RoundedRect
        x={310}
        y={1074}
        width={26}
        height={26}
        r={6}
        color={theme.landWishlist}
        style="stroke"
        strokeWidth={3}
      />
      {fonts.body && (
        <SkiaText
          x={350}
          y={1097}
          text={`Want ${stats.wishlistCount}`}
          font={fonts.body}
          color={theme.textPrimary}
        />
      )}

      {stats.favoritesCount > 0 && (
        <>
          <Group transform={[{ translateX: 552 }, { translateY: 1087 }]}>
            <Path path={POSTER_STAR_PATH} color={theme.favoriteAccent} />
          </Group>
          {fonts.body && (
            <SkiaText
              x={574}
              y={1097}
              text={`Favourites ${stats.favoritesCount}`}
              font={fonts.body}
              color={theme.textPrimary}
            />
          )}
        </>
      )}

      {/* Wordmark */}
      {fonts.small && (
        <SkiaText
          x={84}
          y={1232}
          text={`Bean · ${theme.name}`}
          font={fonts.small}
          color={theme.textMuted}
        />
      )}
    </Group>
  );

  const snapshot = await drawAsImage(posterEl, { width: W, height: H });
  if (!snapshot) {
    throw new Error('Could not render map image.');
  }

  const b64 = snapshot.encodeToBase64();
  const file = new File(Paths.cache, `bean-map-${Date.now()}.png`);
  file.write(b64, { encoding: 'base64' });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: `${stats.visitedCount} of ${stats.totalCount} countries`,
  });
  return true;
}
