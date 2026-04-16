/**
 * Creates MongoDB indexes for all collections.
 * Does NOT insert any data — all content must come from real usage.
 *
 * Usage: npm run seed
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath   = resolve(__dirname, "../.env.local");

let uri    = "";
let dbName = "satyam_ai";

try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("MONGODB_URI=")) uri    = t.slice("MONGODB_URI=".length);
    if (t.startsWith("MONGODB_DB="))  dbName = t.slice("MONGODB_DB=".length);
  }
} catch {
  console.error("Could not read .env.local");
  process.exit(1);
}

if (!uri) { console.error("MONGODB_URI not found in .env.local"); process.exit(1); }

const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db(dbName);

  // leads
  await db.collection("leads").createIndex({ status:    1 });
  await db.collection("leads").createIndex({ createdAt: -1 });
  await db.collection("leads").createIndex({ phone:     1 }, { unique: false });
  console.log("✅ leads indexes");

  // templates
  await db.collection("templates").createIndex({ channel:   1 });
  await db.collection("templates").createIndex({ updatedAt: -1 });
  console.log("✅ templates indexes");

  // followups
  await db.collection("followups").createIndex({ status:  1 });
  await db.collection("followups").createIndex({ dueDate: 1 });
  console.log("✅ followups indexes");

  // settings (single document)
  await db.collection("settings").createIndex({ singleton: 1 }, { unique: true, sparse: true });
  console.log("✅ settings index");

  // whatsapp_messages
  await db.collection("whatsapp_messages").createIndex({ waMessageId: 1 }, { unique: true });
  await db.collection("whatsapp_messages").createIndex({ from: 1, timestamp: -1 });
  console.log("✅ whatsapp_messages indexes");

  // webhook_logs
  await db.collection("webhook_logs").createIndex({ waMessageId: 1 }, { unique: true });
  await db.collection("webhook_logs").createIndex({ from: 1, createdAt: -1 });
  console.log("✅ webhook_logs indexes");

  console.log(`\n✅ All indexes created on "${dbName}". No dummy data inserted.`);
} catch (err) {
  console.error("❌ Setup failed:", err.message);
  process.exit(1);
} finally {
  await client.close();
}
