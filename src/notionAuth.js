/**
 * Notion connected-account auth helper.
 *
 * Ensures a per-user Notion connected account (identified by email) is ACTIVE
 * before the actor proceeds with any Notion operations.
 *
 * Flow:
 *   1. Check if the account for `email` is already ACTIVE → return immediately
 *   2. If not, generate a magic link (OAuth authorization URL) and call onMagicLink(link)
 *   3. Poll Scalekit every `pollIntervalMs` until the account becomes ACTIVE or `timeoutMs` elapses
 */

const ACTIVE = 1;
const STATUS_LABEL = { 0: 'UNSPECIFIED', 1: 'ACTIVE', 2: 'EXPIRED', 3: 'PENDING_AUTH' };

/**
 * @param {object} scalekitActions - scalekit.actions from ScalekitClient
 * @param {string} email           - user email, used as the Scalekit connected-account identifier
 * @param {object} opts
 * @param {number}   opts.pollIntervalMs - how often to poll for auth status (default: 5000 ms)
 * @param {number}   opts.timeoutMs      - max time to wait for authorization (default: 300 000 ms = 5 min)
 * @param {Function} opts.onMagicLink    - async callback(link: string) invoked once when the magic link is ready
 * @returns {Promise<string>} Scalekit connectedAccountId once the account is ACTIVE
 */
export async function ensureNotionConnected(scalekitActions, email, {
  pollIntervalMs = 5_000,
  timeoutMs = 300_000,
  onMagicLink = async () => {},
} = {}) {
  const resp = await scalekitActions.getOrCreateConnectedAccount({
    connectionName: 'notion',
    identifier: email,
  });
  const account = resp.connectedAccount ?? resp;

  if (account.status === ACTIVE) {
    console.log(`Notion account for "${email}" is already ACTIVE — skipping authorization.`);
    return account.id;
  }

  const statusLabel = STATUS_LABEL[account.status] ?? account.status;
  console.log(`Notion account for "${email}" is ${statusLabel}. Generating magic link...`);

  const { link } = await scalekitActions.getAuthorizationLink({
    connectionName: 'notion',
    identifier: email,
  });

  await onMagicLink(link);

  console.log(`Waiting for user to authorize Notion (timeout: ${timeoutMs / 1000}s)...`);

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const pollResp = await scalekitActions.getOrCreateConnectedAccount({
      connectionName: 'notion',
      identifier: email,
    });
    const polledAccount = pollResp.connectedAccount ?? pollResp;
    const pollLabel = STATUS_LABEL[polledAccount.status] ?? polledAccount.status;

    console.log(`  Notion auth status for "${email}": ${pollLabel}`);

    if (polledAccount.status === ACTIVE) {
      console.log(`  Notion account for "${email}" is now ACTIVE.`);
      return polledAccount.id;
    }
  }

  throw new Error(
    `Timed out after ${timeoutMs / 1000}s waiting for Notion authorization. ` +
    `Please complete the authorization via the magic link and re-run the actor.`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
