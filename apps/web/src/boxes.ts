/** Lightweight Charts series primitive that draws price-range boxes from a start time to the right edge. */
export interface Box { t1: number; p1: number; p2: number; color: string; label: string }
export function boxes(series: any, items: Box[]) {
  let chart: any;
  const view = { zOrder: () => 'bottom', renderer: () => ({ draw: (target: any) => target.useBitmapCoordinateSpace((s: any) => {
    const ctx = s.context, rx = s.horizontalPixelRatio, ry = s.verticalPixelRatio;
    for (const b of items) {
      const y1 = series.priceToCoordinate(b.p1), y2 = series.priceToCoordinate(b.p2); if (y1 == null || y2 == null) continue;
      const left = Math.max(0, (chart.timeScale().timeToCoordinate(b.t1) ?? 0) * rx), top = Math.min(y1, y2) * ry, h = Math.max(Math.abs(y1 - y2) * ry, 1);
      ctx.fillStyle = b.color + '26'; ctx.fillRect(left, top, s.bitmapSize.width - left, h);
      ctx.fillStyle = b.color; ctx.font = `${10 * rx}px sans-serif`; ctx.fillText(b.label, left + 4 * rx, top + 11 * ry);
    }
  }) }) };
  return { attached: (p: any) => { chart = p.chart; }, detached() {}, updateAllViews() {}, paneViews: () => [view] };
}
