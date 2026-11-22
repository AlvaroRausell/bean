import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Shader,
  Skia,
  Text as SkiaText,
  useFont,
  vec,
} from '@shopify/react-native-skia';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import * as d3Geo from 'd3-geo';
import * as Haptics from 'expo-haptics';
import { Globe2, Map as MapIcon, RotateCcw, Search, Star, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BASE_MAP_HEIGHT,
  BASE_MAP_WIDTH,
  CameraState,
  clamp,
  clampCameraToBounds,
  computeAdaptiveStrokeWidth,
  computePortraitInitialCamera,
  fitProjectedBoundsToViewport,
  MIN_ZOOM_2D,
  REGION_PRESETS,
  screenToMapPoint,
  zoomAroundFocalPoint,
} from '@/map/cameraMath';
import {
  buildHatchUniforms,
  getHatchRuntimeEffect,
  hexToColorVec4,
} from '@/map/cartography';
import {
  createGlobeProjection,
  getGeoEngine2D,
  getWorldFeatures,
  hitTest2D,
  hitTest3D,
  projectGeoBboxTo2D,
} from '@/map/geoEngine';
import { PLACE_BY_ID, PLACES_CATALOG } from '@/data/places';
import { computeWorldStats } from '@/domain/statsCalculator';
import { useTravelStore } from '@/store/useTravelStore';
import { MAP_THEMES } from '@/theme/mapThemes';
import { FONTS } from '@/theme/typography';
import { MapOverlayMode } from '@/types';

const LABEL_FONT_ASSET = require('@expo-google-fonts/encode-sans-semi-expanded/600SemiBold/EncodeSansSemiExpanded_600SemiBold.ttf');

// Crisp 5-point cartographic star centered at (0,0) with outer radius 6.5px
const STAR_MARKER_PATH =
  Skia.Path.MakeFromSVGString(
    'M 0 -6.5 L 1.68 -2.1 L 6.18 -2.0 L 2.6 0.85 L 3.82 5.25 L 0 2.65 L -3.82 5.25 L -2.6 0.85 L -6.18 -2.0 L -1.68 -2.1 Z'
  ) ?? Skia.Path.Make();

const LiveStarMarker2D = React.memo(function LiveStarMarker2D({
  mapX,
  mapY,
  scale,
  tx,
  ty,
  fillColor,
  haloColor,
}: {
  mapX: number;
  mapY: number;
  scale: ReturnType<typeof useSharedValue<number>>;
  tx: ReturnType<typeof useSharedValue<number>>;
  ty: ReturnType<typeof useSharedValue<number>>;
  fillColor: string;
  haloColor: string;
}) {
  const transform = useDerivedValue(() => [
    { translateX: mapX * scale.value + tx.value },
    { translateY: mapY * scale.value + ty.value - (scale.value >= 1.35 ? 13 : 0) },
  ]);
  return (
    <Group transform={transform}>
      <Path
        path={STAR_MARKER_PATH}
        color={haloColor}
        style="stroke"
        strokeWidth={2.2}
        strokeJoin="round"
      />
      <Path path={STAR_MARKER_PATH} color={fillColor} />
    </Group>
  );
});

interface Props {
  onOpenSearch: () => void;
}

interface LabelCandidate {
  id: string;
  name: string;
  mapX: number;
  mapY: number;
  textWidth: number;
  textColor: string;
  haloColor: string;
  opacity: number;
}

interface LiveSkiaLabelProps {
  label: LabelCandidate;
  font: NonNullable<ReturnType<typeof useFont>>;
  scale: ReturnType<typeof useSharedValue<number>>;
  tx: ReturnType<typeof useSharedValue<number>>;
  ty: ReturnType<typeof useSharedValue<number>>;
}

const LiveSkiaLabel = React.memo(function LiveSkiaLabel({
  label,
  font,
  scale,
  tx,
  ty,
}: LiveSkiaLabelProps) {
  const sx = useDerivedValue(() => label.mapX * scale.value + tx.value - label.textWidth / 2);
  const sy = useDerivedValue(() => label.mapY * scale.value + ty.value + 3.5);

  return (
    <Group opacity={label.opacity}>
      <SkiaText
        x={sx}
        y={sy}
        text={label.name}
        font={font}
        color={label.haloColor}
        style="stroke"
        strokeWidth={3}
        strokeJoin="round"
        strokeCap="round"
      />
      <SkiaText x={sx} y={sy} text={label.name} font={font} color={label.textColor} />
    </Group>
  );
});

export function WorldMapCanvas({ onOpenSearch }: Props) {
  const { width, height } = useWindowDimensions();
  const safeInsets = useSafeAreaInsets();

  const userPlaces = useTravelStore((s) => s.userPlaces);
  const yearCollections = useTravelStore((s) => s.yearCollections);
  const collectionItems = useTravelStore((s) => s.collectionItems);
  const userProfile = useTravelStore((s) => s.userProfile);
  const projectionMode = useTravelStore((s) => s.projectionMode);
  const setProjectionMode = useTravelStore((s) => s.setProjectionMode);
  const overlayMode = useTravelStore((s) => s.overlayMode);
  const setOverlayMode = useTravelStore((s) => s.setOverlayMode);
  const activeYearCollectionId = useTravelStore((s) => s.activeYearCollectionId);
  const selectedPlaceId = useTravelStore((s) => s.selectedPlaceId);
  const selectPlace = useTravelStore((s) => s.selectPlace);
  const cameraRequest = useTravelStore((s) => s.cameraRequest);
  const lastInkEvent = useTravelStore((s) => s.lastInkEvent);
  const sheetHeight = useTravelStore((s) => s.sheetHeight);

  const theme = MAP_THEMES[userProfile.mapTheme];
  const engine2D = useMemo(() => getGeoEngine2D(), []);
  const hatchEffect = useMemo(() => getHatchRuntimeEffect(), []);
  const labelFont = useFont(LABEL_FONT_ASSET, 10.5);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduceMotion(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const stats = useMemo(
    () =>
      computeWorldStats(
        PLACES_CATALOG,
        userPlaces,
        yearCollections,
        collectionItems,
        {
          countingMode: userProfile.countingMode,
          includeTerritories: userProfile.includeTerritories,
          homePlaceId: userProfile.homePlaceId,
        }
      ),
    [userPlaces, yearCollections, collectionItems, userProfile]
  );

  const activeYearCollection = useMemo(
    () => yearCollections.find((c) => c.id === activeYearCollectionId) ?? null,
    [yearCollections, activeYearCollectionId]
  );

  const activeYearPlaceIds = useMemo(() => {
    if (!activeYearCollectionId) return new Set<string>();
    return new Set(
      collectionItems
        .filter((i) => i.collectionId === activeYearCollectionId && !i.deletedAt)
        .map((i) => i.placeId)
    );
  }, [collectionItems, activeYearCollectionId]);

  // ---------- 2D Camera State (UI thread Reanimated SharedValues) ----------
  const initialCam = useMemo(() => {
    const base = computePortraitInitialCamera({ width, height });
    if (userProfile.homePlaceId) {
      const compiledHome = engine2D.placeById[userProfile.homePlaceId];
      if (compiledHome) {
        const focusX = compiledHome.projectedCentroid[0];
        const focusY = compiledHome.projectedCentroid[1];
        return clampCameraToBounds(
          {
            scale: base.scale,
            tx: width / 2 - focusX * base.scale,
            ty: height * 0.46 - focusY * base.scale,
          },
          { width, height }
        );
      }
    }
    return base;
  }, [width, height, userProfile.homePlaceId, engine2D]);

  const scale = useSharedValue(initialCam.scale);
  const tx = useSharedValue(initialCam.tx);
  const ty = useSharedValue(initialCam.ty);

  // Gesture scratch shared values
  const panStartTx = useSharedValue(0);
  const panStartTy = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const pinchStartTx = useSharedValue(0);
  const pinchStartTy = useSharedValue(0);
  const pinchStartFocalX = useSharedValue(0);
  const pinchStartFocalY = useSharedValue(0);

  // One-handed double-tap + drag zoom state
  const lastTapTs = useSharedValue(0);
  const lastTapX = useSharedValue(0);
  const lastTapY = useSharedValue(0);
  const oneFingerZoomActive = useSharedValue(false);
  const oneFingerStartScale = useSharedValue(1);
  const oneFingerStartTx = useSharedValue(0);
  const oneFingerStartTy = useSharedValue(0);

  const [settledCam, setSettledCam] = useState<CameraState>(initialCam);
  const hasUserMoved2DRef = useRef(false);

  // Keep initial camera & Recenter state synced when SQLite profile (homePlaceId) hydrates before user moves map
  useEffect(() => {
    if (hasUserMoved2DRef.current) return;
    scale.value = initialCam.scale;
    tx.value = initialCam.tx;
    ty.value = initialCam.ty;
    setSettledCam(initialCam);
  }, [initialCam, scale, tx, ty]);

  // ---------- Signature Skia Ink-Flood Animation ----------
  const [activeInk, setActiveInk] = useState<{
    id: number;
    placeId: string;
    status: 'visited' | 'wishlist' | 'lived';
    cx: number;
    cy: number;
    maxR: number;
  } | null>(null);
  const inkProgress = useSharedValue(1);

  useEffect(() => {
    if (!lastInkEvent || projectionMode !== '2d' || reduceMotion) {
      setActiveInk(null);
      return;
    }
    const compiled = engine2D.placeById[lastInkEvent.placeId];
    if (!compiled) return;
    const cx = lastInkEvent.mapX ?? compiled.projectedCentroid[0];
    const cy = lastInkEvent.mapY ?? compiled.projectedCentroid[1];
    const b = compiled.projectedBounds;
    const maxR =
      Math.max(
        Math.hypot(cx - b.minX, cy - b.minY),
        Math.hypot(cx - b.maxX, cy - b.minY),
        Math.hypot(cx - b.minX, cy - b.maxY),
        Math.hypot(cx - b.maxX, cy - b.maxY)
      ) + 4;

    setActiveInk({
      id: lastInkEvent.id,
      placeId: lastInkEvent.placeId,
      status: lastInkEvent.status,
      cx,
      cy,
      maxR,
    });
    inkProgress.value = 0;
    inkProgress.value = withTiming(
      1,
      { duration: 460, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(setActiveInk)(null);
        }
      }
    );
  }, [lastInkEvent, projectionMode, reduceMotion, engine2D, inkProgress]);

  const inkRadius = useDerivedValue(() =>
    activeInk ? activeInk.maxR * inkProgress.value : 0
  );

  // ---------- 3D Globe State (with release inertia) ----------
  const defaultGlobe = useMemo(() => {
    if (userProfile.homePlaceId && PLACE_BY_ID[userProfile.homePlaceId]) {
      const c = PLACE_BY_ID[userProfile.homePlaceId].centroid;
      return { lon: -c[0], lat: -clamp(c[1], -65, 65), scale: 1.05 };
    }
    return { lon: -10, lat: -40, scale: 1.05 };
  }, [userProfile.homePlaceId]);

  const [globeRot, setGlobeRot] = useState(defaultGlobe);
  const hasUserMoved3DRef = useRef(false);
  const globeStartRef = useRef(defaultGlobe);
  const globeVelRef = useRef({ vLon: 0, vLat: 0 });
  const globeRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (hasUserMoved3DRef.current) return;
    setGlobeRot(defaultGlobe);
  }, [defaultGlobe]);

  const stopGlobeInertia = useCallback(() => {
    if (globeRafRef.current != null) {
      cancelAnimationFrame(globeRafRef.current);
      globeRafRef.current = null;
    }
  }, []);

  useEffect(() => () => stopGlobeInertia(), [stopGlobeInertia]);

  const syncSettledCamera = useCallback((s: number, x: number, y: number) => {
    hasUserMoved2DRef.current = true;
    setSettledCam({ scale: s, tx: x, ty: y });
  }, []);

  const animate2DCameraTo = useCallback(
    (target: CameraState, explicitDuration?: number) => {
      cancelAnimation(scale);
      cancelAnimation(tx);
      cancelAnimation(ty);
      if (reduceMotion) {
        scale.value = target.scale;
        tx.value = target.tx;
        ty.value = target.ty;
        setSettledCam(target);
        return;
      }
      // Scale flight duration with camera distance so short hops feel crisp & long flights feel composed
      const distPx = Math.hypot(target.tx - tx.value, target.ty - ty.value);
      const scaleDiff = Math.abs(Math.log(Math.max(0.1, target.scale) / Math.max(0.1, scale.value)));
      const duration =
        explicitDuration ??
        Math.round(clamp(230 + distPx * 0.28 + scaleDiff * 110, 240, 540));

      const easing = Easing.out(Easing.cubic);
      scale.value = withTiming(target.scale, { duration, easing });
      tx.value = withTiming(target.tx, { duration, easing });
      ty.value = withTiming(target.ty, { duration, easing }, (finished) => {
        if (finished) {
          runOnJS(syncSettledCamera)(target.scale, target.tx, target.ty);
        }
      });
    },
    [scale, tx, ty, reduceMotion, syncSettledCamera]
  );

  // Has camera moved meaningfully away from default? Drives the single Recenter button!
  const cameraMoved = useMemo(() => {
    if (projectionMode === '3d') {
      return (
        Math.abs(globeRot.lon - defaultGlobe.lon) > 14 ||
        Math.abs(globeRot.lat - defaultGlobe.lat) > 14 ||
        Math.abs(globeRot.scale - defaultGlobe.scale) > 0.22
      );
    }
    return (
      Math.abs(settledCam.scale - initialCam.scale) > 0.25 ||
      Math.hypot(settledCam.tx - initialCam.tx, settledCam.ty - initialCam.ty) > 48
    );
  }, [projectionMode, globeRot, defaultGlobe, settledCam, initialCam]);

  const handleRecenter = useCallback(() => {
    Haptics.selectionAsync();
    if (projectionMode === '2d') {
      animate2DCameraTo(initialCam);
    } else {
      stopGlobeInertia();
      setGlobeRot(defaultGlobe);
    }
  }, [projectionMode, animate2DCameraTo, initialCam, stopGlobeInertia, defaultGlobe]);

  // Respond to external camera requests (Search, Record continent jump, Year view, Place sheet framing)
  useEffect(() => {
    if (!cameraRequest) return;

    if (cameraRequest.type === 'reset') {
      if (projectionMode === '2d') {
        animate2DCameraTo(initialCam);
      } else {
        stopGlobeInertia();
        setGlobeRot(defaultGlobe);
      }
      return;
    }

    if (cameraRequest.type === 'bbox' && cameraRequest.bbox) {
      if (projectionMode === '2d') {
        const projBounds = projectGeoBboxTo2D(cameraRequest.bbox, engine2D.projection);
        const target = fitProjectedBoundsToViewport(projBounds, { width, height }, {
          top: safeInsets.top + 92,
          bottom:
            safeInsets.bottom +
            (cameraRequest.withBottomSheetInset ? sheetHeight + 16 : 138),
          left: 16,
          right: 16,
        });
        animate2DCameraTo(target);
      } else {
        stopGlobeInertia();
        const [minLon, minLat, maxLon, maxLat] = cameraRequest.bbox;
        const midLon = (minLon + maxLon) / 2;
        const midLat = (minLat + maxLat) / 2;
        const span = Math.max(maxLon - minLon, maxLat - minLat);
        const z = clamp(120 / Math.max(15, span), 1.0, 5.5);
        setGlobeRot({ lon: -midLon, lat: -midLat, scale: z });
      }
      return;
    }

    if (cameraRequest.type === 'place' && cameraRequest.placeId) {
      const place = PLACE_BY_ID[cameraRequest.placeId];
      if (!place) return;
      if (projectionMode === '2d') {
        const compiled = engine2D.placeById[place.id];
        if (!compiled) return;
        const b = compiled.projectedBounds;
        const minPad = 14;
        const padded = {
          minX: b.minX - minPad,
          minY: b.minY - minPad,
          maxX: b.maxX + minPad,
          maxY: b.maxY + minPad,
        };
        const target = fitProjectedBoundsToViewport(
          padded,
          { width, height },
          {
            top: safeInsets.top + 88,
            bottom: cameraRequest.withBottomSheetInset
              ? Math.min(height * 0.62, sheetHeight + 16)
              : safeInsets.bottom + 138,
            left: 24,
            right: 24,
          },
          0.72,
          MIN_ZOOM_2D,
          14
        );
        animate2DCameraTo(target);
      } else {
        stopGlobeInertia();
        setGlobeRot((prev) => ({
          lon: -place.centroid[0],
          lat: -clamp(place.centroid[1], -70, 70),
          scale: Math.max(prev.scale, 1.85),
        }));
      }
    }
  }, [
    cameraRequest,
    projectionMode,
    engine2D,
    width,
    height,
    safeInsets,
    sheetHeight,
    initialCam,
    defaultGlobe,
    stopGlobeInertia,
    animate2DCameraTo,
  ]);

  // ---------- 2D Hit-Test Handler ----------
  const handleTap2D = useCallback(
    (mapX: number, mapY: number, currentScale: number) => {
      const hitId = hitTest2D(mapX, mapY, currentScale, userProfile.includeTerritories);
      if (hitId) {
        Haptics.selectionAsync();
        selectPlace(hitId, true, { mapX, mapY });
      } else if (selectedPlaceId) {
        selectPlace(null, false);
      }
    },
    [userProfile.includeTerritories, selectPlace, selectedPlaceId]
  );

  // ---------- 2D Gesture Suite (Portrait-First) ----------
  const pan2D = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .onBegin((e) => {
          cancelAnimation(tx);
          cancelAnimation(ty);
          cancelAnimation(scale);

          const now = Date.now();
          const dist = Math.hypot(e.x - lastTapX.value, e.y - lastTapY.value);
          if (now - lastTapTs.value < 340 && dist < 52) {
            oneFingerZoomActive.value = true;
            oneFingerStartScale.value = scale.value;
            oneFingerStartTx.value = tx.value;
            oneFingerStartTy.value = ty.value;
          } else {
            oneFingerZoomActive.value = false;
            panStartTx.value = tx.value;
            panStartTy.value = ty.value;
          }
        })
        .onUpdate((e) => {
          if (oneFingerZoomActive.value) {
            const factor = Math.exp(e.translationY * 0.0085);
            const nextCam = zoomAroundFocalPoint(
              {
                scale: oneFingerStartScale.value,
                tx: oneFingerStartTx.value,
                ty: oneFingerStartTy.value,
              },
              oneFingerStartScale.value * factor,
              lastTapX.value,
              lastTapY.value
            );
            const clamped = clampCameraToBounds(nextCam, { width, height });
            scale.value = clamped.scale;
            tx.value = clamped.tx;
            ty.value = clamped.ty;
            return;
          }

          const clamped = clampCameraToBounds(
            {
              scale: scale.value,
              tx: panStartTx.value + e.translationX,
              ty: panStartTy.value + e.translationY,
            },
            { width, height }
          );
          tx.value = clamped.tx;
          ty.value = clamped.ty;
        })
        .onEnd((e) => {
          if (oneFingerZoomActive.value) {
            oneFingerZoomActive.value = false;
            runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
            return;
          }

          const scaledW = 1000 * scale.value;
          const scaledH = 520 * scale.value;
          const marginX = width * 0.45;
          const marginY = height * 0.42;
          const minTx = Math.min(width - scaledW - marginX, marginX);
          const maxTx = Math.max(width - scaledW - marginX, marginX);
          const minTy = Math.min(height - scaledH - marginY, marginY);
          const maxTy = Math.max(height - scaledH - marginY, marginY);

          tx.value = withDecay({
            velocity: e.velocityX * 0.85,
            deceleration: 0.994,
            clamp: [minTx, maxTx],
          });
          ty.value = withDecay(
            {
              velocity: e.velocityY * 0.85,
              deceleration: 0.994,
              clamp: [minTy, maxTy],
            },
            () => {
              runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
            }
          );
        }),
    [
      width,
      height,
      tx,
      ty,
      scale,
      panStartTx,
      panStartTy,
      lastTapTs,
      lastTapX,
      lastTapY,
      oneFingerZoomActive,
      oneFingerStartScale,
      oneFingerStartTx,
      oneFingerStartTy,
      syncSettledCamera,
    ]
  );

  const pinch2D = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin((e) => {
          cancelAnimation(scale);
          cancelAnimation(tx);
          cancelAnimation(ty);
          pinchStartScale.value = scale.value;
          pinchStartTx.value = tx.value;
          pinchStartTy.value = ty.value;
          pinchStartFocalX.value = e.focalX;
          pinchStartFocalY.value = e.focalY;
        })
        .onUpdate((e) => {
          const panDeltaX = e.focalX - pinchStartFocalX.value;
          const panDeltaY = e.focalY - pinchStartFocalY.value;
          const zoomed = zoomAroundFocalPoint(
            {
              scale: pinchStartScale.value,
              tx: pinchStartTx.value + panDeltaX,
              ty: pinchStartTy.value + panDeltaY,
            },
            pinchStartScale.value * e.scale,
            e.focalX,
            e.focalY
          );
          const clamped = clampCameraToBounds(zoomed, { width, height });
          scale.value = clamped.scale;
          tx.value = clamped.tx;
          ty.value = clamped.ty;
        })
        .onEnd(() => {
          runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
        }),
    [
      width,
      height,
      scale,
      tx,
      ty,
      pinchStartScale,
      pinchStartTx,
      pinchStartTy,
      pinchStartFocalX,
      pinchStartFocalY,
      syncSettledCamera,
    ]
  );

  const doubleTap2D = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(280)
        .onEnd((e, success) => {
          if (!success || oneFingerZoomActive.value) return;
          const target = clampCameraToBounds(
            zoomAroundFocalPoint(
              { scale: scale.value, tx: tx.value, ty: ty.value },
              scale.value * 2.35,
              e.x,
              e.y
            ),
            { width, height }
          );
          const d = reduceMotion ? 0 : 250;
          scale.value = withTiming(target.scale, { duration: d });
          tx.value = withTiming(target.tx, { duration: d });
          ty.value = withTiming(target.ty, { duration: d }, () => {
            runOnJS(syncSettledCamera)(target.scale, target.tx, target.ty);
          });
        }),
    [width, height, scale, tx, ty, oneFingerZoomActive, reduceMotion, syncSettledCamera]
  );

  const singleTap2D = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDistance(12)
        .onBegin((e) => {
          lastTapTs.value = Date.now();
          lastTapX.value = e.x;
          lastTapY.value = e.y;
        })
        .onEnd((e, success) => {
          if (!success) return;
          const pt = screenToMapPoint(e.x, e.y, {
            scale: scale.value,
            tx: tx.value,
            ty: ty.value,
          });
          runOnJS(handleTap2D)(pt.x, pt.y, scale.value);
        }),
    [scale, tx, ty, lastTapTs, lastTapX, lastTapY, handleTap2D]
  );

  const twoFingerTap2D = useMemo(
    () =>
      Gesture.Tap()
        .minPointers(2)
        .maxDuration(250)
        .onEnd((e, success) => {
          if (!success) return;
          const target = clampCameraToBounds(
            zoomAroundFocalPoint(
              { scale: scale.value, tx: tx.value, ty: ty.value },
              scale.value * 0.5,
              e.x,
              e.y
            ),
            { width, height }
          );
          const d = reduceMotion ? 0 : 230;
          scale.value = withTiming(target.scale, { duration: d });
          tx.value = withTiming(target.tx, { duration: d });
          ty.value = withTiming(target.ty, { duration: d }, () => {
            runOnJS(syncSettledCamera)(target.scale, target.tx, target.ty);
          });
        }),
    [width, height, scale, tx, ty, reduceMotion, syncSettledCamera]
  );

  const composed2DGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        pinch2D,
        pan2D,
        Gesture.Exclusive(twoFingerTap2D, doubleTap2D, singleTap2D)
      ),
    [pinch2D, pan2D, twoFingerTap2D, doubleTap2D, singleTap2D]
  );

  // ---------- 3D Globe Gesture Suite ----------
  const globeBaseRadius = Math.min(width, height) * 0.43;
  const globeCenterX = width / 2;
  const globeCenterY = selectedPlaceId ? height * 0.32 : height * 0.48;
  const globeRadiusPx = globeBaseRadius * globeRot.scale;

  const globeProjection = useMemo(
    () =>
      createGlobeProjection(
        globeCenterX,
        globeCenterY,
        globeRadiusPx,
        globeRot.lon,
        globeRot.lat
      ),
    [globeCenterX, globeCenterY, globeRadiusPx, globeRot]
  );

  const globePaths = useMemo(() => {
    if (projectionMode !== '3d') return null;
    const pathGen = d3Geo.geoPath(globeProjection);
    const sphereSvg = pathGen({ type: 'Sphere' }) ?? '';
    const gratSvg = pathGen(d3Geo.geoGraticule10()) ?? '';
    const features = getWorldFeatures();

    const items: {
      id: string;
      skPath: ReturnType<typeof Skia.Path.Make>;
      centroid: [number, number] | null;
    }[] = [];
    for (const f of features) {
      const id = f.properties?.id || String(f.id ?? '');
      const svg = pathGen(f);
      if (!svg) continue;
      const p = Skia.Path.MakeFromSVGString(svg);
      if (!p) continue;
      const pMeta = PLACE_BY_ID[id];
      let centroid: [number, number] | null = null;
      if (pMeta) {
        const dist = d3Geo.geoDistance(pMeta.centroid, [-globeRot.lon, -globeRot.lat]);
        if (dist < Math.PI / 2 - 0.08) {
          const projPt = globeProjection(pMeta.centroid);
          if (projPt && Number.isFinite(projPt[0]) && Number.isFinite(projPt[1])) {
            centroid = [projPt[0], projPt[1]];
          }
        }
      }
      items.push({ id, skPath: p, centroid });
    }
    return {
      sphere: Skia.Path.MakeFromSVGString(sphereSvg) ?? Skia.Path.Make(),
      graticule: Skia.Path.MakeFromSVGString(gratSvg) ?? Skia.Path.Make(),
      items,
    };
  }, [projectionMode, globeProjection, globeRot.lon, globeRot.lat]);

  const handleGlobeDragStart = useCallback(() => {
    stopGlobeInertia();
    hasUserMoved3DRef.current = true;
    globeStartRef.current = { ...globeRot };
  }, [globeRot, stopGlobeInertia]);

  const handleGlobeDragUpdate = useCallback((dx: number, dy: number) => {
    const start = globeStartRef.current;
    const sensitivity = 0.28 / Math.max(0.8, start.scale);
    setGlobeRot({
      lon: start.lon + dx * sensitivity,
      lat: clamp(start.lat - dy * sensitivity, -78, 78),
      scale: start.scale,
    });
  }, []);

  const handleGlobeDragEnd = useCallback(
    (vx: number, vy: number) => {
      if (reduceMotion) return;
      const sensitivity = 0.0045 / Math.max(0.8, globeStartRef.current.scale);
      globeVelRef.current = {
        vLon: clamp(vx * sensitivity, -6.5, 6.5),
        vLat: clamp(-vy * sensitivity, -4.5, 4.5),
      };
      if (
        Math.abs(globeVelRef.current.vLon) < 0.08 &&
        Math.abs(globeVelRef.current.vLat) < 0.08
      ) {
        return;
      }
      const step = () => {
        globeVelRef.current.vLon *= 0.92;
        globeVelRef.current.vLat *= 0.92;
        const { vLon, vLat } = globeVelRef.current;
        if (Math.abs(vLon) < 0.04 && Math.abs(vLat) < 0.04) {
          globeRafRef.current = null;
          return;
        }
        setGlobeRot((prev) => ({
          lon: prev.lon + vLon,
          lat: clamp(prev.lat + vLat, -78, 78),
          scale: prev.scale,
        }));
        globeRafRef.current = requestAnimationFrame(step);
      };
      globeRafRef.current = requestAnimationFrame(step);
    },
    [reduceMotion]
  );

  const handleGlobePinchUpdate = useCallback((pinchScale: number) => {
    const start = globeStartRef.current;
    setGlobeRot({
      lon: start.lon,
      lat: start.lat,
      scale: clamp(start.scale * pinchScale, 0.85, 7.5),
    });
  }, []);

  const handleTap3D = useCallback(
    (x: number, y: number) => {
      const hitId = hitTest3D(x, y, globeProjection, userProfile.includeTerritories);
      if (hitId) {
        Haptics.selectionAsync();
        selectPlace(hitId, false);
      } else if (selectedPlaceId) {
        selectPlace(null, false);
      }
    },
    [globeProjection, userProfile.includeTerritories, selectPlace, selectedPlaceId]
  );

  const composed3DGesture = useMemo(() => {
    const pan3D = Gesture.Pan()
      .maxPointers(1)
      .onBegin(() => {
        runOnJS(handleGlobeDragStart)();
      })
      .onUpdate((e) => {
        runOnJS(handleGlobeDragUpdate)(e.translationX, e.translationY);
      })
      .onEnd((e) => {
        runOnJS(handleGlobeDragEnd)(e.velocityX, e.velocityY);
      });

    const pinch3D = Gesture.Pinch()
      .onBegin(() => {
        runOnJS(handleGlobeDragStart)();
      })
      .onUpdate((e) => {
        runOnJS(handleGlobePinchUpdate)(e.scale);
      });

    const tap3D = Gesture.Tap()
      .numberOfTaps(1)
      .maxDistance(12)
      .onEnd((e, success) => {
        if (!success) return;
        runOnJS(handleTap3D)(e.x, e.y);
      });

    return Gesture.Simultaneous(pinch3D, pan3D, tap3D);
  }, [
    handleGlobeDragStart,
    handleGlobeDragUpdate,
    handleGlobeDragEnd,
    handleGlobePinchUpdate,
    handleTap3D,
  ]);

  // ---------- VoiceOver Map Accessibility Actions (replaces +/- buttons) ----------
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const action = event.nativeEvent.actionName;
      if (action === 'zoomIn' || action === 'zoomOut') {
        const mult = action === 'zoomIn' ? 1.75 : 0.58;
        if (projectionMode === '2d') {
          const target = clampCameraToBounds(
            zoomAroundFocalPoint(
              { scale: scale.value, tx: tx.value, ty: ty.value },
              scale.value * mult,
              width / 2,
              height * 0.46
            ),
            { width, height }
          );
          animate2DCameraTo(target, 220);
        } else {
          setGlobeRot((prev) => ({
            ...prev,
            scale: clamp(prev.scale * mult, 0.85, 7.5),
          }));
        }
      } else if (action === 'recenter') {
        handleRecenter();
      }
    },
    [projectionMode, scale, tx, ty, width, height, animate2DCameraTo, handleRecenter]
  );

  // ---------- Skia Derived Transforms, Strokes & Hatch Uniforms ----------
  const groupTransform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ]);

  const adaptiveStroke = useDerivedValue(() => computeAdaptiveStrokeWidth(scale.value, 0.9));
  const selectedStrokeOuter = useDerivedValue(() =>
    clamp(3.0 / Math.max(1, scale.value), 0.28, 2.8)
  );
  const selectedStrokeInner = useDerivedValue(() =>
    clamp(1.3 / Math.max(1, scale.value), 0.14, 1.25)
  );
  const livedDotRadius = useDerivedValue(() =>
    clamp(3.2 / Math.pow(scale.value, 0.72), 0.55, 3.2)
  );
  const pinRadius = useDerivedValue(() =>
    clamp(2.8 / Math.pow(scale.value, 0.72), 0.5, 2.8)
  );

  // Zoom-invariant diagonal hatching uniforms on the 2D canvas
  const hatchBgVec = useMemo(() => hexToColorVec4(theme.landUnvisited, 1), [theme.landUnvisited]);
  const hatchInkVec = useMemo(() => hexToColorVec4(theme.landWishlist, 0.86), [theme.landWishlist]);
  const hatchUniforms2D = useDerivedValue(() => {
    const inv = 1 / Math.max(1, scale.value);
    return {
      bgColor: hatchBgVec,
      inkColor: hatchInkVec,
      spacing: clamp(5.8 * inv, 0.35, 6.2),
      strokeWidth: clamp(1.3 * inv, 0.08, 1.35),
    };
  });

  const hatchUniforms3D = useMemo(
    () => buildHatchUniforms(theme.landUnvisited, theme.landWishlist, 5.8, 1.3),
    [theme.landUnvisited, theme.landWishlist]
  );

  // ---------- Place Visual Classification ----------
  const getPlaceVisual = useCallback(
    (placeId: string): { kind: 'solid' | 'hatch'; color: string; isLived: boolean } => {
      const status = userPlaces[placeId]?.status ?? 'none';

      if (overlayMode === 'year' && activeYearCollectionId) {
        if (!activeYearPlaceIds.has(placeId)) {
          return { kind: 'solid', color: theme.landDimmed, isLived: false };
        }
        if (activeYearCollection?.collectionType === 'planned') {
          return { kind: 'hatch', color: theme.landUnvisited, isLived: false };
        }
        return { kind: 'solid', color: theme.landVisited, isLived: status === 'lived' };
      }

      if (overlayMode === 'visited') {
        if (status === 'lived') return { kind: 'solid', color: theme.landLived, isLived: true };
        if (status === 'visited') return { kind: 'solid', color: theme.landVisited, isLived: false };
        return { kind: 'solid', color: theme.landDimmed, isLived: false };
      }

      if (overlayMode === 'wishlist') {
        if (status === 'wishlist') return { kind: 'hatch', color: theme.landUnvisited, isLived: false };
        return { kind: 'solid', color: theme.landDimmed, isLived: false };
      }

      if (overlayMode === 'favorites') {
        if (!userPlaces[placeId]?.isFavorite) {
          return { kind: 'solid', color: theme.landDimmed, isLived: false };
        }
        if (status === 'lived') return { kind: 'solid', color: theme.landLived, isLived: true };
        if (status === 'visited') return { kind: 'solid', color: theme.landVisited, isLived: false };
        if (status === 'wishlist') return { kind: 'hatch', color: theme.landUnvisited, isLived: false };
        return { kind: 'solid', color: theme.landUnvisited, isLived: false };
      }

      if (status === 'lived') return { kind: 'solid', color: theme.landLived, isLived: true };
      if (status === 'visited') return { kind: 'solid', color: theme.landVisited, isLived: false };
      if (status === 'wishlist') return { kind: 'hatch', color: theme.landUnvisited, isLived: false };
      return { kind: 'solid', color: theme.landUnvisited, isLived: false };
    },
    [
      userPlaces,
      overlayMode,
      activeYearCollectionId,
      activeYearPlaceIds,
      activeYearCollection,
      theme,
    ]
  );

  // ---------- Greedy Collision-Free Live Skia Labels ----------
  const visibleLabels = useMemo<LabelCandidate[]>(() => {
    if (projectionMode !== '2d' || settledCam.scale < 1.35 || !labelFont) return [];
    const candidates: (LabelCandidate & { sx: number; sy: number; priority: number })[] = [];

    for (const item of engine2D.places) {
      if (!userProfile.includeTerritories && !item.place.isUnMember) continue;
      const sx = item.projectedCentroid[0] * settledCam.scale + settledCam.tx;
      const sy = item.projectedCentroid[1] * settledCam.scale + settledCam.ty;
      const textWidth = labelFont.measureText(item.place.name).width;
      const halfW = textWidth / 2;
      if (
        sx - halfW < 12 ||
        sx + halfW > width - 12 ||
        sy < safeInsets.top + 86 ||
        sy > height - Math.max(safeInsets.bottom, 12) - 134
      ) {
        continue;
      }

      const screenW = item.projectedWidth * settledCam.scale;
      const isUk = item.place.parentId === 'GB';
      const minW = isUk ? 24 : 44;
      if (screenW < minW && item.id !== selectedPlaceId) continue;

      const status = userPlaces[item.id]?.status ?? 'none';
      const isDimmed =
        (overlayMode === 'visited' && status !== 'visited' && status !== 'lived') ||
        (overlayMode === 'wishlist' && status !== 'wishlist') ||
        (overlayMode === 'favorites' && !userPlaces[item.id]?.isFavorite) ||
        (overlayMode === 'year' && !activeYearPlaceIds.has(item.id));

      let textColor = theme.labelText;
      let haloColor = theme.labelHalo;
      if (!isDimmed) {
        if (status === 'lived') {
          textColor = theme.labelOnLived;
          haloColor = theme.labelHaloOnLived;
        } else if (status === 'visited' || (overlayMode === 'year' && activeYearPlaceIds.has(item.id) && activeYearCollection?.collectionType !== 'planned')) {
          textColor = theme.labelOnVisited;
          haloColor = theme.labelHaloOnVisited;
        }
      }

      const distFromCenter = Math.hypot(sx - width / 2, sy - height * 0.45);

      candidates.push({
        id: item.id,
        name: item.place.name,
        mapX: item.projectedCentroid[0],
        mapY: item.projectedCentroid[1],
        textWidth,
        textColor,
        haloColor,
        opacity: isDimmed ? 0.42 : 0.94,
        sx,
        sy,
        priority:
          (item.id === selectedPlaceId ? -1000 : 0) +
          (isUk ? -120 : 0) +
          (status !== 'none' ? -40 : 0) +
          distFromCenter,
      });
    }

    candidates.sort((a, b) => a.priority - b.priority);

    // Greedy screen-space bounding-box collision rejection (prevents WalEngland / NorwSweden!)
    const placed: typeof candidates = [];
    for (const c of candidates) {
      if (placed.length >= 22) break;
      const halfW = c.textWidth / 2 + 8;
      let collides = false;
      for (const p of placed) {
        const pHalfW = p.textWidth / 2 + 8;
        if (Math.abs(c.sx - p.sx) < halfW + pHalfW && Math.abs(c.sy - p.sy) < 17) {
          collides = true;
          break;
        }
      }
      if (!collides) placed.push(c);
    }

    return placed;
  }, [
    projectionMode,
    settledCam,
    labelFont,
    engine2D.places,
    userProfile.includeTerritories,
    userPlaces,
    overlayMode,
    activeYearPlaceIds,
    activeYearCollection,
    width,
    height,
    safeInsets.top,
    safeInsets.bottom,
    selectedPlaceId,
    theme,
  ]);

  const selectedCompiled2D = selectedPlaceId ? engine2D.placeById[selectedPlaceId] : null;
  const activeInkCompiled = activeInk ? engine2D.placeById[activeInk.placeId] : null;
  const selectedGlobeItem =
    globePaths && selectedPlaceId
      ? globePaths.items.find((i) => i.id === selectedPlaceId) ?? null
      : null;

  const toggleOverlayFilter = (mode: Exclude<MapOverlayMode, 'all' | 'year'>) => {
    Haptics.selectionAsync();
    setOverlayMode(overlayMode === mode ? 'all' : mode);
  };

  const bottomHudOffset = Math.max(safeInsets.bottom, 12) + (Platform.OS === 'ios' ? 76 : 72);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.ocean }]}
      accessible={false}
    >
      {/* Full-Bleed Interactive Map / Globe Canvas */}
      <GestureDetector
        gesture={projectionMode === '2d' ? composed2DGesture : composed3DGesture}
      >
        <View
          style={styles.canvasWrap}
          accessibilityLabel={`World travel map, ${stats.visitedCount} of ${stats.totalCount} countries visited`}
          accessibilityHint="Pinch to zoom, drag to pan, double-tap a country or tap to inspect"
          accessibilityActions={[
            { name: 'zoomIn', label: 'Zoom in' },
            { name: 'zoomOut', label: 'Zoom out' },
            { name: 'recenter', label: 'Recenter map' },
          ]}
          onAccessibilityAction={handleAccessibilityAction}
        >
          <Canvas style={styles.canvas}>
            {projectionMode === '2d' ? (
              <>
                <Group transform={groupTransform}>
                  {/* Continuous single-ocean graticule + thin cartographic neatline (zero ocean cutoff!) */}
                  <Path
                    path={engine2D.graticulePath}
                    color={theme.graticule}
                    style="stroke"
                    strokeWidth={0.45}
                  />
                  <Path
                    path={engine2D.spherePath}
                    color={theme.graticule}
                    style="stroke"
                    strokeWidth={0.75}
                  />

                  {/* Landfills + Coastline Borders */}
                  {engine2D.places.map((item) => {
                    const visual = getPlaceVisual(item.id);
                    const isFlooding = activeInk?.placeId === item.id;
                    return (
                      <React.Fragment key={item.id}>
                        {isFlooding ? (
                          <Path path={item.skPath} color={theme.landUnvisited} />
                        ) : visual.kind === 'hatch' && hatchEffect ? (
                          <Path path={item.skPath}>
                            <Shader source={hatchEffect} uniforms={hatchUniforms2D} />
                          </Path>
                        ) : (
                          <Path
                            path={item.skPath}
                            color={
                              visual.kind === 'hatch'
                                ? theme.accentSoft
                                : visual.color
                            }
                          />
                        )}
                        <Path
                          path={item.skPath}
                          color={theme.border}
                          style="stroke"
                          strokeWidth={adaptiveStroke}
                          strokeJoin="round"
                          strokeCap="round"
                        />
                      </React.Fragment>
                    );
                  })}

                  {/* Signature Skia Ink-Flood Animation (clipped to country coastline!) */}
                  {activeInk && activeInkCompiled && (
                    <Group clip={activeInkCompiled.skPath}>
                      {activeInk.status === 'wishlist' && hatchEffect ? (
                        <Circle cx={activeInk.cx} cy={activeInk.cy} r={inkRadius}>
                          <Shader source={hatchEffect} uniforms={hatchUniforms2D} />
                        </Circle>
                      ) : (
                        <Circle
                          cx={activeInk.cx}
                          cy={activeInk.cy}
                          r={inkRadius}
                          color={
                            activeInk.status === 'lived'
                              ? theme.landLived
                              : theme.landVisited
                          }
                        />
                      )}
                      <Path
                        path={activeInkCompiled.skPath}
                        color={theme.border}
                        style="stroke"
                        strokeWidth={adaptiveStroke}
                        strokeJoin="round"
                        strokeCap="round"
                      />
                    </Group>
                  )}

                  {/* Solid Centroid Dot for "Lived" countries (secondary visual cue) */}
                  {engine2D.places.map((item) => {
                    const visual = getPlaceVisual(item.id);
                    if (!visual.isLived) return null;
                    return (
                      <Circle
                        key={`lived-${item.id}`}
                        cx={item.projectedCentroid[0]}
                        cy={item.projectedCentroid[1]}
                        r={livedDotRadius}
                        color={theme.livedDot}
                      />
                    );
                  })}

                  {/* Microstate dots — shown only when marked or zoomed past 2.8x */}
                  {engine2D.places.map((item) => {
                    if (!item.place.isMicrostate) return null;
                    if (!userProfile.includeTerritories && !item.place.isUnMember) return null;
                    const status = userPlaces[item.id]?.status ?? 'none';
                    if (status === 'none' && settledCam.scale < 2.8) return null;
                    const dotColor =
                      status === 'visited'
                        ? theme.landVisited
                        : status === 'lived'
                        ? theme.landLived
                        : status === 'wishlist'
                        ? theme.landWishlist
                        : theme.border;
                    return (
                      <Circle
                        key={`pin-${item.id}`}
                        cx={item.projectedCentroid[0]}
                        cy={item.projectedCentroid[1]}
                        r={pinRadius}
                        color={dotColor}
                      />
                    );
                  })}

                  {/* Cased Selection Outline (drawn last with round joins — zero Hebrides miter blob!) */}
                  {selectedCompiled2D && (
                    <>
                      <Path
                        path={selectedCompiled2D.skPath}
                        color={theme.borderSelectedOuter}
                        style="stroke"
                        strokeWidth={selectedStrokeOuter}
                        strokeJoin="round"
                        strokeCap="round"
                      />
                      <Path
                        path={selectedCompiled2D.skPath}
                        color={theme.borderSelected}
                        style="stroke"
                        strokeWidth={selectedStrokeInner}
                        strokeJoin="round"
                        strokeCap="round"
                      />
                    </>
                  )}
                </Group>

                {/* Starred Favourite Place Markers tracking at 60fps in screen space */}
                {engine2D.places.map((item) => {
                  const up = userPlaces[item.id];
                  if (!up?.isFavorite || up.deletedAt) return null;
                  if (overlayMode === 'year' && !activeYearPlaceIds.has(item.id)) return null;
                  if (
                    overlayMode === 'visited' &&
                    up.status !== 'visited' &&
                    up.status !== 'lived'
                  ) {
                    return null;
                  }
                  if (overlayMode === 'wishlist' && up.status !== 'wishlist') return null;
                  return (
                    <LiveStarMarker2D
                      key={`star-${item.id}`}
                      mapX={item.projectedCentroid[0]}
                      mapY={item.projectedCentroid[1]}
                      scale={scale}
                      tx={tx}
                      ty={ty}
                      fillColor={theme.favoriteAccent}
                      haloColor={theme.surface}
                    />
                  );
                })}

                {/* Live 60fps Stroked-Halo Skia Labels tracking the camera on the UI thread */}
                {labelFont &&
                  visibleLabels.map((lbl) => (
                    <LiveSkiaLabel
                      key={lbl.id}
                      label={lbl}
                      font={labelFont}
                      scale={scale}
                      tx={tx}
                      ty={ty}
                    />
                  ))}
              </>
            ) : (
              globePaths && (
                <Group>
                  {/* Soft Atmospheric Rim */}
                  <Circle
                    cx={globeCenterX}
                    cy={globeCenterY}
                    r={globeRadiusPx}
                    color={theme.oceanAtmosphere}
                  >
                    <BlurMask blur={18} style="outer" />
                  </Circle>

                  {/* Ocean Sphere + Radial Limb Darkening */}
                  <Path path={globePaths.sphere} color={theme.oceanHighlight} />
                  <Group clip={globePaths.sphere}>
                    <Path
                      path={globePaths.graticule}
                      color={theme.graticule}
                      style="stroke"
                      strokeWidth={0.6}
                    />

                    {globePaths.items.map((item) => {
                      const visual = getPlaceVisual(item.id);
                      return (
                        <React.Fragment key={item.id}>
                          {visual.kind === 'hatch' && hatchEffect ? (
                            <Path path={item.skPath}>
                              <Shader source={hatchEffect} uniforms={hatchUniforms3D} />
                            </Path>
                          ) : (
                            <Path
                              path={item.skPath}
                              color={
                                visual.kind === 'hatch' ? theme.accentSoft : visual.color
                              }
                            />
                          )}
                          <Path
                            path={item.skPath}
                            color={theme.border}
                            style="stroke"
                            strokeWidth={0.65}
                            strokeJoin="round"
                            strokeCap="round"
                          />
                          {visual.isLived && item.centroid && !userPlaces[item.id]?.isFavorite && (
                            <Circle
                              cx={item.centroid[0]}
                              cy={item.centroid[1]}
                              r={3}
                              color={theme.livedDot}
                            />
                          )}
                          {userPlaces[item.id]?.isFavorite && item.centroid && (
                            <Group
                              transform={[
                                { translateX: item.centroid[0] },
                                { translateY: item.centroid[1] },
                              ]}
                            >
                              <Path
                                path={STAR_MARKER_PATH}
                                color={theme.surface}
                                style="stroke"
                                strokeWidth={2.2}
                                strokeJoin="round"
                              />
                              <Path
                                path={STAR_MARKER_PATH}
                                color={theme.favoriteAccent}
                              />
                            </Group>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Cased selection outline on 3D globe */}
                    {selectedGlobeItem && (
                      <>
                        <Path
                          path={selectedGlobeItem.skPath}
                          color={theme.borderSelectedOuter}
                          style="stroke"
                          strokeWidth={2.8}
                          strokeJoin="round"
                          strokeCap="round"
                        />
                        <Path
                          path={selectedGlobeItem.skPath}
                          color={theme.borderSelected}
                          style="stroke"
                          strokeWidth={1.25}
                          strokeJoin="round"
                          strokeCap="round"
                        />
                      </>
                    )}

                    {/* Subtle Spherical Limb Vignette (direct child of Circle — no black base Paint!) */}
                    <Circle cx={globeCenterX} cy={globeCenterY} r={globeRadiusPx}>
                      <RadialGradient
                        c={vec(
                          globeCenterX - globeRadiusPx * 0.24,
                          globeCenterY - globeRadiusPx * 0.24
                        )}
                        r={globeRadiusPx * 1.12}
                        colors={
                          theme.isDark
                            ? ['rgba(255,255,255,0.06)', 'rgba(0,0,0,0)', 'rgba(3,10,20,0.42)']
                            : ['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)', 'rgba(20,38,54,0.22)']
                        }
                        positions={[0, 0.65, 1]}
                      />
                    </Circle>
                  </Group>

                  {/* Crisp Globe Rim */}
                  <Path
                    path={globePaths.sphere}
                    color={theme.cardBorder}
                    style="stroke"
                    strokeWidth={1}
                  />
                </Group>
              )
            )}

            {/* Gentle Top Vignette so Title Block stays effortlessly legible over coastlines */}
            <Rect x={0} y={0} width={width} height={safeInsets.top + 88}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(0, safeInsets.top + 88)}
                colors={[theme.ocean, `${theme.ocean}CC`, `${theme.ocean}00`]}
                positions={[0, 0.45, 1]}
              />
            </Rect>
          </Canvas>
        </View>
      </GestureDetector>

      {/* Quiet Top Title Block & Two Minimal Icon Actions */}
      <View
        style={[styles.topHud, { top: safeInsets.top + 8 }]}
        pointerEvents="box-none"
      >
        <View style={styles.titleBlock} pointerEvents="none">
          {stats.visitedCount === 0 ? (
            <>
              <Text style={[styles.emptyHeadline, { color: theme.textPrimary }]}>
                Tap a country you've been to
              </Text>
              <Text style={[styles.countSub, { color: theme.textSecondary }]}>
                0 of {stats.totalCount} countries
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.countHeadline, { color: theme.textPrimary }]}>
                {stats.visitedCount}
                <Text style={[styles.countDenom, { color: theme.textSecondary }]}>
                  {' '}
                  of {stats.totalCount}
                </Text>
              </Text>
              <Text style={[styles.countSub, { color: theme.textSecondary }]}>
                countries
              </Text>
            </>
          )}
        </View>

        <View style={styles.topActions}>
          <Pressable
            onPress={onOpenSearch}
            accessibilityRole="button"
            accessibilityLabel="Search places"
            style={({ pressed }) => [
              styles.circleActionOuter,
              {
                borderColor: theme.cardBorder,
                opacity: pressed ? 0.72 : 1,
                backgroundColor:
                  Platform.OS === 'android' ? theme.surfaceGlass : 'transparent',
              },
            ]}
          >
            <BlurView
              intensity={64}
              tint={theme.blurTint}
              style={[styles.circleActionInner, { backgroundColor: theme.surfaceGlass }]}
            >
              <Search
                size={18}
                color={theme.textPrimary}
                strokeWidth={1.9}
                absoluteStrokeWidth
              />
            </BlurView>
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setProjectionMode(projectionMode === '2d' ? '3d' : '2d');
            }}
            accessibilityRole="button"
            accessibilityLabel={
              projectionMode === '2d' ? 'Switch to 3D globe' : 'Switch to flat map'
            }
            style={({ pressed }) => [
              styles.circleActionOuter,
              {
                borderColor: theme.cardBorder,
                opacity: pressed ? 0.72 : 1,
                backgroundColor:
                  Platform.OS === 'android' ? theme.surfaceGlass : 'transparent',
              },
            ]}
          >
            <BlurView
              intensity={64}
              tint={theme.blurTint}
              style={[styles.circleActionInner, { backgroundColor: theme.surfaceGlass }]}
            >
              {projectionMode === '2d' ? (
                <Globe2
                  size={18}
                  color={theme.textPrimary}
                  strokeWidth={1.8}
                  absoluteStrokeWidth
                />
              ) : (
                <MapIcon
                  size={18}
                  color={theme.textPrimary}
                  strokeWidth={1.8}
                  absoluteStrokeWidth
                />
              )}
            </BlurView>
          </Pressable>
        </View>
      </View>

      {/* Bottom Legend-as-Filter & Conditional Recenter Pill (NO +/- stack, NO region strip) */}
      {!selectedPlaceId && (
        <View
          style={[styles.bottomRow, { bottom: bottomHudOffset }]}
          pointerEvents="box-none"
        >
          {overlayMode === 'year' && activeYearCollection ? (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setOverlayMode('all');
              }}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${activeYearCollection.title} map filter`}
              style={({ pressed }) => [
                styles.glassPillOuter,
                {
                  borderColor: theme.cardBorder,
                  opacity: pressed ? 0.76 : 1,
                  backgroundColor:
                    Platform.OS === 'android' ? theme.surfaceGlass : 'transparent',
                },
              ]}
            >
              <BlurView
                intensity={68}
                tint={theme.blurTint}
                style={[styles.yearBannerInner, { backgroundColor: theme.surfaceGlass }]}
              >
                <Text style={[styles.legendText, { color: theme.textPrimary }]}>
                  {activeYearCollection.title}
                </Text>
                <Text style={[styles.legendNum, { color: theme.textSecondary }]}>
                  {activeYearPlaceIds.size}
                </Text>
                <X size={14} color={theme.textSecondary} strokeWidth={2} absoluteStrokeWidth />
              </BlurView>
            </Pressable>
          ) : (
            <View
              style={[
                styles.glassPillOuter,
                {
                  borderColor: theme.cardBorder,
                  backgroundColor:
                    Platform.OS === 'android' ? theme.surfaceGlass : 'transparent',
                },
              ]}
            >
              <BlurView
                intensity={68}
                tint={theme.blurTint}
                style={[styles.legendInner, { backgroundColor: theme.surfaceGlass }]}
              >
                <Pressable
                  onPress={() => toggleOverlayFilter('visited')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: overlayMode === 'visited' }}
                  accessibilityLabel={`Filter visited countries, ${stats.visitedCount}`}
                  style={({ pressed }) => [
                    styles.legendBtn,
                    overlayMode === 'visited' && {
                      backgroundColor: theme.accentSoft,
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View
                    style={[
                      styles.legendSwatch,
                      {
                        backgroundColor: theme.landVisited,
                        borderColor: theme.border,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.legendText,
                      {
                        color:
                          overlayMode === 'visited' ? theme.accent : theme.textPrimary,
                      },
                    ]}
                  >
                    Been{' '}
                    <Text style={styles.legendNum}>{stats.visitedCount}</Text>
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => toggleOverlayFilter('wishlist')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: overlayMode === 'wishlist' }}
                  accessibilityLabel={`Filter want to go countries, ${stats.wishlistCount}`}
                  style={({ pressed }) => [
                    styles.legendBtn,
                    overlayMode === 'wishlist' && {
                      backgroundColor: theme.accentSoft,
                    },
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View
                    style={[
                      styles.legendSwatch,
                      {
                        backgroundColor: theme.landUnvisited,
                        borderColor: theme.landWishlist,
                        overflow: 'hidden',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.hatchLine1,
                        { backgroundColor: theme.landWishlist },
                      ]}
                    />
                    <View
                      style={[
                        styles.hatchLine2,
                        { backgroundColor: theme.landWishlist },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.legendText,
                      {
                        color:
                          overlayMode === 'wishlist' ? theme.accent : theme.textPrimary,
                      },
                    ]}
                  >
                    Want{' '}
                    <Text style={styles.legendNum}>{stats.wishlistCount}</Text>
                  </Text>
                </Pressable>

                {stats.favoritesCount > 0 && (
                  <Pressable
                    onPress={() => toggleOverlayFilter('favorites')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: overlayMode === 'favorites' }}
                    accessibilityLabel={`Filter favourite places, ${stats.favoritesCount}`}
                    style={({ pressed }) => [
                      styles.legendBtn,
                      overlayMode === 'favorites' && {
                        backgroundColor: theme.favoriteSoft,
                      },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Star
                      size={12}
                      color={theme.favoriteAccent}
                      fill={theme.favoriteAccent}
                      strokeWidth={1.8}
                      absoluteStrokeWidth
                    />
                    <Text
                      style={[
                        styles.legendNum,
                        {
                          fontSize: 13,
                          color:
                            overlayMode === 'favorites'
                              ? theme.favoriteAccent
                              : theme.textPrimary,
                        },
                      ]}
                    >
                      {stats.favoritesCount}
                    </Text>
                  </Pressable>
                )}
              </BlurView>
            </View>
          )}

          {cameraMoved && (
            <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)}>
              <Pressable
                onPress={handleRecenter}
                accessibilityRole="button"
                accessibilityLabel="Recenter map"
                style={({ pressed }) => [
                  styles.glassPillOuter,
                  {
                    borderColor: theme.cardBorder,
                    opacity: pressed ? 0.72 : 1,
                    backgroundColor:
                      Platform.OS === 'android' ? theme.surfaceGlass : 'transparent',
                  },
                ]}
              >
                <BlurView
                  intensity={68}
                  tint={theme.blurTint}
                  style={[styles.recenterInner, { backgroundColor: theme.surfaceGlass }]}
                >
                  <RotateCcw
                    size={13}
                    color={theme.textPrimary}
                    strokeWidth={1.9}
                    absoluteStrokeWidth
                  />
                  <Text style={[styles.recenterText, { color: theme.textPrimary }]}>
                    Recenter
                  </Text>
                </BlurView>
              </Pressable>
            </Animated.View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  canvasWrap: {
    flex: 1,
  },
  canvas: {
    flex: 1,
  },
  topHud: {
    position: 'absolute',
    left: 18,
    right: 16,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    paddingRight: 12,
  },
  countHeadline: {
    fontFamily: FONTS.num,
    fontSize: 30,
    lineHeight: 33,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  countDenom: {
    fontFamily: FONTS.numMedium,
    fontSize: 19,
  },
  emptyHeadline: {
    fontFamily: FONTS.display,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  countSub: {
    fontFamily: FONTS.body,
    fontSize: 13,
    marginTop: 1,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  circleActionOuter: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  circleActionInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  glassPillOuter: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  legendInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    gap: 2,
  },
  legendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 12,
    height: 36,
    borderRadius: 999,
  },
  legendSwatch: {
    width: 11,
    height: 11,
    borderRadius: 2.5,
    borderWidth: 1,
  },
  hatchLine1: {
    position: 'absolute',
    width: 16,
    height: 1.4,
    top: 2,
    left: -3,
    transform: [{ rotate: '-45deg' }],
  },
  hatchLine2: {
    position: 'absolute',
    width: 16,
    height: 1.4,
    top: 6.5,
    left: -2,
    transform: [{ rotate: '-45deg' }],
  },
  legendText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
  legendNum: {
    fontFamily: FONTS.num,
    fontVariant: ['tabular-nums'],
  },
  yearBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 12,
    height: 44,
  },
  recenterInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 14,
    height: 44,
  },
  recenterText: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
  },
});
