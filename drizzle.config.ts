import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/d1/schema.ts",
  out: "./migrations"
});
