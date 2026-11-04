import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      src: path.resolve(__dirname, './src'),
    },
  },
  test: {
    deps: {
      optimizer: {
        ssr: {
          // CommonJS-only package that require()s grammY: loaded as is, `Composer` comes out
          // undefined in workerd. Pre-bundled with esbuild, like wrangler does for the real build.
          enabled: true,
          include: ['@grammyjs/commands'],
        },
      },
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // The KV binding is `remote: true` in wrangler.jsonc: without this, tests would hit the production namespace
      remoteBindings: false,
    }),
  ],
});
