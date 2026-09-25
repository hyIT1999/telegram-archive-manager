/** How an image is zoomed: its scale and its offset from the centre, in screen pixels. */
export interface ZoomState {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const ZOOM_RESET: ZoomState = { scale: 1, x: 0, y: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
/** One step of the zoom buttons and keys. */
export const ZOOM_STEP = 1.5;

/** The displayed size of the image at scale 1. */
export interface ZoomBounds {
  readonly width: number;
  readonly height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Moves a zoomed image, never so far that its edge comes inside the frame. */
export function panBy(state: ZoomState, dx: number, dy: number, bounds: ZoomBounds): ZoomState {
  if (state.scale <= MIN_SCALE) {
    return ZOOM_RESET;
  }
  const limitX = (bounds.width * (state.scale - 1)) / 2;
  const limitY = (bounds.height * (state.scale - 1)) / 2;
  return {
    scale: state.scale,
    x: clamp(state.x + dx, -limitX, limitX),
    y: clamp(state.y + dy, -limitY, limitY),
  };
}

/**
 * Zooms by `factor` around `point` (screen pixels from the frame's centre), keeping the part of the
 * image under that point where it is, as maps and photo apps do.
 */
export function zoomAt(
  state: ZoomState,
  factor: number,
  bounds: ZoomBounds,
  point: { x: number; y: number } = { x: 0, y: 0 },
): ZoomState {
  const scale = clamp(state.scale * factor, MIN_SCALE, MAX_SCALE);
  if (scale === MIN_SCALE) {
    return ZOOM_RESET;
  }
  const ratio = scale / state.scale;
  const zoomed = {
    scale,
    x: point.x - (point.x - state.x) * ratio,
    y: point.y - (point.y - state.y) * ratio,
  };
  return panBy(zoomed, 0, 0, bounds);
}

export function zoomTransform(state: ZoomState): string {
  return `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
}
