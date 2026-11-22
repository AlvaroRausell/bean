import {
  BeanBackupV1,
  CollectionItem,
  TravelGoal,
  UserPlace,
  UserProfile,
  YearCollection,
} from '@/types';
import { createDefaultProfile, HydratedState } from '@/db/repositories';

export interface BackupPreview {
  exportedAt: string;
  visitedCount: number;
  wishlistCount: number;
  collectionsCount: number;
  goalsCount: number;
  backup: BeanBackupV1;
}

export function buildBackupPayload(state: HydratedState): BeanBackupV1 {
  return {
    schemaVersion: 1,
    app: 'bean',
    exportedAt: new Date().toISOString(),
    data: {
      userPlaces: Object.values(state.userPlaces),
      yearCollections: state.yearCollections,
      collectionItems: state.collectionItems,
      travelGoals: state.travelGoals,
      userProfile: state.userProfile,
    },
  };
}

export function parseAndValidateBackup(rawJson: string): BackupPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON file. Please select a valid Bean backup.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup file is empty or malformed.');
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.app !== 'bean' || obj.schemaVersion !== 1) {
    throw new Error('Unsupported backup format or schema version.');
  }

  const data = obj.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') {
    throw new Error('Backup file is missing data section.');
  }

  if (
    !Array.isArray(data.userPlaces) ||
    !Array.isArray(data.yearCollections) ||
    !Array.isArray(data.collectionItems) ||
    !Array.isArray(data.travelGoals)
  ) {
    throw new Error('Backup file is missing required collections.');
  }

  // Validate individual place entries
  const validStatuses = new Set(['none', 'visited', 'wishlist', 'lived', 'skipped']);
  const userPlaces: UserPlace[] = data.userPlaces.map((p: any) => {
    if (!p || typeof p.placeId !== 'string' || !validStatuses.has(p.status)) {
      throw new Error('Backup contains an invalid place entry.');
    }
    return {
      placeId: p.placeId,
      status: p.status,
      firstVisitedYear: typeof p.firstVisitedYear === 'number' ? p.firstVisitedYear : null,
      notes: typeof p.notes === 'string' ? p.notes : null,
      isFavorite: Boolean(p.isFavorite),
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
      deletedAt: typeof p.deletedAt === 'string' ? p.deletedAt : null,
    };
  });

  const yearCollections: YearCollection[] = data.yearCollections.map((c: any) => {
    if (!c || typeof c.id !== 'string' || typeof c.year !== 'number') {
      throw new Error('Backup contains an invalid year collection.');
    }
    return {
      id: c.id,
      year: c.year,
      title: typeof c.title === 'string' ? c.title : `${c.year}`,
      collectionType: c.collectionType === 'planned' ? 'planned' : 'visited',
      updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : new Date().toISOString(),
      deletedAt: typeof c.deletedAt === 'string' ? c.deletedAt : null,
    };
  });

  const collectionItems: CollectionItem[] = data.collectionItems.map((i: any) => {
    if (!i || typeof i.id !== 'string' || typeof i.collectionId !== 'string' || typeof i.placeId !== 'string') {
      throw new Error('Backup contains an invalid collection item.');
    }
    return {
      id: i.id,
      collectionId: i.collectionId,
      placeId: i.placeId,
      visitMonth: typeof i.visitMonth === 'number' ? i.visitMonth : null,
      notes: typeof i.notes === 'string' ? i.notes : null,
      updatedAt: typeof i.updatedAt === 'string' ? i.updatedAt : new Date().toISOString(),
      deletedAt: typeof i.deletedAt === 'string' ? i.deletedAt : null,
    };
  });

  const travelGoals: TravelGoal[] = data.travelGoals.map((g: any) => {
    if (!g || typeof g.id !== 'string' || typeof g.targetCount !== 'number' || typeof g.targetYear !== 'number') {
      throw new Error('Backup contains an invalid travel goal.');
    }
    return {
      id: g.id,
      title: typeof g.title === 'string' ? g.title : 'Travel Goal',
      targetCount: g.targetCount,
      targetYear: g.targetYear,
      scope: g.scope === 'continent' || g.scope === 'uk_nations' ? g.scope : 'world',
      scopeValue: typeof g.scopeValue === 'string' ? g.scopeValue : null,
      updatedAt: typeof g.updatedAt === 'string' ? g.updatedAt : new Date().toISOString(),
      deletedAt: typeof g.deletedAt === 'string' ? g.deletedAt : null,
    };
  });

  const rawProfile = (data.userProfile ?? {}) as Partial<UserProfile>;
  const defaults = createDefaultProfile();
  const userProfile: UserProfile = {
    ...defaults,
    ...rawProfile,
    id: 'local',
    countingMode: rawProfile.countingMode === 'un_strict' ? 'un_strict' : 'uk_split_un',
    includeTerritories: Boolean(rawProfile.includeTerritories),
    mapTheme:
      rawProfile.mapTheme === 'parchment' || rawProfile.mapTheme === 'ocean'
        ? rawProfile.mapTheme
        : 'midnight',
    defaultProjection: '2d',
  };

  const backup: BeanBackupV1 = {
    schemaVersion: 1,
    app: 'bean',
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    data: {
      userPlaces,
      yearCollections,
      collectionItems,
      travelGoals,
      userProfile,
    },
  };

  const activePlaces = userPlaces.filter((p) => !p.deletedAt);
  return {
    exportedAt: backup.exportedAt,
    visitedCount: activePlaces.filter((p) => p.status === 'visited' || p.status === 'lived').length,
    wishlistCount: activePlaces.filter((p) => p.status === 'wishlist').length,
    collectionsCount: yearCollections.filter((c) => !c.deletedAt).length,
    goalsCount: travelGoals.filter((g) => !g.deletedAt).length,
    backup,
  };
}

function lwwMergeByKey<T extends { updatedAt: string }>(
  localItems: T[],
  incomingItems: T[],
  getKey: (item: T) => string
): T[] {
  const map = new Map<string, T>();
  for (const item of localItems) {
    map.set(getKey(item), item);
  }
  for (const inc of incomingItems) {
    const key = getKey(inc);
    const existing = map.get(key);
    if (!existing || inc.updatedAt >= existing.updatedAt) {
      map.set(key, inc);
    }
  }
  return [...map.values()];
}

/**
 * Last-Write-Wins merge of local state with an imported backup using `updatedAt` timestamps.
 */
export function mergeBackupWithLocal(
  local: HydratedState,
  incoming: BeanBackupV1
): BeanBackupV1['data'] {
  const userPlaces = lwwMergeByKey(
    Object.values(local.userPlaces),
    incoming.data.userPlaces,
    (p) => p.placeId
  );

  const yearCollections = lwwMergeByKey(
    local.yearCollections,
    incoming.data.yearCollections,
    (c) => c.id
  );

  const collectionItems = lwwMergeByKey(
    local.collectionItems,
    incoming.data.collectionItems,
    (i) => i.id
  );

  const travelGoals = lwwMergeByKey(
    local.travelGoals,
    incoming.data.travelGoals,
    (g) => g.id
  );

  const userProfile =
    incoming.data.userProfile.updatedAt >= local.userProfile.updatedAt
      ? incoming.data.userProfile
      : local.userProfile;

  return {
    userPlaces,
    yearCollections,
    collectionItems,
    travelGoals,
    userProfile,
  };
}
