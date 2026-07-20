import { MongoClient, type Db } from 'mongodb';

const uri = process.env.MONGODB_URI || '';
const dbName = process.env.MONGODB_DB || 'vectra_cloud';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes(db);
  return db;
}

async function ensureIndexes(database: Db): Promise<void> {
  await database.collection('users').createIndex({ email: 1 }, { unique: true });
  await database.collection('instances').createIndex({ userId: 1, createdAt: -1 });
  await database.collection('instances').createIndex({ id: 1 }, { unique: true });
}
