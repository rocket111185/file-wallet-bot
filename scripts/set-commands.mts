/**
 * Publishes the command menu (src/bot/commands.ts) to Telegram with `setMyCommands`, one call per
 * language. Runs on your machine with plain Node, after `wrangler deploy` (see `npm run deploy`),
 * so the Worker doesn't need a route for it.
 *
 * Needs the production bot token in `BOT_TOKEN`: from the environment, or from a `.env` file
 * (gitignored). Run `npm run commands:set` on its own to publish the menu without deploying.
 *
 * Node runs the TypeScript sources directly (type stripping), so everything src/bot/commands.ts
 * imports must stay erasable TypeScript: no enums, namespaces or `constructor(private x)`.
 */
import { registerHooks } from 'node:module';

// Node knows neither the `src/*` alias (tsconfig.json) nor extensionless imports: map one to the other
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier.startsWith('src/')) {
      const resolvedSrcPath = new URL(`../${specifier}.ts`, import.meta.url);
      return next(resolvedSrcPath.href, context);
    }

    return next(specifier, context);
  },
});

// Imported after the hook is registered, so the alias resolves
const { Api } = await import('grammy');
const { menuCommands } = await import('src/bot/commands');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN is not set. Put it in .env or pass it: BOT_TOKEN=... npm run commands:set');
  process.exit(1);
}

try {
  await menuCommands.setCommands({ api: new Api(token) });
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : err
  console.error('Telegram rejected the command menu:', errorMessage);
  process.exit(1);
}

for (const { language_code, commands } of menuCommands.toArgs().scopes) {
  const commandList = commands.map((botCommand) => `/${botCommand.command}`).join(', ');
  const language = language_code ?? 'default';

  console.log(`Menu set (${language}): ${commandList}`);
}
