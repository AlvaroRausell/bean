import * as SQLite from 'expo-sqlite';
import {
  CollectionItem,
  CollectionType,
  PlaceStatus,
  TravelGoal,
  UserPlace,
  UserProfile,
  YearCollection,
} from '@/types';

export function createDefaultProfile(now = new Date().toISOString()): UserProfile {
  return {
    id: 'local',
    birthYear: null,
    homePlaceId: null,
    countingMode: 'uk_split_un',
    includeTerritories: false,
    mapTheme: 'parchment',
    defaultProjection: '2d',
    lastBackupAt: null,
    updatedAt: now,
  };
}

export interface HydratedState {
  userPlaces: Record<string, UserPlace>;
  yearCollections: YearCollection[];
  collectionItems: CollectionItem[];
  travelGoals: TravelGoal[];
  userProfile: UserProfile;
}

export async function loadAllState(db: SQLite.SQLiteDatabase): Promise<HydratedState> {
  const placeRows = await db.getAllAsync<{
    place_id: string;
    status: PlaceStatus;
    first_visited_year: number | null;
    notes: string | null;
    is_favorite: number | null;
    updated_at: string;
    deleted_at: string | null;
  }>('SELECT * FROM user_places WHERE deleted_at IS NULL');

  const userPlaces: Record<string, UserPlace> = {};
  for (const r of placeRows) {
    userPlaces[r.place_id] = {
      placeId: r.place_id,
      status: r.status,
      firstVisitedYear: r.first_visited_year,
      notes: r.notes,
      isFavorite: r.is_favorite === 1,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    };
  }

  const colRows = await db.getAllAsync<{
    id: string;
    year: number;
    title: string;
    collection_type: CollectionType;
    updated_at: string;
    deleted_at: string | null;
  }>('SELECT * FROM year_collections WHERE deleted_at IS NULL ORDER BY year DESC, title ASC');

  const yearCollections: YearCollection[] = colRows.map((r) => ({
    id: r.id,
    year: r.year,
    title: r.title,
    collectionType: r.collection_type,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }));

  const itemRows = await db.getAllAsync<{
    id: string;
    collection_id: string;
    place_id: string;
    visit_month: number | null;
    notes: string | null;
    updated_at: string;
    deleted_at: string | null;
  }>('SELECT * FROM collection_items WHERE deleted_at IS NULL');

  const collectionItems: CollectionItem[] = itemRows.map((r) => ({
    id: r.id,
    collectionId: r.collection_id,
    placeId: r.place_id,
    visitMonth: r.visit_month,
    notes: r.notes,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }));

  const goalRows = await db.getAllAsync<{
    id: string;
    title: string;
    target_count: number;
    target_year: number;
    scope: TravelGoal['scope'];
    scope_value: string | null;
    updated_at: string;
    deleted_at: string | null;
  }>('SELECT * FROM travel_goals WHERE deleted_at IS NULL ORDER BY target_year ASC');

  const travelGoals: TravelGoal[] = goalRows.map((r) => ({
    id: r.id,
    title: r.title,
    targetCount: r.target_count,
    targetYear: r.target_year,
    scope: r.scope,
    scopeValue: r.scope_value,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }));

  const profileRow = await db.getFirstAsync<{
    id: string;
    birth_year: number | null;
    home_place_id: string | null;
    counting_mode: UserProfile['countingMode'];
    include_territories: number;
    map_theme: UserProfile['mapTheme'];
    default_projection: UserProfile['defaultProjection'];
    last_backup_at: string | null;
    updated_at: string;
  }>("SELECT * FROM user_profile WHERE id = 'local'");

  let userProfile: UserProfile;
  if (profileRow) {
    userProfile = {
      id: profileRow.id,
      birthYear: profileRow.birth_year,
      homePlaceId: profileRow.home_place_id,
      countingMode: profileRow.counting_mode,
      includeTerritories: profileRow.include_territories === 1,
      mapTheme: profileRow.map_theme,
      defaultProjection: profileRow.default_projection,
      lastBackupAt: profileRow.last_backup_at,
      updatedAt: profileRow.updated_at,
    };
  } else {
    userProfile = createDefaultProfile();
    await upsertUserProfile(db, userProfile);
  }

  return {
    userPlaces,
    yearCollections,
    collectionItems,
    travelGoals,
    userProfile,
  };
}

export async function upsertUserPlace(
  db: SQLite.SQLiteDatabase,
  place: UserPlace
): Promise<void> {
  await db.runAsync(
    `INSERT INTO user_places (place_id, status, first_visited_year, notes, is_favorite, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(place_id) DO UPDATE SET
       status = excluded.status,
       first_visited_year = excluded.first_visited_year,
       notes = excluded.notes,
       is_favorite = excluded.is_favorite,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
    [
      place.placeId,
      place.status,
      place.firstVisitedYear,
      place.notes,
      place.isFavorite ? 1 : 0,
      place.updatedAt,
      place.deletedAt,
    ]
  );
}

export async function bulkUpsertUserPlaces(
  db: SQLite.SQLiteDatabase,
  places: UserPlace[]
): Promise<void> {
  if (places.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const p of places) {
      await upsertUserPlace(db, p);
    }
  });
}

export async function upsertYearCollection(
  db: SQLite.SQLiteDatabase,
  col: YearCollection
): Promise<void> {
  await db.runAsync(
    `INSERT INTO year_collections (id, year, title, collection_type, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       year = excluded.year,
       title = excluded.title,
       collection_type = excluded.collection_type,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
    [col.id, col.year, col.title, col.collectionType, col.updatedAt, col.deletedAt]
  );
}

export async function upsertCollectionItem(
  db: SQLite.SQLiteDatabase,
  item: CollectionItem
): Promise<void> {
  await db.runAsync(
    `INSERT INTO collection_items (id, collection_id, place_id, visit_month, notes, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       collection_id = excluded.collection_id,
       place_id = excluded.place_id,
       visit_month = excluded.visit_month,
       notes = excluded.notes,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
    [
      item.id,
      item.collectionId,
      item.placeId,
      item.visitMonth,
      item.notes,
      item.updatedAt,
      item.deletedAt,
    ]
  );
}

export async function upsertTravelGoal(
  db: SQLite.SQLiteDatabase,
  goal: TravelGoal
): Promise<void> {
  await db.runAsync(
    `INSERT INTO travel_goals (id, title, target_count, target_year, scope, scope_value, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       target_count = excluded.target_count,
       target_year = excluded.target_year,
       scope = excluded.scope,
       scope_value = excluded.scope_value,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
    [
      goal.id,
      goal.title,
      goal.targetCount,
      goal.targetYear,
      goal.scope,
      goal.scopeValue,
      goal.updatedAt,
      goal.deletedAt,
    ]
  );
}

export async function upsertUserProfile(
  db: SQLite.SQLiteDatabase,
  profile: UserProfile
): Promise<void> {
  await db.runAsync(
    `INSERT INTO user_profile (
       id, birth_year, home_place_id, counting_mode, include_territories,
       map_theme, default_projection, last_backup_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       birth_year = excluded.birth_year,
       home_place_id = excluded.home_place_id,
       counting_mode = excluded.counting_mode,
       include_territories = excluded.include_territories,
       map_theme = excluded.map_theme,
       default_projection = excluded.default_projection,
       last_backup_at = excluded.last_backup_at,
       updated_at = excluded.updated_at`,
    [
      profile.id,
      profile.birthYear,
      profile.homePlaceId,
      profile.countingMode,
      profile.includeTerritories ? 1 : 0,
      profile.mapTheme,
      profile.defaultProjection,
      profile.lastBackupAt,
      profile.updatedAt,
    ]
  );
}

export async function replaceAllDataTransaction(
  db: SQLite.SQLiteDatabase,
  payload: {
    userPlaces: UserPlace[];
    yearCollections: YearCollection[];
    collectionItems: CollectionItem[];
    travelGoals: TravelGoal[];
    userProfile: UserProfile;
  }
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      DELETE FROM collection_items;
      DELETE FROM year_collections;
      DELETE FROM user_places;
      DELETE FROM travel_goals;
      DELETE FROM user_profile;
    `);
    for (const p of payload.userPlaces) {
      await upsertUserPlace(db, p);
    }
    for (const c of payload.yearCollections) {
      await upsertYearCollection(db, c);
    }
    for (const item of payload.collectionItems) {
      await upsertCollectionItem(db, item);
    }
    for (const g of payload.travelGoals) {
      await upsertTravelGoal(db, g);
    }
    await upsertUserProfile(db, payload.userProfile);
  });
}
