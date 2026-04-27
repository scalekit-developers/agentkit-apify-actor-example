/**
 * Notion tool definitions (provider-agnostic) and Scalekit execution layer.
 *
 * Tool schemas match the Scalekit pre-built Notion tools exactly.
 * To add more tools, copy from the full list of 18 Notion tools in Scalekit.
 */

/** Provider-agnostic tool definitions — used to build prompts for both Claude and OpenAI */
export const NOTION_TOOL_DEFINITIONS = [
  {
    name: 'notion_data_fetch',
    description:
      'Search the Notion workspace for pages and databases by keyword. Returns a list of matching items with their IDs and titles. Use this first to find pages before reading them.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text search query to find pages or databases',
        },
        page_size: {
          type: 'number',
          description: 'Max number of results to return (1-100, default 10)',
        },
        start_cursor: {
          type: 'string',
          description: 'Pagination cursor from a previous response',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_page_search',
    description:
      'Search Notion pages by text query. Returns matching pages with their titles, IDs, and metadata. Use this to find a target page by name before reading or writing.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text to search for across Notion pages',
        },
        page_size: {
          type: 'number',
          description: 'Maximum number of pages to return (1-100)',
        },
        start_cursor: {
          type: 'string',
          description: 'Cursor to fetch the next page of results',
        },
        sort_direction: {
          type: 'string',
          description: 'Direction to sort results',
        },
        sort_timestamp: {
          type: 'string',
          description: 'Timestamp field to sort results by',
        },
      },
    },
  },
  {
    name: 'notion_page_get',
    description:
      'Get metadata and properties of a Notion page by its ID. Returns title, parent, and all page properties.',
    parameters: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'The Notion page ID (hyphenated UUID, e.g. 12345678-1234-1234-1234-123456789012)',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'notion_page_content_get',
    description:
      'Get the full text content and blocks of a Notion page. Use the page ID as block_id.',
    parameters: {
      type: 'object',
      properties: {
        block_id: {
          type: 'string',
          description: 'The page or block ID to retrieve children from (same as page_id)',
        },
        page_size: {
          type: 'number',
          description: 'Number of blocks to return (max 100)',
        },
        start_cursor: {
          type: 'string',
          description: 'Cursor for pagination from a previous response',
        },
      },
      required: ['block_id'],
    },
  },
  {
    name: 'notion_page_content_append',
    description:
      'Append content blocks to an existing Notion page. Use block_id = the page ID. Blocks use a simplified format: { type, text } where type is one of: paragraph, heading_1, heading_2, heading_3, bulleted_list_item, numbered_list_item, divider. Text is omitted for divider.',
    parameters: {
      type: 'object',
      properties: {
        block_id: {
          type: 'string',
          description: 'The Notion page ID to append blocks to',
        },
        blocks: {
          type: 'array',
          description:
            'Blocks to append. Examples: [{"type":"heading_2","text":"Title"}, {"type":"bulleted_list_item","text":"Item"}, {"type":"divider"}]',
          items: { type: 'object' },
        },
      },
      required: ['block_id', 'blocks'],
    },
  },
  {
    name: 'notion_find_or_create_page',
    description:
      'Find a Notion page by exact title. If no matching page exists, create it under parent_page_id, database_id, or the configured default parent/database. Returns the page ID to use for appending content.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The page title to find or create',
        },
        parent_page_id: {
          type: 'string',
          description: 'Optional parent page ID used when creating the page',
        },
        database_id: {
          type: 'string',
          description: 'Optional database ID used when creating the page',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'notion_page_create',
    description:
      'Create a new Notion page. Use parent_page_id to create a child page, or database_id to create a database row. Do not provide both. For child pages with title: pass it in properties as {"title": {"title": [{"text": {"content": "Your Title"}}]}}. child_blocks is optional content.',
    parameters: {
      type: 'object',
      properties: {
        parent_page_id: {
          type: 'string',
          description: 'ID of the parent page (use this OR database_id, not both)',
        },
        database_id: {
          type: 'string',
          description: 'ID of the parent database (use this OR parent_page_id, not both)',
        },
        properties: {
          type: 'object',
          description:
            'Page properties. For a simple title: {"title": {"title": [{"text": {"content": "My Page"}}]}}. For database rows, key by property name.',
        },
        child_blocks: {
          type: 'array',
          description:
            'Content blocks. Example paragraph: [{"object":"block","type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Hello"}}]}}]',
          items: { type: 'object' },
        },
      },
    },
  },
];

function getToolData(result) {
  return result?.data ?? result?.page ?? result;
}

function findResultsArray(value) {
  if (!value || typeof value !== 'object') return [];

  const directResults = Array.isArray(value.results) ? value.results : null;
  const directItems = Array.isArray(value.items) ? value.items : null;
  if (directResults?.length > 0) return directResults;
  if (directItems?.length > 0) return directItems;

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      const results = findResultsArray(nested);
      if (results.length > 0) return results;
    }
  }

  return directResults ?? directItems ?? [];
}

function getTitleFromRichText(items) {
  if (!Array.isArray(items)) return null;

  const title = items
    .map((item) => item.plain_text ?? item.text?.content ?? '')
    .join('')
    .trim();

  return title || null;
}

function extractNotionPageTitle(page) {
  const data = getToolData(page);

  if (typeof data?.title === 'string' && data.title.trim()) {
    return data.title.trim();
  }

  const properties = data?.properties;
  if (!properties || typeof properties !== 'object') {
    return null;
  }

  for (const property of Object.values(properties)) {
    if (property?.type === 'title') {
      return getTitleFromRichText(property.title);
    }
  }

  return null;
}

function getNotionPageId(page) {
  const data = getToolData(page);
  return data?.id ?? page?.id ?? null;
}

function normalizeTitle(title) {
  return title?.trim().toLowerCase() ?? '';
}

function buildTitleProperties(title) {
  return {
    title: {
      title: [
        {
          text: {
            content: title,
          },
        },
      ],
    },
  };
}

async function findNotionPageByTitle(scalekitActions, connectedAccountId, title) {
  const result = await scalekitActions.executeTool({
    toolName: 'notion_page_search',
    connectedAccountId,
    toolInput: { query: title, page_size: 10 },
  });

  const targetTitle = normalizeTitle(title);
  const pages = findResultsArray(result);

  return (
    pages.find((page) => normalizeTitle(extractNotionPageTitle(page)) === targetTitle) ??
    pages.find((page) => normalizeTitle(extractNotionPageTitle(page)).includes(targetTitle)) ??
    null
  );
}

async function findOrCreateNotionPage(scalekitActions, connectedAccountId, toolInput, options = {}) {
  const title = toolInput?.title?.trim();
  if (!title) throw new Error('notion_find_or_create_page requires a title.');

  const existingPage = await findNotionPageByTitle(scalekitActions, connectedAccountId, title);
  if (existingPage) {
    const pageId = getNotionPageId(existingPage);
    console.log(`[Notion] Found page "${extractNotionPageTitle(existingPage) ?? title}" (${pageId}).`);
    return { created: false, pageId, title: extractNotionPageTitle(existingPage) ?? title, page: existingPage };
  }

  const parentPageId = toolInput?.parent_page_id ?? options.defaultParentPageId ?? process.env.NOTION_DEFAULT_PARENT_PAGE_ID;
  const databaseId = toolInput?.database_id ?? options.defaultDatabaseId ?? process.env.NOTION_DEFAULT_DATABASE_ID;

  if (!parentPageId && !databaseId) {
    throw new Error(
      `Notion page "${title}" was not found and cannot be created because no parent_page_id/database_id was provided. Set NOTION_DEFAULT_PARENT_PAGE_ID or NOTION_DEFAULT_DATABASE_ID to enable automatic page creation.`
    );
  }

  const createInput = {
    properties: buildTitleProperties(title),
    ...(parentPageId ? { parent_page_id: parentPageId } : { database_id: databaseId }),
  };

  console.log(`[Notion] Page "${title}" not found. Creating it now.`);
  const page = await scalekitActions.executeTool({
    toolName: 'notion_page_create',
    connectedAccountId,
    toolInput: createInput,
  });
  const pageId = getNotionPageId(page);
  console.log(`[Notion] Created page "${title}" (${pageId}).`);

  return { created: true, pageId, title, page };
}

async function getNotionAppendTarget(scalekitActions, connectedAccountId, blockId) {
  if (!blockId) return 'unknown page';

  try {
    const page = await scalekitActions.executeTool({
      toolName: 'notion_page_get',
      connectedAccountId,
      toolInput: { page_id: blockId },
    });
    const title = extractNotionPageTitle(page);

    return title ? `"${title}" (${blockId})` : `page/block ${blockId}`;
  } catch (err) {
    console.warn(`[Notion] Could not resolve append target title for ${blockId}: ${err.message}`);
    return `page/block ${blockId}`;
  }
}

/**
 * Execute a Notion tool via Scalekit's proxy.
 *
 * @param {object} scalekitActions - scalekit.actions from ScalekitClient
 * @param {string} identifier - the connected account identifier (e.g. "shared-notion")
 * @param {string} toolName - one of the NOTION_TOOL_DEFINITIONS names
 * @param {object} toolInput - input matching the tool's parameter schema
 * @returns {object} tool result
 */
export async function executeNotionTool(scalekitActions, identifier, toolName, toolInput, options = {}) {
  // Get the connected account ID for this identifier
  const resp = await scalekitActions.getOrCreateConnectedAccount({
    connectionName: 'notion',
    identifier,
  });

  const account = resp.connectedAccount ?? resp;

  // ConnectorStatus enum: 0=UNSPECIFIED, 1=ACTIVE, 2=EXPIRED, 3=PENDING_AUTH
  const ACTIVE = 1;
  if (account.status !== ACTIVE) {
    const statusName = { 0: 'UNSPECIFIED', 1: 'ACTIVE', 2: 'EXPIRED', 3: 'PENDING_AUTH' }[account.status] ?? account.status;
    throw new Error(
      `Notion account is not connected (status: ${statusName}). Run "npm run auth:setup" and complete the OAuth flow first.`
    );
  }

  if (toolName === 'notion_find_or_create_page') {
    return findOrCreateNotionPage(scalekitActions, account.id, toolInput, options);
  }

  let appendTarget = null;
  if (toolName === 'notion_page_content_append') {
    appendTarget = await getNotionAppendTarget(scalekitActions, account.id, toolInput?.block_id);
    const blockCount = Array.isArray(toolInput?.blocks) ? toolInput.blocks.length : 0;
    console.log(`[Notion] Appending ${blockCount} block(s) to ${appendTarget}.`);
  }

  const result = await scalekitActions.executeTool({
    toolName,
    connectedAccountId: account.id,
    toolInput,
  });

  if (appendTarget) {
    console.log(`[Notion] Append complete for ${appendTarget}.`);
  }

  return result;
}
