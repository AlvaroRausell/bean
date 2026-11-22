import { PLACES_CATALOG } from '@/data/places';
import { evaluateGoalProgress } from '@/domain/goalsCalculator';
import { TravelGoal, UserPlace } from '@/types';

const now = '2026-01-01T00:00:00.000Z';

function makeVisited(ids: string[], year: number): Record<string, UserPlace> {
  const out: Record<string, UserPlace> = {};
  for (const id of ids) {
    out[id] = {
      placeId: id,
      status: 'visited',
      firstVisitedYear: year,
      notes: null,
      updatedAt: now,
      deletedAt: null,
    };
  }
  return out;
}

describe('Goals & Travel Pace Calculator', () => {
  it('computes required countries per year accurately for a 2050 goal', () => {
    const un30 = PLACES_CATALOG.filter((p) => p.isUnMember)
      .slice(0, 30)
      .map((p) => p.id);
    const userPlaces = makeVisited(un30, 2025);

    const goal: TravelGoal = {
      id: 'g1',
      title: '100 Countries by 2050',
      targetCount: 100,
      targetYear: 2050,
      scope: 'world',
      scopeValue: null,
      updatedAt: now,
      deletedAt: null,
    };

    const result = evaluateGoalProgress(goal, PLACES_CATALOG, userPlaces, [], [], {
      countingMode: 'uk_split_un',
      includeTerritories: false,
      currentYear: 2026,
    });

    expect(result.currentCount).toBe(30);
    expect(result.remainingCount).toBe(70);
    expect(result.yearsRemaining).toBe(24);
    expect(result.requiredPerYear).toBeCloseTo(2.9, 1);
    expect(result.isCompleted).toBe(false);
    expect(result.yearlyTargetForCurrentYear).toBe(3);
  });

  it('handles completed goals and UK nations scope cleanly', () => {
    const userPlaces = makeVisited(['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR'], 2026);
    const goal: TravelGoal = {
      id: 'g-uk',
      title: 'All 4 UK Nations',
      targetCount: 4,
      targetYear: 2028,
      scope: 'uk_nations',
      scopeValue: null,
      updatedAt: now,
      deletedAt: null,
    };

    const result = evaluateGoalProgress(goal, PLACES_CATALOG, userPlaces, [], [], {
      countingMode: 'un_strict', // even in un_strict, uk_nations goal counts all 4!
      includeTerritories: false,
      currentYear: 2026,
    });

    expect(result.currentCount).toBe(4);
    expect(result.isCompleted).toBe(true);
    expect(result.requiredPerYear).toBe(0);
    expect(result.percentComplete).toBe(100);
  });
});
