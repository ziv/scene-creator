/**
 * The map's backing buffer is its CSS size × devicePixelRatio. To get an exact
 * backing buffer of (width, height), the stage is laid out at width/dpr ×
 * height/dpr CSS pixels and CSS-scaled to fit the viewport. A transform does
 * not change layout size, so the buffer keeps its size while the element
 * shrinks visually.
 */
export interface StageLayout {
  cssWidth: number;
  cssHeight: number;
  /** Fit scale, never above 1. */
  scale: number;
}

export function layoutStage(width: number, height: number, dpr: number, availW: number, availH: number): StageLayout {
  const cssWidth = width / dpr;
  const cssHeight = height / dpr;
  const scale = Math.min(availW / cssWidth, availH / cssHeight, 1);
  return { cssWidth, cssHeight, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}

export function applyStage(stage: HTMLElement, layout: StageLayout): void {
  stage.style.width = `${layout.cssWidth}px`;
  stage.style.height = `${layout.cssHeight}px`;
  stage.style.transform = `scale(${layout.scale})`;
}
