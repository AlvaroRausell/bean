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
  SkPath,
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
  stepCameraMultiTouch,
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

  // Cache label widths once per font instance (avoids 243 measureText calls on every settle)
  const labelWidthCache = useMemo(() => {
    const map = new Map<string, number>();
    if (!labelFont) return map;
    for (const item of engine2D.places) {
      map.set(item.id, labelFont.measureText(item.place.name).width);
    }
    return map;
  }, [labelFont, engine2D.places]);

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

  // Unified pointer-slot state machine (zero-slip 1-finger pan + 2-finger pinch/pan)
  const aId = useSharedValue(-1);
  const aX = useSharedValue(0);
  const aY = useSharedValue(0);
  const bId = useSharedValue(-1);
  const bX = useSharedValue(0);
  const bY = useSharedValue(0);
  const travel = useSharedValue(0);
  const dragging = useSharedValue(false);
  const multiTouchSeq = useSharedValue(false);
  const downAt = useSharedValue(0);
  const lastCx = useSharedValue(0);
  const lastCy = useSharedValue(0);
  const vx = useSharedValue(0);
  const vy = useSharedValue(0);
  const lastT = useSharedValue(0);
  const touchSeqId = useSharedValue(0);
  const decayDoneCount = useSharedValue(0);

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

  // ---------- Unified Jump-Free Manual Camera State Machine (0.00 pt 2->1->2 slip!) ----------
  const camera2D = useMemo(
    () =>
      Gesture.Manual()
        .onTouchesDown((e, sm) => {
          const now = Date.now();
          if (aId.value < 0 && bId.value < 0) {
            // First finger down: immediately stop any active fling or camera animation
            cancelAnimation(tx);
            cancelAnimation(ty);
            cancelAnimation(scale);
            touchSeqId.value += 1;
            travel.value = 0;
            dragging.value = false;
            multiTouchSeq.value = false;
            vx.value = 0;
            vy.value = 0;
            downAt.value = now;
            lastT.value = now;
            sm.begin();
          }

          for (const t of e.changedTouches) {
            if (aId.value < 0) {
              aId.value = t.id;
              aX.value = t.x;
              aY.value = t.y;
            } else if (bId.value < 0) {
              bId.value = t.id;
              bX.value = t.x;
              bY.value = t.y;
              multiTouchSeq.value = true;
              vx.value = 0;
              vy.value = 0;
              lastT.value = now;
            }
          }

          const hasA = aId.value >= 0;
          const hasB = bId.value >= 0;
          if (hasA && hasB) {
            lastCx.value = (aX.value + bX.value) / 2;
            lastCy.value = (aY.value + bY.value) / 2;
          } else if (hasA) {
            lastCx.value = aX.value;
            lastCy.value = aY.value;
          } else if (hasB) {
            lastCx.value = bX.value;
            lastCy.value = bY.value;
          }
        })
        .onTouchesMove((e, sm) => {
          let nax = aX.value;
          let nay = aY.value;
          let nbx = bX.value;
          let nby = bY.value;
          for (const t of e.allTouches) {
            if (t.id === aId.value) {
              nax = t.x;
              nay = t.y;
            } else if (t.id === bId.value) {
              nbx = t.x;
              nby = t.y;
            }
          }

          const hasA = aId.value >= 0;
          const hasB = bId.value >= 0;
          const two = hasA && hasB;
          if (!hasA && !hasB) return;

          const cPx = two ? (aX.value + bX.value) / 2 : hasA ? aX.value : bX.value;
          const cPy = two ? (aY.value + bY.value) / 2 : hasA ? aY.value : bY.value;
          const cx = two ? (nax + nbx) / 2 : hasA ? nax : nbx;
          const cy = two ? (nay + nby) / 2 : hasA ? nay : nby;
          const dP = two ? Math.hypot(aX.value - bX.value, aY.value - bY.value) : 0;
          const d = two ? Math.hypot(nax - nbx, nay - nby) : 0;

          lastCx.value = cx;
          lastCy.value = cy;

          if (!dragging.value) {
            travel.value += Math.hypot(cx - cPx, cy - cPy) + Math.abs(d - dP);
            if (travel.value >= 8) {
              dragging.value = true;
              sm.activate();
              lastT.value = Date.now();
            }
          }

          if (dragging.value) {
            const scaleRatio = two && dP >= 24 && d >= 24 ? d / dP : 1;
            const nextCam = stepCameraMultiTouch(
              { scale: scale.value, tx: tx.value, ty: ty.value },
              cPx,
              cPy,
              cx,
              cy,
              scaleRatio,
              { width, height },
              minZoom,
              24.0
            );
            scale.value = nextCam.scale;
            tx.value = nextCam.tx;
            ty.value = nextCam.ty;

            const now = Date.now();
            const dt = now - lastT.value;
            if (!two && dt > 0 && dt < 120) {
              const alpha = 1 - Math.exp(-dt / 40);
              vx.value += alpha * (((cx - cPx) / dt) * 1000 - vx.value);
              vy.value += alpha * (((cy - cPy) / dt) * 1000 - vy.value);
              lastT.value = now;
            } else if (two) {
              vx.value = 0;
              vy.value = 0;
              lastT.value = now;
            }
          }

          aX.value = nax;
          aY.value = nay;
          bX.value = nbx;
          bY.value = nby;
        })
        .onTouchesUp((e, sm) => {
          const now = Date.now();
          // Always remove lifted pointers from changedTouches (iOS keeps them in allTouches on up)
          for (const t of e.changedTouches) {
            if (t.id === aId.value) aId.value = -1;
            else if (t.id === bId.value) bId.value = -1;
          }

          // If one finger still remains down, reset velocity and seamlessly continue panning (0.00 pt jump)
          if (aId.value >= 0 || bId.value >= 0) {
            vx.value = 0;
            vy.value = 0;
            lastT.value = now;
            return;
          }

          const mySeq = touchSeqId.value;

          if (!dragging.value) {
            // Quick two-finger tap zooms out smoothly by 0.5x
            if (multiTouchSeq.value && now - downAt.value < 260) {
              const target = clampCameraToBounds(
                zoomAroundFocalPoint(
                  { scale: scale.value, tx: tx.value, ty: ty.value },
                  scale.value * 0.5,
                  lastCx.value,
                  lastCy.value,
                  minZoom,
                  24.0
                ),
                { width, height }
              );
              const d = reduceMotion ? 0 : 220;
              scale.value = withTiming(target.scale, { duration: d });
              tx.value = withTiming(target.tx, { duration: d });
              ty.value = withTiming(target.ty, { duration: d }, (finished) => {
                if (finished && touchSeqId.value === mySeq) {
                  runOnJS(syncSettledCamera)(target.scale, target.tx, target.ty);
                }
              });
            }
            sm.fail();
            return;
          }

          const stale = now - lastT.value > 80;
          const speed = Math.hypot(vx.value, vy.value);
          if (reduceMotion || stale || speed < 120) {
            runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
            sm.end();
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

          decayDoneCount.value = 0;
          const onAxisDone = (finished?: boolean) => {
            'worklet';
            if (!finished || touchSeqId.value !== mySeq) return;
            decayDoneCount.value += 1;
            if (decayDoneCount.value === 2) {
              runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
            }
          };

          tx.value = withDecay(
            {
              velocity: vx.value * 0.85,
              deceleration: 0.993,
              clamp: [minTx, maxTx],
            },
            onAxisDone
          );
          ty.value = withDecay(
            {
              velocity: vy.value * 0.85,
              deceleration: 0.993,
              clamp: [minTy, maxTy],
            },
            onAxisDone
          );
          sm.end();
        })
        .onTouchesCancelled((_e, sm) => {
          aId.value = -1;
          bId.value = -1;
          vx.value = 0;
          vy.value = 0;
          sm.fail();
          if (dragging.value) {
            runOnJS(syncSettledCamera)(scale.value, tx.value, ty.value);
          }
        }),
    [
      width,
      height,
      minZoom,
      scale,
      tx,
      ty,
      aId,
      aX,
      aY,
      bId,
      bX,
      bY,
      travel,
      dragging,
      multiTouchSeq,
      downAt,
      lastCx,
      lastCy,
      vx,
      vy,
      lastT,
      touchSeqId,
      decayDoneCount,
      reduceMotion,
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
          if (!success || multiTouchSeq.value || dragging.value) return;
          cancelAnimation(scale);
          cancelAnimation(tx);
          cancelAnimation(ty);
          const mySeq = touchSeqId.value;
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
            if (finished && touchSeqId.value === mySeq) {
              runOnJS(syncSettledCamera)(target.scale, target.tx, target.ty);
            }
          });
        }),
    [
      width,
      height,
      minZoom,
      scale,
      tx,
      ty,
      multiTouchSeq,
      dragging,
      touchSeqId,
      reduceMotion,
      syncSettledCamera,
    ]
  );

  const singleTap2D = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDistance(20)
        .maxDuration(340)
        .onEnd((e, success) => {
          if (!success || multiTouchSeq.value || dragging.value) return;
          const pt = screenToMapPoint(e.x, e.y, {
            scale: scale.value,
            tx: tx.value,
            ty: ty.value,
          });
          runOnJS(handleTap2D)(pt.x, pt.y, scale.value);
        }),
    [scale, tx, ty, multiTouchSeq, dragging, handleTap2D]
  );

  const composed2DGesture = useMemo(
    () => Gesture.Simultaneous(camera2D, Gesture.Exclusive(doubleTap2D, singleTap2D)),
    [camera2D, doubleTap2D, singleTap2D]
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

  // ---------- Merged Skia Fill Buckets (486 draw calls -> ~8 merged paths!) ----------
  const mergedLayers = useMemo(() => {
    const colorBuilders = new Map<string, ReturnType<typeof Skia.PathBuilder.Make>>();
    const hatchBuilder = Skia.PathBuilder.Make();
    let hasHatch = false;
    const livedCentroids: { id: string; cx: number; cy: number }[] = [];

    const addToBucket = (color: string, path: SkPath) => {
      let builder = colorBuilders.get(color);
      if (!builder) {
        builder = Skia.PathBuilder.Make();
        colorBuilders.set(color, builder);
      }
      builder.addPath(path);
    };

    for (const item of engine2D.places) {
      const visual = getPlaceVisual(item.id);
      const isFlooding = activeInk?.placeId === item.id;

      if (isFlooding) {
        addToBucket(theme.landUnvisited, item.skPath);
      } else if (visual.kind === 'hatch') {
        if (hatchEffect) {
          hatchBuilder.addPath(item.skPath);
          hasHatch = true;
        } else {
          addToBucket(theme.accentSoft, item.skPath);
        }
      } else {
        addToBucket(visual.color, item.skPath);
      }

      if (visual.isLived) {
        livedCentroids.push({
          id: item.id,
          cx: item.projectedCentroid[0],
          cy: item.projectedCentroid[1],
        });
      }
    }

    const solidLayers: { color: string; path: SkPath }[] = [];
    for (const [color, builder] of colorBuilders.entries()) {
      solidLayers.push({ color, path: builder.detach() });
    }

    return {
      solidLayers,
      hatchPath: hasHatch ? hatchBuilder.detach() : null,
      livedCentroids,
    };
  }, [engine2D.places, getPlaceVisual, activeInk?.placeId, theme.landUnvisited, theme.accentSoft, hatchEffect]);

  // Pre-filtered microstates & favourite stars (keeps settle re-renders lightweight)
  const visibleMicrostates = useMemo(() => {
    const out: { id: string; cx: number; cy: number; color: string }[] = [];
    for (const item of engine2D.places) {
      if (!item.place.isMicrostate) continue;
      const status = userPlaces[item.id]?.status ?? 'none';
      if (status === 'none' && settledCam.scale < 2.5) continue;
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
      out.push({
        id: item.id,
        cx: item.projectedCentroid[0],
        cy: item.projectedCentroid[1],
        color: dotColor,
      });
    }
    return out;
  }, [engine2D.places, userPlaces, settledCam.scale, theme]);

  const visibleStars = useMemo(() => {
    const out: { id: string; cx: number; cy: number }[] = [];
    for (const item of engine2D.places) {
      const up = userPlaces[item.id];
      if (!up?.isFavorite || up.deletedAt) continue;
      if (overlayMode === 'year' && !activeYearPlaceIds.has(item.id)) continue;
      if (overlayMode === 'visited' && up.status !== 'visited' && up.status !== 'lived') continue;
      if (overlayMode === 'wishlist' && up.status !== 'wishlist') continue;
      if (overlayMode === 'skipped' && up.status !== 'skipped') continue;
      out.push({
        id: item.id,
        cx: item.projectedCentroid[0],
        cy: item.projectedCentroid[1],
      });
    }
    return out;
  }, [engine2D.places, userPlaces, overlayMode, activeYearPlaceIds]);

  // ---------- Greedy Collision-Free Live Skia Labels (with cached text widths!) ----------
  const visibleLabels = useMemo<LabelCandidate[]>(() => {
    if (settledCam.scale < 1.3 || !labelFont) return [];
    const candidates: (LabelCandidate & { sx: number; sy: number; priority: number })[] = [];

    const topEdge = safeInsets.top + (isLandscape ? 52 : 86);
    const bottomEdge = height - Math.max(safeInsets.bottom, 12) - (isLandscape ? 60 : 134);
    const leftEdge = Math.max(12, safeInsets.left + 8);
    const rightEdge = width - Math.max(12, safeInsets.right + 8);

    for (const item of engine2D.places) {
      const sx = item.projectedCentroid[0] * settledCam.scale + settledCam.tx;
      const sy = item.projectedCentroid[1] * settledCam.scale + settledCam.ty;
      const textWidth = labelWidthCache.get(item.id) ?? 48;
      const halfW = textWidth / 2;
      if (
        sx - halfW < leftEdge ||
        sx + halfW > rightEdge ||
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
    labelWidthCache,
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
      {/* Full-Bleed 60/120fps Merged-Path 2D Interactive Map Canvas */}
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
          <Canvas style={styles.canvas} opaque>
            {/* Opaque Ocean Base (eliminates transparent Metal compositing pass!) */}
            <Rect x={0} y={0} width={width} height={height} color={theme.ocean} />

            <Group transform={groupTransform}>
              {/* Continuous graticule + thin cartographic neatline */}
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

              {/* Merged Solid Fill Buckets (~5 draw calls total!) */}
              {mergedLayers.solidLayers.map((layer) => (
                <Path key={layer.color} path={layer.path} color={layer.color} />
              ))}

              {/* Single Merged Hatch Bucket (1 Shader draw call!) */}
              {mergedLayers.hatchPath && hatchEffect && (
                <Path path={mergedLayers.hatchPath}>
                  <Shader source={hatchEffect} uniforms={hatchUniforms2D} />
                </Path>
              )}

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
                </Group>
              )}

              {/* Single Deduplicated TopoJSON Border Mesh (1 draw call, 1 shared-value read!) */}
              <Path
                path={engine2D.borderMeshPath}
                color={theme.border}
                style="stroke"
                strokeWidth={adaptiveStroke}
              />

              {/* Solid Centroid Dot for "Lived" countries */}
              {mergedLayers.livedCentroids.map((dot) => (
                <Circle
                  key={`lived-${dot.id}`}
                  cx={dot.cx}
                  cy={dot.cy}
                  r={livedDotRadius}
                  color={theme.livedDot}
                />
              ))}

              {/* Microstate dots */}
              {visibleMicrostates.map((ms) => (
                <Circle
                  key={`pin-${ms.id}`}
                  cx={ms.cx}
                  cy={ms.cy}
                  r={pinRadius}
                  color={ms.color}
                />
              ))}

              {/* Cased Selection Outline (round joins kept cleanly on selected country only) */}
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

            {/* Starred Favourite Place Markers tracking at 60/120fps in screen space */}
            {visibleStars.map((st) => (
              <LiveStarMarker2D
                key={`star-${st.id}`}
                mapX={st.cx}
                mapY={st.cy}
                scale={scale}
                tx={tx}
                ty={ty}
                fillColor={theme.favoriteAccent}
                haloColor={theme.surface}
              />
            ))}

            {/* Live Stroked-Halo Skia Labels tracking the camera on the UI thread */}
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
