import { Continent, Place, UserPlace } from '@/types';
import { isVisitedStatus } from './statsCalculator';

export interface BulkWishlistScope {
  continent?: Continent | 'ALL';
  includeTerritories: boolean;
  excludeAlreadyVisited: boolean;
}

export interface BulkWishlistResult {
  updates: UserPlace[];
  previousSnapshot: UserPlace[];
  addedCount: number;
}

/**
 * Pure "Select All Except" bulk wishlist planner.
 * Computes the exact set of UserPlace records to promote to 'wishlist'
 * along with a complete rollback snapshot for instant Undo.
 */
export function computeBulkWishlistExcept(
  catalog: Place[],
  currentUserPlaces: Record<string, UserPlace>,
  excludedIds: Set<string>,
  scope: BulkWishlistScope,
  now = new Date().toISOString()
): BulkWishlistResult {
  const candidates = catalog.filter((p) => {
    if (!scope.includeTerritories && !p.isUnMember) return false;
    if (scope.continent && scope.continent !== 'ALL' && p.continent !== scope.continent) {
      return false;
    }
    return true;
  });

  const updates: UserPlace[] = [];
  const previousSnapshot: UserPlace[] = [];

  for (const place of candidates) {
    if (excludedIds.has(place.id)) continue;

    const existing = currentUserPlaces[place.id];
    if (scope.excludeAlreadyVisited && isVisitedStatus(existing?.status)) {
      continue;
    }
    if (existing?.status === 'skipped' && !existing.deletedAt) {
      continue;
    }
    if (existing?.status === 'wishlist' && !existing.deletedAt) {
      continue;
    }

    previousSnapshot.push(
      existing
        ? { ...existing }
        : {
            placeId: place.id,
            status: 'none',
            firstVisitedYear: null,
            notes: null,
            isFavorite: false,
            updatedAt: now,
            deletedAt: null,
          }
    );

    updates.push({
      placeId: place.id,
      status: 'wishlist',
      firstVisitedYear: existing?.firstVisitedYear ?? null,
      notes: existing?.notes ?? null,
      isFavorite: Boolean(existing?.isFavorite),
      updatedAt: now,
      deletedAt: null,
    });
  }

  return {
    updates,
    previousSnapshot,
    addedCount: updates.length,
  };
}
