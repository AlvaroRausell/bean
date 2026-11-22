export type PlaceKind =
  | 'country'
  | 'constituent_country'
  | 'territory'
  | 'subdivision';

export type Continent =
  | 'Europe'
  | 'Asia'
  | 'Africa'
  | 'North America'
  | 'South America'
  | 'Oceania'
  | 'Antarctica';

export interface Place {
  id: string; // e.g. 'FR', 'GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR', 'PR'
  name: string;
  flag: string;
  kind: PlaceKind;
  parentId: string | null; // 'GB' for UK nations
  continent: Continent;
  isUnMember: boolean;
  centroid: [number, number]; // [lon, lat]
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  frameBbox: [number, number, number, number]; // main landmass bbox for smooth camera framing
  areaSr: number;
  isMicrostate: boolean;
  searchAliases?: string[];
}

export type PlaceStatus = 'none' | 'visited' | 'wishlist' | 'lived';

export interface UserPlace {
  placeId: string;
  status: PlaceStatus;
  firstVisitedYear: number | null;
  notes: string | null;
  isFavorite?: boolean;
  updatedAt: string; // ISO UTC
  deletedAt: string | null;
}

export type CollectionType = 'visited' | 'planned';

export interface YearCollection {
  id: string;
  year: number;
  title: string;
  collectionType: CollectionType;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CollectionItem {
  id: string;
  collectionId: string;
  placeId: string;
  visitMonth: number | null; // 1-12
  notes: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export type GoalScope = 'world' | 'continent' | 'uk_nations';

export interface TravelGoal {
  id: string;
  title: string;
  targetCount: number;
  targetYear: number;
  scope: GoalScope;
  scopeValue: string | null; // e.g. 'Europe' when scope === 'continent'
  updatedAt: string;
  deletedAt: string | null;
}

export type CountingMode = 'uk_split_un' | 'un_strict';
export type MapThemeId = 'midnight' | 'parchment' | 'ocean';
export type MapProjectionMode = '2d' | '3d';
export type MapOverlayMode = 'all' | 'visited' | 'wishlist' | 'favorites' | 'year';

export interface UserProfile {
  id: string;
  birthYear: number | null;
  homePlaceId: string | null;
  countingMode: CountingMode;
  includeTerritories: boolean;
  mapTheme: MapThemeId;
  defaultProjection: MapProjectionMode;
  lastBackupAt: string | null;
  updatedAt: string;
}

export interface BeanBackupV1 {
  schemaVersion: 1;
  app: 'bean';
  exportedAt: string;
  data: {
    userPlaces: UserPlace[];
    yearCollections: YearCollection[];
    collectionItems: CollectionItem[];
    travelGoals: TravelGoal[];
    userProfile: UserProfile;
  };
}
