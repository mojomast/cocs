import test from 'node:test';
import assert from 'node:assert/strict';
import {formatNumber, formatWhole, formatResource, formatCountdown} from './format-ui.mjs';

test('display numbers hide floating-point noise and redundant precision', () => {
  assert.equal(formatNumber(7.800000000000001), '7.8');
  assert.equal(formatNumber(2.0000000000000004), '2');
  assert.equal(formatNumber(1.23456), '1.2');
  assert.equal(formatNumber(1.23456, 2), '1.23');
  assert.equal(formatNumber(-0.000001), '0');
  assert.equal(formatNumber(-1.25), '-1.3');
  assert.equal(formatWhole(99.82), '100');
  for (const value of [NaN, Infinity, undefined, 'bad']) assert.equal(formatNumber(value), '0');
});

test('resource balances never advertise more than the player can spend', () => {
  assert.equal(formatResource(79.99999), '79');
  assert.equal(formatResource(80), '80');
  assert.equal(formatResource(-1), '0');
});

test('countdowns are quiet at long durations and never expire early', () => {
  assert.equal(formatCountdown(89.27), '90');
  assert.equal(formatCountdown(5.001), '6');
  assert.equal(formatCountdown(5), '5');
  assert.equal(formatCountdown(4.001), '4.1');
  assert.equal(formatCountdown(3), '3');
  assert.equal(formatCountdown(.001), '0.1');
  assert.equal(formatCountdown(0), '0');
  assert.equal(formatCountdown(-2), '0');
});
