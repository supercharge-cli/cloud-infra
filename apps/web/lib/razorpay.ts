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
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
