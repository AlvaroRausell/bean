import {
  CollectionItem,
  Continent,
  CountingMode,
  Place,
  UserPlace,
  YearCollection,
} from '@/types';

export const CONTINENTS: Continent[] = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
  'Antarctica',
];

export interface ContinentStat {
  continent: Continent;
  visited: number;
  wishlist: number;
  total: number;
  percent: number;
}

export interface UkNationStat {
  id: string;
  name: string;
  flag: string;
  visited: boolean;
  wishlist: boolean;
}

export interface YearlyStat {
  year: number;
  totalVisited: number;
  newCountries: number;
  placeIds: string[];
}

export interface AgePercentileResult {
  age: number;
  visitedCount: number;
  topPercent: number; // e.g. 8.4 means "Top 8.4%"
  percentile: number; // e.g. 91.6
  label: string;
  disclaimer: string;
}

export interface AgePercentileTarget {
  age: number;
  targetPercentile: number; // e.g. 95 means "95th percentile" (Top 5%)
  topPercent: number; // e.g. 5
  requiredCountries: number;
  achievable: boolean;
}

export interface GeographicExtremes {
  northernmost: Place | null;
  southernmost: Place | null;
  furthestFromHome: { place: Place; distanceKm: number } | null;
  hemispheres: { north: boolean; south: boolean; east: boolean; west: boolean };
}

export interface WorldStats {
  visitedCount: number;
  livedCount: number;
  wishlistCount: number;
  skippedCount: number;
  skippedPlaces: Place[];
  favoritesCount: number;
  favoritePlaces: Place[];
  totalCount: number;
  remainingCount: number;
  percent: number;
  continents: ContinentStat[];
  ukNations: UkNationStat[];
  ukVisitedCount: number;
  yearlyStats: YearlyStat[];
  bestYear: YearlyStat | null;
  extremes: GeographicExtremes;
}

export function isVisitedStatus(status: UserPlace['status'] | undefined): boolean {
  return status === 'visited' || status === 'lived';
}

export function getEligiblePlaces(
  catalog: Place[],
  includeTerritories: boolean
): Place[] {
  return catalog.filter((p) => (includeTerritories ? true : p.isUnMember));
}

/**
 * Counts a set of eligible places respecting countingMode:
 * - 'uk_split_un': England, Scotland, Wales, Northern Ireland each count as 1 (4 total)
 * - 'un_strict': Any visited UK constituent nation rolls up to 1 United Kingdom count
 */
export function countPlacesWithMode(
  eligiblePlaces: Place[],
  visitedSet: Set<string>,
  countingMode: CountingMode
): { visited: number; total: number } {
  if (countingMode === 'uk_split_un') {
    let visited = 0;
    for (const p of eligiblePlaces) {
      if (visitedSet.has(p.id)) visited += 1;
    }
    return { visited, total: eligiblePlaces.length };
  }

  // un_strict: collapse parentId === 'GB' into 1 sovereign UK entity
  let visited = 0;
  let total = 0;
  let hasUkInScope = false;
  let anyUkVisited = false;

  for (const p of eligiblePlaces) {
    if (p.parentId === 'GB') {
      hasUkInScope = true;
      if (visitedSet.has(p.id)) anyUkVisited = true;
    } else {
      total += 1;
      if (visitedSet.has(p.id)) visited += 1;
    }
  }

  if (hasUkInScope) {
    total += 1;
    if (anyUkVisited) visited += 1;
  }

  return { visited, total };
}

export function haversineDistanceKm(
  [lon1, lat1]: [number, number],
  [lon2, lat2]: [number, number]
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeYearlyStats(
  userPlaces: Record<string, UserPlace>,
  yearCollections: YearCollection[],
  collectionItems: CollectionItem[]
): YearlyStat[] {
  const visitedCollectionsById = new Map<string, YearCollection>();
  for (const c of yearCollections) {
    if (!c.deletedAt && c.collectionType === 'visited') {
      visitedCollectionsById.set(c.id, c);
    }
  }

  const yearToPlaces = new Map<number, Set<string>>();

  // 1. Gather places from visited Year Collections
  for (const item of collectionItems) {
    if (item.deletedAt) continue;
    const col = visitedCollectionsById.get(item.collectionId);
    if (!col) continue;
    let set = yearToPlaces.get(col.year);
    if (!set) {
      set = new Set<string>();
      yearToPlaces.set(col.year, set);
    }
    set.add(item.placeId);
  }

  // 2. Also incorporate firstVisitedYear on userPlaces if not already in that year's set
  for (const up of Object.values(userPlaces)) {
    if (up.deletedAt || !isVisitedStatus(up.status) || !up.firstVisitedYear) {
      continue;
    }
    let set = yearToPlaces.get(up.firstVisitedYear);
    if (!set) {
      set = new Set<string>();
      yearToPlaces.set(up.firstVisitedYear, set);
    }
    set.add(up.placeId);
  }

  // 3. Sort years chronologically so "newCountries" counts first-ever visits accurately
  const sortedYears = [...yearToPlaces.keys()].sort((a, b) => a - b);
  const seenEver = new Set<string>();
  const stats: YearlyStat[] = [];

  for (const year of sortedYears) {
    const ids = [...(yearToPlaces.get(year) ?? [])];
    let newCountries = 0;
    for (const id of ids) {
      if (!seenEver.has(id)) {
        seenEver.add(id);
        newCountries += 1;
      }
    }
    stats.push({
      year,
      totalVisited: ids.length,
      newCountries,
      placeIds: ids,
    });
  }

  return stats;
}

export function computeWorldStats(
  catalog: Place[],
  userPlaces: Record<string, UserPlace>,
  yearCollections: YearCollection[],
  collectionItems: CollectionItem[],
  options: {
    countingMode: CountingMode;
    includeTerritories: boolean;
    homePlaceId: string | null;
  }
): WorldStats {
  const eligible = getEligiblePlaces(catalog, options.includeTerritories);
  const visitedSet = new Set<string>();
  const livedSet = new Set<string>();
  const wishlistSet = new Set<string>();
  const skippedSet = new Set<string>();
  const favoriteSet = new Set<string>();

  for (const up of Object.values(userPlaces)) {
    if (up.deletedAt) continue;
    if (up.status === 'visited') visitedSet.add(up.placeId);
    if (up.status === 'lived') {
      visitedSet.add(up.placeId);
      livedSet.add(up.placeId);
    }
    if (up.status === 'wishlist') wishlistSet.add(up.placeId);
    if (up.status === 'skipped') skippedSet.add(up.placeId);
    if (up.isFavorite) favoriteSet.add(up.placeId);
  }

  const favoritePlaces = catalog
    .filter((p) => favoriteSet.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const skippedPlaces = catalog
    .filter((p) => skippedSet.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const worldCounts = countPlacesWithMode(eligible, visitedSet, options.countingMode);
  const wishlistCounts = countPlacesWithMode(eligible, wishlistSet, options.countingMode);
  const livedCounts = countPlacesWithMode(eligible, livedSet, options.countingMode);

  const percent =
    worldCounts.total > 0
      ? Number(((worldCounts.visited / worldCounts.total) * 100).toFixed(1))
      : 0;

  const continents: ContinentStat[] = CONTINENTS.map((continent) => {
    const inCont = eligible.filter((p) => p.continent === continent);
    const vCount = countPlacesWithMode(inCont, visitedSet, options.countingMode);
    const wCount = countPlacesWithMode(inCont, wishlistSet, options.countingMode);
    return {
      continent,
      visited: vCount.visited,
      wishlist: wCount.visited,
      total: vCount.total,
      percent:
        vCount.total > 0 ? Number(((vCount.visited / vCount.total) * 100).toFixed(1)) : 0,
    };
  }).filter((c) => c.total > 0);

  const ukOrder = ['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR'];
  const ukNations: UkNationStat[] = ukOrder
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p): p is Place => Boolean(p))
    .map((p) => ({
      id: p.id,
      name: p.name,
      flag: p.flag,
      visited: visitedSet.has(p.id),
      wishlist: wishlistSet.has(p.id),
    }));

  const ukVisitedCount = ukNations.filter((u) => u.visited).length;

  const yearlyStats = computeYearlyStats(userPlaces, yearCollections, collectionItems);
  const bestYear =
    yearlyStats.length > 0
      ? yearlyStats.reduce((best, cur) =>
          cur.totalVisited > best.totalVisited ? cur : best
        )
      : null;

  // Geographic extremes across all visited places
  const visitedPlaces = catalog.filter((p) => visitedSet.has(p.id));
  let northernmost: Place | null = null;
  let southernmost: Place | null = null;
  const hemispheres = { north: false, south: false, east: false, west: false };

  for (const p of visitedPlaces) {
    const [lon, lat] = p.centroid;
    if (!northernmost || lat > northernmost.centroid[1]) northernmost = p;
    if (!southernmost || lat < southernmost.centroid[1]) southernmost = p;
    if (lat >= 0) hemispheres.north = true;
    if (lat < 0) hemispheres.south = true;
    if (lon >= 0) hemispheres.east = true;
    if (lon < 0) hemispheres.west = true;
  }

  let furthestFromHome: { place: Place; distanceKm: number } | null = null;
  if (options.homePlaceId) {
    const home = catalog.find((p) => p.id === options.homePlaceId);
    if (home) {
      for (const p of visitedPlaces) {
        if (p.id === home.id) continue;
        const dist = haversineDistanceKm(home.centroid, p.centroid);
        if (!furthestFromHome || dist > furthestFromHome.distanceKm) {
          furthestFromHome = { place: p, distanceKm: Math.round(dist) };
        }
      }
    }
  }

  return {
    visitedCount: worldCounts.visited,
    livedCount: livedCounts.visited,
    wishlistCount: wishlistCounts.visited,
    skippedCount: skippedPlaces.length,
    skippedPlaces,
    favoritesCount: favoritePlaces.length,
    favoritePlaces,
    totalCount: worldCounts.total,
    remainingCount: Math.max(0, worldCounts.total - worldCounts.visited),
    percent,
    continents,
    ukNations,
    ukVisitedCount,
    yearlyStats,
    bestYear,
    extremes: {
      northernmost,
      southernmost,
      furthestFromHome,
      hemispheres,
    },
  };
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 7.1.26, max error < 1.5e-7).
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

// Heuristic offline log-normal curve on (countries + 1) by age.
// NOTE: This is NOT fitted from a single published open microdataset (no public dataset
// publishes exact global country-count percentiles by single year of age).
// Values are loosely calibrated toward UK/Western European adult traveler norms
// (e.g. YouGov UK surveys report an average of ~9.6–12 countries visited over a lifetime,
// whereas Pew Research US surveys report a much lower median of ~1–2 at ages 18–29 and
// only 26% of US adults having visited 5+ countries).
const AGE_BENCHMARK_ANCHORS: { age: number; median: number; sigma: number }[] = [
  { age: 16, median: 2.2, sigma: 0.78 },
  { age: 21, median: 3.6, sigma: 0.82 },
  { age: 28, median: 6.0, sigma: 0.86 },
  { age: 35, median: 8.2, sigma: 0.88 },
  { age: 45, median: 10.5, sigma: 0.90 },
  { age: 58, median: 12.5, sigma: 0.92 },
  { age: 75, median: 13.5, sigma: 0.92 },
];

function interpolateAgeParams(age: number): { median: number; sigma: number } {
  const clamped = Math.max(16, Math.min(90, age));
  if (clamped <= AGE_BENCHMARK_ANCHORS[0].age) {
    return AGE_BENCHMARK_ANCHORS[0];
  }
  const last = AGE_BENCHMARK_ANCHORS[AGE_BENCHMARK_ANCHORS.length - 1];
  if (clamped >= last.age) {
    return last;
  }

  for (let i = 0; i < AGE_BENCHMARK_ANCHORS.length - 1; i++) {
    const a = AGE_BENCHMARK_ANCHORS[i];
    const b = AGE_BENCHMARK_ANCHORS[i + 1];
    if (clamped >= a.age && clamped <= b.age) {
      const t = (clamped - a.age) / (b.age - a.age);
      return {
        median: a.median + t * (b.median - a.median),
        sigma: a.sigma + t * (b.sigma - a.sigma),
      };
    }
  }
  return last;
}

/**
 * Estimates what "Top N% of travelers for your age" the user falls into.
 * Monotonic in visitedCount (more countries -> lower topPercent) and smooth across age.
 */
export function calculateAgePercentile(
  age: number,
  visitedCount: number
): AgePercentileResult {
  const safeAge = Math.max(10, Math.min(100, Math.round(age)));
  const safeVisited = Math.max(0, visitedCount);

  if (safeVisited === 0) {
    return {
      age: safeAge,
      visitedCount: 0,
      topPercent: 99,
      percentile: 1,
      label: `Top 99% for age ${safeAge}`,
      disclaimer:
        'Rough offline estimate calibrated around UK/European traveler medians (not a published global census).',
    };
  }

  const { median, sigma } = interpolateAgeParams(safeAge);
  const mu = Math.log(median + 1);
  const z = (Math.log(safeVisited + 1) - mu) / sigma;
  const cdf = normalCdf(z);

  const rawTop = (1 - cdf) * 100;
  const topPercent = Math.max(0.1, Math.min(99, Number(rawTop.toFixed(rawTop < 5 ? 1 : 0))));
  const percentile = Number((100 - topPercent).toFixed(1));

  const displayTop = topPercent < 1 ? `${topPercent.toFixed(1)}%` : `${Math.round(topPercent)}%`;

  return {
    age: safeAge,
    visitedCount: safeVisited,
    topPercent,
    percentile,
    label: `Top ${displayTop} of travelers aged ${safeAge}`,
    disclaimer:
      'Estimated from age-stratified international travel survey benchmarks (offline model).',
  };
}

/**
 * Computes the exact minimum number of countries needed at `age` to reach or exceed
 * `targetPercentile` (e.g. 90 = 90th percentile / top 10%, 95 = 95th percentile / top 5%).
 * Uses exact binary search against `calculateAgePercentile` so results always agree 1:1.
 */
export function calculateCountriesForPercentile(
  age: number,
  targetPercentile: number,
  maxCountries = 196
): AgePercentileTarget {
  const safeAge = Math.max(10, Math.min(100, Math.round(age)));
  const clampedPct = Math.max(50, Math.min(99, Math.round(targetPercentile)));
  const topPercent = Number((100 - clampedPct).toFixed(1));
  const cap = Math.max(1, Math.round(maxCountries));

  // Binary search for smallest count in [1..cap] whose percentile >= clampedPct
  let lo = 1;
  let hi = cap;
  let answer: number | null = null;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const res = calculateAgePercentile(safeAge, mid);
    if (res.percentile >= clampedPct) {
      answer = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return {
    age: safeAge,
    targetPercentile: clampedPct,
    topPercent,
    requiredCountries: answer ?? cap,
    achievable: answer !== null,
  };
}
