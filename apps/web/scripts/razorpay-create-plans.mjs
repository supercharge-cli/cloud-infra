#!/usr/bin/env node
/**
 * Create (or find) one monthly Razorpay Plan per paid sandbox size and print
 * the env lines to set. Idempotent: an existing plan with the same size,
 * currency and amount (matched by notes) is reused.
 *
 * Usage (from apps/web, with YOUR keys in the shell — test keys first):
 *   RAZORPAY_KEY_ID=rzp_test_… RAZORPAY_KEY_SECRET=… node scripts/razorpay-create-plans.mjs
 *   … --currency USD     plans in USD (needs international payments enabled)
 *   … --dry-run          list what would be created, create nothing
 *
 * Sizes and prices are read from lib/billing.ts so they never drift.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const currencyArg = args.includes('--currency') ? args[args.indexOf('--currency') + 1] : 'INR';
const currency = String(currencyArg || 'INR').toUpperCase();
if (currency !== 'INR' && currency !== 'USD') {
  console.error('--currency must be INR or USD');
  process.exit(2);
}

const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
if (!keyId || !keySecret) {
  console.error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in this shell (not printed).');
  process.exit(2);
}
const mode = keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST';

// ── sizes from lib/billing.ts ───────────────────────────────────────────
const billingSrc = readFileSync(new URL('../lib/billing.ts', import.meta.url), 'utf8');
const sizes = [...billingSrc.matchAll(/\{\s*id:\s*'(hosting-[a-z0-9]+)',\s*cpu:\s*(\d+),\s*memoryMb:\s*(\d+),\s*priceInr:\s*([\d.]+),\s*priceUsd:\s*([\d.]+),\s*name:\s*'([^']+)'\s*\}/g)]
  .map((m) => ({ id: m[1], cpu: Number(m[2]), memoryMb: Number(m[3]), priceInr: Number(m[4]), priceUsd: Number(m[5]), name: m[6] }));
if (!sizes.length) {
  console.error('Could not read sandbox sizes from lib/billing.ts');
  process.exit(1);
}

const sizeKey = (id) => id.replace(/^hosting-/, '').replace(/[^a-z0-9]/gi, '_').toUpperCase();
const envKey = (id) => `RAZORPAY_PLAN_ID_${sizeKey(id)}${currency === 'USD' ? '_USD' : ''}`;
const amountFor = (size) => Math.round((currency === 'USD' ? size.priceUsd : size.priceInr) * 100);

// ── Razorpay API ────────────────────────────────────────────────────────
const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
async function api(method, path, body) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.error?.description || ''}`.trim());
  return data;
}

async function listPlans() {
  const all = [];
  for (let skip = 0; ; skip += 100) {
    const page = await api('GET', `/plans?count=100&skip=${skip}`);
    all.push(...(page.items || []));
    if (!page.items || page.items.length < 100) break;
  }
  return all;
}

const existing = await listPlans();
console.error(`[${mode}] ${existing.length} existing plan(s) on this account`);

const lines = [];
for (const size of sizes) {
  const amount = amountFor(size);
  const match = existing.find(
    (p) =>
      p.period === 'monthly' &&
      Number(p.interval) === 1 &&
      p.notes?.vectra_size === size.id &&
      p.item?.currency === currency &&
      Number(p.item?.amount) === amount,
  );
  if (match) {
    console.error(`= ${size.id}: reuse ${match.id} (${currency} ${amount / 100}/mo)`);
    lines.push(`${envKey(size.id)}=${match.id}`);
    continue;
  }
  if (dryRun) {
    console.error(`+ ${size.id}: would create ${currency} ${amount / 100}/mo`);
    continue;
  }
  const plan = await api('POST', '/plans', {
    period: 'monthly',
    interval: 1,
    item: {
      name: `Vectra Cloud sandbox · ${size.name}`,
      amount,
      currency,
      description: `${size.cpu} vCPU, ${Math.round(size.memoryMb / 1024)} GB sandbox, billed monthly`,
    },
    notes: { product: 'vectra-cloud', vectra_size: size.id, currency },
  });
  console.error(`+ ${size.id}: created ${plan.id} (${currency} ${amount / 100}/mo)`);
  lines.push(`${envKey(size.id)}=${plan.id}`);
}

console.error(`\nSet these in Vercel (${mode} keys → ${mode === 'LIVE' ? 'Production' : 'Preview/Development'}):`);
console.log(lines.join('\n'));
