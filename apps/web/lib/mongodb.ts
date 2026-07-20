import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Normalize Vercel / .env paste mistakes:
 * - surrounding single/double quotes
 * - accidental "MONGODB_URI=..." prefix
 * - whitespace / BOM
 */
export function resolveMongoUri(): string {
  let raw = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? '';
  raw = raw.replace(/^\uFEFF/, '').trim();

  // strip wrapping quotes: "mongodb+srv://..." or '...'
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }

  // paste of full env line
  if (/^MONGODB_URI\s*=/i.test(raw) || /^MONGO_URI\s*=/i.test(raw)) {
    raw = raw.replace(/^[A-Z_]+\s*=\s*/i, '').trim();
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1).trim();
    }
  }

  return raw;
}

export function resolveMongoDbName(): string {
  const name = (process.env.MONGODB_DB || 'vectra_cloud').trim();
  return name || 'vectra_cloud';
}

export async function getDb(): Promise<Db> {
  if (db) return db;

  const uri = resolveMongoUri();
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it in Vercel → Project → Settings → Environment Variables (Production), then redeploy.',
    );
  }
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    const preview = uri.slice(0, 24).replace(/./g, (c, i) => (i < 8 ? c : '•'));
    throw new Error(
      `Invalid MONGODB_URI scheme (got "${preview}…"). Value must start with mongodb:// or mongodb+srv:// — remove wrapping quotes in Vercel env settings.`,
    );
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(resolveMongoDbName());
  await ensureIndexes(db);
  // Seed / sync bootstrap admin(s) from ADMIN_EMAILS + ADMIN_BOOTSTRAP_PASSWORD
  try {
    const { ensureBootstrapAdmins } = await import('./store');
    await ensureBootstrapAdmins(db);
  } catch (e) {
    console.warn('[mongodb] bootstrap admin skipped:', (e as Error).message);
  }
  return db;
}

async function ensureIndexes(database: Db): Promise<void> {
  await database.collection('users').createIndex({ email: 1 }, { unique: true });
  await database.collection('instances').createIndex({ userId: 1, createdAt: -1 });
  await database.collection('instances').createIndex({ id: 1 }, { unique: true });
  await database.collection('orders').createIndex({ razorpayOrderId: 1 }, { unique: true, sparse: true });
}
