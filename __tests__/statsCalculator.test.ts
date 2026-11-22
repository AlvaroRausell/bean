import { PLACES_CATALOG } from '@/data/places';
import {
  calculateAgePercentile,
  calculateCountriesForPercentile,
  computeWorldStats,
  computeYearlyStats,
} from '@/domain/statsCalculator';
import { CollectionItem, UserPlace, YearCollection } from '@/types';

const now = '2026-01-01T00:00:00.000Z';

describe('Stats Calculator & Age Percentile', () => {
  it('rolls up UK constituent nations into 1 in un_strict mode and counts all 4 in uk_split_un mode', () => {
    const userPlaces: Record<string, UserPlace> = {
      'GB-ENG': { placeId: 'GB-ENG', status: 'visited', firstVisitedYear: 2022, notes: null, updatedAt: now, deletedAt: null },
      'GB-SCT': { placeId: 'GB-SCT', status: 'visited', firstVisitedYear: 2023, notes: null, updatedAt: now, deletedAt: null },
      'GB-WLS': { placeId: 'GB-WLS', status: 'visited', firstVisitedYear: 2024, notes: null, updatedAt: now, deletedAt: null },
      FR: { placeId: 'FR', status: 'visited', firstVisitedYear: 2021, notes: null, updatedAt: now, deletedAt: null },
    };

    const splitStats = computeWorldStats(PLACES_CATALOG, userPlaces, [], [], {
      countingMode: 'uk_split_un',
      includeTerritories: false,
      homePlaceId: 'GB-ENG',
    });

    const strictStats = computeWorldStats(PLACES_CATALOG, userPlaces, [], [], {
      countingMode: 'un_strict',
      includeTerritories: false,
      homePlaceId: 'GB-ENG',
    });

    expect(splitStats.visitedCount).toBe(4);
    expect(splitStats.totalCount).toBe(196);
    expect(splitStats.ukVisitedCount).toBe(3);

    expect(strictStats.visitedCount).toBe(2); // UK (1) + FR (1)
    expect(strictStats.totalCount).toBe(193);
    expect(strictStats.ukVisitedCount).toBe(3); // UK nations card still shows 3/4!
  });

  it('deduplicates repeat country visits across years while tracking first-time new countries per year', () => {
    const userPlaces: Record<string, UserPlace> = {
      ES: { placeId: 'ES', status: 'visited', firstVisitedYear: 2019, notes: null, updatedAt: now, deletedAt: null },
      JP: { placeId: 'JP', status: 'visited', firstVisitedYear: 2024, notes: null, updatedAt: now, deletedAt: null },
    };

    const collections: YearCollection[] = [
      { id: 'c2019', year: 2019, title: '2019', collectionType: 'visited', updatedAt: now, deletedAt: null },
      { id: 'c2024', year: 2024, title: '2024', collectionType: 'visited', updatedAt: now, deletedAt: null },
    ];

    const items: CollectionItem[] = [
      { id: 'i1', collectionId: 'c2019', placeId: 'ES', visitMonth: null, notes: null, updatedAt: now, deletedAt: null },
      { id: 'i2', collectionId: 'c2024', placeId: 'ES', visitMonth: null, notes: null, updatedAt: now, deletedAt: null },
      { id: 'i3', collectionId: 'c2024', placeId: 'JP', visitMonth: null, notes: null, updatedAt: now, deletedAt: null },
    ];

    const yearly = computeYearlyStats(userPlaces, collections, items);
    expect(yearly).toHaveLength(2);
    expect(yearly[0]).toMatchObject({ year: 2019, totalVisited: 1, newCountries: 1 });
    expect(yearly[1]).toMatchObject({ year: 2024, totalVisited: 2, newCountries: 1 });
  });

  it('calculates monotonic, bounded age-based traveler percentiles', () => {
    const p0 = calculateAgePercentile(28, 0);
    const p5 = calculateAgePercentile(28, 5);
    const p20 = calculateAgePercentile(28, 20);
    const p80 = calculateAgePercentile(28, 80);

    expect(p0.topPercent).toBe(99);
    expect(p5.topPercent).toBeGreaterThan(p20.topPercent);
    expect(p20.topPercent).toBeGreaterThan(p80.topPercent);
    expect(p80.topPercent).toBeGreaterThanOrEqual(0.1);

    // Same country count at a younger age should rank higher (lower topPercent) than at an older age
    const young = calculateAgePercentile(22, 18);
    const older = calculateAgePercentile(55, 18);
    expect(young.topPercent).toBeLessThan(older.topPercent);
  });

  it('computes the exact minimum countries required for any target percentile at current age', () => {
    for (const targetPct of [75, 90, 95, 99]) {
      const res = calculateCountriesForPercentile(28, targetPct, 196);
      expect(res.achievable).toBe(true);
      expect(calculateAgePercentile(28, res.requiredCountries).percentile).toBeGreaterThanOrEqual(
        targetPct
      );
      if (res.requiredCountries > 1) {
        expect(
          calculateAgePercentile(28, res.requiredCountries - 1).percentile
        ).toBeLessThan(targetPct);
      }
    }

    // Higher target percentile strictly requires at least as many countries
    const p75 = calculateCountriesForPercentile(30, 75, 196).requiredCountries;
    const p90 = calculateCountriesForPercentile(30, 90, 196).requiredCountries;
    const p95 = calculateCountriesForPercentile(30, 95, 196).requiredCountries;
    const p99 = calculateCountriesForPercentile(30, 99, 196).requiredCountries;
    expect(p75).toBeLessThan(p90);
    expect(p90).toBeLessThan(p95);
    expect(p95).toBeLessThan(p99);
  });
});
