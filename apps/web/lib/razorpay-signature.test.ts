import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type * as Razorpay from './razorpay';

const { loadLib } = (await import(new URL('./subscription-test-loader.ts', import.meta.url).href)) as typeof import('./subscription-test-loader');
const rp = loadLib<typeof Razorpay>('razorpay');
const SECRET = 'test_webhook_secret_not_real';
const hmac = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');

test('webhook signature: valid raw body passes, any byte change or wrong secret fails', () => {
  const raw = '{"event":"subscription.charged","payload":{"subscription":{"entity":{"id":"sub_1"}}}}';
  assert.equal(rp.verifyWebhookSignatureWith(raw, hmac(raw), SECRET), true);
  assert.equal(rp.verifyWebhookSignatureWith(`${raw} `, hmac(raw), SECRET), false, 're-serialised body must not verify');
  assert.equal(rp.verifyWebhookSignatureWith(raw, hmac(raw, 'other'), SECRET), false);
  assert.equal(rp.verifyWebhookSignatureWith(raw, 'short', SECRET), false);
  assert.equal(rp.verifyWebhookSignatureWith(raw, '', SECRET), false);
  assert.equal(rp.verifyWebhookSignatureWith(raw, hmac(raw), ''), false);
});

test('webhook signature reads RAZORPAY_WEBHOOK_SECRET and refuses when unset', () => {
  const raw = '{"event":"subscription.activated"}';
  const prev = process.env.RAZORPAY_WEBHOOK_SECRET;
  try {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    assert.equal(rp.verifyWebhookSignature(raw, hmac(raw)), true);
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    assert.equal(rp.verifyWebhookSignature(raw, hmac(raw)), false);
  } finally {
    if (prev === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = prev;
  }
});

test('checkout subscription signature is HMAC(payment_id|subscription_id)', () => {
  const sig = hmac('pay_123|sub_456', 'key_secret_not_real');
  const ok = rp.verifySubscriptionPaymentSignature({ subscriptionId: 'sub_456', paymentId: 'pay_123', signature: sig, secret: 'key_secret_not_real' });
  assert.equal(ok, true);
  const swapped = rp.verifySubscriptionPaymentSignature({ subscriptionId: 'pay_123', paymentId: 'sub_456', signature: sig, secret: 'key_secret_not_real' });
  assert.equal(swapped, false);
});
