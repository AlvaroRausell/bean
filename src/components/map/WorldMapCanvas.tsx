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
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
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
import * as Haptics from 'expo-haptics';
import { RotateCcw, Search, Star, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CameraState,
  clamp,
  clampCameraToBounds,
  computeAdaptiveStrokeWidth,
  computeMinZoomForViewport,
  computePortraitInitialCamera,
  fitProjectedBoundsToViewport,
  screenToMapPoint,
  zoomAroundFocalPoint,
} from '@/map/cameraMath';
import {
  getHatchRuntimeEffect,
  hexToColorVec4,
} from '@/map/cartography';
import {
  getGeoEngine2D,
  hitTest2D,
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
    { translateY: mapY * scale.value + ty.value - (scale.value >= 1.3 ? 13 : 0) },
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
  const isLandscape = width > height;

  const userPlaces = useTravelStore((s) => s.userPlaces);
  const yearCollections = useTravelStore((s) => s.yearCollections);
  const collectionItems = useTravelStore((s) => s.collectionItems);
  const userProfile = useTravelStore((s) => s.userProfile);
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

  const minZoom = useMemo(
    () => computeMinZoomForViewport({ width, height }),
    [width, height]
  );

  // ---------- 2D Camera State (UI thread Reanimated SharedValues) ----------
  const initialCam = useMemo(() => {
    const base = computePortraitInitialCamera({ width, height });
    // In landscape, always frame the full world cleanly edge-to-edge
    if (width > height) {
      return base;
    }
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

  // Gesture scratch shared values (conflict-free pan & pinch)
  const isPinching = useSharedValue(false);
  const panLastTransX = useSharedValue(0);
  const panLastTransY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const pinchStartTx = useSharedValue(0);
  const pinchStartTy = useSharedValue(0);
  const pinchStartFocalX = useSharedValue(0);
  const pinchStartFocalY = useSharedValue(0);

  const [settledCam, setSettledCam] = useState<CameraState>(initialCam);
  const hasUserMoved2DRef = useRef(false);
  const prevIsLandscapeRef = useRef(isLandscape);

  // Re-fit camera automatically on orientation switch (portrait <-> landscape full-world)
  // and on initial SQLite homePlaceId hydration before the user moves the map
  useEffect(() => {
    const orientationChanged = prevIsLandscapeRef.current !== isLandscape;
    prevIsLandscapeRef.current = isLandscape;
    if (!orientationChanged && hasUserMoved2DRef.current) return;

    cancelAnimation(scale);
    cancelAnimation(tx);
    cancelAnimation(ty);
    if (orientationChanged) {
      hasUserMoved2DRef.current = false;
    }
    scale.value = initialCam.scale;
    tx.value = initialCam.tx;
    ty.value = initialCam.ty;
    setSettledCam(initialCam);
  }, [initialCam, isLandscape, scale, tx, ty]);

  // ---------- Signature Skia Ink-Flood Animation ----------
  const [activeInk, setActiveInk] = useState<{
    id: number;
    placeId: string;
    status: 'visited' | 'wishlist' | 'lived' | 'skipped';
    cx: number;
    cy: number;
    maxR: number;
  } | null>(null);
  const inkProgress = useSharedValue(1);

  useEffect(() => {
    if (!lastInkEvent || reduceMotion) {
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
      { duration: 420, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(setActiveInk)(null);
        }
      }
    );
  }, [lastInkEvent, reduceMotion, engine2D, inkProgress]);

  const inkRadius = useDerivedValue(() =>
    activeInk ? activeInk.maxR * inkProgress.value : 0
  );

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
      const distPx = Math.hypot(target.tx - tx.value, target.ty - ty.value);
      const scaleDiff = Math.abs(
        Math.log(Math.max(0.1, target.scale) / Math.max(0.1, scale.value))
      );
      const duration =
        explicitDuration ??
        Math.round(clamp(220 + distPx * 0.25 + scaleDiff * 105, 220, 480));

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

  // Has camera moved meaningfully away from default? Drives the Recenter pill
  const cameraMoved = useMemo(() => {
    return (
      Math.abs(settledCam.scale - initialCam.scale) > 0.18 ||
      Math.hypot(settledCam.tx - initialCam.tx, settledCam.ty - initialCam.ty) > 44
    );
  }, [settledCam, initialCam]);

  const handleRecenter = useCallback(() => {
    Haptics.selectionAsync();
    animate2DCameraTo(initialCam);
  }, [animate2DCameraTo, initialCam]);

  // Respond to external camera requests once per request id (never re-fire stale requests on rotation!)
  const lastHandledCameraReqIdRef = useRef<number>(0);
  useEffect(() => {
    if (!cameraRequest || cameraRequest.id === lastHandledCameraReqIdRef.current) return;
    lastHandledCameraReqIdRef.current = cameraRequest.id;

    if (cameraRequest.type === 'reset') {
      animate2DCameraTo(initialCam);
      return;
    }

    if (cameraRequest.type === 'bbox' && cameraRequest.bbox) {
      const projBounds = projectGeoBboxTo2D(cameraRequest.bbox, engine2D.projection);
      const target = fitProjectedBoundsToViewport(
        projBounds,
        { width, height },
        {
          top: safeInsets.top + (isLandscape ? 54 : 92),
          bottom:
            safeInsets.bottom +
            (cameraRequest.withBottomSheetInset
              ? Math.min(height * 0.58, sheetHeight + 16)
              : isLandscape
              ? 64
              : 138),
          left: Math.max(16, safeInsets.left + 12),
          right: Math.max(16, safeInsets.right + 12),
        },
        0.86,
        minZoom,
        24
      );
      animate2DCameraTo(target);
      return;
    }

    if (cameraRequest.type === 'place' && cameraRequest.placeId) {
      const place = PLACE_BY_ID[cameraRequest.placeId];
      if (!place) return;
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
          top: safeInsets.top + (isLandscape ? 48 : 88),
          bottom: cameraRequest.withBottomSheetInset
            ? Math.min(height * (isLandscape ? 0.56 : 0.62), sheetHeight + 16)
            : safeInsets.bottom + (isLandscape ? 64 : 138),
          left: Math.max(24, safeInsets.left + 16),
          right: Math.max(24, safeInsets.right + 16),
        },
        0.72,
        minZoom,
        14
      );
      animate2DCameraTo(target);
    }
  }, [
    cameraRequest,
    engine2D,
    width,
    height,
    isLandscape,
    safeInsets,
    sheetHeight,
    initialCam,
    minZoom,
    animate2DCameraTo,
  ]);

  // ---------- 2D Hit-Test Handler (hits ALL 243 countries & territories!) ----------
  const handleTap2D = useCallback(
    (mapX: number, mapY: number, currentScale: number) => {
      const hitId = hitTest2D(mapX, mapY, currentScale);
      if (hitId) {
        Haptics.selectionAsync();
        selectPlace(hitId, true, { mapX, mapY });
      } else if (selectedPlaceId) {
        selectPlace(null, false);
      }
    },
    [selectPlace, selectedPlaceId]
  );

  // ---------- Conflict-Free 2D Gesture Suite ----------
  const pan2D = useMemo(
    () =>
      Gesture.Pan()
        .minPointers(1)
        .maxPointers(1)
        .minDistance(8)
        .onStart((e) => {
          if (isPinching.value) return;
          cancelAnimation(tx);
          cancelAnimation(ty);
          cancelAnimation(scale);
          panLastTransX.value = e.translationX;
          panLastTransY.value = e.translationY;
        })
        .onUpdate((e) => {
          if (isPinching.value) return;
          const dx = e.translationX - panLastTransX.value;
          const dy = e.translationY - panLastTransY.value;
          panLastTransX.value = e.translationX;
          panLastTransY.value = e.translationY;

          const clamped = clampCameraToBounds(
            {
              scale: scale.value,
              tx: tx.value + dx,
              ty: ty.value + dy,
            },
            { width, height }
          );
          tx.value = clamped.tx;
          ty.value = clamped.ty;
        })
        .onEnd((e) => {
          if (isPinching.value) return;
          const speed = Math.hypot(e.velocityX, e.velocityY);
          if (reduceMotion || speed < 65) {
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

          const xDominant = Math.abs(e.velocityX) >= Math.abs(e.velocityY);

          tx.value = withDecay(
            {
              velocity: e.velocityX * 0.82,
              deceleration: 0.993,
              clamp: [minTx, maxTx],
            },
            xDominant
              ? (finished) => {
                  if (finished) {
                    runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
                  }
                }
              : undefined
          );
          ty.value = withDecay(
            {
              velocity: e.velocityY * 0.82,
              deceleration: 0.993,
              clamp: [minTy, maxTy],
            },
            !xDominant
              ? (finished) => {
                  if (finished) {
                    runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
                  }
                }
              : undefined
          );
        }),
    [
      width,
      height,
      tx,
      ty,
      scale,
      isPinching,
      panLastTransX,
      panLastTransY,
      reduceMotion,
      syncSettledCamera,
    ]
  );

  const pinch2D = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((e) => {
          isPinching.value = true;
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
            e.focalY,
            minZoom,
            24.0
          );
          const clamped = clampCameraToBounds(zoomed, { width, height });
          scale.value = clamped.scale;
          tx.value = clamped.tx;
          ty.value = clamped.ty;
        })
        .onFinalize(() => {
          isPinching.value = false;
          runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
        }),
    [
      width,
      height,
      minZoom,
      scale,
      tx,
      ty,
      isPinching,
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
        .maxDelay(190)
        .maxDistance(24)
        .onEnd((e, success) => {
          if (!success) return;
          cancelAnimation(scale);
          cancelAnimation(tx);
          cancelAnimation(ty);
          const target = clampCameraToBounds(
            zoomAroundFocalPoint(
              { scale: scale.value, tx: tx.value, ty: ty.value },
              scale.value * 2.25,
              e.x,
              e.y,
              minZoom,
              24.0
            ),
            { width, height }
          );
          const d = reduceMotion ? 0 : 230;
          scale.value = withTiming(target.scale, { duration: d });
          tx.value = withTiming(target.tx, { duration: d });
          ty.value = withTiming(target.ty, { duration: d }, (finished) => {
            if (finished) {
              runOnJS(syncSettledCamera)(target.scale, target.tx, target.ty);
            }
          });
        }),
    [width, height, minZoom, scale, tx, ty, reduceMotion, syncSettledCamera]
  );

  const singleTap2D = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDistance(20)
        .maxDuration(340)
        .onEnd((e, success) => {
          if (!success) return;
          cancelAnimation(tx);
          cancelAnimation(ty);
          const pt = screenToMapPoint(e.x, e.y, {
            scale: scale.value,
            tx: tx.value,
            ty: ty.value,
          });
          runOnJS(handleTap2D)(pt.x, pt.y, scale.value);
        }),
    [scale, tx, ty, handleTap2D]
  );

  const twoFingerTap2D = useMemo(
    () =>
      Gesture.Tap()
        .minPointers(2)
        .maxDuration(240)
        .maxDistance(24)
        .onEnd((e, success) => {
          if (!success) return;
          cancelAnimation(scale);
          cancelAnimation(tx);
          cancelAnimation(ty);
          const target = clampCameraToBounds(
            zoomAroundFocalPoint(
              { scale: scale.value, tx: tx.value, ty: ty.value },
              scale.value * 0.5,
              e.x,
              e.y,
              minZoom,
              24.0
            ),
            { width, height }
          );
          const d = reduceMotion ? 0 : 220;
          scale.value = withTiming(target.scale, { duration: d });
          tx.value = withTiming(target.tx, { duration: d });
          ty.value = withTiming(target.ty, { duration: d }, (finished) => {
            if (finished) {
              runOnJS(syncSettledCamera)(target.scale, target.tx, target.ty);
            }
          });
        }),
    [width, height, minZoom, scale, tx, ty, reduceMotion, syncSettledCamera]
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

  // ---------- VoiceOver Map Accessibility Actions ----------
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const action = event.nativeEvent.actionName;
      if (action === 'zoomIn' || action === 'zoomOut') {
        const mult = action === 'zoomIn' ? 1.75 : 0.58;
        const target = clampCameraToBounds(
          zoomAroundFocalPoint(
            { scale: scale.value, tx: tx.value, ty: ty.value },
            scale.value * mult,
            width / 2,
            height * 0.46,
            minZoom,
            24.0
          ),
          { width, height }
        );
        animate2DCameraTo(target, 220);
      } else if (action === 'recenter') {
        handleRecenter();
      }
    },
    [scale, tx, ty, width, height, minZoom, animate2DCameraTo, handleRecenter]
  );

  // ---------- Skia Derived Transforms, Strokes & Hatch Uniforms ----------
  const groupTransform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ]);

  const adaptiveStroke = useDerivedValue(() => computeAdaptiveStrokeWidth(scale.value, 0.9));
  const selectedStrokeOuter = useDerivedValue(() =>
    clamp(3.0 / Math.max(0.5, scale.value), 0.28, 3.2)
  );
  const selectedStrokeInner = useDerivedValue(() =>
    clamp(1.3 / Math.max(0.5, scale.value), 0.14, 1.45)
  );
  const livedDotRadius = useDerivedValue(() =>
    clamp(3.2 / Math.pow(Math.max(0.6, scale.value), 0.72), 0.55, 3.5)
  );
  const pinRadius = useDerivedValue(() =>
    clamp(2.8 / Math.pow(Math.max(0.6, scale.value), 0.72), 0.5, 3.0)
  );

  const hatchBgVec = useMemo(() => hexToColorVec4(theme.landUnvisited, 1), [theme.landUnvisited]);
  const hatchInkVec = useMemo(() => hexToColorVec4(theme.landWishlist, 0.86), [theme.landWishlist]);
  const hatchUniforms2D = useDerivedValue(() => {
    const inv = 1 / Math.max(0.6, scale.value);
    return {
      bgColor: hatchBgVec,
      inkColor: hatchInkVec,
      spacing: clamp(5.8 * inv, 0.35, 7.2),
      strokeWidth: clamp(1.3 * inv, 0.08, 1.55),
    };
  });

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

      if (overlayMode === 'skipped') {
        if (status === 'skipped') return { kind: 'solid', color: theme.landSkipped, isLived: false };
        return { kind: 'solid', color: theme.landDimmed, isLived: false };
      }

      if (overlayMode === 'favorites') {
        if (!userPlaces[placeId]?.isFavorite) {
          return { kind: 'solid', color: theme.landDimmed, isLived: false };
        }
        if (status === 'lived') return { kind: 'solid', color: theme.landLived, isLived: true };
        if (status === 'visited') return { kind: 'solid', color: theme.landVisited, isLived: false };
        if (status === 'wishlist') return { kind: 'hatch', color: theme.landUnvisited, isLived: false };
        if (status === 'skipped') return { kind: 'solid', color: theme.landSkipped, isLived: false };
        return { kind: 'solid', color: theme.landUnvisited, isLived: false };
      }

      if (status === 'lived') return { kind: 'solid', color: theme.landLived, isLived: true };
      if (status === 'visited') return { kind: 'solid', color: theme.landVisited, isLived: false };
      if (status === 'wishlist') return { kind: 'hatch', color: theme.landUnvisited, isLived: false };
      if (status === 'skipped') return { kind: 'solid', color: theme.landSkipped, isLived: false };
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

  // ---------- Greedy Collision-Free Live Skia Labels (ALL 243 countries & territories!) ----------
  const visibleLabels = useMemo<LabelCandidate[]>(() => {
    if (settledCam.scale < 1.3 || !labelFont) return [];
    const candidates: (LabelCandidate & { sx: number; sy: number; priority: number })[] = [];

    const topEdge = safeInsets.top + (isLandscape ? 52 : 86);
    const bottomEdge = height - Math.max(safeInsets.bottom, 12) - (isLandscape ? 60 : 134);

    for (const item of engine2D.places) {
      const sx = item.projectedCentroid[0] * settledCam.scale + settledCam.tx;
      const sy = item.projectedCentroid[1] * settledCam.scale + settledCam.ty;
      const textWidth = labelFont.measureText(item.place.name).width;
      const halfW = textWidth / 2;
      if (
        sx - halfW < Math.max(12, safeInsets.left + 8) ||
        sx + halfW > width - Math.max(12, safeInsets.right + 8) ||
        sy < topEdge ||
        sy > bottomEdge
      ) {
        continue;
      }

      const screenW = item.projectedWidth * settledCam.scale;
      const isUk = item.place.parentId === 'GB';
      const minW = isUk ? 24 : 42;
      if (screenW < minW && item.id !== selectedPlaceId) continue;

      const status = userPlaces[item.id]?.status ?? 'none';
      const isDimmed =
        status === 'skipped' ||
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
        } else if (
          status === 'visited' ||
          (overlayMode === 'year' &&
            activeYearPlaceIds.has(item.id) &&
            activeYearCollection?.collectionType !== 'planned')
        ) {
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
        opacity: isDimmed ? 0.44 : 0.94,
        sx,
        sy,
        priority:
          (item.id === selectedPlaceId ? -1000 : 0) +
          (isUk ? -120 : 0) +
          (status !== 'none' && status !== 'skipped' ? -40 : 0) +
          distFromCenter,
      });
    }

    candidates.sort((a, b) => a.priority - b.priority);

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
    settledCam,
    labelFont,
    engine2D.places,
    userPlaces,
    overlayMode,
    activeYearPlaceIds,
    activeYearCollection,
    width,
    height,
    isLandscape,
    safeInsets.top,
    safeInsets.bottom,
    safeInsets.left,
    safeInsets.right,
    selectedPlaceId,
    theme,
  ]);

  const selectedCompiled2D = selectedPlaceId ? engine2D.placeById[selectedPlaceId] : null;
  const activeInkCompiled = activeInk ? engine2D.placeById[activeInk.placeId] : null;

  const toggleOverlayFilter = (mode: Exclude<MapOverlayMode, 'all' | 'year'>) => {
    Haptics.selectionAsync();
    setOverlayMode(overlayMode === mode ? 'all' : mode);
  };

  const bottomHudOffset = isLandscape
    ? Math.max(safeInsets.bottom, 10) + (Platform.OS === 'ios' ? 46 : 44)
    : Math.max(safeInsets.bottom, 12) + (Platform.OS === 'ios' ? 76 : 72);

  const hudLeft = Math.max(16, safeInsets.left + 12);
  const hudRight = Math.max(16, safeInsets.right + 12);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.ocean }]}
      accessible={false}
    >
      {/* Full-Bleed 60fps 2D Interactive Map Canvas */}
      <GestureDetector gesture={composed2DGesture}>
        <View
          style={styles.canvasWrap}
          accessibilityLabel={`World travel map, ${stats.visitedCount} of ${stats.totalCount} countries visited`}
          accessibilityHint="Pinch to zoom, drag to pan, double-tap to zoom in, tap any country or territory to inspect"
          accessibilityActions={[
            { name: 'zoomIn', label: 'Zoom in' },
            { name: 'zoomOut', label: 'Zoom out' },
            { name: 'recenter', label: 'Recenter map' },
          ]}
          onAccessibilityAction={handleAccessibilityAction}
        >
          <Canvas style={styles.canvas}>
            <Group transform={groupTransform}>
              {/* Continuous single-ocean graticule + thin cartographic neatline */}
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
                          visual.kind === 'hatch' ? theme.accentSoft : visual.color
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
                          : activeInk.status === 'skipped'
                          ? theme.landSkipped
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

              {/* Solid Centroid Dot for "Lived" countries */}
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

              {/* Microstate dots — shown for all microstates/territories when marked or zoomed past 2.5x */}
              {engine2D.places.map((item) => {
                if (!item.place.isMicrostate) return null;
                const status = userPlaces[item.id]?.status ?? 'none';
                if (status === 'none' && settledCam.scale < 2.5) return null;
                const dotColor =
                  status === 'visited'
                    ? theme.landVisited
                    : status === 'lived'
                    ? theme.landLived
                    : status === 'wishlist'
                    ? theme.landWishlist
                    : status === 'skipped'
                    ? theme.skippedAccent
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

              {/* Cased Selection Outline (drawn last with round joins) */}
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
              if (overlayMode === 'skipped' && up.status !== 'skipped') return null;
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

            {/* Gentle Top Vignette so Title Block stays effortlessly legible over coastlines */}
            <Rect
              x={0}
              y={0}
              width={width}
              height={safeInsets.top + (isLandscape ? 58 : 88)}
            >
              <LinearGradient
                start={vec(0, 0)}
                end={vec(0, safeInsets.top + (isLandscape ? 58 : 88))}
                colors={[theme.ocean, `${theme.ocean}CC`, `${theme.ocean}00`]}
                positions={[0, 0.45, 1]}
              />
            </Rect>
          </Canvas>
        </View>
      </GestureDetector>

      {/* Quiet Top Title Block & Single Search Action */}
      <View
        style={[
          styles.topHud,
          {
            top: safeInsets.top + (isLandscape ? 6 : 8),
            left: hudLeft + 2,
            right: hudRight,
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.titleBlock} pointerEvents="none">
          {stats.visitedCount === 0 ? (
            <>
              <Text style={[styles.emptyHeadline, { color: theme.textPrimary }]}>
                Tap a country you've been to
              </Text>
              <Text style={[styles.countSub, { color: theme.textSecondary }]}>
                0 of {stats.totalCount}{' '}
                {userProfile.includeTerritories ? 'places' : 'countries'}
              </Text>
            </>
          ) : (
            <>
              <Text
                style={[
                  isLandscape ? styles.countHeadlineCompact : styles.countHeadline,
                  { color: theme.textPrimary },
                ]}
              >
                {stats.visitedCount}
                <Text
                  style={[
                    isLandscape ? styles.countDenomCompact : styles.countDenom,
                    { color: theme.textSecondary },
                  ]}
                >
                  {' '}
                  of {stats.totalCount}
                </Text>
              </Text>
              {!isLandscape && (
                <Text style={[styles.countSub, { color: theme.textSecondary }]}>
                  {userProfile.includeTerritories ? 'places' : 'countries'}
                </Text>
              )}
            </>
          )}
        </View>

        <View style={styles.topActions}>
          <Pressable
            onPress={onOpenSearch}
            hitSlop={6}
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
        </View>
      </View>

      {/* Bottom Legend-as-Filter & Conditional Recenter Pill */}
      {!selectedPlaceId && (
        <View
          style={[
            styles.bottomRow,
            {
              bottom: bottomHudOffset,
              left: hudLeft,
              right: hudRight,
            },
          ]}
          pointerEvents="box-none"
        >
          {overlayMode === 'year' && activeYearCollection ? (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setOverlayMode('all');
              }}
              hitSlop={6}
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
                  hitSlop={6}
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
                  hitSlop={6}
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
                    hitSlop={6}
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
                hitSlop={6}
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
    zIndex: 30,
    elevation: 10,
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
  countHeadlineCompact: {
    fontFamily: FONTS.num,
    fontSize: 22,
    lineHeight: 26,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  countDenom: {
    fontFamily: FONTS.numMedium,
    fontSize: 19,
  },
  countDenomCompact: {
    fontFamily: FONTS.numMedium,
    fontSize: 15,
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
    zIndex: 30,
    elevation: 10,
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
    padding: 3,
    gap: 2,
  },
  legendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 12,
    height: 40,
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
