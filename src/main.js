/**
 * Apify Actor entry point for the Notion AI Agent.
 *
 * Two modes:
 *   - YouTube research (searchKeyword): searches YouTube, scores channels, appends to Notion page
 *   - Generic Notion agent (task): natural language Notion operations via LLM + tools
 *
 * Notion auth is per-user: the actor accepts a notionUserEmail, creates a Scalekit
 * connected account with that email as the identifier, generates a magic link if the
 * account is not yet authorized, outputs it immediately, then polls until ACTIVE before
 * proceeding. If the account is already ACTIVE from a previous run it skips auth entirely.
 *
 * YouTube continues to use the shared static connected account (youtubeIdentifier).
 */

import { Actor } from 'apify';
import { ScalekitClient } from '@scalekit-sdk/node';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { PROVIDERS, DEFAULT_MODELS } from './llm.js';
import { runAgent } from './agent.js';
import { runYouTubeNotionWorkflow } from './youtubeNotionWorkflow.js';
import { ensureNotionConnected } from './notionAuth.js';

await Actor.init();

try {
  const input = await Actor.getInput();

  const {
    task,
    searchKeyword,
    notionPageId,
    llmProvider = PROVIDERS.ANTHROPIC,
    llmModel = '',
    llmApiKey,
    scalekitEnvUrl,
    scalekitClientId,
    scalekitClientSecret,
    notionUserEmail,
    youtubeIdentifier = 'shared-youtube',
    topN = 15,
    maxIterations = 10,
    authTimeoutSeconds = 300,
  } = input;

  if (!searchKeyword && !task) {
    throw new Error('Provide either "task" (generic agent) or "searchKeyword" (YouTube research workflow).');
  }
  if (!notionUserEmail) throw new Error('Input "notionUserEmail" is required.');
  if (!llmApiKey) throw new Error('Input "llmApiKey" is required.');
  if (!scalekitEnvUrl || !scalekitClientId || !scalekitClientSecret) {
    throw new Error('Scalekit credentials (scalekitEnvUrl, scalekitClientId, scalekitClientSecret) are required.');
  }

  // Build LLM client
  let client;
  if (llmProvider === PROVIDERS.ANTHROPIC) {
    client = new Anthropic({ apiKey: llmApiKey });
  } else if (llmProvider === PROVIDERS.OPENAI) {
    client = new OpenAI({ apiKey: llmApiKey });
  } else {
    throw new Error(`Unknown llmProvider: "${llmProvider}". Use "anthropic" or "openai".`);
  }

  const scalekit = new ScalekitClient(scalekitEnvUrl, scalekitClientId, scalekitClientSecret);
  const resolvedModel = llmModel || DEFAULT_MODELS[llmProvider];

  console.log(`LLM: ${llmProvider} / ${resolvedModel}`);
  console.log(`Notion user: ${notionUserEmail}`);

  // ── Notion auth: per-user connected account ──────────────────────────────
  await ensureNotionConnected(scalekit.actions, notionUserEmail, {
    timeoutMs: authTimeoutSeconds * 1000,
    onMagicLink: async (link) => {
      console.log(`\nNotion authorization required for ${notionUserEmail}.`);
      console.log(`Magic link: ${link}\n`);
      // Surface the link immediately in the actor's key-value store OUTPUT so
      // the user can see and click it while the actor polls in the background.
      await Actor.setValue('OUTPUT', {
        status: 'AWAITING_NOTION_AUTH',
        notionUserEmail,
        magicLink: link,
        message: `Open the magic link to authorize Notion for ${notionUserEmail}. The actor will continue automatically once you complete authorization.`,
      });
    },
  });

  // notionUserEmail is now the active Scalekit identifier for all Notion calls
  const notionIdentifier = notionUserEmail;

  if (searchKeyword) {
    // ── YouTube → Notion research workflow ──────────────────────────────────
    if (!notionPageId) throw new Error('"notionPageId" is required when using searchKeyword.');
    console.log(`Mode: YouTube research workflow`);
    console.log(`Keyword: ${searchKeyword} | Notion page: ${notionPageId}`);

    const { topChannels, totalChannelsFound, variations } = await runYouTubeNotionWorkflow({
      client,
      provider: llmProvider,
      model: resolvedModel,
      scalekitActions: scalekit.actions,
      youtubeIdentifier,
      notionIdentifier,
      notionPageId,
      keyword: searchKeyword,
      topN,
    });

    await Actor.charge({ eventName: 'task-completed', count: 1 });
    await Actor.setValue('OUTPUT', {
      status: 'DONE',
      notionUserEmail,
      keyword: searchKeyword,
      variations,
      totalChannelsFound,
      topChannels,
      notionPageId,
    });
    await Actor.pushData({ keyword: searchKeyword, variations, totalChannelsFound, topChannels, notionPageId });
    console.log(`\nDone. ${topChannels.length} channels written to Notion.`);
  } else {
    // ── Generic Notion agent ─────────────────────────────────────────────────
    console.log(`Mode: Generic Notion agent | Task: ${task}`);

    const { result, steps } = await runAgent({
      client,
      provider: llmProvider,
      model: resolvedModel,
      scalekitActions: scalekit.actions,
      identifier: notionIdentifier,
      task,
      maxIterations,
      onStep: async (step) => {
        if (step.type === 'tool_call') {
          console.log(`[tool] ${step.tool} → ${step.status}`);
          if (step.error) console.error(`  Error: ${step.error}`);
          if (step.status === 'success') {
            await Actor.charge({ eventName: 'tool-call', count: 1 });
          }
        } else if (step.type === 'final') {
          console.log('[done] Agent finished.');
          await Actor.charge({ eventName: 'task-completed', count: 1 });
        }
      },
    });

    await Actor.setValue('OUTPUT', { status: 'DONE', notionUserEmail, task, result, steps, llmProvider, model: resolvedModel });
    await Actor.pushData({ task, result, steps, llmProvider, model: resolvedModel });
    console.log('\nResult:\n', result);
  }
} catch (err) {
  console.error('Actor failed:', err.message);
  await Actor.fail(err.message);
}

await Actor.exit();
