import { Continent, Place } from '@/types';
import rawCatalog from './places-catalog.json';

export const PLACES_CATALOG: Place[] = rawCatalog as Place[];

export const PLACE_BY_ID: Record<string, Place> = Object.fromEntries(
  PLACES_CATALOG.map((p) => [p.id, p])
);

export const UK_NATION_IDS = ['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR'] as const;

export const UK_NATIONS: Place[] = UK_NATION_IDS.map((id) => PLACE_BY_ID[id]).filter(
  Boolean
);

export function searchPlaces(
  query: string,
  includeTerritories: boolean
): Place[] {
  const q = query.trim().toLowerCase();
  const base = includeTerritories
    ? PLACES_CATALOG
    : PLACES_CATALOG.filter((p) => p.isUnMember);

  if (!q) return base;

  return base.filter((p) => {
    if (p.name.toLowerCase().includes(q)) return true;
    if (p.id.toLowerCase() === q) return true;
    if (p.continent.toLowerCase().includes(q)) return true;
    if (p.searchAliases?.some((a) => a.toLowerCase().includes(q))) return true;
    return false;
  });
}

export function getPlacesByContinent(
  continent: Continent,
  includeTerritories: boolean
): Place[] {
  return PLACES_CATALOG.filter(
    (p) => p.continent === continent && (includeTerritories || p.isUnMember)
  );
}
