// Tiny zero-dependency canvas candlestick renderer for the popup's mini chart.
import { UP, DOWN } from './format.js';

// Map a price to a y pixel inside [top, bottom] given the value range [min, max].
// Higher price -> smaller y (closer to top). Pure, unit-tested.
export function priceToY(price, min, max, top, bottom) {
  if (max === min) return (top + bottom) / 2;
  return bottom - ((price - min) / (max - min)) * (bottom - top);
}

// Draw {t,o,h,l,c} candles onto a canvas, handling HiDPI scaling.
export function drawCandles(canvas, candles) {
  const dpr = (typeof self !== 'undefined' && self.devicePixelRatio) || 1;
  const cssW = canvas.clientWidth || 296;
  const cssH = canvas.clientHeight || 150;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!candles || candles.length === 0) return;

  const padTB = 8;
  const top = padTB;
  const bottom = cssH - padTB;
  const left = 4;
  const right = cssW - 4;

  let min = Infinity;
  let max = -Infinity;
  for (const c of candles) {
    if (c.l < min) min = c.l;
    if (c.h > max) max = c.h;
  }
  const pad = (max - min) * 0.05 || 1;
  min -= pad;
  max += pad;

  const n = candles.length;
  const slot = (right - left) / n;
  const bodyW = Math.max(1, slot * 0.6);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const xc = left + slot * (i + 0.5);
    const up = c.c >= c.o;
    const color = up ? UP : DOWN;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    // wick (high-low)
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xc, priceToY(c.h, min, max, top, bottom));
    ctx.lineTo(xc, priceToY(c.l, min, max, top, bottom));
    ctx.stroke();

    // body (open-close)
    const yOpen = priceToY(c.o, min, max, top, bottom);
    const yClose = priceToY(c.c, min, max, top, bottom);
    const yTop = Math.min(yOpen, yClose);
    const h = Math.max(1, Math.abs(yOpen - yClose));
    ctx.fillRect(xc - bodyW / 2, yTop, bodyW, h);
  }
}
