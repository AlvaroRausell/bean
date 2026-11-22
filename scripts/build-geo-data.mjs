#!/usr/bin/env node
/**
 * Build-time cartographic data pipeline for Bean.
 *
 * Downloads (and caches) Natural Earth 50m Admin-0 Countries & Map Units,
 * replaces the unified United Kingdom (GBR) polygon with its 4 constituent
 * countries (England, Scotland, Wales, Northern Ireland), ensures all 193
 * UN member states are represented (supplementing tiny island/microstates
 * if absent from 50m), computes main-landmass centroids & framing bounding
 * boxes, and emits:
 *   - src/data/world-uk-split.topo.json
 *   - src/data/places-catalog.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as d3Geo from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { quantize } from 'topojson-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'geo');
const OUT_DIR = path.join(ROOT, 'src', 'data');

const NE_COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const NE_MAP_UNITS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_units.geojson';

// All 192 non-UK UN member states (ISO 3166-1 alpha-2).
// Together with GB (split into GB-ENG, GB-SCT, GB-WLS, GB-NIR), this gives:
//   - UN Strict: 192 + 1 = 193
//   - UK Split:  192 + 4 = 196
const UN_NON_UK_ISO2 = new Set([
  'AF', 'AL', 'DZ', 'AD', 'AO', 'AG', 'AR', 'AM', 'AU', 'AT', 'AZ',
  'BS', 'BH', 'BD', 'BB', 'BY', 'BE', 'BZ', 'BJ', 'BT', 'BO', 'BA', 'BW', 'BR', 'BN', 'BG', 'BF', 'BI',
  'CV', 'KH', 'CM', 'CA', 'CF', 'TD', 'CL', 'CN', 'CO', 'KM', 'CG', 'CD', 'CR', 'CI', 'HR', 'CU', 'CY', 'CZ',
  'DK', 'DJ', 'DM', 'DO',
  'EC', 'EG', 'SV', 'GQ', 'ER', 'EE', 'SZ', 'ET',
  'FJ', 'FI', 'FR',
  'GA', 'GM', 'GE', 'DE', 'GH', 'GR', 'GD', 'GT', 'GN', 'GW', 'GY',
  'HT', 'HN', 'HU',
  'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IL', 'IT',
  'JM', 'JP', 'JO',
  'KZ', 'KE', 'KI', 'KP', 'KR', 'KW', 'KG',
  'LA', 'LV', 'LB', 'LS', 'LR', 'LY', 'LI', 'LT', 'LU',
  'MG', 'MW', 'MY', 'MV', 'ML', 'MT', 'MH', 'MR', 'MU', 'MX', 'FM', 'MD', 'MC', 'MN', 'ME', 'MA', 'MZ', 'MM',
  'NA', 'NR', 'NP', 'NL', 'NZ', 'NI', 'NE', 'NG', 'MK', 'NO',
  'OM',
  'PK', 'PW', 'PA', 'PG', 'PY', 'PE', 'PH', 'PL', 'PT',
  'QA',
  'RO', 'RU', 'RW',
  'KN', 'LC', 'VC', 'WS', 'SM', 'ST', 'SA', 'SN', 'RS', 'SC', 'SL', 'SG', 'SK', 'SI', 'SB', 'SO', 'ZA', 'SS', 'ES', 'LK', 'SD', 'SR', 'SE', 'CH', 'SY',
  'TJ', 'TZ', 'TH', 'TL', 'TG', 'TO', 'TT', 'TN', 'TR', 'TM', 'TV',
  'UG', 'UA', 'AE', 'US', 'UY', 'UZ',
  'VU', 'VE', 'VN',
  'YE',
  'ZM', 'ZW',
]);

// Fallback entries for tiny UN states in case 50m omits them
const FALLBACK_MICROSTATES = [
  { id: 'AD', name: 'Andorra', continent: 'Europe', lon: 1.5218, lat: 42.5063, isUnMember: true },
  { id: 'AG', name: 'Antigua and Barbuda', continent: 'North America', lon: -61.7964, lat: 17.0608, isUnMember: true },
  { id: 'BB', name: 'Barbados', continent: 'North America', lon: -59.5432, lat: 13.1939, isUnMember: true },
  { id: 'BH', name: 'Bahrain', continent: 'Asia', lon: 50.5577, lat: 26.0667, isUnMember: true },
  { id: 'DM', name: 'Dominica', continent: 'North America', lon: -61.371, lat: 15.415, isUnMember: true },
  { id: 'FM', name: 'Micronesia', continent: 'Oceania', lon: 150.5508, lat: 7.4256, isUnMember: true },
  { id: 'GD', name: 'Grenada', continent: 'North America', lon: -61.679, lat: 12.1165, isUnMember: true },
  { id: 'KI', name: 'Kiribati', continent: 'Oceania', lon: -157.363, lat: 1.8709, isUnMember: true },
  { id: 'KN', name: 'Saint Kitts and Nevis', continent: 'North America', lon: -62.783, lat: 17.3578, isUnMember: true },
  { id: 'LC', name: 'Saint Lucia', continent: 'North America', lon: -60.9789, lat: 13.9094, isUnMember: true },
  { id: 'LI', name: 'Liechtenstein', continent: 'Europe', lon: 9.5554, lat: 47.166, isUnMember: true },
  { id: 'MC', name: 'Monaco', continent: 'Europe', lon: 7.4246, lat: 43.7384, isUnMember: true },
  { id: 'MH', name: 'Marshall Islands', continent: 'Oceania', lon: 171.1845, lat: 7.1315, isUnMember: true },
  { id: 'MT', name: 'Malta', continent: 'Europe', lon: 14.3754, lat: 35.9375, isUnMember: true },
  { id: 'MV', name: 'Maldives', continent: 'Asia', lon: 73.2207, lat: 3.2028, isUnMember: true },
  { id: 'NR', name: 'Nauru', continent: 'Oceania', lon: 166.9315, lat: -0.5228, isUnMember: true },
  { id: 'PW', name: 'Palau', continent: 'Oceania', lon: 134.5825, lat: 7.515, isUnMember: true },
  { id: 'SC', name: 'Seychelles', continent: 'Africa', lon: 55.492, lat: -4.6796, isUnMember: true },
  { id: 'SG', name: 'Singapore', continent: 'Asia', lon: 103.8198, lat: 1.3521, isUnMember: true },
  { id: 'SM', name: 'San Marino', continent: 'Europe', lon: 12.4578, lat: 43.9424, isUnMember: true },
  { id: 'ST', name: 'São Tomé and Príncipe', continent: 'Africa', lon: 6.6131, lat: 0.1864, isUnMember: true },
  { id: 'TO', name: 'Tonga', continent: 'Oceania', lon: -175.1982, lat: -21.179, isUnMember: true },
  { id: 'TV', name: 'Tuvalu', continent: 'Oceania', lon: 179.1942, lat: -8.5167, isUnMember: true },
  { id: 'VC', name: 'Saint Vincent and the Grenadines', continent: 'North America', lon: -61.2872, lat: 12.9843, isUnMember: true },
  { id: 'WS', name: 'Samoa', continent: 'Oceania', lon: -172.1046, lat: -13.759, isUnMember: true },
  { id: 'VA', name: 'Vatican City', continent: 'Europe', lon: 12.4534, lat: 41.9029, isUnMember: false },
];

// Natural Earth ISO_A2 fixes where NE outputs '-99'
const NE_ISO2_OVERRIDES = {
  FRA: 'FR',
  NOR: 'NO',
  KOS: 'XK',
  SOL: 'XS',
  CYN: 'XN',
  IOA: 'IO',
  ASH: 'AU-ASH',
  CSI: 'AU-CSI',
  KAS: 'XC',
  PGA: 'XP',
  SER: 'RS',
  SDS: 'SS',
  SAH: 'EH',
  TWN: 'TW',
  PSX: 'PS',
  ALD: 'AX',
  ESB: 'XB',
  WSB: 'XW',
};

const UK_UNIT_MAP = {
  ENG: {
    id: 'GB-ENG',
    name: 'England',
    flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    searchAliases: ['United Kingdom', 'UK', 'Britain', 'Great Britain'],
  },
  SCT: {
    id: 'GB-SCT',
    name: 'Scotland',
    flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    searchAliases: ['United Kingdom', 'UK', 'Britain', 'Great Britain'],
  },
  WLS: {
    id: 'GB-WLS',
    name: 'Wales',
    flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    searchAliases: ['United Kingdom', 'UK', 'Britain', 'Great Britain', 'Cymru'],
  },
  NIR: {
    id: 'GB-NIR',
    name: 'Northern Ireland',
    flag: '🇬🇧',
    searchAliases: ['United Kingdom', 'UK', 'Britain', 'Ulster'],
  },
};

function iso2ToFlag(iso2) {
  if (!iso2 || iso2.length !== 2 || !/^[A-Z]{2}$/.test(iso2)) {
    return '🏳️';
  }
  const codePoints = [...iso2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

function normalizeContinent(raw, id) {
  if (id === 'RU') return 'Europe';
  if (id === 'TR') return 'Asia';
  if (id === 'CY') return 'Europe';
  if (id === 'AM' || id === 'AZ' || id === 'GE') return 'Asia';
  if (raw === 'Seven seas (open ocean)') {
    if (['MV', 'IO', 'TF'].includes(id)) return 'Asia';
    if (['MU', 'SC', 'SH', 'RE', 'YT', 'KM'].includes(id)) return 'Africa';
    if (['GS', 'FK'].includes(id)) return 'South America';
    return 'Oceania';
  }
  const valid = new Set([
    'Europe',
    'Asia',
    'Africa',
    'North America',
    'South America',
    'Oceania',
    'Antarctica',
  ]);
  return valid.has(raw) ? raw : 'Europe';
}

function makeCirclePolygon(lon, lat, radiusDeg = 0.22, steps = 12) {
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const dLon = (radiusDeg * Math.cos(angle)) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const dLat = radiusDeg * Math.sin(angle);
    ring.push([
      Number((lon + dLon).toFixed(4)),
      Number(Math.max(-85, Math.min(85, lat + dLat)).toFixed(4)),
    ]);
  }
  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

function computePrimaryLandmassMetrics(feature) {
  const geom = feature.geometry;
  let targetFeature = feature;

  if (geom.type === 'MultiPolygon' && geom.coordinates.length > 1) {
    // Pick the polygon with largest spherical area so France/USA/Netherlands frame cleanly on main landmass
    let bestArea = -1;
    let bestPoly = geom.coordinates[0];
    for (const polyCoords of geom.coordinates) {
      const polyFeat = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: polyCoords },
      };
      const a = d3Geo.geoArea(polyFeat);
      if (a > bestArea) {
        bestArea = a;
        bestPoly = polyCoords;
      }
    }
    targetFeature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: bestPoly },
    };
  }

  const centroid = d3Geo.geoCentroid(targetFeature);
  const fullBounds = d3Geo.geoBounds(feature);
  const frameBounds = d3Geo.geoBounds(targetFeature);

  // Special framing overrides for wide/trans-meridian countries
  const id = feature.properties.id;
  let frameBbox = [
    Number(frameBounds[0][0].toFixed(3)),
    Number(frameBounds[0][1].toFixed(3)),
    Number(frameBounds[1][0].toFixed(3)),
    Number(frameBounds[1][1].toFixed(3)),
  ];
  if (id === 'US') {
    frameBbox = [-125, 24, -66, 50];
  } else if (id === 'RU') {
    frameBbox = [26, 41, 179, 77];
  } else if (id === 'FR') {
    frameBbox = [-5.5, 41.2, 9.8, 51.3];
  } else if (id === 'NZ') {
    frameBbox = [166, -47.5, 179, -34];
  } else if (id === 'FJ') {
    frameBbox = [176.5, -19.5, 180, -16];
  }

  return {
    centroid: [Number(centroid[0].toFixed(3)), Number(centroid[1].toFixed(3))],
    bbox: [
      Number(fullBounds[0][0].toFixed(3)),
      Number(fullBounds[0][1].toFixed(3)),
      Number(fullBounds[1][0].toFixed(3)),
      Number(fullBounds[1][1].toFixed(3)),
    ],
    frameBbox,
    areaSr: Number(d3Geo.geoArea(feature).toExponential(4)),
  };
}

async function fetchJsonCached(url, filename) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, filename);
  if (fs.existsSync(cachePath)) {
    console.log(`[geo] Using cached ${filename}`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }
  console.log(`[geo] Downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  fs.writeFileSync(cachePath, text, 'utf8');
  return JSON.parse(text);
}

async function main() {
  const [countriesGeo, mapUnitsGeo] = await Promise.all([
    fetchJsonCached(NE_COUNTRIES_URL, 'ne_50m_admin_0_countries.geojson'),
    fetchJsonCached(NE_MAP_UNITS_URL, 'ne_50m_admin_0_map_units.geojson'),
  ]);

  const seenIds = new Set();
  const normalizedFeatures = [];

  // 1. Extract all non-UK features from ne_50m_admin_0_countries
  for (const feat of countriesGeo.features) {
    const p = feat.properties || {};
    const adm0 = p.ADM0_A3 || '';
    const sov = p.SOV_A3 || '';
    const admin = p.ADMIN || p.NAME || '';

    // Skip unified United Kingdom (will be replaced by 4 constituent units)
    if (adm0 === 'GBR' || (sov === 'GB1' && admin === 'United Kingdom')) {
      continue;
    }

    let id = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
    if (!id || id === '-99') {
      id = NE_ISO2_OVERRIDES[adm0] || p.WB_A2;
    }
    if (!id || id === '-99') {
      // Skip tiny disputed/unrecognized micro-enclaves without ISO codes
      continue;
    }
    // Skip duplicate IDs (keep first/primary)
    if (seenIds.has(id)) {
      continue;
    }

    const isUnMember = UN_NON_UK_ISO2.has(id);
    const kind = isUnMember ? 'country' : 'territory';
    const continent = normalizeContinent(p.CONTINENT, id);
    const name = p.NAME_EN || p.NAME || admin;

    seenIds.add(id);
    normalizedFeatures.push({
      type: 'Feature',
      id,
      properties: {
        id,
        name,
        flag: iso2ToFlag(id),
        kind,
        parentId: null,
        continent,
        isUnMember,
        searchAliases: admin !== name ? [admin] : undefined,
      },
      geometry: feat.geometry,
    });
  }

  // 2. Extract the 4 UK constituent nations from ne_50m_admin_0_map_units
  let ukFound = 0;
  for (const feat of mapUnitsGeo.features) {
    const p = feat.properties || {};
    const unitCode = p.GU_A3 || p.SU_A3 || '';
    const ukMeta = UK_UNIT_MAP[unitCode];
    if (!ukMeta) continue;
    if (seenIds.has(ukMeta.id)) continue;

    seenIds.add(ukMeta.id);
    ukFound += 1;
    normalizedFeatures.push({
      type: 'Feature',
      id: ukMeta.id,
      properties: {
        id: ukMeta.id,
        name: ukMeta.name,
        flag: ukMeta.flag,
        kind: 'constituent_country',
        parentId: 'GB',
        continent: 'Europe',
        isUnMember: true,
        searchAliases: ukMeta.searchAliases,
      },
      geometry: feat.geometry,
    });
  }

  if (ukFound !== 4) {
    throw new Error(`Expected 4 UK constituent units, found ${ukFound}`);
  }

  // 3. Ensure every single UN 193 member + Vatican exists (adding microstate circles if missing from 50m)
  for (const ms of FALLBACK_MICROSTATES) {
    if (seenIds.has(ms.id)) continue;
    seenIds.add(ms.id);
    normalizedFeatures.push({
      type: 'Feature',
      id: ms.id,
      properties: {
        id: ms.id,
        name: ms.name,
        flag: iso2ToFlag(ms.id),
        kind: ms.isUnMember ? 'country' : 'territory',
        parentId: null,
        continent: ms.continent,
        isUnMember: ms.isUnMember,
      },
      geometry: makeCirclePolygon(ms.lon, ms.lat),
    });
  }

  // 4. Verify all 192 non-UK UN states exist
  const missingUn = [...UN_NON_UK_ISO2].filter((code) => !seenIds.has(code));
  if (missingUn.length > 0) {
    throw new Error(`Missing UN member states: ${missingUn.join(', ')}`);
  }

  // 5. Build place metadata catalog sorted alphabetically
  const placesCatalog = normalizedFeatures
    .map((feat) => {
      const metrics = computePrimaryLandmassMetrics(feat);
      const isMicrostate = metrics.areaSr < 0.00018;
      return {
        ...feat.properties,
        centroid: metrics.centroid,
        bbox: metrics.bbox,
        frameBbox: metrics.frameBbox,
        areaSr: metrics.areaSr,
        isMicrostate,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Keep TopoJSON feature properties lean (just `id`)
  const leanGeo = {
    type: 'FeatureCollection',
    features: normalizedFeatures.map((f) => ({
      type: 'Feature',
      id: f.properties.id,
      properties: { id: f.properties.id },
      geometry: f.geometry,
    })),
  };

  // 6. Convert to TopoJSON, lightly simplify (keeping crisp UK/European borders), and quantize
  let topo = topology({ places: leanGeo });
  topo = presimplify(topo);
  const minWeight = quantile(topo, 0.22);
  topo = simplify(topo, minWeight);
  topo = quantize(topo, 1e5);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const topoPath = path.join(OUT_DIR, 'world-uk-split.topo.json');
  const catalogPath = path.join(OUT_DIR, 'places-catalog.json');

  fs.writeFileSync(topoPath, JSON.stringify(topo));
  fs.writeFileSync(catalogPath, JSON.stringify(placesCatalog, null, 2));

  const topoKb = (fs.statSync(topoPath).size / 1024).toFixed(1);
  const catalogKb = (fs.statSync(catalogPath).size / 1024).toFixed(1);
  const unCount = placesCatalog.filter((p) => p.isUnMember && p.parentId !== 'GB').length;
  const ukCount = placesCatalog.filter((p) => p.parentId === 'GB').length;
  const territoryCount = placesCatalog.filter((p) => !p.isUnMember).length;

  console.log(`[geo] Generated ${topoPath} (${topoKb} KB)`);
  console.log(`[geo] Generated ${catalogPath} (${catalogKb} KB)`);
  console.log(
    `[geo] Places: ${placesCatalog.length} total (${unCount} non-UK UN + ${ukCount} UK nations = ${
      unCount + ukCount
    } UK-split base, ${territoryCount} territories)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
