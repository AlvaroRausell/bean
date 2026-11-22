import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import {
  BeanBackupV1,
  CollectionItem,
  CollectionType,
  MapOverlayMode,
  PlaceStatus,
  TravelGoal,
  UserPlace,
  UserProfile,
  YearCollection,
} from '@/types';
import { getDatabase } from '@/db/schema';
import {
  bulkUpsertUserPlaces,
  createDefaultProfile,
  loadAllState,
  replaceAllDataTransaction,
  upsertCollectionItem,
  upsertTravelGoal,
  upsertUserPlace,
  upsertUserProfile,
  upsertYearCollection,
} from '@/db/repositories';
import { PLACE_BY_ID, PLACES_CATALOG } from '@/data/places';
import {
  BulkWishlistScope,
  computeBulkWishlistExcept,
} from '@/domain/wishlistOps';
import { mergeBackupWithLocal } from '@/sync/backupService';

export interface CameraRequest {
  id: number;
  type: 'bbox' | 'place' | 'reset';
  bbox?: [number, number, number, number];
  placeId?: string;
  withBottomSheetInset?: boolean;
}

export interface InkEvent {
  id: number;
  placeId: string;
  status: 'visited' | 'wishlist' | 'lived' | 'skipped';
  mapX?: number;
  mapY?: number;
}

export type UndoBanner =
  | {
      kind: 'places';
      message: string;
      previousPlaces: UserPlace[];
    }
  | {
      kind: 'goal';
      message: string;
      deletedGoal: TravelGoal;
    }
  | {
      kind: 'collection';
      message: string;
      deletedCollection: YearCollection;
      deletedItems: CollectionItem[];
    };

interface TravelStore {
  hydrated: boolean;
  userPlaces: Record<string, UserPlace>;
  yearCollections: YearCollection[];
  collectionItems: CollectionItem[];
  travelGoals: TravelGoal[];
  userProfile: UserProfile;

  // Map & UI state
  overlayMode: MapOverlayMode;
  activeYearCollectionId: string | null;
  selectedPlaceId: string | null;
  cameraRequest: CameraRequest | null;
  lastInkEvent: InkEvent | null;
  undoBanner: UndoBanner | null;
  planSubTab: 'goals' | 'wishlist' | 'years';
  selectExceptModalOpen: boolean;
  searchModalOpen: boolean;
  recentSearchIds: string[];
  sheetHeight: number;
  lastTapMapPoint: { placeId: string; mapX: number; mapY: number } | null;

  // Actions
  hydrate: () => Promise<void>;
  setOverlayMode: (mode: MapOverlayMode, yearCollectionId?: string | null) => void;
  setPlanSubTab: (tab: 'goals' | 'wishlist' | 'years') => void;
  setSelectExceptModalOpen: (open: boolean) => void;
  setSearchModalOpen: (open: boolean) => void;
  setSheetHeight: (height: number) => void;
  recordRecentSearch: (placeId: string) => void;
  selectPlace: (
    placeId: string | null,
    focusCamera?: boolean,
    tapPoint?: { mapX: number; mapY: number }
  ) => void;
  requestCameraBbox: (bbox: [number, number, number, number]) => void;
  requestCameraReset: () => void;

  setPlaceStatus: (
    placeId: string,
    status: PlaceStatus,
    firstVisitedYear?: number | null,
    options?: { silentInk?: boolean; withUndo?: boolean }
  ) => Promise<void>;
  togglePlaceFavorite: (placeId: string) => Promise<boolean>;
  setPlaceNotes: (placeId: string, notes: string) => Promise<void>;
  addPlaceToYear: (placeId: string, year: number) => Promise<void>;
  removePlaceFromYear: (placeId: string, year: number) => Promise<void>;
  bulkAddWishlistExcept: (
    excludedIds: Set<string>,
    scope: BulkWishlistScope
  ) => Promise<number>;
  undoLastBulkAction: () => Promise<void>;
  dismissUndoBanner: () => void;

  createYearCollection: (
    year: number,
    title: string,
    collectionType: CollectionType
  ) => Promise<YearCollection>;
  deleteYearCollection: (id: string) => Promise<void>;
  togglePlaceInCollection: (collectionId: string, placeId: string) => Promise<void>;

  createGoal: (input: {
    title: string;
    targetCount: number;
    targetYear: number;
    scope: TravelGoal['scope'];
    scopeValue?: string | null;
  }) => Promise<TravelGoal>;
  deleteGoal: (id: string) => Promise<void>;

  updateProfile: (partial: Partial<UserProfile>) => Promise<void>;
  importBackup: (backup: BeanBackupV1, mode: 'merge' | 'replace') => Promise<void>;
  markBackupExported: () => Promise<void>;
}

let cameraReqCounter = 1;
let inkCounter = 1;

export const useTravelStore = create<TravelStore>((set, get) => ({
  hydrated: false,
  userPlaces: {},
  yearCollections: [],
  collectionItems: [],
  travelGoals: [],
  userProfile: createDefaultProfile(),

  overlayMode: 'all',
  activeYearCollectionId: null,
  selectedPlaceId: null,
  cameraRequest: null,
  lastInkEvent: null,
  undoBanner: null,
  planSubTab: 'goals',
  selectExceptModalOpen: false,
  searchModalOpen: false,
  recentSearchIds: [],
  sheetHeight: 380,
  lastTapMapPoint: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const db = await getDatabase();
    const loaded = await loadAllState(db);
    set((current) => ({
      hydrated: true,
      userPlaces: { ...loaded.userPlaces, ...current.userPlaces },
      yearCollections:
        current.yearCollections.length > 0
          ? current.yearCollections
          : loaded.yearCollections,
      collectionItems:
        current.collectionItems.length > 0
          ? current.collectionItems
          : loaded.collectionItems,
      travelGoals:
        current.travelGoals.length > 0 ? current.travelGoals : loaded.travelGoals,
      userProfile: loaded.userProfile,
    }));
  },

  setPlanSubTab: (tab) => set({ planSubTab: tab }),
  setSelectExceptModalOpen: (open) => set({ selectExceptModalOpen: open }),
  setSearchModalOpen: (open) => set({ searchModalOpen: open }),
  setSheetHeight: (height) => {
    if (Math.abs(get().sheetHeight - height) > 4) {
      set({ sheetHeight: height });
    }
  },

  recordRecentSearch: (placeId) =>
    set((s) => ({
      recentSearchIds: [placeId, ...s.recentSearchIds.filter((id) => id !== placeId)].slice(
        0,
        6
      ),
    })),

  setOverlayMode: (mode, yearCollectionId = null) =>
    set({
      overlayMode: mode,
      activeYearCollectionId: mode === 'year' ? yearCollectionId : null,
    }),

  selectPlace: (placeId, focusCamera = true, tapPoint) => {
    set({
      selectedPlaceId: placeId,
      lastTapMapPoint:
        placeId && tapPoint ? { placeId, mapX: tapPoint.mapX, mapY: tapPoint.mapY } : null,
      cameraRequest:
        placeId && focusCamera
          ? {
              id: ++cameraReqCounter,
              type: 'place',
              placeId,
              withBottomSheetInset: true,
            }
          : get().cameraRequest,
    });
  },

  requestCameraBbox: (bbox) =>
    set({
      cameraRequest: {
        id: ++cameraReqCounter,
        type: 'bbox',
        bbox,
        withBottomSheetInset: false,
      },
    }),

  requestCameraReset: () =>
    set({
      cameraRequest: {
        id: ++cameraReqCounter,
        type: 'reset',
      },
    }),

  setPlaceStatus: async (placeId, status, firstVisitedYear, options) => {
    const now = new Date().toISOString();
    const existing = get().userPlaces[placeId];
    const resolvedYear =
      firstVisitedYear !== undefined
        ? firstVisitedYear
        : status === 'visited' || status === 'lived'
        ? existing?.firstVisitedYear ?? new Date().getFullYear()
        : existing?.firstVisitedYear ?? null;

    const updated: UserPlace = {
      placeId,
      status,
      firstVisitedYear: resolvedYear,
      notes: existing?.notes ?? null,
      isFavorite: Boolean(existing?.isFavorite),
      updatedAt: now,
      deletedAt: null,
    };

    const prevStatus = existing?.status ?? 'none';
    const tapPt = get().lastTapMapPoint;
    const shouldInk =
      !options?.silentInk &&
      (status === 'visited' ||
        status === 'wishlist' ||
        status === 'lived' ||
        status === 'skipped') &&
      prevStatus !== status;

    const placeName = PLACE_BY_ID[placeId]?.name ?? 'Place';
    const previousSnapshot: UserPlace = existing
      ? { ...existing }
      : {
          placeId,
          status: 'none',
          firstVisitedYear: null,
          notes: null,
          updatedAt: now,
          deletedAt: null,
        };

    set((s) => ({
      userPlaces: { ...s.userPlaces, [placeId]: updated },
      lastInkEvent: shouldInk
        ? {
            id: ++inkCounter,
            placeId,
            status,
            mapX: tapPt?.placeId === placeId ? tapPt.mapX : undefined,
            mapY: tapPt?.placeId === placeId ? tapPt.mapY : undefined,
          }
        : s.lastInkEvent,
      undoBanner: options?.withUndo
        ? {
            kind: 'places',
            message:
              status === 'none'
                ? `Removed ${placeName}`
                : status === 'visited'
                ? `Marked ${placeName} as been`
                : status === 'skipped'
                ? `Marked ${placeName} as not for me`
                : `Updated ${placeName}`,
            previousPlaces: [previousSnapshot],
          }
        : s.undoBanner,
    }));

    const db = await getDatabase();
    await upsertUserPlace(db, updated);
  },

  togglePlaceFavorite: async (placeId) => {
    const now = new Date().toISOString();
    const existing = get().userPlaces[placeId];
    const nextFav = !existing?.isFavorite;
    const updated: UserPlace = {
      placeId,
      status: existing?.status ?? 'none',
      firstVisitedYear: existing?.firstVisitedYear ?? null,
      notes: existing?.notes ?? null,
      isFavorite: nextFav,
      updatedAt: now,
      deletedAt: null,
    };

    set((s) => ({
      userPlaces: { ...s.userPlaces, [placeId]: updated },
    }));

    const db = await getDatabase();
    await upsertUserPlace(db, updated);
    return nextFav;
  },

  setPlaceNotes: async (placeId, notes) => {
    const now = new Date().toISOString();
    const existing = get().userPlaces[placeId];
    const updated: UserPlace = {
      placeId,
      status: existing?.status ?? 'none',
      firstVisitedYear: existing?.firstVisitedYear ?? null,
      notes: notes.trim() ? notes : null,
      isFavorite: Boolean(existing?.isFavorite),
      updatedAt: now,
      deletedAt: null,
    };

    set((s) => ({
      userPlaces: { ...s.userPlaces, [placeId]: updated },
    }));

    const db = await getDatabase();
    await upsertUserPlace(db, updated);
  },

  addPlaceToYear: async (placeId, year) => {
    const currentYear = new Date().getFullYear();
    const desiredType: CollectionType = year > currentYear ? 'planned' : 'visited';
    let targetCol = get().yearCollections.find(
      (c) => !c.deletedAt && c.year === year && c.collectionType === desiredType
    );
    if (!targetCol) {
      targetCol = get().yearCollections.find((c) => !c.deletedAt && c.year === year);
    }
    if (!targetCol) {
      targetCol = await get().createYearCollection(
        year,
        `${year}`,
        desiredType
      );
    }
    const alreadyMember = get().collectionItems.some(
      (i) => i.collectionId === targetCol!.id && i.placeId === placeId && !i.deletedAt
    );
    if (!alreadyMember) {
      await get().togglePlaceInCollection(targetCol.id, placeId);
    }
  },

  removePlaceFromYear: async (placeId, year) => {
    const matchingCols = get().yearCollections.filter(
      (c) => !c.deletedAt && c.year === year
    );
    for (const col of matchingCols) {
      const exists = get().collectionItems.some(
        (i) => i.collectionId === col.id && i.placeId === placeId && !i.deletedAt
      );
      if (exists) {
        await get().togglePlaceInCollection(col.id, placeId);
      }
    }

    // Recompute earliest visited year from remaining visited collections
    const remainingColIds = new Set(
      get()
        .collectionItems.filter((i) => i.placeId === placeId && !i.deletedAt)
        .map((i) => i.collectionId)
    );
    const remainingVisitedYears = get()
      .yearCollections.filter(
        (c) => !c.deletedAt && c.collectionType === 'visited' && remainingColIds.has(c.id)
      )
      .map((c) => c.year);

    const existing = get().userPlaces[placeId];
    if (existing && existing.firstVisitedYear === year) {
      const nextEarliest =
        remainingVisitedYears.length > 0 ? Math.min(...remainingVisitedYears) : null;
      await get().setPlaceStatus(placeId, existing.status, nextEarliest, {
        silentInk: true,
      });
    }
  },

  bulkAddWishlistExcept: async (excludedIds, scope) => {
    const { updates, previousSnapshot, addedCount } = computeBulkWishlistExcept(
      PLACES_CATALOG,
      get().userPlaces,
      excludedIds,
      scope
    );
    if (addedCount === 0) return 0;

    set((s) => {
      const next = { ...s.userPlaces };
      for (const u of updates) {
        next[u.placeId] = u;
      }
      return {
        userPlaces: next,
        undoBanner: {
          kind: 'places',
          message: `Added ${addedCount} ${addedCount === 1 ? 'place' : 'places'} to Want to go`,
          previousPlaces: previousSnapshot,
        },
      };
    });

    const db = await getDatabase();
    await bulkUpsertUserPlaces(db, updates);
    return addedCount;
  },

  undoLastBulkAction: async () => {
    const banner = get().undoBanner;
    if (!banner) return;
    const now = new Date().toISOString();
    const db = await getDatabase();

    if (banner.kind === 'places') {
      const restored = banner.previousPlaces.map((p) => ({
        ...p,
        updatedAt: now,
      }));
      set((s) => {
        const next = { ...s.userPlaces };
        for (const p of restored) {
          next[p.placeId] = p;
        }
        return { userPlaces: next, undoBanner: null };
      });
      await bulkUpsertUserPlaces(db, restored);
      return;
    }

    if (banner.kind === 'goal') {
      const restoredGoal: TravelGoal = {
        ...banner.deletedGoal,
        updatedAt: now,
        deletedAt: null,
      };
      set((s) => ({
        travelGoals: [...s.travelGoals, restoredGoal].sort(
          (a, b) => a.targetYear - b.targetYear
        ),
        undoBanner: null,
      }));
      await upsertTravelGoal(db, restoredGoal);
      return;
    }

    if (banner.kind === 'collection') {
      const restoredCol: YearCollection = {
        ...banner.deletedCollection,
        updatedAt: now,
        deletedAt: null,
      };
      const restoredItems = banner.deletedItems.map((i) => ({
        ...i,
        updatedAt: now,
        deletedAt: null,
      }));
      set((s) => ({
        yearCollections: [...s.yearCollections, restoredCol].sort(
          (a, b) => b.year - a.year
        ),
        collectionItems: [...s.collectionItems, ...restoredItems],
        undoBanner: null,
      }));
      await upsertYearCollection(db, restoredCol);
      for (const item of restoredItems) {
        await upsertCollectionItem(db, item);
      }
    }
  },

  dismissUndoBanner: () => set({ undoBanner: null }),

  createYearCollection: async (year, title, collectionType) => {
    const now = new Date().toISOString();
    const col: YearCollection = {
      id: Crypto.randomUUID(),
      year,
      title: title.trim() || `${year}`,
      collectionType,
      updatedAt: now,
      deletedAt: null,
    };

    set((s) => ({
      yearCollections: [col, ...s.yearCollections].sort((a, b) => b.year - a.year),
    }));

    const db = await getDatabase();
    await upsertYearCollection(db, col);
    return col;
  },

  deleteYearCollection: async (id) => {
    const now = new Date().toISOString();
    const target = get().yearCollections.find((c) => c.id === id);
    if (!target) return;
    const targetItems = get().collectionItems.filter(
      (i) => i.collectionId === id && !i.deletedAt
    );

    const tombstoned: YearCollection = {
      ...target,
      updatedAt: now,
      deletedAt: now,
    };

    set((s) => ({
      yearCollections: s.yearCollections.filter((c) => c.id !== id),
      collectionItems: s.collectionItems.filter((i) => i.collectionId !== id),
      activeYearCollectionId:
        s.activeYearCollectionId === id ? null : s.activeYearCollectionId,
      overlayMode: s.activeYearCollectionId === id ? 'all' : s.overlayMode,
      undoBanner: {
        kind: 'collection',
        message: `Removed ${target.title}`,
        deletedCollection: target,
        deletedItems: targetItems,
      },
    }));

    const db = await getDatabase();
    await upsertYearCollection(db, tombstoned);
  },

  togglePlaceInCollection: async (collectionId, placeId) => {
    const now = new Date().toISOString();
    const col = get().yearCollections.find((c) => c.id === collectionId);
    if (!col) return;

    const existing = get().collectionItems.find(
      (i) => i.collectionId === collectionId && i.placeId === placeId && !i.deletedAt
    );

    const db = await getDatabase();

    if (existing) {
      const removed: CollectionItem = {
        ...existing,
        updatedAt: now,
        deletedAt: now,
      };
      set((s) => ({
        collectionItems: s.collectionItems.filter((i) => i.id !== existing.id),
      }));
      await upsertCollectionItem(db, removed);
      return;
    }

    const newItem: CollectionItem = {
      id: Crypto.randomUUID(),
      collectionId,
      placeId,
      visitMonth: null,
      notes: null,
      updatedAt: now,
      deletedAt: null,
    };

    set((s) => ({
      collectionItems: [...s.collectionItems, newItem],
    }));
    await upsertCollectionItem(db, newItem);

    // Smart sync: adding a place to a 'visited' year collection ensures it's marked visited
    const currentPlace = get().userPlaces[placeId];
    if (col.collectionType === 'visited') {
      const earliestYear =
        currentPlace?.firstVisitedYear != null
          ? Math.min(currentPlace.firstVisitedYear, col.year)
          : col.year;
      if (
        !currentPlace ||
        (currentPlace.status !== 'visited' && currentPlace.status !== 'lived') ||
        currentPlace.firstVisitedYear !== earliestYear
      ) {
        await get().setPlaceStatus(
          placeId,
          currentPlace?.status === 'lived' ? 'lived' : 'visited',
          earliestYear
        );
      }
    } else if (
      col.collectionType === 'planned' &&
      (!currentPlace || currentPlace.status === 'none')
    ) {
      await get().setPlaceStatus(placeId, 'wishlist');
    }
  },

  createGoal: async ({ title, targetCount, targetYear, scope, scopeValue = null }) => {
    const now = new Date().toISOString();
    const goal: TravelGoal = {
      id: Crypto.randomUUID(),
      title: title.trim() || `${targetCount} countries by ${targetYear}`,
      targetCount,
      targetYear,
      scope,
      scopeValue,
      updatedAt: now,
      deletedAt: null,
    };

    set((s) => ({
      travelGoals: [...s.travelGoals, goal].sort((a, b) => a.targetYear - b.targetYear),
    }));

    const db = await getDatabase();
    await upsertTravelGoal(db, goal);
    return goal;
  },

  deleteGoal: async (id) => {
    const now = new Date().toISOString();
    const target = get().travelGoals.find((g) => g.id === id);
    if (!target) return;

    const tombstoned: TravelGoal = { ...target, updatedAt: now, deletedAt: now };
    set((s) => ({
      travelGoals: s.travelGoals.filter((g) => g.id !== id),
      undoBanner: {
        kind: 'goal',
        message: `Removed "${target.title}"`,
        deletedGoal: target,
      },
    }));

    const db = await getDatabase();
    await upsertTravelGoal(db, tombstoned);
  },

  updateProfile: async (partial) => {
    const now = new Date().toISOString();
    const updated: UserProfile = {
      ...get().userProfile,
      ...partial,
      id: 'local',
      updatedAt: now,
    };
    set({
      userProfile: updated,
    });
    const db = await getDatabase();
    await upsertUserProfile(db, updated);
  },

  importBackup: async (backup, mode) => {
    const state = get();
    const payload =
      mode === 'merge'
        ? mergeBackupWithLocal(
            {
              userPlaces: state.userPlaces,
              yearCollections: state.yearCollections,
              collectionItems: state.collectionItems,
              travelGoals: state.travelGoals,
              userProfile: state.userProfile,
            },
            backup
          )
        : backup.data;

    const db = await getDatabase();
    await replaceAllDataTransaction(db, payload);
    const reloaded = await loadAllState(db);
    set({
      ...reloaded,
      selectedPlaceId: null,
      activeYearCollectionId: null,
      overlayMode: 'all',
    });
  },

  markBackupExported: async () => {
    await get().updateProfile({ lastBackupAt: new Date().toISOString() });
  },
}));
