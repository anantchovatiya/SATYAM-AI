import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "satyam_ai";

if (!uri) {
  throw new Error(
    "Please add your MongoDB connection string to .env.local as MONGODB_URI"
  );
}

// In development, reuse the client across hot-reloads to avoid exhausting connections.
// In production, a module-level singleton is fine.
declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

let client: MongoClient;

if (process.env.NODE_ENV === "development") {
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri);
  }
  client = global._mongoClient;
} else {
  client = new MongoClient(uri);
}

export async function getDb(): Promise<Db> {
  await client.connect();
  return client.db(dbName);
}
