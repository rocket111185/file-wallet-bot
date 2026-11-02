import { defineConfig } from 'drizzle-kit';

// Migrations for the UserVault Durable Object; each vault applies them itself on startup
export default defineConfig({
  dialect: 'sqlite',
  driver: 'durable-sqlite',
  schema: './src/db/schemas/user-vault.ts',
  out: './drizzle/user-vault',
});
