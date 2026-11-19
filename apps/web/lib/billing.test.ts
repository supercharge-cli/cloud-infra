import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as Billing from './billing';

const { loadLib } = (await import(new URL('./subscription-test-loader.ts', import.meta.url).href)) as typeof import('./subscription-test-loader');
const billing = loadLib<typeof Billing>('billing');

const FIXED_USD: Record<string, number> = {
  'hosting-2c4g': 2.29,
  'hosting-4c8g': 4.59,
  'hosting-8c8g': 6.79,
  'hosting-16c16g': 13.49,
};

test('USD prices are the fixed amounts, not derived from INR', () => {
  const plans = billing.listPlans();
  assert.equal(plans.length, 4);
  for (const plan of plans) {
    assert.equal(plan.priceUsd, FIXED_USD[plan.id], plan.id);
    assert.equal(plan.amountCents, Math.round(FIXED_USD[plan.id] * 100));
    assert.equal(plan.amountPaise, Math.round(plan.priceInr * 100));
  }
});

test('priceForCurrency uses the fixed USD amount in major and minor units', () => {
  const plan = billing.planById('hosting-16c16g');
  const usd = billing.priceForCurrency('USD', plan);
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.display, 13.49);
  assert.equal(usd.amountMinor, 1349);
  assert.equal(usd.priceLabel, '$13.49/mo');
  assert.equal(usd.buttonLabel, 'Pay $13.49');
});

test('default sold size is 4 vCPU · 8 GB at the fixed USD price', () => {
  const plan = billing.getPlan();
  assert.equal(plan.id, 'hosting-4c8g');
  assert.equal(plan.priceInr, 399);
  assert.equal(plan.priceUsd, 4.59);
  assert.equal(plan.amountCents, 459);
});
