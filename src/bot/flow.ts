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
  ctx.session.flow = null;

  const statusMessageId = flow && 'statusMessageId' in flow ? flow.statusMessageId : undefined;
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
 * For buttons: returns the current flow if it is of the given kind. Otherwise the button is left
 * over from an earlier command that was cancelled or replaced: tells the user it expired and
 * returns null.
 */
export const activeFlow = async <K extends FlowKind>(ctx: BotContext, kind: K): Promise<FlowOf<K> | null> => {
  const flow = ctx.session.flow;
  if (flow?.kind === kind) {
    return flow as FlowOf<K>;
  }
  await ctx.answerCallbackQuery({ text: ctx.tText('session-expired') });
  return null;
};

/**
 * Cancel button of a flow without a status message: ends the flow (unless another one has started
 * since) and replaces the menu with `messageKey`
 */
export const cancelFlow = async (ctx: BotContext, kind: FlowKind, messageKey: PlainMessageKey): Promise<void> => {
  if (ctx.session.flow?.kind === kind) {
    await endFlow(ctx);
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t(messageKey));
};
