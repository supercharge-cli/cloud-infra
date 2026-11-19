import { createHmac, timingSafeEqual } from 'node:crypto';

export function razorpayKeys(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || '';
  if (!keyId || !keySecret) {
    throw new Error('Razorpay not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
  }
  return { keyId, keySecret };
}

export function publicRazorpayKeyId(): string {
  return (
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() ||
    process.env.RAZORPAY_KEY_ID?.trim() ||
    ''
  );
}

function basicAuth(): string {
  const { keyId, keySecret } = razorpayKeys();
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

export type CreateOrderInput = {
  receipt: string;
  notes: Record<string, string>;
  /** Amount in smallest currency unit (paise / cents) */
  amountMinor: number;
  currency: 'INR' | 'USD';
};

export async function createRazorpayOrder(input: CreateOrderInput): Promise<{
  id: string;
  amount: number;
  currency: string;
}> {
  const amount = input.amountMinor;
  const currency = input.currency;

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuth(),
    },
    body: JSON.stringify({
      amount,
      currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[razorpay] create order failed', err.slice(0, 500));
    throw new Error('Failed to create Razorpay order');
  }

  const order = (await response.json()) as {
    id: string;
    amount: number;
    currency: string;
  };
  return order;
}

export function verifyPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = razorpayKeys();
  const expected = createHmac('sha256', keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(input.signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  return verifyWebhookSignatureWith(rawBody, signature, secret);
}

/* ───────────────────────── Subscriptions ───────────────────────── */

export class RazorpayApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'RazorpayApiError';
    this.status = status;
    this.code = code;
  }
}

async function razorpayRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: basicAuth() },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const err = (data as { error?: { description?: string; code?: string } } | null)?.error;
    // Never log the request body or auth header.
    console.error(`[razorpay] ${method} ${path.split('?')[0]} failed`, response.status, err?.code || '');
    throw new RazorpayApiError(response.status, err?.description || `Razorpay HTTP ${response.status}`, err?.code);
  }
  return data as T;
}

export type RazorpaySubscription = {
  id: string;
  plan_id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  ended_at?: number | null;
  paid_count?: number;
  total_count?: number;
  short_url?: string | null;
  has_scheduled_changes?: boolean;
  notes?: Record<string, string>;
};

export function createRazorpaySubscription(input: {
  planId: string;
  totalCount: number;
  notes: Record<string, string>;
  /** Unix seconds — first charge date (used to honour prepaid time) */
  startAt?: number;
}): Promise<RazorpaySubscription> {
  return razorpayRequest('POST', '/subscriptions', {
    plan_id: input.planId,
    total_count: input.totalCount,
    quantity: 1,
    customer_notify: 1,
    notes: input.notes,
    ...(input.startAt ? { start_at: input.startAt } : {}),
  });
}

export function fetchRazorpaySubscription(id: string): Promise<RazorpaySubscription> {
  return razorpayRequest('GET', `/subscriptions/${encodeURIComponent(id)}`);
}

export function cancelRazorpaySubscription(id: string, atCycleEnd: boolean): Promise<RazorpaySubscription> {
  return razorpayRequest('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
    cancel_at_cycle_end: atCycleEnd ? 1 : 0,
  });
}

export function updateRazorpaySubscription(
  id: string,
  input: { planId: string; scheduleChangeAt: 'now' | 'cycle_end' },
): Promise<RazorpaySubscription> {
  return razorpayRequest('PATCH', `/subscriptions/${encodeURIComponent(id)}`, {
    plan_id: input.planId,
    schedule_change_at: input.scheduleChangeAt,
    customer_notify: 1,
  });
}

export function resumeRazorpaySubscription(id: string): Promise<RazorpaySubscription> {
  return razorpayRequest('POST', `/subscriptions/${encodeURIComponent(id)}/resume`, { resume_at: 'now' });
}

function safeEqualHex(expected: string, actual: string): boolean {
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(String(actual || ''));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Checkout (subscription mode) handler signature: HMAC(payment_id|subscription_id). */
export function verifySubscriptionPaymentSignature(input: {
  subscriptionId: string;
  paymentId: string;
  signature: string;
  secret?: string;
}): boolean {
  const secret = input.secret ?? razorpayKeys().keySecret;
  if (!secret || !input.subscriptionId || !input.paymentId) return false;
  const expected = createHmac('sha256', secret)
    .update(`${input.paymentId}|${input.subscriptionId}`)
    .digest('hex');
  return safeEqualHex(expected, input.signature);
}

/** Webhook signature check with an explicit secret (testable). */
export function verifyWebhookSignatureWith(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
