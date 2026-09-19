import { getDb } from "../src/lib/db";
import { migrate } from "../src/lib/db/migrate";

async function main() {
  const db = await getDb();
  console.log("Running migrations...");
  await migrate(db);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
