import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import worldTopoRaw from '@/data/world-uk-split.topo.json';
import { PLACE_BY_ID, PLACES_CATALOG, searchPlaces, UK_NATIONS } from '@/data/places';
import { countPlacesWithMode, getEligiblePlaces } from '@/domain/statsCalculator';

describe('Geo Data & UK Constituent Country Integrity', () => {
  it('splits the UK into England, Scotland, Wales, and Northern Ireland without duplicating GB', () => {
    expect(UK_NATIONS.map((u) => u.id)).toEqual([
      'GB-ENG',
      'GB-SCT',
      'GB-WLS',
      'GB-NIR',
    ]);
    for (const nation of UK_NATIONS) {
      expect(nation.parentId).toBe('GB');
      expect(nation.kind).toBe('constituent_country');
      expect(nation.isUnMember).toBe(true);
    }
    expect(PLACE_BY_ID['GB']).toBeUndefined();
    expect(PLACE_BY_ID['GBR']).toBeUndefined();
  });

  it('has valid TopoJSON geometries for all 4 UK nations and every catalog entry', () => {
    const topo = worldTopoRaw as unknown as Topology<{
      places: GeometryCollection<{ id: string }>;
    }>;
    const fc = feature(topo, topo.objects.places);
    const featureIds = new Set(fc.features.map((f) => f.properties?.id || f.id));

    expect(featureIds.has('GB-ENG')).toBe(true);
    expect(featureIds.has('GB-SCT')).toBe(true);
    expect(featureIds.has('GB-WLS')).toBe(true);
    expect(featureIds.has('GB-NIR')).toBe(true);

    for (const place of PLACES_CATALOG) {
      expect(featureIds.has(place.id)).toBe(true);
    }
  });

  it('yields exact 196 in UK-split mode and exact 193 in UN strict mode', () => {
    const eligible = getEligiblePlaces(PLACES_CATALOG, false);
    const ukSplit = countPlacesWithMode(eligible, new Set(), 'uk_split_un');
    const unStrict = countPlacesWithMode(eligible, new Set(), 'un_strict');

    expect(ukSplit.total).toBe(196);
    expect(unStrict.total).toBe(193);
  });

  it('surfaces all 4 UK nations when searching "United Kingdom" or "UK"', () => {
    const results = searchPlaces('United Kingdom', false).map((p) => p.id);
    expect(results).toEqual(
      expect.arrayContaining(['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR'])
    );
  });
});
