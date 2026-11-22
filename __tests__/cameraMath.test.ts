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
});
