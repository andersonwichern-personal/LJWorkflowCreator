import path from "node:path";
import { defineConfig } from "prisma/config";

// Load .env.local so Prisma CLI can read DATABASE_URL
try { process.loadEnvFile(".env.local"); } catch {}

export default defineConfig({
  earlyAccess: true,
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    // Use DIRECT_URL for migrations (PgBouncer doesn't support them)
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
