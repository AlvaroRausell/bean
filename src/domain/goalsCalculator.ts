import {
  CollectionItem,
  CountingMode,
  Place,
  TravelGoal,
  UserPlace,
  YearCollection,
} from '@/types';
import {
  computeYearlyStats,
  countPlacesWithMode,
  getEligiblePlaces,
  isVisitedStatus,
} from './statsCalculator';

export interface GoalProgress {
  goal: TravelGoal;
  currentCount: number;
  targetCount: number;
  remainingCount: number;
  percentComplete: number;
  isCompleted: boolean;
  yearsRemaining: number;
  requiredPerYear: number;
  currentAnnualPace: number | null;
  projectedYear: number | null;
  yearsAheadOrBehind: number | null; // positive = ahead of schedule
  newThisYear: number;
  yearlyTargetForCurrentYear: number;
}

export function evaluateGoalProgress(
  goal: TravelGoal,
  catalog: Place[],
  userPlaces: Record<string, UserPlace>,
  yearCollections: YearCollection[],
  collectionItems: CollectionItem[],
  options: {
    countingMode: CountingMode;
    includeTerritories: boolean;
    currentYear?: number;
  }
): GoalProgress {
  const currentYear = options.currentYear ?? new Date().getFullYear();

  // Filter catalog by goal scope
  let scopedPlaces = getEligiblePlaces(catalog, options.includeTerritories);
  if (goal.scope === 'continent' && goal.scopeValue) {
    scopedPlaces = scopedPlaces.filter((p) => p.continent === goal.scopeValue);
  } else if (goal.scope === 'uk_nations') {
    scopedPlaces = catalog.filter((p) => p.parentId === 'GB');
  }

  const visitedSet = new Set<string>();
  for (const up of Object.values(userPlaces)) {
    if (!up.deletedAt && isVisitedStatus(up.status)) {
      visitedSet.add(up.placeId);
    }
  }

  const effectiveMode: CountingMode =
    goal.scope === 'uk_nations' ? 'uk_split_un' : options.countingMode;
  const { visited: currentCount } = countPlacesWithMode(
    scopedPlaces,
    visitedSet,
    effectiveMode
  );

  const targetCount = Math.max(1, goal.targetCount);
  const remainingCount = Math.max(0, targetCount - currentCount);
  const isCompleted = remainingCount === 0;
  const percentComplete = Math.min(
    100,
    Number(((currentCount / targetCount) * 100).toFixed(1))
  );

  // Inclusive remaining years including current year if targetYear >= currentYear
  const yearsRemaining = Math.max(1, goal.targetYear - currentYear);
  const requiredPerYear = isCompleted
    ? 0
    : Number((remainingCount / yearsRemaining).toFixed(1));

  // Historical pace from yearly stats (scoped to this goal's eligible places)
  const scopedIds = new Set(scopedPlaces.map((p) => p.id));
  const allYearly = computeYearlyStats(userPlaces, yearCollections, collectionItems);

  const seen = new Set<string>();
  const scopedNewByYear = new Map<number, number>();
  for (const ys of allYearly) {
    let added = 0;
    for (const id of ys.placeIds) {
      if (scopedIds.has(id) && !seen.has(id)) {
        seen.add(id);
        added += 1;
      }
    }
    if (added > 0) {
      scopedNewByYear.set(ys.year, added);
    }
  }

  const newThisYear = scopedNewByYear.get(currentYear) ?? 0;
  const yearlyTargetForCurrentYear = isCompleted
    ? 0
    : Math.max(1, Math.ceil(requiredPerYear));

  // Compute average pace over recorded active span (up to last 5 years)
  let currentAnnualPace: number | null = null;
  let projectedYear: number | null = null;
  let yearsAheadOrBehind: number | null = null;

  const recentYears = [...scopedNewByYear.keys()].filter(
    (y) => y >= currentYear - 4 && y <= currentYear
  );
  if (recentYears.length > 0) {
    const earliest = Math.min(...recentYears);
    const spanYears = Math.max(1, currentYear - earliest + 1);
    const totalRecentNew = recentYears.reduce(
      (sum, y) => sum + (scopedNewByYear.get(y) ?? 0),
      0
    );
    currentAnnualPace = Number((totalRecentNew / spanYears).toFixed(1));

    if (!isCompleted && currentAnnualPace > 0) {
      const yearsNeeded = Math.ceil(remainingCount / currentAnnualPace);
      projectedYear = currentYear + yearsNeeded;
      yearsAheadOrBehind = goal.targetYear - projectedYear;
    } else if (isCompleted) {
      projectedYear = currentYear;
      yearsAheadOrBehind = Math.max(0, goal.targetYear - currentYear);
    }
  }

  return {
    goal,
    currentCount,
    targetCount,
    remainingCount,
    percentComplete,
    isCompleted,
    yearsRemaining,
    requiredPerYear,
    currentAnnualPace,
    projectedYear,
    yearsAheadOrBehind,
    newThisYear,
    yearlyTargetForCurrentYear,
  };
}
