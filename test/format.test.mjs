import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBadgePrice, formatPrice, formatPct, formatFunding,
  fundingCountdown, isStale,
} from '../format.js';

test('formatBadgePrice scales to <=4 chars', () => {
  assert.equal(formatBadgePrice(68432.5), '68.4');
  assert.equal(formatBadgePrice(104210), '104k');
  assert.equal(formatBadgePrice(6842), '6.84');
  assert.equal(formatBadgePrice(0), '—');
  assert.equal(formatBadgePrice(NaN), '—');
});

test('formatPrice adds separators', () => {
  assert.equal(formatPrice(68432.5), '68,432.5');
});

test('formatPct is signed', () => {
  assert.equal(formatPct(2.314), '+2.31%');
  assert.equal(formatPct(-1.2), '-1.20%');
});

test('formatFunding converts fraction to signed percent', () => {
  assert.equal(formatFunding(0.0001), '+0.0100%');
  assert.equal(formatFunding(-0.00005), '-0.0050%');
});

test('fundingCountdown formats remaining time', () => {
  const now = 1_000_000;
  assert.equal(fundingCountdown(now + 32 * 60 * 1000, now), '32分00秒后结算');
  assert.equal(fundingCountdown(now + (3600 + 4 * 60) * 1000, now), '1时04分后结算');
  assert.equal(fundingCountdown(now - 5000, now), '0秒后结算');
});

test('isStale respects threshold', () => {
  assert.equal(isStale(1000, 2000, 10000), false);
  assert.equal(isStale(1000, 20000, 10000), true);
  assert.equal(isStale(0, 5000), true);
});
