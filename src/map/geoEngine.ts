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

const RING_OFFSETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.707, 0.707],
  [-0.707, 0.707],
  [0.707, -0.707],
  [-0.707, -0.707],
];

function containsMapPoint(
  item: CompiledPlace2D,
  mapX: number,
  mapY: number,
  lonLat: [number, number] | null
): boolean {
  const b = item.projectedBounds;
  const pad = 2.5;
  const crossesAntimeridian = item.place.bbox[2] - item.place.bbox[0] > 300;
  if (
    !crossesAntimeridian &&
    (mapX < b.minX - pad || mapX > b.maxX + pad || mapY < b.minY - pad || mapY > b.maxY + pad)
  ) {
    return false;
  }

  // Pixel-exact C++ Skia hit-test matches rendered coastlines 1:1
  if (typeof item.skPath?.contains === 'function') {
    return item.skPath.contains(mapX, mapY);
  }

  if (lonLat && Number.isFinite(lonLat[0]) && Number.isFinite(lonLat[1])) {
    return d3Geo.geoContains(item.feature, lonLat);
  }
  return false;
}

/**
 * Fast, forgiving hit-test in 2D map space across ALL rendered places (countries + territories):
 * 1. Direct tap on a microstate pin (e.g. Monaco, San Marino, Singapore, Vatican)
 * 2. Pixel-exact polygon containment (smallest area wins so enclaves like Lesotho win)
 * 3. Generous screen-space thumb-tolerance ring around coastlines & small islands (New Caledonia, Fiji, Cyprus, etc.)
 */
export function hitTest2D(
  mapX: number,
  mapY: number,
  currentScale: number
): string | null {
  const engine = getGeoEngine2D();
  const safeScale = Math.max(0.35, currentScale);

  // 1. Check direct microstate pin hit so tiny states inside larger countries stay effortlessly tappable
  const directMicroRadius = 15 / safeScale;
  const fallbackMicroRadius = 24 / safeScale;
  let nearestMicroId: string | null = null;
  let nearestMicroDist = fallbackMicroRadius;

  for (const item of engine.places) {
    if (!item.place.isMicrostate) continue;
    const dx = item.projectedCentroid[0] - mapX;
    const dy = item.projectedCentroid[1] - mapY;
    const dist = Math.hypot(dx, dy);
    if (dist < nearestMicroDist) {
      nearestMicroDist = dist;
      nearestMicroId = item.id;
    }
  }

  if (nearestMicroId && nearestMicroDist <= directMicroRadius) {
    return nearestMicroId;
  }

  // 2. Exact polygon containment at the tap point (smallest area wins for enclaves)
  const lonLat = engine.projection.invert?.([mapX, mapY]) ?? null;
  let exactMatch: CompiledPlace2D | null = null;
  for (const item of engine.places) {
    if (containsMapPoint(item, mapX, mapY, lonLat)) {
      if (!exactMatch || item.place.areaSr < exactMatch.place.areaSr) {
        exactMatch = item;
      }
    }
  }
  if (exactMatch) return exactMatch.id;

  // 3. Coastal & small-island thumb tolerance (8px then 18px screen radius)
  for (const radiusPx of [8, 18]) {
    const rMap = radiusPx / safeScale;
    let ringMatch: CompiledPlace2D | null = null;
    for (const [ox, oy] of RING_OFFSETS) {
      const px = mapX + ox * rMap;
      const py = mapY + oy * rMap;
      const ringLonLat = engine.projection.invert?.([px, py]) ?? null;
      for (const item of engine.places) {
        if (containsMapPoint(item, px, py, ringLonLat)) {
          if (!ringMatch || item.place.areaSr < ringMatch.place.areaSr) {
            ringMatch = item;
          }
        }
      }
    }
    if (ringMatch) return ringMatch.id;
  }

  // 4. Final fallback to nearest microstate within generous touch tolerance
  return nearestMicroId;
}
