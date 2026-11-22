import {
  BASE_MAP_HEIGHT,
  BASE_MAP_WIDTH,
  clampCameraToBounds,
  computeAdaptiveStrokeWidth,
  computePortraitInitialCamera,
  fitProjectedBoundsToViewport,
  MAX_ZOOM_2D,
  MIN_ZOOM_2D,
  screenToMapPoint,
  stepCameraMultiTouch,
  zoomAroundFocalPoint,
} from '@/map/cameraMath';

describe('Portrait Camera & Navigation Math', () => {
  const portraitViewport = { width: 393, height: 852 };

  it('keeps the world point under the pinch focal point invariant across 1x-24x zoom', () => {
    const initial = { scale: 2.0, tx: -300, ty: -100 };
    const focalX = 240;
    const focalY = 410;

    const beforeMapPt = screenToMapPoint(focalX, focalY, initial);

    for (const nextScale of [1.2, 4.5, 12.0, 24.0]) {
      const next = zoomAroundFocalPoint(initial, nextScale, focalX, focalY);
      const afterMapPt = screenToMapPoint(focalX, focalY, next);

      expect(afterMapPt.x).toBeCloseTo(beforeMapPt.x, 5);
      expect(afterMapPt.y).toBeCloseTo(beforeMapPt.y, 5);
      expect(next.scale).toBeGreaterThanOrEqual(MIN_ZOOM_2D);
      expect(next.scale).toBeLessThanOrEqual(MAX_ZOOM_2D);
    }
  });

  it('frames a country cleanly above an open bottom sheet in portrait mode', () => {
    const ukBounds = { minX: 465, minY: 95, maxX: 495, maxY: 132 };
    const insets = { top: 100, bottom: 376, left: 20, right: 20 };

    const cam = fitProjectedBoundsToViewport(ukBounds, portraitViewport, insets);

    const centerX = ((ukBounds.minX + ukBounds.maxX) / 2) * cam.scale + cam.tx;
    const centerY = ((ukBounds.minY + ukBounds.maxY) / 2) * cam.scale + cam.ty;

    const expectedSafeCenterY = insets.top + (portraitViewport.height - insets.top - insets.bottom) / 2;

    expect(centerX).toBeCloseTo(portraitViewport.width / 2, 0);
    expect(centerY).toBeCloseTo(expectedSafeCenterY, 0);
    // Must stay clearly above the bottom sheet
    expect(centerY).toBeLessThan(portraitViewport.height - insets.bottom);
  });

  it('clamps extreme pan offsets while allowing generous portrait navigation', () => {
    const cam = clampCameraToBounds(
      { scale: 4, tx: 99999, ty: -99999 },
      portraitViewport,
      BASE_MAP_WIDTH,
      BASE_MAP_HEIGHT
    );
    expect(cam.tx).toBeLessThanOrEqual(portraitViewport.width * 0.45 + 1);
    expect(cam.ty).toBeGreaterThanOrEqual(
      portraitViewport.height - BASE_MAP_HEIGHT * 4 - portraitViewport.height * 0.42 - 1
    );
  });

  it('scales stroke width down smoothly as zoom increases to keep UK borders razor sharp', () => {
    const s1 = computeAdaptiveStrokeWidth(1);
    const s6 = computeAdaptiveStrokeWidth(6);
    const s20 = computeAdaptiveStrokeWidth(20);

    expect(s1).toBeGreaterThan(s6);
    expect(s6).toBeGreaterThan(s20);
    expect(s20).toBeGreaterThanOrEqual(0.14);
  });

  it('computes a comfortable zoomed portrait initial camera instead of a tiny postage-stamp world', () => {
    const cam = computePortraitInitialCamera(portraitViewport);
    expect(cam.scale).toBeGreaterThanOrEqual(MIN_ZOOM_2D);
  });

  it('frames the entire world cleanly inside a landscape viewport', () => {
    const landscape = { width: 874, height: 402 };
    const cam = computePortraitInitialCamera(landscape);
    expect(BASE_MAP_WIDTH * cam.scale).toBeLessThanOrEqual(landscape.width);
    expect(BASE_MAP_HEIGHT * cam.scale).toBeLessThanOrEqual(landscape.height);
    expect(cam.tx).toBeGreaterThanOrEqual(0);
    expect(cam.ty).toBeGreaterThanOrEqual(0);
  });

  it('produces zero focal slip across 2->1->2 finger transitions and reverses immediately at max zoom', () => {
    let cam = { scale: 2.5, tx: -900, ty: -220 };

    // Two fingers at (100, 300) and (300, 500) -> centroid (200, 400), span 282.84
    const worldBeforePinch = screenToMapPoint(200, 400, cam);
    // Spread fingers by 1.5x and pan centroid by (+20, -15)
    cam = stepCameraMultiTouch(cam, 200, 400, 220, 385, 1.5, portraitViewport);
    const worldAfterPinch = screenToMapPoint(220, 385, cam);
    expect(worldAfterPinch.x).toBeCloseTo(worldBeforePinch.x, 5);
    expect(worldAfterPinch.y).toBeCloseTo(worldBeforePinch.y, 5);

    // Finger 2 lifts -> remaining finger is at (100, 300) and moves 0px -> MUST produce 0.00 pt slip!
    const beforeLift = { ...cam };
    cam = stepCameraMultiTouch(cam, 100, 300, 100, 300, 1, portraitViewport);
    expect(cam.tx).toBeCloseTo(beforeLift.tx, 6);
    expect(cam.ty).toBeCloseTo(beforeLift.ty, 6);
    expect(cam.scale).toBeCloseTo(beforeLift.scale, 6);

    // Over-pinch past MAX_ZOOM_2D then immediately reverse -> must unstick on the very first frame
    cam = stepCameraMultiTouch(cam, 200, 400, 200, 400, 20, portraitViewport);
    expect(cam.scale).toBe(MAX_ZOOM_2D);
    cam = stepCameraMultiTouch(cam, 200, 400, 200, 400, 0.9, portraitViewport);
    expect(cam.scale).toBeCloseTo(MAX_ZOOM_2D * 0.9, 5);
  });
});
