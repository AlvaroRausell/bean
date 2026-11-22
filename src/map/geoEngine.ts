import * as d3Geo from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { Skia, SkPath } from '@shopify/react-native-skia';
import worldTopoRaw from '@/data/world-uk-split.topo.json';
import { PLACE_BY_ID, PLACES_CATALOG } from '@/data/places';
import { Place } from '@/types';
import { BASE_MAP_HEIGHT, BASE_MAP_WIDTH, MapBounds2D } from './cameraMath';

export interface CompiledPlace2D {
  id: string;
  place: Place;
  feature: Feature<Geometry, { id: string }>;
  skPath: SkPath;
  svgPath: string;
  projectedCentroid: [number, number];
  projectedBounds: MapBounds2D;
  projectedWidth: number;
  projectedHeight: number;
}

export interface GeoEngine2D {
  projection: d3Geo.GeoProjection;
  pathGenerator: d3Geo.GeoPath;
  places: CompiledPlace2D[];
  placeById: Record<string, CompiledPlace2D>;
  graticulePath: SkPath;
  spherePath: SkPath;
}

let cachedFeatures: Feature<Geometry, { id: string }>[] | null = null;
let cachedEngine2D: GeoEngine2D | null = null;

export function getWorldFeatures(): Feature<Geometry, { id: string }>[] {
  if (cachedFeatures) return cachedFeatures;
  const topo = worldTopoRaw as unknown as Topology<{
    places: GeometryCollection<{ id: string }>;
  }>;
  const fc = feature(topo, topo.objects.places) as unknown as FeatureCollection<
    Geometry,
    { id: string }
  >;
  cachedFeatures = fc.features;
  return cachedFeatures;
}

export function getGeoEngine2D(): GeoEngine2D {
  if (cachedEngine2D) return cachedEngine2D;

  const features = getWorldFeatures();
  const sphere: d3Geo.GeoSphere = { type: 'Sphere' };

  const projection = d3Geo
    .geoNaturalEarth1()
    .fitExtent(
      [
        [10, 10],
        [BASE_MAP_WIDTH - 10, BASE_MAP_HEIGHT - 10],
      ],
      sphere
    );

  const pathGenerator = d3Geo.geoPath(projection);
  const places: CompiledPlace2D[] = [];
  const placeById: Record<string, CompiledPlace2D> = {};

  for (const feat of features) {
    const id = feat.properties?.id || String(feat.id ?? '');
    const place = PLACE_BY_ID[id];
    if (!place) continue;

    const svgPath = pathGenerator(feat) ?? '';
    if (!svgPath) continue;

    const skPath = Skia.Path.MakeFromSVGString(svgPath);
    if (!skPath) continue;

    const projectedCentroid = projection(place.centroid) ?? [
      BASE_MAP_WIDTH / 2,
      BASE_MAP_HEIGHT / 2,
    ];

    const bounds = projectGeoBboxTo2D(place.frameBbox, projection);
    const compiled: CompiledPlace2D = {
      id,
      place,
      feature: feat,
      skPath,
      svgPath,
      projectedCentroid: [projectedCentroid[0], projectedCentroid[1]],
      projectedBounds: bounds,
      projectedWidth: Math.max(1, bounds.maxX - bounds.minX),
      projectedHeight: Math.max(1, bounds.maxY - bounds.minY),
    };

    places.push(compiled);
    placeById[id] = compiled;
  }

  const graticuleSvg = pathGenerator(d3Geo.geoGraticule10()) ?? '';
  const graticulePath = Skia.Path.MakeFromSVGString(graticuleSvg) ?? Skia.Path.Make();

  const sphereSvg = pathGenerator(sphere) ?? '';
  const spherePath = Skia.Path.MakeFromSVGString(sphereSvg) ?? Skia.Path.Make();

  cachedEngine2D = {
    projection,
    pathGenerator,
    places,
    placeById,
    graticulePath,
    spherePath,
  };
  return cachedEngine2D;
}

/**
 * Projects a geographic bbox `[minLon, minLat, maxLon, maxLat]` into 2D map coordinates
 * by sampling edges so curved projections (Natural Earth) frame accurately.
 */
export function projectGeoBboxTo2D(
  bbox: [number, number, number, number],
  projection: d3Geo.GeoProjection
): MapBounds2D {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const samples = 4;
  for (let i = 0; i <= samples; i++) {
    const lon = minLon + ((maxLon - minLon) * i) / samples;
    for (let j = 0; j <= samples; j++) {
      const lat = minLat + ((maxLat - minLat) * j) / samples;
      const pt = projection([lon, lat]);
      if (!pt) continue;
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: BASE_MAP_WIDTH, maxY: BASE_MAP_HEIGHT };
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Fast hit-test in 2D map space:
 * 1. Exact inverse-projection + bbox pre-filter + geoContains
 * 2. Adaptive microstate pin fallback so small countries (Monaco, Singapore, Malta, etc.) are easy to tap
 */
export function hitTest2D(
  mapX: number,
  mapY: number,
  currentScale: number,
  includeTerritories: boolean
): string | null {
  const engine = getGeoEngine2D();
  const lonLat = engine.projection.invert?.([mapX, mapY]);

  // 1. Check microstate pins first when zoomed out so tiny countries inside larger ones (e.g. San Marino, Vatican, Monaco) are tappable!
  const pinHitRadiusMap = 13 / Math.max(1, currentScale);
  let nearestMicroId: string | null = null;
  let nearestMicroDist = pinHitRadiusMap;

  for (const item of engine.places) {
    if (!item.place.isMicrostate) continue;
    if (!includeTerritories && !item.place.isUnMember) continue;
    const dx = item.projectedCentroid[0] - mapX;
    const dy = item.projectedCentroid[1] - mapY;
    const dist = Math.hypot(dx, dy);
    if (dist < nearestMicroDist) {
      nearestMicroDist = dist;
      nearestMicroId = item.id;
    }
  }

  // Prefer microstate pin if tapped right on top of it
  if (nearestMicroId && nearestMicroDist < pinHitRadiusMap * 0.72) {
    return nearestMicroId;
  }

  // 2. Exact polygon containment test
  if (lonLat && Number.isFinite(lonLat[0]) && Number.isFinite(lonLat[1])) {
    const [lon, lat] = lonLat;
    // Check smaller areas first so enclaves (e.g., Lesotho inside South Africa) win!
    let matched: CompiledPlace2D | null = null;
    for (const item of engine.places) {
      if (!includeTerritories && !item.place.isUnMember) continue;
      const [minLon, minLat, maxLon, maxLat] = item.place.bbox;
      // Handle antimeridian-crossing countries (Fiji, Russia, Kiribati) gracefully
      const crossesAntimeridian = maxLon - minLon > 300;
      if (
        !crossesAntimeridian &&
        (lon < minLon - 0.5 || lon > maxLon + 0.5 || lat < minLat - 0.5 || lat > maxLat + 0.5)
      ) {
        continue;
      }
      if (d3Geo.geoContains(item.feature, [lon, lat])) {
        if (!matched || item.place.areaSr < matched.place.areaSr) {
          matched = item;
        }
      }
    }
    if (matched) return matched.id;
  }

  // 3. Fallback to nearest microstate / tiny island within touch tolerance
  return nearestMicroId;
}

/**
 * 3D Orthographic Globe projection & hit-testing helpers
 */
export function createGlobeProjection(
  centerX: number,
  centerY: number,
  radius: number,
  rotateLon: number,
  rotateLat: number
): d3Geo.GeoProjection {
  return d3Geo
    .geoOrthographic()
    .translate([centerX, centerY])
    .scale(radius)
    .clipAngle(90)
    .rotate([rotateLon, rotateLat, 0]);
}

export function hitTest3D(
  screenX: number,
  screenY: number,
  projection: d3Geo.GeoProjection,
  includeTerritories: boolean
): string | null {
  const lonLat = projection.invert?.([screenX, screenY]);
  if (!lonLat || !Number.isFinite(lonLat[0]) || !Number.isFinite(lonLat[1])) {
    return null;
  }

  const features = getWorldFeatures();
  const [lon, lat] = lonLat;
  let matched: { id: string; areaSr: number } | null = null;

  for (const feat of features) {
    const id = feat.properties?.id || String(feat.id ?? '');
    const place = PLACE_BY_ID[id];
    if (!place) continue;
    if (!includeTerritories && !place.isUnMember) continue;

    const [minLon, minLat, maxLon, maxLat] = place.bbox;
    const crossesAntimeridian = maxLon - minLon > 300;
    if (
      !crossesAntimeridian &&
      (lon < minLon - 0.5 || lon > maxLon + 0.5 || lat < minLat - 0.5 || lat > maxLat + 0.5)
    ) {
      continue;
    }
    if (d3Geo.geoContains(feat, [lon, lat])) {
      if (!matched || place.areaSr < matched.areaSr) {
        matched = { id, areaSr: place.areaSr };
      }
    }
  }

  if (matched) return matched.id;

  // Microstate proximity fallback on the visible hemisphere
  let bestId: string | null = null;
  let bestDist = 18;
  for (const place of PLACES_CATALOG) {
    if (!place.isMicrostate) continue;
    if (!includeTerritories && !place.isUnMember) continue;
    const pt = projection(place.centroid);
    if (!pt) continue;
    const dist = Math.hypot(pt[0] - screenX, pt[1] - screenY);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = place.id;
    }
  }

  return bestId;
}
