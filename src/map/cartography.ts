import * as d3Geo from 'd3-geo';
import { Skia, SkPath, SkRuntimeEffect } from '@shopify/react-native-skia';
import { PLACE_BY_ID } from '@/data/places';
import { getWorldFeatures } from '@/map/geoEngine';
import { Continent } from '@/types';

/**
 * Anti-aliased 45° diagonal line hatching SKSL shader for Wishlist / planned territories.
 * Evaluates in local canvas space; divide spacing/strokeWidth by zoom scale to stay crisp on screen.
 */
const HATCH_SKSL = `
uniform float4 bgColor;
uniform float4 inkColor;
uniform float spacing;
uniform float strokeWidth;

half4 main(float2 pos) {
  float d = mod(pos.x + pos.y, spacing);
  float aa = max(0.25, strokeWidth * 0.22);
  float lineA = 1.0 - smoothstep(strokeWidth - aa, strokeWidth + aa, d);
  float lineB = smoothstep(spacing - aa, spacing, d);
  float mask = clamp(lineA + lineB, 0.0, 1.0);
  return mix(half4(bgColor), half4(inkColor), mask);
}
`;

let cachedHatchEffect: SkRuntimeEffect | null | undefined;

export function getHatchRuntimeEffect(): SkRuntimeEffect | null {
  if (cachedHatchEffect !== undefined) return cachedHatchEffect;
  try {
    cachedHatchEffect = Skia.RuntimeEffect.Make(HATCH_SKSL);
  } catch {
    cachedHatchEffect = null;
  }
  return cachedHatchEffect;
}

export function hexToColorVec4(hex: string, alpha = 1): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5, alpha];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

export function buildHatchUniforms(
  bgHex: string,
  inkHex: string,
  spacing = 6.0,
  strokeWidth = 1.35
) {
  return {
    bgColor: hexToColorVec4(bgHex, 1),
    inkColor: hexToColorVec4(inkHex, 0.86),
    spacing,
    strokeWidth,
  };
}

export interface CompiledMiniPlace {
  id: string;
  skPath: SkPath;
  centroid: [number, number];
}

export interface CompiledMiniMap {
  width: number;
  height: number;
  spherePath?: SkPath;
  places: CompiledMiniPlace[];
}

// ---------- Uncropped World Mini-Map (for Record Hero & Share Poster) ----------
const worldMiniCache = new Map<string, CompiledMiniMap>();

export function getWorldMiniMap(width: number, height: number, pad = 4): CompiledMiniMap {
  const key = `${Math.round(width)}x${Math.round(height)}:${pad}`;
  const cached = worldMiniCache.get(key);
  if (cached) return cached;

  const sphere: d3Geo.GeoSphere = { type: 'Sphere' };
  const proj = d3Geo.geoNaturalEarth1().fitExtent(
    [
      [pad, pad],
      [Math.max(pad + 10, width - pad), Math.max(pad + 10, height - pad)],
    ],
    sphere
  );
  const pathGen = d3Geo.geoPath(proj);
  const spherePath = Skia.Path.MakeFromSVGString(pathGen(sphere) ?? '') ?? Skia.Path.Make();

  const places: CompiledMiniPlace[] = [];
  for (const f of getWorldFeatures()) {
    const id = f.properties?.id || String(f.id ?? '');
    const pMeta = PLACE_BY_ID[id];
    if (!pMeta) continue;
    const svg = pathGen(f);
    if (!svg) continue;
    const skPath = Skia.Path.MakeFromSVGString(svg);
    if (!skPath) continue;
    const c = proj(pMeta.centroid) ?? [width / 2, height / 2];
    places.push({ id, skPath, centroid: [c[0], c[1]] });
  }

  const built: CompiledMiniMap = { width, height, spherePath, places };
  worldMiniCache.set(key, built);
  return built;
}

// ---------- 6 Continent Mini-Maps (for Record Grid) ----------
export interface ContinentMiniSpec {
  continent: Continent;
  shortLabel: string;
  lon: [number, number];
  lat: [number, number];
}

export const CONTINENT_MINI_SPECS: ContinentMiniSpec[] = [
  { continent: 'Europe', shortLabel: 'Europe', lon: [-12, 34], lat: [35, 69] },
  { continent: 'Asia', shortLabel: 'Asia', lon: [36, 146], lat: [-8, 58] },
  { continent: 'Africa', shortLabel: 'Africa', lon: [-20, 52], lat: [-36, 38] },
  { continent: 'North America', shortLabel: 'N. America', lon: [-140, -55], lat: [10, 70] },
  { continent: 'South America', shortLabel: 'S. America', lon: [-84, -34], lat: [-56, 13] },
  { continent: 'Oceania', shortLabel: 'Oceania', lon: [110, 179], lat: [-47, -2] },
];

const continentMiniCache = new Map<string, CompiledMiniMap>();

export function getContinentMiniMap(
  spec: ContinentMiniSpec,
  width: number,
  height: number
): CompiledMiniMap {
  const key = `${spec.continent}:${Math.round(width)}x${Math.round(height)}`;
  const cached = continentMiniCache.get(key);
  if (cached) return cached;

  const bboxFeature: GeoJSON.Feature<GeoJSON.MultiPoint> = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPoint',
      coordinates: [
        [spec.lon[0], spec.lat[0]],
        [spec.lon[1], spec.lat[1]],
      ],
    },
  };

  const proj = d3Geo
    .geoMercator()
    .fitExtent(
      [
        [5, 4],
        [Math.max(12, width - 5), Math.max(12, height - 4)],
      ],
      bboxFeature
    )
    .clipExtent([
      [0, 0],
      [width, height],
    ]);

  const pathGen = d3Geo.geoPath(proj);
  const places: CompiledMiniPlace[] = [];

  for (const f of getWorldFeatures()) {
    const id = f.properties?.id || String(f.id ?? '');
    if (!id || id === 'AQ') continue;
    const pMeta = PLACE_BY_ID[id];
    if (!pMeta || pMeta.continent !== spec.continent) continue;
    if (spec.continent === 'Europe' && (id === 'RU' || id === 'IS')) continue;
    if (spec.continent === 'North America' && id === 'GL') continue;
    const svg = pathGen(f);
    if (!svg) continue;
    const skPath = Skia.Path.MakeFromSVGString(svg);
    if (!skPath) continue;
    const c = proj(pMeta.centroid) ?? [width / 2, height / 2];
    places.push({ id, skPath, centroid: [c[0], c[1]] });
  }

  const built: CompiledMiniMap = { width, height, places };
  continentMiniCache.set(key, built);
  return built;
}

// ---------- UK 4-Nation Interactive Inset Map ----------
const UK_IDS = ['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR'] as const;
const ukInsetCache = new Map<string, CompiledMiniMap>();

export function getUkInsetMap(width: number, height: number): CompiledMiniMap {
  const key = `${Math.round(width)}x${Math.round(height)}`;
  const cached = ukInsetCache.get(key);
  if (cached) return cached;

  const ukFeatures = getWorldFeatures().filter((f) =>
    UK_IDS.includes((f.properties?.id || '') as (typeof UK_IDS)[number])
  );
  const ukFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: ukFeatures,
  };

  const proj = d3Geo.geoMercator().fitExtent(
    [
      [8, 6],
      [Math.max(16, width - 8), Math.max(16, height - 6)],
    ],
    ukFc
  );
  const pathGen = d3Geo.geoPath(proj);
  const places: CompiledMiniPlace[] = [];

  for (const f of ukFeatures) {
    const id = f.properties?.id || '';
    const pMeta = PLACE_BY_ID[id];
    const svg = pathGen(f);
    if (!svg || !pMeta) continue;
    const skPath = Skia.Path.MakeFromSVGString(svg);
    if (!skPath) continue;
    const c = proj(pMeta.centroid) ?? [width / 2, height / 2];
    places.push({ id, skPath, centroid: [c[0], c[1]] });
  }

  const built: CompiledMiniMap = { width, height, places };
  ukInsetCache.set(key, built);
  return built;
}

export function hitTestUkInset(inset: CompiledMiniMap, x: number, y: number): string | null {
  for (const p of inset.places) {
    if (p.skPath.contains(x, y)) return p.id;
  }
  // Nearest centroid fallback for small islands / touch slop
  let bestId: string | null = null;
  let bestDist = 28;
  for (const p of inset.places) {
    const d = Math.hypot(x - p.centroid[0], y - p.centroid[1]);
    if (d < bestDist) {
      bestDist = d;
      bestId = p.id;
    }
  }
  return bestId;
}

// ---------- Country Standalone Silhouette (for Place Sheet header) ----------
const silhouetteCache = new Map<string, SkPath>();

export function getPlaceSilhouettePath(placeId: string, size = 36): SkPath | null {
  const key = `${placeId}:${size}`;
  const cached = silhouetteCache.get(key);
  if (cached) return cached;

  const feat = getWorldFeatures().find((f) => (f.properties?.id || String(f.id ?? '')) === placeId);
  if (!feat) return null;

  const pMeta = PLACE_BY_ID[placeId];
  const pad = 4;

  // Frame using main landmass frameBbox for countries with far-flung overseas territories (e.g. FR, US, NO)
  let proj: d3Geo.GeoProjection;
  if (pMeta && placeId !== 'AQ') {
    const [minLon, minLat, maxLon, maxLat] = pMeta.frameBbox;
    const boxFeat: GeoJSON.Feature<GeoJSON.MultiPoint> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
      },
    };
    proj = d3Geo
      .geoMercator()
      .fitExtent(
        [
          [pad, pad],
          [size - pad, size - pad],
        ],
        boxFeat
      )
      .clipExtent([
        [0, 0],
        [size, size],
      ]);
  } else {
    proj = d3Geo.geoNaturalEarth1().fitExtent(
      [
        [pad, pad],
        [size - pad, size - pad],
      ],
      feat
    );
  }

  const svg = d3Geo.geoPath(proj)(feat);
  if (!svg) return null;
  const skPath = Skia.Path.MakeFromSVGString(svg);
  if (!skPath) return null;
  silhouetteCache.set(key, skPath);
  return skPath;
}

// ---------- Home Region Mini-Map (for Settings live theme previews) ----------
const homeMiniCache = new Map<string, CompiledMiniMap>();

export function getHomeRegionMiniMap(
  homePlaceId: string | null,
  width: number,
  height: number
): CompiledMiniMap {
  const centerPlace = homePlaceId ? PLACE_BY_ID[homePlaceId] : null;
  const centerLon = centerPlace ? centerPlace.centroid[0] : 2.5;
  const centerLat = centerPlace ? Math.max(-55, Math.min(62, centerPlace.centroid[1])) : 51.2;

  const key = `${homePlaceId ?? 'eu'}:${Math.round(width)}x${Math.round(height)}`;
  const cached = homeMiniCache.get(key);
  if (cached) return cached;

  const proj = d3Geo
    .geoMercator()
    .center([centerLon, centerLat])
    .scale(width * 1.48)
    .translate([width / 2, height / 2])
    .clipExtent([
      [-8, -8],
      [width + 8, height + 8],
    ]);

  const pathGen = d3Geo.geoPath(proj);
  const places: CompiledMiniPlace[] = [];

  for (const f of getWorldFeatures()) {
    const id = f.properties?.id || String(f.id ?? '');
    if (!id || id === 'AQ') continue;
    const pMeta = PLACE_BY_ID[id];
    if (!pMeta) continue;
    // Quick geographic proximity filter around center
    const [b0, b1, b2, b3] = pMeta.frameBbox;
    if (
      b2 < centerLon - 55 ||
      b0 > centerLon + 55 ||
      b3 < centerLat - 38 ||
      b1 > centerLat + 38
    ) {
      if (id !== 'RU' && id !== 'US' && id !== 'CA' && id !== 'FR' && id !== 'NO') continue;
    }
    const svg = pathGen(f);
    if (!svg) continue;
    const skPath = Skia.Path.MakeFromSVGString(svg);
    if (!skPath) continue;
    const c = proj(pMeta.centroid) ?? [width / 2, height / 2];
    places.push({ id, skPath, centroid: [c[0], c[1]] });
  }

  const built: CompiledMiniMap = { width, height, places };
  homeMiniCache.set(key, built);
  return built;
}
