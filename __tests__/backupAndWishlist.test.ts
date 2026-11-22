import { PLACES_CATALOG } from '@/data/places';
import { computeBulkWishlistExcept } from '@/domain/wishlistOps';
import { createDefaultProfile } from '@/db/repositories';
import {
  buildBackupPayload,
  mergeBackupWithLocal,
  parseAndValidateBackup,
} from '@/sync/backupService';
import { UserPlace } from '@/types';

describe('Wishlist "Select All Except" & Offline JSON Backup/Restore', () => {
  it('adds all eligible places except excluded & already-visited ones and returns an exact undo snapshot', () => {
    const t0 = '2026-01-01T00:00:00.000Z';
    const current: Record<string, UserPlace> = {
      FR: { placeId: 'FR', status: 'visited', firstVisitedYear: 2022, notes: null, updatedAt: t0, deletedAt: null },
      JP: { placeId: 'JP', status: 'wishlist', firstVisitedYear: null, notes: null, updatedAt: t0, deletedAt: null },
    };

    const excluded = new Set(['KP', 'AF', 'GB-ENG']);
    const result = computeBulkWishlistExcept(PLACES_CATALOG, current, excluded, {
      continent: 'ALL',
      includeTerritories: false,
      excludeAlreadyVisited: true,
    });

    // 196 base - 1 visited (FR) - 1 already wishlist (JP) - 3 excluded = 191 added
    expect(result.addedCount).toBe(191);
    expect(result.previousSnapshot).toHaveLength(191);
    expect(result.updates.some((u) => u.placeId === 'FR')).toBe(false);
    expect(result.updates.some((u) => u.placeId === 'KP')).toBe(false);
    expect(result.updates.some((u) => u.placeId === 'GB-ENG')).toBe(false);
    expect(result.updates.some((u) => u.placeId === 'GB-SCT')).toBe(true);
  });

  it('round-trips a JSON backup and rejects malformed backup payloads', () => {
    const t0 = '2026-05-01T10:00:00.000Z';
    const payload = buildBackupPayload({
      userPlaces: {
        'GB-SCT': {
          placeId: 'GB-SCT',
          status: 'visited',
          firstVisitedYear: 2024,
          notes: 'Highlands road trip',
          updatedAt: t0,
          deletedAt: null,
        },
      },
      yearCollections: [
        { id: 'y2024', year: 2024, title: '2024 Travels', collectionType: 'visited', updatedAt: t0, deletedAt: null },
      ],
      collectionItems: [
        { id: 'ci1', collectionId: 'y2024', placeId: 'GB-SCT', visitMonth: 7, notes: null, updatedAt: t0, deletedAt: null },
      ],
      travelGoals: [
        { id: 'g1', title: '100 by 2050', targetCount: 100, targetYear: 2050, scope: 'world', scopeValue: null, updatedAt: t0, deletedAt: null },
      ],
      userProfile: createDefaultProfile(t0),
    });

    const preview = parseAndValidateBackup(JSON.stringify(payload));
    expect(preview.visitedCount).toBe(1);
    expect(preview.collectionsCount).toBe(1);
    expect(preview.goalsCount).toBe(1);

    expect(() => parseAndValidateBackup('{not json')).toThrow();
    expect(() => parseAndValidateBackup(JSON.stringify({ app: 'other', schemaVersion: 1 }))).toThrow();
  });

  it('merges backups using Last-Write-Wins on updatedAt timestamps', () => {
    const older = '2026-01-01T10:00:00.000Z';
    const newer = '2026-06-01T10:00:00.000Z';

    const local = {
      userPlaces: {
        FR: { placeId: 'FR', status: 'visited' as const, firstVisitedYear: 2023, notes: 'Newer local', updatedAt: newer, deletedAt: null },
        IT: { placeId: 'IT', status: 'wishlist' as const, firstVisitedYear: null, notes: 'Older local', updatedAt: older, deletedAt: null },
      },
      yearCollections: [],
      collectionItems: [],
      travelGoals: [],
      userProfile: createDefaultProfile(older),
    };

    const incoming = buildBackupPayload({
      userPlaces: {
        FR: { placeId: 'FR', status: 'wishlist', firstVisitedYear: null, notes: 'Stale backup', updatedAt: older, deletedAt: null },
        IT: { placeId: 'IT', status: 'visited', firstVisitedYear: 2026, notes: 'Newer backup', updatedAt: newer, deletedAt: null },
        JP: { placeId: 'JP', status: 'visited', firstVisitedYear: 2025, notes: null, updatedAt: newer, deletedAt: null },
      },
      yearCollections: [],
      collectionItems: [],
      travelGoals: [],
      userProfile: createDefaultProfile(newer),
    });

    const merged = mergeBackupWithLocal(local, incoming);
    const byId = Object.fromEntries(merged.userPlaces.map((p) => [p.placeId, p]));

    expect(byId['FR'].status).toBe('visited'); // newer local won
    expect(byId['IT'].status).toBe('visited'); // newer incoming won
    expect(byId['JP'].status).toBe('visited'); // incoming-only preserved
  });

  it('preserves starred favourite places across bulk wishlist updates and backup round-trips', () => {
    const t0 = '2026-06-01T10:00:00.000Z';
    const current: Record<string, UserPlace> = {
      IS: {
        placeId: 'IS',
        status: 'none',
        firstVisitedYear: null,
        notes: 'Ring road dream',
        isFavorite: true,
        updatedAt: t0,
        deletedAt: null,
      },
      'GB-SCT': {
        placeId: 'GB-SCT',
        status: 'visited',
        firstVisitedYear: 2024,
        notes: null,
        isFavorite: true,
        updatedAt: t0,
        deletedAt: null,
      },
    };

    const bulk = computeBulkWishlistExcept(PLACES_CATALOG, current, new Set(), {
      continent: 'Europe',
      includeTerritories: false,
      excludeAlreadyVisited: true,
    });
    const updatedIceland = bulk.updates.find((u) => u.placeId === 'IS');
    expect(updatedIceland?.status).toBe('wishlist');
    expect(updatedIceland?.isFavorite).toBe(true);

    const payload = buildBackupPayload({
      userPlaces: current,
      yearCollections: [],
      collectionItems: [],
      travelGoals: [],
      userProfile: createDefaultProfile(t0),
    });
    const parsed = parseAndValidateBackup(JSON.stringify(payload));
    const parsedScot = parsed.backup.data.userPlaces.find((p) => p.placeId === 'GB-SCT');
    expect(parsedScot?.isFavorite).toBe(true);
  });
});
