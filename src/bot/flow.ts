import type { BotContext } from 'src/bot/context';
import type { PlainMessageKey } from 'src/i18n/i18n';
import type { FlowKind, FlowOf } from 'src/session/session';

/** Context of an update that arrived while the user is in a flow of kind `K` */
export type FlowContext<K extends FlowKind> = BotContext & { session: { flow: FlowOf<K> } };

/**
 * Ends the current flow and deletes its status message, if any.
 *
 * @returns ID of the deleted status message, so callers can tell whether the message
 *          a button was pressed on still exists
 */
export const endFlow = async (ctx: BotContext): Promise<number | undefined> => {
  const flow = ctx.session.flow;
  const statusMessageId = flow && 'statusMessageId' in flow ? flow.statusMessageId : undefined;
  ctx.session.flow = null;

  if (statusMessageId && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => {
      // Already deleted by the user, or too old to delete
    });
  }

  return statusMessageId;
};

const isCommand = (ctx: BotContext): boolean =>
  ctx.message?.entities?.some((e) => e.type === 'bot_command' && e.offset === 0) ?? false;

/**
 * Filter for messages that are input to a flow of kind `kind` (a folder name, a file, ...).
 *
 * Commands are never input, so a command always starts over, whatever order the features are
 * registered in. An unknown command (e.g. a typo) is ignored instead of becoming a folder name.
 */
export const awaitingInput =
  <K extends FlowKind>(kind: K) =>
  (ctx: BotContext): ctx is FlowContext<K> =>
    ctx.session.flow?.kind === kind && !isCommand(ctx);

/**
 * Extra condition for a button to act on its flow, beyond the flow's kind (e.g. a folder is picked).
 * It's a type guard, so the button handler gets the flow narrowed to what the check ensures.
 */
export type FlowCheck<K extends FlowKind, F extends FlowOf<K> = FlowOf<K>> = (
  flow: FlowOf<K>,
  ctx: BotContext,
) => flow is F;

/** The current flow if it is of the given kind and passes `check` */
const matchFlow = <K extends FlowKind, F extends FlowOf<K>>(
  ctx: BotContext,
  kind: K,
  check?: FlowCheck<K, F>,
): F | null => {
  const flow = ctx.session.flow;

  if (flow?.kind !== kind) {
    return null;
  }

  if (!check || check(flow as FlowOf<K>, ctx)) {
    return flow as F;
  }

  return null;
};

/**
 * For buttons: returns the current flow if it is of the given kind and passes `check`. Otherwise
 * the button is left over from an earlier command that was cancelled or replaced: tells the user
 * it expired and returns null.
 */
export const activeFlow = async <K extends FlowKind, F extends FlowOf<K> = FlowOf<K>>(
  ctx: BotContext,
  kind: K,
  check?: FlowCheck<K, F>,
): Promise<F | null> => {
  const flow = matchFlow(ctx, kind, check);

  if (!flow) {
    await ctx.answerCallbackQuery({ text: ctx.tText('session-expired') });
  }

  return flow;
};

/**
 * Cancel button of a flow without a status message: ends the flow (unless another one has started
 * since, or it fails `check`) and replaces the menu with `messageKey`
 */
export const cancelFlow = async <K extends FlowKind>(
  ctx: BotContext,
  kind: K,
  messageKey: PlainMessageKey,
  check?: FlowCheck<K>,
): Promise<void> => {
  if (matchFlow(ctx, kind, check)) {
    await endFlow(ctx);
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t(messageKey));
};
