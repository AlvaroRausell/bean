export interface CameraState {
  scale: number;
  tx: number;
  ty: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MapBounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_ZOOM_2D = 1.0;
export const MAX_ZOOM_2D = 24.0;
export const BASE_MAP_WIDTH = 1000;
export const BASE_MAP_HEIGHT = 520;

export interface RegionPreset {
  id: string;
  label: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

export const REGION_PRESETS: RegionPreset[] = [
  { id: 'world', label: 'World', bbox: [-170, -56, 178, 72] },
  { id: 'uk', label: 'UK', bbox: [-8.6, 49.8, 2.1, 60.9] },
  { id: 'europe', label: 'Europe', bbox: [-11, 35, 40, 70] },
  { id: 'asia', label: 'Asia', bbox: [42, -10, 148, 56] },
  { id: 'africa', label: 'Africa', bbox: [-18, -36, 52, 37] },
  { id: 'north_america', label: 'N. America', bbox: [-135, 12, -55, 65] },
  { id: 'south_america', label: 'S. America', bbox: [-83, -56, -34, 13] },
  { id: 'oceania', label: 'Oceania', bbox: [110, -48, 179, 0] },
  { id: 'caribbean', label: 'Caribbean', bbox: [-85, 10, -59, 27] },
];

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/**
 * Computes new camera state after zooming from `prev` to `nextScale`
 * while keeping screen focal point `(focalX, focalY)` pinned to the exact same map coordinate.
 */
export function zoomAroundFocalPoint(
  prev: CameraState,
  nextScaleRaw: number,
  focalX: number,
  focalY: number,
  minZoom = 1.0,
  maxZoom = 24.0
): CameraState {
  'worklet';
  const scale = clamp(nextScaleRaw, minZoom, maxZoom);
  const ratio = scale / prev.scale;
  const tx = focalX - (focalX - prev.tx) * ratio;
  const ty = focalY - (focalY - prev.ty) * ratio;
  return { scale, tx, ty };
}

/**
 * Clamps translation so the user can effortlessly pan every corner of the map
 * into the center of a portrait viewport without losing the map off-screen.
 */
export function clampCameraToBounds(
  camera: CameraState,
  viewport: ViewportSize,
  mapWidth = 1000,
  mapHeight = 520
): CameraState {
  'worklet';
  const scaledW = mapWidth * camera.scale;
  const scaledH = mapHeight * camera.scale;

  // Allow panning any edge up to ~60% across the screen for comfortable portrait ergonomics
  const marginX = viewport.width * 0.45;
  const marginY = viewport.height * 0.42;

  const minTx = viewport.width - scaledW - marginX;
  const maxTx = marginX;

  const minTy = viewport.height - scaledH - marginY;
  const maxTy = marginY;

  return {
    scale: camera.scale,
    tx: clamp(camera.tx, Math.min(minTx, maxTx), Math.max(minTx, maxTx)),
    ty: clamp(camera.ty, Math.min(minTy, maxTy), Math.max(minTy, maxTy)),
  };
}

/**
 * Computes the camera state `(scale, tx, ty)` that cleanly frames projected 2D map bounds
 * inside the unobstructed portrait viewport (respecting top HUD & optional open bottom sheet).
 */
export function fitProjectedBoundsToViewport(
  bounds: MapBounds2D,
  viewport: ViewportSize,
  insets: SafeInsets = { top: 90, bottom: 110, left: 16, right: 16 },
  paddingFactor = 0.86,
  minZoom = MIN_ZOOM_2D,
  maxZoom = MAX_ZOOM_2D
): CameraState {
  const usableW = Math.max(60, viewport.width - insets.left - insets.right);
  const usableH = Math.max(60, viewport.height - insets.top - insets.bottom);

  const boxW = Math.max(4, bounds.maxX - bounds.minX);
  const boxH = Math.max(4, bounds.maxY - bounds.minY);

  const scaleX = (usableW * paddingFactor) / boxW;
  const scaleY = (usableH * paddingFactor) / boxH;
  const scale = clamp(Math.min(scaleX, scaleY), minZoom, maxZoom);

  const boxCenterX = (bounds.minX + bounds.maxX) / 2;
  const boxCenterY = (bounds.minY + bounds.maxY) / 2;

  const targetCenterX = insets.left + usableW / 2;
  const targetCenterY = insets.top + usableH / 2;

  const tx = targetCenterX - boxCenterX * scale;
  const ty = targetCenterY - boxCenterY * scale;

  return clampCameraToBounds({ scale, tx, ty }, viewport);
}

/**
 * Converts a screen tap coordinate `(screenX, screenY)` into base map coordinates `(mapX, mapY)`.
 */
export function screenToMapPoint(
  screenX: number,
  screenY: number,
  camera: CameraState
): { x: number; y: number } {
  'worklet';
  return {
    x: (screenX - camera.tx) / camera.scale,
    y: (screenY - camera.ty) / camera.scale,
  };
}

/**
 * Dynamic country border stroke width that stays razor-sharp across 1x-24x zoom.
 */
export function computeAdaptiveStrokeWidth(scale: number, baseWidth = 0.9): number {
  'worklet';
  return clamp(baseWidth / Math.pow(Math.max(1, scale), 0.72), 0.14, 1.2);
}

/**
 * Initial portrait camera: instead of squishing the world into a tiny ribbon,
 * starts at a comfortable navigable portrait zoom centered over Europe / Atlantic
 * (or user's home region) while remaining 1-tap away from full World view.
 */
export function computePortraitInitialCamera(
  viewport: ViewportSize,
  mapWidth = BASE_MAP_WIDTH,
  mapHeight = BASE_MAP_HEIGHT
): CameraState {
  const fitWidthScale = viewport.width / mapWidth;
  const fitHeightScale = viewport.height / mapHeight;
  // In portrait, fill full vertical viewport height so there are zero top/bottom dead ocean bands
  const isPortrait = viewport.height > viewport.width;
  const initialScale = clamp(
    isPortrait ? Math.max(fitHeightScale * 1.18, fitWidthScale * 2.55) : fitWidthScale * 1.08,
    MIN_ZOOM_2D,
    4.5
  );

  // Center comfortably over Europe / Atlantic / North Africa
  const focusX = mapWidth * 0.51;
  const focusY = mapHeight * 0.34;

  const tx = viewport.width / 2 - focusX * initialScale;
  const ty = viewport.height * 0.48 - focusY * initialScale;

  return clampCameraToBounds({ scale: initialScale, tx, ty }, viewport, mapWidth, mapHeight);
}
