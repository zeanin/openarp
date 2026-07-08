import { Plugin } from '@formai/plugin';
import {
  LLMManager,
  OpenAIProvider,
  AnthropicProvider,
  QwenProvider,
  MockLLMProvider,
  A2DataEngine,
  A2UIEngine,
  A2FlowEngine,
  A2MenuEngine,
  AgentRuntime,
  ResourceSkillRegistry,
  SkillLogger,
} from '@formai/ai';
import type { Context, Next } from 'koa';
import type { RuntimeChatRequest, SkillContext } from '@formai/shared';
import { AGUIGateway } from './websocket';

// ─── Permission helpers ───────────────────────────────────────────────────

const AI_ADMIN_ROLES = new Set(['root', 'admin', 'developer']);

/** Requires the request to be authenticated (any logged-in user). */
function aiRequireLogin(ctx: Context): boolean {
  if (!(ctx as any).state?.currentUser) {
    (ctx as any).status = 401;
    (ctx as any).body = { errors: [{ message: 'Please log in first', code: 'UNAUTHORIZED' }] };
    return false;
  }
  return true;
}

/** Requires admin role to access sensitive AI admin operations. */
function aiRequireAdmin(ctx: Context): boolean {
  if (!aiRequireLogin(ctx)) return false;
  const role = (ctx as any).state?.currentRole;
  if (!AI_ADMIN_ROLES.has(role)) {
    (ctx as any).status = 403;
    (ctx as any).body = { errors: [{ message: 'Forbidden: Administrator role required', code: 'FORBIDDEN' }] };
    return false;
  }
  return true;
}

/**
 * AIPlugin — wires the LLMManager + AI engines + ResourceSkillRegistry onto the Application
 * and exposes REST APIs under /api/ai/* for the frontend chat panel.
 *
 * Builder Routes (generating platform resources):
 *   POST /api/ai/chat           — raw chat (builder / assistant mode)
 *   POST /api/ai/a2data         — generate a collection definition
 *   POST /api/ai/a2ui           — generate a UI schema (page or block)
 *   POST /api/ai/a2flow         — generate a workflow definition
 *   GET  /api/ai/providers      — list registered LLM providers
 *   POST /api/ai/providers      — add / update a provider config
 *
 * Runtime Routes (operating on real data via Resource Skills):
 *   POST /api/ai/runtime-chat           — user chat with skill-aware AI agent
 *   POST /api/ai/confirm-skill          — confirm a pending skill execution
 *   GET  /api/ai/skills                 — list available skills for current context
 */
export default class AIPlugin extends Plugin {
  llm!: LLMManager;
  a2data!: A2DataEngine;
  a2ui!: A2UIEngine;
  a2flow!: A2FlowEngine;
  a2menu!: A2MenuEngine;
  agentRuntime!: AgentRuntime;
  skillRegistry!: ResourceSkillRegistry;
  skillLogger!: SkillLogger;
  gateway?: AGUIGateway;

  async load(): Promise<void> {
    // Define aiProviders collection to persist LLM configs
    this.defineCollection({
      name: 'aiProviders',
      title: 'AI Providers',
      tableName: 'ai_providers',
      fields: [
        { name: 'type', type: 'string', unique: true, allowNull: false },
        { name: 'config', type: 'jsonb', defaultValue: null },
        { name: 'isDefault', type: 'boolean', defaultValue: false },
      ],
      indexes: [
        { fields: ['type'], unique: true, name: 'uq_ai_providers_type' },
      ],
    });

    // Define agentSessions collection
    this.defineCollection({
      name: 'agentSessions',
      title: 'Agent Sessions',
      tableName: 'agent_sessions',
      fields: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultValue: 'UUIDV4' },
        { name: 'name', type: 'string', allowNull: false },
        { name: 'status', type: 'enum', values: ['pending', 'running', 'waiting_approval', 'paused', 'completed', 'failed'], defaultValue: 'pending', allowNull: false },
        { name: 'triggeredBy', type: 'string', allowNull: false },
        { name: 'systemPrompt', type: 'text', allowNull: false },
        { name: 'initialPrompt', type: 'text', allowNull: false },
        { name: 'currentCheckpointId', type: 'uuid', allowNull: true },
      ],
    });

    // Define agentCheckpoints collection
    this.defineCollection({
      name: 'agentCheckpoints',
      title: 'Agent Checkpoints',
      tableName: 'agent_checkpoints',
      fields: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultValue: 'UUIDV4' },
        { name: 'sessionId', type: 'uuid', allowNull: false },
        { name: 'stepNumber', type: 'integer', allowNull: false },
        { name: 'messages', type: 'jsonb', allowNull: false },
        { name: 'variables', type: 'jsonb', defaultValue: null },
        { name: 'tokenUsage', type: 'jsonb', defaultValue: null },
      ],
    });

    // Define agentTraces collection
    this.defineCollection({
      name: 'agentTraces',
      title: 'Agent Traces',
      tableName: 'agent_traces',
      fields: [
        { name: 'id', type: 'uuid', primaryKey: true, defaultValue: 'UUIDV4' },
        { name: 'sessionId', type: 'uuid', allowNull: false },
        { name: 'parentId', type: 'uuid', allowNull: true },
        { name: 'agentName', type: 'string', allowNull: false },
        { name: 'stepType', type: 'string', allowNull: false }, // thought, tool_call, sub_agent_call, verification
        { name: 'title', type: 'string', allowNull: false },
        { name: 'input', type: 'jsonb', defaultValue: null },
        { name: 'output', type: 'jsonb', defaultValue: null },
        { name: 'durationMs', type: 'integer', allowNull: true },
        { name: 'status', type: 'string', defaultValue: 'success' },
        { name: 'errorMessage', type: 'text', allowNull: true },
      ],
    });

    // ── LLM setup ───────────────────────────────────────────────────────────

    this.llm = new LLMManager();
    this.app.llm = this.llm;

    if (process.env.OPENAI_API_KEY) {
      this.llm.registerProvider(
        new OpenAIProvider({
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: process.env.OPENAI_BASE_URL,
          model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        }),
      );
    }

    if (process.env.ANTHROPIC_API_KEY) {
      this.llm.registerProvider(
        new AnthropicProvider({
          apiKey: process.env.ANTHROPIC_API_KEY,
          model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-20241022',
        }),
      );
    }

    this.llm.registerProvider(new MockLLMProvider());

    // Load persisted providers from DB
    await this.loadDbProviders();

    const providers = this.llm.listProviders();
    const realProvider = providers.find((p) => p !== 'mock');
    if (realProvider) {
      this.llm.setDefaultProvider(realProvider);
    }

    // ── Builder Engines setup ────────────────────────────────────────────────

    this.a2data = new A2DataEngine(this.llm);
    this.a2ui = new A2UIEngine(this.llm, this.db);
    this.a2flow = new A2FlowEngine(this.llm);
    this.a2menu = new A2MenuEngine(this.llm);

    this.app.a2data = this.a2data;
    this.app.a2ui = this.a2ui;
    this.app.a2flow = this.a2flow;
    this.app.a2menu = this.a2menu;

    this.app.on('start', () => {
      if (this.app.server) {
        this.gateway = new AGUIGateway(this.app.server, {
          onUserAction: (sessionId, payload) => {
            this.handleUserAction(sessionId, payload).catch((err) => {
              console.error('[AG-UI Gateway] Error handling user action:', err.message);
            });
          }
        });
        this.app.a2uiGateway = this.gateway;
        this.a2ui.gateway = this.gateway;
      }
    });

    // Helper to resolve codex and provider configuration for UI generation routes
    const getCodexRunOptions = () => {
      const codex = (this.app as any).codex;
      let llmProviderConfig: any = undefined;
      if (codex) {
        const activeProviderName = (this.llm as any).defaultProvider || 'openai';
        const activeProvider = this.llm.getProvider(activeProviderName);
        const activeModel = (activeProvider as any).defaultModel || 'gpt-4o';
        const providerConfig = (activeProvider as any).config || {};
        
        const rawProvider = activeProviderName.toLowerCase();
        const mappedProvider = rawProvider === 'qwen'
          ? 'dashscope'
          : ['openai', 'ollama', 'lmstudio', 'amazon-bedrock', 'dashscope'].includes(rawProvider)
            ? rawProvider
            : 'openai';

        llmProviderConfig = {
          provider: mappedProvider,
          apiKey: providerConfig.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || undefined,
          baseUrl: providerConfig.baseURL || providerConfig.baseUrl || process.env.OPENAI_BASE_URL || undefined,
          model: activeModel,
          temperature: 0.2,
        };
      }
      return { codex, llmProviderConfig };
    };

    const addBlockToPageSchema = async (
      pageSchemaUid: string,
      blockKey: string,
      blockSchema: any,
    ) => {
      const repo = this.db.getRepository('uiSchemas');
      if (!repo) throw new Error('uiSchemas repository not found');
      
      const record = await repo.findOne({ filter: { uid: pageSchemaUid } });
      if (!record) throw new Error(`Page schema with uid "${pageSchemaUid}" not found`);
      
      const schema = record.schema || { type: 'object', properties: {} };
      if (!schema.properties) {
        schema.properties = {};
      }
      
      if (schema.properties.layoutGrid) {
        if (!schema.properties.layoutGrid.properties) {
          schema.properties.layoutGrid.properties = {};
        }
        schema.properties.layoutGrid.properties[blockKey] = blockSchema;
      } else {
        schema.properties[blockKey] = blockSchema;
      }
      
      await repo.update({
        filter: { id: record.id },
        values: { schema },
      });
      
      return { success: true, pageSchemaUid, blockKey };
    };

    // ── Runtime Skills setup ─────────────────────────────────────────────────

    this.skillRegistry = new ResourceSkillRegistry();
    // Mount to app for access by other plugins (e.g., collection-manager)
    this.app.skillRegistry = this.skillRegistry;

    // Initialize SkillLogger (only available after DB connection, lazy-loaded)
    const getSkillLogger = () => {
      if (!this.skillLogger) {
        this.skillLogger = new SkillLogger(this.db);
        this.app.skillLogger = this.skillLogger;
      }
      return this.skillLogger;
    };
    this.db.on?.('connected', () => {
      this.skillLogger = new SkillLogger(this.db);
      this.app.skillLogger = this.skillLogger;
    });

    this.agentRuntime = new AgentRuntime(this.llm, this.db, this.skillRegistry);
    this.app.agentRuntime = this.agentRuntime;

    // ── REST routes ─────────────────────────────────────────────────────────

    this.app.use(async (ctx: Context, next: Next) => {
      if (!ctx.path.startsWith('/api/ai')) {
        return next();
      }

      // ── Managed Agents Routes ──────────────────────────────────────────

      // POST /api/ai/managed-agents/sessions — Create a new agent session
      if (ctx.path === '/api/ai/managed-agents/sessions' && ctx.method === 'POST') {
        if (!aiRequireLogin(ctx)) return;
        const { name, initialPrompt, systemPrompt } = (ctx as any).request.body ?? {};
        if (!name || !initialPrompt) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'name and initialPrompt are required', code: 'VALIDATION_ERROR' }] };
          return;
        }

        try {
          const sessionRepo = this.db.getRepository('agentSessions');
          const sessionId = require('crypto').randomUUID();
          const session = await sessionRepo.create({
            values: {
              id: sessionId,
              name,
              status: 'pending',
              triggeredBy: (ctx as any).state?.currentUser?.id || 'anonymous',
              systemPrompt: systemPrompt || 'You are a helpful assistant.',
              initialPrompt,
            },
          });
          ctx.body = { data: session };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'SESSION_CREATE_ERROR' }] };
        }
        return;
      }

      // POST /api/ai/managed-agents/sessions/:id/run — Execute/Resume agent session
      const runSessionMatch = ctx.path.match(/^\/api\/ai\/managed-agents\/sessions\/([^/]+)\/run$/);
      if (runSessionMatch && ctx.method === 'POST') {
        if (!aiRequireLogin(ctx)) return;
        const sessionId = decodeURIComponent(runSessionMatch[1]);
        const { maxIterations } = (ctx as any).request.body ?? {};

        try {
          const sessionRepo = this.db.getRepository('agentSessions');
          const session = await sessionRepo.findOne({ filter: { id: sessionId } });
          if (!session) {
            ctx.status = 404;
            ctx.body = { errors: [{ message: `Session ${sessionId} not found`, code: 'NOT_FOUND' }] };
            return;
          }

          if (session.status === 'completed' || session.status === 'failed') {
            ctx.status = 400;
            ctx.body = { errors: [{ message: `Session ${sessionId} is already ${session.status}`, code: 'BAD_REQUEST' }] };
            return;
          }

          await sessionRepo.update({
            filterByTk: sessionId,
            values: { status: 'running' },
          });

          const activeProviderName = (this.llm as any).defaultProvider || 'openai';
          const activeProvider = this.llm.getProvider(activeProviderName);
          const activeModel = (activeProvider as any).defaultModel || 'gpt-4o';

          const agent = {
            id: 'runtime-agent',
            name: session.name,
            description: 'Managed runtime execution agent',
            systemPrompt: session.systemPrompt,
            model: activeModel,
            provider: activeProviderName,
            tools: this.skillRegistry.getAvailableTools({
              userId: (ctx as any).state?.currentUser?.id,
              roles: [(ctx as any).state?.currentRole],
            }),
            temperature: 0.3,
            maxTokens: 2048,
          };

          this.agentRuntime.execute(agent, session.initialPrompt, {
            sessionId,
            user: {
              userId: (ctx as any).state?.currentUser?.id,
              roles: [(ctx as any).state?.currentRole],
            },
            maxIterations: maxIterations || 10,
          }).catch((err: any) => {
            console.error(`[Managed Agent] Background execution error for session ${sessionId}:`, err);
          });

          ctx.body = { data: { sessionId, status: 'running' } };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'SESSION_RUN_ERROR' }] };
        }
        return;
      }

      // POST /api/ai/managed-agents/sessions/:id/approve — Human-in-the-loop confirmation
      const approveMatch = ctx.path.match(/^\/api\/ai\/managed-agents\/sessions\/([^/]+)\/approve$/);
      if (approveMatch && ctx.method === 'POST') {
        if (!aiRequireLogin(ctx)) return;
        const sessionId = decodeURIComponent(approveMatch[1]);
        const { action, overrideContent } = (ctx as any).request.body ?? {};

        if (!action || !['approve', 'reject'].includes(action)) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'action must be approve or reject', code: 'VALIDATION_ERROR' }] };
          return;
        }

        try {
          const approved = action === 'approve';
          this.agentRuntime.resume(sessionId, approved, overrideContent).catch((err: any) => {
            console.error(`[Managed Agent] Resume execution error for session ${sessionId}:`, err);
          });

          ctx.body = { data: { sessionId, status: approved ? 'resuming' : 'cancelling' } };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'SESSION_APPROVE_ERROR' }] };
        }
        return;
      }

      // GET /api/ai/managed-agents/sessions/:id/traces — Retrieve trace logs
      const tracesMatch = ctx.path.match(/^\/api\/ai\/managed-agents\/sessions\/([^/]+)\/traces$/);
      if (tracesMatch && ctx.method === 'GET') {
        if (!aiRequireLogin(ctx)) return;
        const sessionId = decodeURIComponent(tracesMatch[1]);

        try {
          const traceRepo = this.db.getRepository('agentTraces');
          const list = await traceRepo.find({
            filter: { sessionId },
            sort: ['createdAt'],
          });
          ctx.body = { data: list };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'SESSION_TRACES_ERROR' }] };
        }
        return;
      }

      // ── Runtime Routes ─────────────────────────────────────────────────

      // POST /api/ai/runtime-chat — skill-aware AI agent chat
      // Any logged-in user can invoke enabled Skills via AI chat
      if (ctx.path === '/api/ai/runtime-chat' && ctx.method === 'POST') {
        if (!aiRequireLogin(ctx)) return;
        await this.handleRuntimeChat(ctx);
        return;
      }

      // POST /api/ai/confirm-skill — confirm a pending dangerous skill
      // Any logged-in user can confirm their own initiated operations
      if (ctx.path === '/api/ai/confirm-skill' && ctx.method === 'POST') {
        if (!aiRequireLogin(ctx)) return;
        await this.handleConfirmSkill(ctx);
        return;
      }

      // GET /api/ai/skills — list available skills for context
      // Any logged-in user can retrieve enabled Skills (needed when entering an App)
      if (ctx.path === '/api/ai/skills' && ctx.method === 'GET') {
        if (!aiRequireLogin(ctx)) return;
        await this.handleListSkills(ctx);
        return;
      }

      // GET /api/ai/logs — query skill execution logs
      // Execution logs are audit information and can only be viewed by administrators
      if (ctx.path === '/api/ai/logs' && ctx.method === 'GET') {
        if (!aiRequireAdmin(ctx)) return;
        await this.handleListLogs(ctx);
        return;
      }

      // ── Builder Routes ─────────────────────────────────────────────────

      if (ctx.path === '/api/ai/providers' && ctx.method === 'GET') {
        ctx.body = {
          data: this.llm.listProviders().map((name) => ({
            name,
            isDefault: name === (this.llm as any).defaultProvider,
          })),
        };
        return;
      }

      if (ctx.path === '/api/ai/providers' && ctx.method === 'POST') {
        const { type, config } = (ctx as any).request.body ?? {};
        try {
          let provider;
          if (type === 'openai') {
            provider = new OpenAIProvider(config);
          } else if (type === 'anthropic') {
            provider = new AnthropicProvider(config);
          } else if (type === 'qwen') {
            provider = new QwenProvider(config);
          } else {
            ctx.status = 400;
            ctx.body = { errors: [{ message: `Unknown provider type: ${type}`, code: 'UNKNOWN_PROVIDER' }] };
            return;
          }
          this.llm.registerProvider(provider);
          this.llm.setDefaultProvider(provider.name);

          // Persist to database
          const repo = this.db.getRepository('aiProviders');
          if (repo) {
            const existing = await repo.findOne({ filter: { type } });
            if (existing) {
              await repo.update({
                filterByTk: existing.id,
                values: { config, isDefault: true },
              });
            } else {
              await repo.create({
                values: { type, config, isDefault: true },
              });
            }
            // Set other providers' isDefault status to false
            const allProviders = await repo.find({ filter: { type: { $ne: type } } });
            for (const other of allProviders) {
              await repo.update({
                filterByTk: other.id,
                values: { isDefault: false },
              });
            }
          }

          ctx.body = { data: { name: provider.name, registered: true } };
        } catch (err: any) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: err.message, code: 'PROVIDER_CONFIG_ERROR' }] };
        }
        return;
      }

      const defaultMatch = ctx.path.match(/^\/api\/ai\/providers\/([^/]+)\/default$/);
      if (defaultMatch && ctx.method === 'POST') {
        const name = decodeURIComponent(defaultMatch[1]);
        try {
          this.llm.setDefaultProvider(name);

          // Update database
          const repo = this.db.getRepository('aiProviders');
          if (repo) {
            await repo.update({
              filter: { type: name },
              values: { isDefault: true },
            });
            await repo.update({
              filter: { type: { $ne: name } },
              values: { isDefault: false },
            });
          }
          ctx.body = { data: { name, isDefault: true } };
        } catch (err: any) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: err.message, code: 'DEFAULT_PROVIDER_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/chat' && ctx.method === 'POST') {
        const { messages, mode, context: aiCtx, provider } = (ctx as any).request.body ?? {};
        if (!messages || !Array.isArray(messages)) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'messages array is required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          if (mode === 'builder') {
            // Serialize all database collections to inject into system prompt for real-time physical schema awareness
            const collections = this.db.getCollections() || [];
            const schemaDetails = collections
              .map((col: any) => {
                const fields = col.getFields()
                  .map((f: any) => {
                    const relInfo = f.target ? ` (Relation to ${f.target}${f.through ? ' through ' + f.through : ''})` : '';
                    return `  - ${f.name} (${f.type}${f.allowNull === false ? ', required' : ''}${f.comment ? ', ' + f.comment : ''})${relInfo}`;
                  })
                  .join('\n');
                return `- Collection: \`${col.name}\` (Title: "${col.options.title || col.name}"${col.options.comment ? ', Comment: ' + col.options.comment : ''})\n  Fields:\n${fields}`;
              })
              .join('\n\n');

            let systemPrompt = `You are a professional software architect designing applications on the Formai platform.
Formai is an AI-native low-code platform where applications are centered around user business scenarios, and business logic is defined in "Skills" (which are executable business actions that can be triggered via natural language chat or UI buttons). Technical capabilities like database tables (collections), pages, menus, and automated workflows are implied behind these needs and compiled in the background.

Here are all the database collections currently registered on the Formai platform:
${schemaDetails || '(None registered yet)'}

Design a comprehensive Markdown Blueprint for the new application "${aiCtx?.appId || 'FormAI App'}".
The blueprint MUST strictly follow the Formai Platform Mode and use the following template structure:

# 🌐 Formai Application Blueprint: [App Title]

## 🎯 1. User Scenarios & Product Value
[Describe the core scenarios, target users, and what business problems the app solves]

## ⚡ 2. Business Logic & AI Skills
Formai is an AI-native platform. Core business actions are represented as **Skills** that users or buttons can execute.
Auto-generated CRUD skills are supported for every collection. Listed here are specialized custom skills needed for the business logic:
- **\`[skill_name]\` ([skill_title])**: [description of the custom skill, e.g. status transition, document generation, integrations, calculations]
  - **Context**: Linked to collection \`[collection_name]\` (or \`global\`)
  - **Dynamic Safeguard**: [Whether it requires verification or confirmation, e.g. Yes/No]

## 🗃️ 3. Functional Design
*The Formai engine dynamically compiles and syncs these underlying technical capabilities in the background to support the scenarios and skills defined above.*

### A. Data Entities (Collections)
Database structures to persist business objects:
- **\`[collection_name]\` ([collection_title])**:
  Fields:
  - \`[field_name]\`: \`[field_type]\` ([field_title])

### B. User Portals (Menus & Pages)
Responsive front-end routes and navigation menus:
- \`[menu_title]\` ([menu_icon]) -> Linked to \`[collection_name]\`

### C. Automated Tasks (Workflows)
Event-driven background processes for asynchronous automation:
- **[workflow_title]**:
  - **Trigger**: [workflow trigger, e.g. collection event]
  - **Actions**: [brief trigger/action workflow description]

You MUST return two parts in your response:
1. A brief explanation of the application concept and design (visible to the user in chat).
2. The complete Markdown Blueprint enclosed in \`<new_blueprint>\\n...\\n</new_blueprint>\` tags. Do NOT truncate the blueprint.`;

            if (aiCtx?.blueprint) {
              systemPrompt = `You are a professional software architect helping to build and refine the application "${aiCtx.appId || 'FormAI App'}".
Formai is an AI-native low-code platform. Applications are designed to be user-needs-centric, with business logic defined in "Skills". Technical details like database tables (collections), pages, menus, and automated workflows are implied underneath.

Here are all the database collections currently registered on the Formai platform:
${schemaDetails || '(None registered yet)'}

The application currently has a detailed Markdown Blueprint defining its architecture:
\`\`\`markdown
${aiCtx.blueprint}
\`\`\`

Based on the user's message, modify the Blueprint. You MUST strictly preserve or refine the Formai Platform Mode template structure (Section 1: User Scenarios, Section 2: Business Logic & AI Skills, Section 3: Functional Design - Collections, Menus, Workflows).
You MUST return two parts in your response:
1. A brief explanation of the changes you made (visible to the user in chat).
2. The complete, updated Markdown Blueprint enclosed in \`<new_blueprint>\\n...\\n</new_blueprint>\` tags. Do NOT truncate the blueprint; always output the entire updated document inside the tags.`;
            }
            const codex = (this.app as any).codex;
            if (codex) {
              // Resolve LLM configuration from current default/active provider
              const activeProviderName = provider || (this.llm as any).defaultProvider || 'openai';
              const activeProvider = this.llm.getProvider(activeProviderName);
              const activeModel = (activeProvider as any).defaultModel || 'gpt-4o';
              const providerConfig = (activeProvider as any).config || {};
              
              // Codex natively supports a limited set of provider names. Map other OpenAI-compatible APIs to 'openai'.
              const rawProvider = activeProviderName.toLowerCase();
              const mappedProvider = rawProvider === 'qwen'
                ? 'dashscope'
                : ['openai', 'ollama', 'lmstudio', 'amazon-bedrock', 'dashscope'].includes(rawProvider)
                  ? rawProvider
                  : 'openai';

              const llmProviderConfig = {
                provider: mappedProvider as any,
                apiKey: providerConfig.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || undefined,
                baseUrl: providerConfig.baseURL || providerConfig.baseUrl || process.env.OPENAI_BASE_URL || undefined,
                model: activeModel,
                temperature: 0.2,
              };

              console.log(`[FormAI-Codex] Routing builder blueprint chat request to Codex daemon (Model: ${llmProviderConfig.model})...`);

              const mcpBridgePort = (codex as any).mcpBridgePort;
              const mcpScriptPath = (codex as any).mcpScriptPath;

              // Initialize a dynamic Codex thread session
              const thread = codex.startThread({
                workingDirectory: process.cwd(), // 注入物理工作区 CWD，激活 Codex 的物理文件读写
                skipGitRepoCheck: true,
                model: llmProviderConfig.model,
                llmProvider: llmProviderConfig,
                ...(mcpBridgePort && mcpScriptPath ? {
                  config: {
                    "mcp.servers.formai-platform": {
                      command: "node",
                      args: [mcpScriptPath],
                      env: {
                        NODE_ENV: process.env.NODE_ENV || "development",
                        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
                        FORMAI_MCP_PORT: String(mcpBridgePort),
                      }
                    }
                  }
                } : {})
              });

              // Construct a consolidated prompt containing the blueprint context and conversational log
              let chatPrompt = `SYSTEM INSTRUCTION:\n${systemPrompt}\n\n`;
              chatPrompt += `CONVERSATION HISTORY:\n`;
              for (const msg of messages) {
                if (msg.role !== 'system') {
                  chatPrompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
                }
              }
              chatPrompt += `\nTASK:\nBased on the history and the latest user request, please update or design the App Blueprint inside <new_blueprint>...</new_blueprint> tags following the instructions above.`;

              // Run the turn over the WebSockets JSON-RPC connection
              const turn = await thread.run(chatPrompt);
              ctx.body = {
                data: {
                  role: 'assistant',
                  content: turn.finalResponse,
                  routedToCodex: true,
                }
              };
            } else {
              const systemMessage = { role: 'system' as const, content: systemPrompt };
              const response = await this.llm.chat([systemMessage, ...messages], { provider });
              ctx.body = {
                data: {
                  ...response,
                  routedToCodex: false,
                }
              };
            }
          } else {
            // Assistant mode: Run the full schema-aware, skill-aware runtime agent!
            if (!aiRequireLogin(ctx)) return;

            const currentUser = (ctx as any).state?.currentUser;
            const roles = await this.resolveUserRoles(ctx);
            const appIdParam = aiCtx?.appId;

            let appId: number | null = null;
            if (appIdParam) {
              if (!isNaN(Number(appIdParam))) {
                appId = Number(appIdParam);
              } else {
                const appsRepo = this.db.getRepository('apps');
                const appRecord = await appsRepo.findOne({ filter: { name: appIdParam } });
                if (appRecord) {
                  appId = appRecord.id;
                }
              }
            }

            const skillContext: SkillContext = {
              appId,
              userId: currentUser?.id ?? undefined,
              roles,
            };

            const availableTools = this.skillRegistry.getAvailableTools(skillContext);
            const systemPrompt = await this.buildRuntimeSystemPrompt(appIdParam, availableTools.length, roles, aiCtx?.currentPage);

            const providerName = provider || (this.llm as any).defaultProvider;
            const activeProvider = this.llm.getProvider(providerName);
            const activeModel = (activeProvider as any).defaultModel || 'gpt-4o';

            const agent = {
              id: 'runtime-agent',
              name: 'Formai Runtime Agent',
              description: 'AI agent that operates on real application data',
              systemPrompt,
              model: activeModel,
              provider: providerName,
              tools: availableTools,
              temperature: 0.3,
              maxTokens: 2048,
            };

            const result = await this.executeAgentWithSkills(agent, messages, skillContext);

            ctx.body = {
              data: {
                content: result.output,
                sessionId: aiCtx?.sessionId,
                toolCalls: result.toolResults?.map((tr: any) => ({
                  toolCallId: tr.toolCallId,
                  result: tr.result,
                })),
                pendingConfirmation: result.pendingConfirmation ?? null,
              },
            };
          }
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'AI_CHAT_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/a2data' && ctx.method === 'POST') {
        const { prompt, existingCollections } = (ctx as any).request.body ?? {};
        if (!prompt) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'prompt is required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          const collection = await this.a2data.generateCollection(prompt, { existingCollections });
          ctx.body = { data: collection };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'A2DATA_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/a2data/fields' && ctx.method === 'POST') {
        const { collectionName, description } = (ctx as any).request.body ?? {};
        if (!collectionName) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'collectionName is required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          const fields = await this.a2data.suggestFields(collectionName, description);
          ctx.body = { data: fields };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'A2DATA_FIELDS_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/a2data/relations' && ctx.method === 'POST') {
        const { collections } = (ctx as any).request.body ?? {};
        if (!collections || !Array.isArray(collections)) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'collections array is required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          const relations = await this.a2data.suggestRelations(collections);
          ctx.body = { data: relations };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'A2DATA_RELATIONS_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/a2ui' && ctx.method === 'POST') {
        const { prompt, collection, fields, mode = 'create', context: uiCtx, blockType } = (ctx as any).request.body ?? {};
        if (!prompt) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'prompt is required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          const runOpts = getCodexRunOptions();
          let schema;
          if (blockType) {
            schema = await this.a2ui.generateBlock({
              prompt,
              collection,
              fields,
              blockType,
              codex: runOpts.codex,
              llmProviderConfig: runOpts.llmProviderConfig,
            });
          } else {
            schema = await this.a2ui.generatePage({
              prompt,
              collection,
              fields,
              mode,
              context: uiCtx,
              codex: runOpts.codex,
              llmProviderConfig: runOpts.llmProviderConfig,
            });
          }
          ctx.body = { data: schema };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'A2UI_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/a2ui/suggest' && ctx.method === 'POST') {
        const { collectionName, fields } = (ctx as any).request.body ?? {};
        if (!collectionName || !fields) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'collectionName and fields are required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          const runOpts = getCodexRunOptions();
          const suggestions = await this.a2ui.suggestUI(collectionName, fields, runOpts);
          ctx.body = { data: suggestions };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'A2UI_SUGGEST_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/a2ui/modify' && ctx.method === 'POST') {
        const { schema, instruction } = (ctx as any).request.body ?? {};
        if (!schema || !instruction) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'schema and instruction are required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          const runOpts = getCodexRunOptions();
          const modified = await this.a2ui.modifySchema(schema, instruction, runOpts);
          ctx.body = { data: modified };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'A2UI_MODIFY_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/a2flow' && ctx.method === 'POST') {
        const { prompt, context: flowCtx, existingCollections } = (ctx as any).request.body ?? {};
        if (!prompt) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'prompt is required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          const workflow = await this.a2flow.generateWorkflow(prompt, { existingCollections, ...flowCtx });
          ctx.body = { data: workflow };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'A2FLOW_ERROR' }] };
        }
        return;
      }

      if (ctx.path === '/api/ai/a2menu' && ctx.method === 'POST') {
        const { prompt } = (ctx as any).request.body ?? {};
        if (!prompt) {
          ctx.status = 400;
          ctx.body = { errors: [{ message: 'prompt is required', code: 'VALIDATION_ERROR' }] };
          return;
        }
        try {
          const menus = await this.a2menu.generateMenus(prompt);
          ctx.body = { data: menus };
        } catch (err: any) {
          ctx.status = 500;
          ctx.body = { errors: [{ message: err.message, code: 'A2MENU_ERROR' }] };
        }
        return;
      }

      await next();
    });

    // Register A2DataEngine compilation skill
    this.skillRegistry.register(
      {
        name: 'a2_compile_data_model',
        title: 'Compile Data Model Schema',
        description: 'Compiles a database collection definition (fields, types, relations) using A2DataEngine.',
        resourceType: 'collection',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'data_model' },
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The natural language requirements for the database data model.' },
            existingCollections: { type: 'array', items: { type: 'string' }, description: 'Names of existing collections.' }
          },
          required: ['prompt']
        }
      },
      async (args: Record<string, any>) => {
        const result = await this.a2data.generateCollection(args.prompt, {
          existingCollections: args.existingCollections
        });
        return { data: result };
      }
    );

    // Register A2UIEngine compilation skill
    this.skillRegistry.register(
      {
        name: 'a2_compile_ui_schema',
        title: 'Compile UI Layout Schema',
        description: 'Compiles a frontend page or block JSON-Schema bound to a collection using A2UIEngine.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'ui_schema' },
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Frontend layout or interface requirements.' },
            collection: { type: 'string', description: 'Name of the database collection this page binds to.' },
            mode: { type: 'string', enum: ['create', 'edit', 'list', 'detail'], description: 'Interface mode (create, edit, list, detail).' }
          },
          required: ['prompt', 'collection']
        }
      },
      async (args: Record<string, any>) => {
        const runOpts = getCodexRunOptions();
        const result = await this.a2ui.generatePage({
          prompt: args.prompt,
          collection: args.collection,
          mode: args.mode || 'list',
          codex: runOpts.codex,
          llmProviderConfig: runOpts.llmProviderConfig,
        });
        return { data: result };
      }
    );

    // Register standard FormAI UI Component Skills
    this.skillRegistry.register(
      {
        name: 'formai_add_filter_block',
        title: 'Add Filter Block to Page',
        description: 'Adds an advanced query filter panel to the top of a page schema.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'add_filter_block' },
        inputSchema: {
          type: 'object',
          properties: {
            pageSchemaUid: { type: 'string', description: 'The unique ID of the page schema.' },
            collectionName: { type: 'string', description: 'The database collection name for querying.' },
            fields: { type: 'array', items: { type: 'string' }, description: 'List of field names to filter on.' }
          },
          required: ['pageSchemaUid', 'collectionName', 'fields']
        }
      },
      async (args: Record<string, any>) => {
        const { pageSchemaUid, collectionName, fields } = args;
        const blockKey = `filter_${collectionName}_${Math.random().toString(36).slice(2, 6)}`;
        const filterBlockSchema = {
          type: 'void',
          'x-uid': blockKey,
          'x-component': 'FilterBlock',
          'x-index': 10,
          'x-component-props': {
            collection: collectionName,
            fields: fields.map((f: string) => ({
              name: f,
              title: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' '),
              type: f === 'status' ? 'enum' : f.includes('date') || f.includes('time') ? 'date' : 'string',
              values: f === 'status' ? ['active', 'inactive', 'draft', 'completed'] : undefined,
            })),
          },
        };
        await addBlockToPageSchema(pageSchemaUid, blockKey, filterBlockSchema);
        return { data: { success: true, blockKey, schema: filterBlockSchema } };
      }
    );

    this.skillRegistry.register(
      {
        name: 'formai_add_table_block',
        title: 'Add Table Block to Page',
        description: 'Adds a list data Table block bound to a collection to a page schema.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'add_table_block' },
        inputSchema: {
          type: 'object',
          properties: {
            pageSchemaUid: { type: 'string', description: 'The unique ID of the page schema.' },
            collectionName: { type: 'string', description: 'The database collection name.' },
            fields: { type: 'array', items: { type: 'string' }, description: 'List of field names to display as columns.' }
          },
          required: ['pageSchemaUid', 'collectionName', 'fields']
        }
      },
      async (args: Record<string, any>) => {
        const { pageSchemaUid, collectionName, fields } = args;
        const blockKey = `table_${collectionName}_${Math.random().toString(36).slice(2, 6)}`;
        const columns = fields.map((f: string) => ({
          title: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' '),
          dataIndex: f,
          key: f,
          sorter: true,
          render: f === 'status' ? 'status' : f === 'amount' || f === 'price' ? 'amount' : undefined,
        }));
        const tableBlockSchema = {
          type: 'array',
          'x-uid': blockKey,
          'x-component': 'Table',
          'x-index': 30,
          'x-component-props': {
            collection: collectionName,
            columns,
            rowSelection: true,
            pagination: {
              pageSize: 10,
              showSizeChanger: true,
            },
          },
        };
        await addBlockToPageSchema(pageSchemaUid, blockKey, tableBlockSchema);
        return { data: { success: true, blockKey, schema: tableBlockSchema } };
      }
    );

    this.skillRegistry.register(
      {
        name: 'formai_add_action_bar_block',
        title: 'Add Action Bar Block to Page',
        description: 'Adds a toolbar space with action buttons (Add, Delete, Export, Import) to a page schema.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'add_action_bar_block' },
        inputSchema: {
          type: 'object',
          properties: {
            pageSchemaUid: { type: 'string', description: 'The unique ID of the page schema.' },
            collectionName: { type: 'string', description: 'The database collection name.' },
            actions: { type: 'array', items: { type: 'string' }, description: 'Actions to include: add, destroy, export, import.' }
          },
          required: ['pageSchemaUid', 'collectionName', 'actions']
        }
      },
      async (args: Record<string, any>) => {
        const { pageSchemaUid, collectionName, actions } = args;
        const blockKey = `actionBar_${collectionName}_${Math.random().toString(36).slice(2, 6)}`;
        const actionSpaceProperties: Record<string, any> = {};

        if (actions.includes('add')) {
          actionSpaceProperties['createDrawer'] = {
            type: 'void',
            title: 'Add New',
            'x-component': 'ActionDrawer',
            'x-component-props': { width: 600, triggerText: 'Add New', triggerType: 'primary' },
            properties: {
              createForm: {
                type: 'object',
                'x-component': 'Form',
                'x-component-props': { collection: collectionName, layout: 'vertical' },
                properties: {
                  submit: {
                    type: 'void',
                    'x-component': 'Action',
                    'x-component-props': { title: 'Submit', type: 'primary', htmlType: 'submit' },
                  },
                },
              },
            },
          };
        }
        if (actions.includes('import')) {
          actionSpaceProperties['importAction'] = {
            type: 'void',
            title: 'Import',
            'x-component': 'Action',
            'x-component-props': { action: 'import', collection: collectionName },
          };
        }
        if (actions.includes('export')) {
          actionSpaceProperties['exportAction'] = {
            type: 'void',
            title: 'Export',
            'x-component': 'Action',
            'x-component-props': { action: 'export', collection: collectionName },
          };
        }
        if (actions.includes('destroy')) {
          actionSpaceProperties['delete'] = {
            type: 'void',
            title: 'Delete',
            'x-component': 'Action',
            'x-component-props': {
              title: 'Delete',
              action: 'destroy',
              danger: true,
              collection: collectionName,
              confirmTitle: 'Are you sure you want to delete selected records?',
            },
          };
        }

        const actionBarSchema = {
          type: 'void',
          'x-uid': blockKey,
          'x-component': 'Space',
          'x-index': 20,
          'x-component-props': {
            style: { marginBottom: 16 },
          },
          properties: actionSpaceProperties,
        };

        await addBlockToPageSchema(pageSchemaUid, blockKey, actionBarSchema);
        return { data: { success: true, blockKey, schema: actionBarSchema } };
      }
    );

    this.skillRegistry.register(
      {
        name: 'formai_add_details_block',
        title: 'Add Details Block to Page',
        description: 'Adds a read-only detail field list component bound to a collection to a page schema.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'add_details_block' },
        inputSchema: {
          type: 'object',
          properties: {
            pageSchemaUid: { type: 'string', description: 'The unique ID of the page schema.' },
            collectionName: { type: 'string', description: 'The database collection name.' },
            fields: { type: 'array', items: { type: 'string' }, description: 'List of fields to show details for.' }
          },
          required: ['pageSchemaUid', 'collectionName', 'fields']
        }
      },
      async (args: Record<string, any>) => {
        const { pageSchemaUid, collectionName, fields } = args;
        const blockKey = `details_${collectionName}_${Math.random().toString(36).slice(2, 6)}`;
        const detailFields = fields.map((f: string) => ({
          name: f,
          title: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' '),
        }));
        const detailsBlockSchema = {
          type: 'void',
          'x-uid': blockKey,
          'x-component': 'Details',
          'x-index': 40,
          'x-component-props': {
            collection: collectionName,
            fields: detailFields,
          },
        };
        await addBlockToPageSchema(pageSchemaUid, blockKey, detailsBlockSchema);
        return { data: { success: true, blockKey, schema: detailsBlockSchema } };
      }
    );

    this.skillRegistry.register(
      {
        name: 'formai_add_kanban_block',
        title: 'Add Kanban Block to Page',
        description: 'Adds a Kanban board block grouped by a status field to a page schema.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'add_kanban_block' },
        inputSchema: {
          type: 'object',
          properties: {
            pageSchemaUid: { type: 'string', description: 'The unique ID of the page schema.' },
            collectionName: { type: 'string', description: 'The database collection name.' },
            groupByField: { type: 'string', description: 'The field to group swimlanes by (e.g. status).' }
          },
          required: ['pageSchemaUid', 'collectionName', 'groupByField']
        }
      },
      async (args: Record<string, any>) => {
        const { pageSchemaUid, collectionName, groupByField } = args;
        const blockKey = `kanban_${collectionName}_${Math.random().toString(36).slice(2, 6)}`;
        const kanbanBlockSchema = {
          type: 'void',
          'x-uid': blockKey,
          'x-component': 'KanbanView',
          'x-index': 30,
          'x-component-props': {
            collection: collectionName,
            groupBy: groupByField,
            titleField: 'name',
            descriptionField: 'description',
            columns: [
              { key: 'todo', title: 'To Do', color: '#f5f5f5' },
              { key: 'in_progress', title: 'In Progress', color: '#e6f4ff' },
              { key: 'done', title: 'Done', color: '#f6ffed' }
            ]
          },
        };
        await addBlockToPageSchema(pageSchemaUid, blockKey, kanbanBlockSchema);
        return { data: { success: true, blockKey, schema: kanbanBlockSchema } };
      }
    );

    this.skillRegistry.register(
      {
        name: 'formai_add_wiki_block',
        title: 'Add Knowledge Wiki Block to Page',
        description: 'Adds an Obsidian-style KnowledgeWiki workspace block bound to a memory tree to a page schema.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'add_wiki_block' },
        inputSchema: {
          type: 'object',
          properties: {
            pageSchemaUid: { type: 'string', description: 'The unique ID of the page schema.' },
            collectionName: { type: 'string', description: 'The database collection name for wiki memory nodes.' }
          },
          required: ['pageSchemaUid', 'collectionName']
        }
      },
      async (args: Record<string, any>) => {
        const { pageSchemaUid, collectionName } = args;
        const blockKey = `wiki_${collectionName}_${Math.random().toString(36).slice(2, 6)}`;
        const wikiBlockSchema = {
          type: 'void',
          'x-uid': blockKey,
          'x-component': 'KnowledgeWiki',
          'x-index': 50,
          'x-component-props': {
            collection: collectionName,
          },
        };
        await addBlockToPageSchema(pageSchemaUid, blockKey, wikiBlockSchema);
        return { data: { success: true, blockKey, schema: wikiBlockSchema } };
      }
    );

    this.skillRegistry.register(
      {
        name: 'formai_add_chart_block',
        title: 'Add Chart Block to Page',
        description: 'Adds a dynamic visualization Chart block (Bar, Line, or Pie chart) bound to a data collection to a page schema.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'add_chart_block' },
        inputSchema: {
          type: 'object',
          properties: {
            pageSchemaUid: { type: 'string', description: 'The unique ID of the page schema.' },
            collectionName: { type: 'string', description: 'The database collection name.' },
            chartType: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'The chart style: bar, line, or pie.' },
            xField: { type: 'string', description: 'The grouping field name (e.g. status).' },
            yField: { type: 'string', description: 'The numeric field name to aggregate (e.g. amount).' },
            title: { type: 'string', description: 'Optional chart title.' }
          },
          required: ['pageSchemaUid', 'collectionName', 'chartType', 'xField', 'yField']
        }
      },
      async (args: Record<string, any>) => {
        const { pageSchemaUid, collectionName, chartType, xField, yField, title } = args;
        const blockKey = `chart_${collectionName}_${Math.random().toString(36).slice(2, 6)}`;
        const chartBlockSchema = {
          type: 'void',
          'x-uid': blockKey,
          'x-component': 'ChartBlock',
          'x-index': 45,
          'x-component-props': {
            collection: collectionName,
            chartType,
            xField,
            yField,
            title: title || `${collectionName.toUpperCase()} Analysis`
          },
        };
        await addBlockToPageSchema(pageSchemaUid, blockKey, chartBlockSchema);
        return { data: { success: true, blockKey, schema: chartBlockSchema } };
      }
    );

    this.skillRegistry.register(
      {
        name: 'formai_add_divider_block',
        title: 'Add Divider to Page',
        description: 'Adds a fine-grained separator Divider layout line with optional text content to a page schema.',
        resourceType: 'page',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'add_divider' },
        inputSchema: {
          type: 'object',
          properties: {
            pageSchemaUid: { type: 'string', description: 'The unique ID of the page schema.' },
            text: { type: 'string', description: 'Optional text label to display on the divider.' },
            dashed: { type: 'boolean', description: 'Set to true to make the divider line dashed.' },
            orientation: { type: 'string', enum: ['left', 'right', 'center'], description: 'Divider text orientation.' }
          },
          required: ['pageSchemaUid']
        }
      },
      async (args: Record<string, any>) => {
        const { pageSchemaUid, text, dashed, orientation } = args;
        const blockKey = `divider_${Math.random().toString(36).slice(2, 6)}`;
        const dividerSchema = {
          type: 'void',
          'x-uid': blockKey,
          'x-component': 'Divider',
          'x-index': 25,
          'x-component-props': {
            dashed: dashed || false,
            orientation: orientation || 'center',
            plain: true
          },
          'x-content': text || undefined
        };
        await addBlockToPageSchema(pageSchemaUid, blockKey, dividerSchema);
        return { data: { success: true, blockKey, schema: dividerSchema } };
      }
    );

    // Register A2FlowEngine compilation skill

    this.skillRegistry.register(
      {
        name: 'a2_compile_workflow',
        title: 'Compile Workflow Schema',
        description: 'Compiles an event-driven automation workflow definition using A2FlowEngine.',
        resourceType: 'workflow',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'workflow' },
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Automation trigger/actions requirements.' },
            existingCollections: { type: 'array', items: { type: 'string' }, description: 'Names of existing collections.' }
          },
          required: ['prompt']
        }
      },
      async (args: Record<string, any>) => {
        const result = await this.a2flow.generateWorkflow(args.prompt, {
          existingCollections: args.existingCollections
        });
        return { data: result };
      }
    );

    // Register A2MenuEngine compilation skill
    this.skillRegistry.register(
      {
        name: 'a2_compile_menus',
        title: 'Compile Menus Schema',
        description: 'Compiles application navigation menu paths using A2MenuEngine.',
        resourceType: 'menu',
        resourceName: 'compiler',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false,
        rolesAllowed: ['root', 'admin', 'developer'],
        handler: { type: 'rest_action', resource: 'compiler', action: 'menus' },
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Menu hierarchy and structural requirements.' }
          },
          required: ['prompt']
        }
      },
      async (args: Record<string, any>) => {
        const result = await this.a2menu.generateMenus(args.prompt);
        return { data: result };
      }
    );

    // Register global SQL query skill (safe read-only SELECT by default, modification dynamically confirmed)
    this.skillRegistry.register(
      {
        name: 'formai_sql_query',
        title: 'Execute SQL Query',
        description: 'Executes a SQL query against the database. Used for aggregation (SUM, COUNT, GROUP BY) or complex joins that CRUD list skills cannot easily do. Read-only SELECT statements run instantly. Writing operations (UPDATE, INSERT, DELETE) will dynamically request user approval/confirmation before running.',
        resourceType: 'collection',
        resourceName: 'database',
        appId: null,
        skillType: 'custom',
        enabled: true,
        requiresConfirm: false, // Handled dynamically by hook
        rolesAllowed: ['root', 'admin', 'developer'], // Administrative roles
        handler: { type: 'rest_action', resource: 'database', action: 'query' },
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'The SELECT, UPDATE, INSERT, or DELETE SQL statement to execute. e.g., "SELECT c.name, SUM(o.amount) AS total FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name ORDER BY total DESC LIMIT 10"'
            }
          },
          required: ['sql']
        }
      },
      async (args: Record<string, any>, context: SkillContext) => {
        const { sql } = args;
        if (!sql) throw new Error('SQL query is required');
        
        // Execute the query using the DB connection
        const [results] = await this.db.raw(sql);
        return { data: results };
      }
    );

    // Register dynamic pre-execution safety and ACL checks hook (Claude Code style)
    this.skillRegistry.addPreExecuteHook(async (skill, args, context) => {
      if (skill.name !== 'formai_sql_query') return;
      
      const sql = args.sql;
      if (!sql) throw new Error('SQL query is required');
      
      const cleanSql = sql.trim().toLowerCase();
      
      // 1. Identify which database tables (collections) are accessed in this SQL query.
      // We check word boundaries of all defined collections in the system.
      const collections = this.db.getCollections();
      const accessedCollections = collections.filter((col: any) => {
        const nameRegex = new RegExp(`\\b${col.name}\\b`);
        const tableRegex = col.options.tableName ? new RegExp(`\\b${col.options.tableName}\\b`) : null;
        return nameRegex.test(cleanSql) || (tableRegex ? tableRegex.test(cleanSql) : false);
      });
      
      // 2. Perform ACL check for each accessed table based on query type (read vs write)
      const userRoles = context.roles || [];
      const isPlatformAdmin = userRoles.some((role) =>
        ['root', 'admin', 'developer'].includes(role)
      );
      
      // Check query type
      const isWriteQuery = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/.test(cleanSql);
      
      if (!isPlatformAdmin) {
        const aclEngine = this.acl || (this.app as any).acl;
        
        for (const col of accessedCollections) {
          // Determine the action required based on SELECT vs modification
          const actionRequired = isWriteQuery 
            ? (cleanSql.includes('delete') ? 'destroy' : 'update') 
            : 'list';
            
          const hasAccess = userRoles.some((role) => {
            const perm = aclEngine?.can(role, col.name, actionRequired);
            return perm !== false && perm !== undefined;
          });
          
          if (!hasAccess) {
            throw new Error(`Security Violation: You do not have permission to access the collection "${col.name}" with action "${actionRequired}".`);
          }
        }
      }
      
      // 3. For write operations, instead of rejecting, dynamically prompt for user confirmation!
      if (isWriteQuery) {
        // Find matching modification keywords for the confirmation display
        const modificationKeywords = ['insert', 'update', 'delete', 'drop', 'alter', 'truncate', 'create'];
        const matches = modificationKeywords.filter((kw) => new RegExp(`\\b${kw}\\b`).test(cleanSql));
        
        return {
          requiresConfirm: true,
          reason: `⚠️ Warning: This SQL query contains database modification operations (${matches.join(', ').toUpperCase()}). Please review the SQL query carefully before approving:\n\n\`\`\`sql\n${sql}\n\`\`\``
        };
      }
    });
  }

  async loadDbProviders(): Promise<void> {
    try {
      const repo = this.db.getRepository('aiProviders');
      if (!repo) return;
      const records = await repo.find();
      for (const record of records) {
        const { type, config, isDefault } = record;
        let provider;
        if (type === 'openai') {
          provider = new OpenAIProvider(config);
        } else if (type === 'anthropic') {
          provider = new AnthropicProvider(config);
        } else if (type === 'qwen') {
          provider = new QwenProvider(config);
        }
        if (provider) {
          this.llm.registerProvider(provider);
          if (isDefault) {
            this.llm.setDefaultProvider(provider.name);
          }
        }
      }
    } catch (err: any) {
      console.warn('[AI] Failed to load providers from database:', err.message);
    }
  }

  // ── Runtime Chat Handler ─────────────────────────────────────────────────

  private async handleRuntimeChat(ctx: Context): Promise<void> {
    const body: RuntimeChatRequest = (ctx as any).request.body ?? {};
    const { message, appId: appIdParam, sessionId, resourceScope, currentPage } = body as any;

    if (!message) {
      ctx.status = 400;
      ctx.body = { errors: [{ message: 'message is required', code: 'VALIDATION_ERROR' }] };
      return;
    }

    // Extract user context from the request (injected by auth middleware)
    const currentUser = (ctx as any).state?.currentUser;
    // Resolve roles: priority goes to roles in JWT, otherwise query roleUsers table
    const roles = await this.resolveUserRoles(ctx);

    // Resolve string appId to numeric appId
    let appId: number | null = null;
    if (appIdParam) {
      if (!isNaN(Number(appIdParam))) {
        appId = Number(appIdParam);
      } else {
        const appsRepo = this.db.getRepository('apps');
        const appRecord = await appsRepo.findOne({ filter: { name: appIdParam } });
        if (appRecord) {
          appId = appRecord.id;
        }
      }
    }

    const skillContext: SkillContext & { sessionId?: string } = {
      appId,
      userId: currentUser?.id ?? undefined,
      roles,
      resourceScope,
      sessionId,
    };

    // Get Skills available to the current context (permissions + App scope filtered)
    const availableTools = this.skillRegistry.getAvailableTools(skillContext);

    // Build System Prompt (with App context awareness and ACL schema filtering)
    const systemPrompt = await this.buildRuntimeSystemPrompt(appIdParam, availableTools.length, roles, currentPage);

    try {
      const providerName = (this.llm as any).defaultProvider;
      const activeProvider = this.llm.getProvider(providerName);
      const activeModel = (activeProvider as any).defaultModel || 'gpt-4o';

      // Execute using AgentRuntime (automatic Function Calling loop)
      const agent = {
        id: 'runtime-agent',
        name: 'Formai Runtime Agent',
        description: 'AI agent that operates on real application data',
        systemPrompt,
        model: activeModel,
        provider: providerName,
        tools: availableTools,
        temperature: 0.3, // Low temperature, data operations require precision
        maxTokens: 2048,
      };

      // Override AgentRuntime's tool executor to use skillRegistry
      const result = await this.executeAgentWithSkills(agent, message, skillContext);

      ctx.body = {
        data: {
          reply: result.output,
          sessionId,
          toolCalls: result.toolResults?.map((tr: { toolCallId: string; result: any }) => ({
            toolCallId: tr.toolCallId,
            result: tr.result,
          })),
          pendingConfirmation: result.pendingConfirmation ?? null,
          usage: result.usage,
        },
      };
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = { errors: [{ message: err.message, code: 'RUNTIME_CHAT_ERROR' }] };
    }
  }

  /**
   * Custom Agent execution loop, routing tool calls to ResourceSkillRegistry
   */
  private async executeAgentWithSkills(
    agent: any,
    userMessageOrHistory: string | any[],
    skillContext: SkillContext,
  ): Promise<any> {
    const availableTools = this.skillRegistry.getAvailableTools(skillContext);
    const maxIterations = 10;

    const messages: any[] = [
      { role: 'system', content: agent.systemPrompt },
    ];

    if (typeof userMessageOrHistory === 'string') {
      messages.push({ role: 'user', content: userMessageOrHistory });
    } else if (Array.isArray(userMessageOrHistory)) {
      // Filter out any system message from incoming history to prevent duplicates
      const history = userMessageOrHistory.filter((m: any) => m.role !== 'system');
      messages.push(...history);
    }

    const allToolResults: any[] = [];
    let pendingConfirmation: any = null;

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.llm.chat(messages, {
        model: agent.model,
        provider: agent.provider,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        tools: availableTools.length > 0 ? availableTools : undefined,
      });

      messages.push(response);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          success: true,
          output: response.content,
          messages,
          toolResults: allToolResults,
          pendingConfirmation,
        };
      }

      // Execute tool calls
      const toolResultMessages: any[] = [];
      for (const toolCall of response.toolCalls) {
        const fnName = toolCall.function.name;
        let result: any;

        try {
          const args = JSON.parse(toolCall.function.arguments);
          const execResult = await this.skillRegistry.execute(fnName, args, skillContext);

          if (execResult.type === 'confirmation') {
            // User confirmation required, pause agent loop
            pendingConfirmation = execResult.request;
            result = {
              status: 'awaiting_confirmation',
              message: `Action "${execResult.request.skillTitle}" requires your confirmation before execution`,
              confirmationId: execResult.request.confirmationId,
            };
          } else {
            result = execResult.result;
            allToolResults.push({ toolCallId: toolCall.id, result });
          }
        } catch (err: any) {
          result = { error: err.message };
        }

        const resultContent = typeof result === 'string' ? result : JSON.stringify(result);
        toolResultMessages.push({
          role: 'tool',
          content: resultContent,
          name: fnName,
          toolCallId: toolCall.id,
        });

        // If there is an operation pending confirmation, return immediately to wait for user confirmation
        if (pendingConfirmation) {
          messages.push(...toolResultMessages);
          const finalResponse = await this.llm.chat(messages, {
            model: agent.model,
            provider: agent.provider,
            temperature: agent.temperature,
          });
          return {
            success: true,
            output: finalResponse.content,
            messages,
            toolResults: allToolResults,
            pendingConfirmation,
          };
        }
      }

      messages.push(...toolResultMessages);
    }

    return {
      success: false,
      output: 'Agent exceeded maximum iterations',
      messages,
      toolResults: allToolResults,
      pendingConfirmation: null,
    };
  }

  // ── Confirm Skill Handler ────────────────────────────────────────────────

  private async handleConfirmSkill(ctx: Context): Promise<void> {
    const { confirmationId, approved } = (ctx as any).request.body ?? {};

    if (!confirmationId) {
      ctx.status = 400;
      ctx.body = { errors: [{ message: 'confirmationId is required', code: 'VALIDATION_ERROR' }] };
      return;
    }

    if (!approved) {
      ctx.body = { data: { status: 'cancelled', message: 'Operation cancelled' } };
      return;
    }

    try {
      const result = await this.skillRegistry.confirmAndExecute(confirmationId);
      ctx.body = { data: { status: 'executed', result } };
    } catch (err: any) {
      ctx.status = 400;
      ctx.body = { errors: [{ message: err.message, code: 'CONFIRMATION_ERROR' }] };
    }
  }

  // ── List Skills Handler ──────────────────────────────────────────────────

  private async handleListSkills(ctx: Context): Promise<void> {
    const { appId: appIdParam, resourceType, resourceName } = (ctx as any).query ?? {};
    const currentUser = (ctx as any).state?.currentUser;

    let appId: number | null = null;
    if (appIdParam) {
      if (!isNaN(Number(appIdParam))) {
        appId = Number(appIdParam);
      } else {
        const appsRepo = this.db.getRepository('apps');
        const appRecord = await appsRepo.findOne({ filter: { name: appIdParam } });
        if (appRecord) {
          appId = appRecord.id;
        }
      }
    }

    const skillContext: SkillContext = {
      appId,
      userId: currentUser?.id,
      roles: currentUser?.roles || [],
      resourceScope: resourceType && resourceName
        ? [{ type: resourceType, name: resourceName }]
        : undefined,
    };

    const tools = this.skillRegistry.getAvailableTools(skillContext);
    ctx.body = { data: tools, meta: { count: tools.length } };
  }

  // ── List Execution Logs Handler ──────────────────────────────────────────

  private async handleListLogs(ctx: Context): Promise<void> {
    const {
      skillName, appId: appIdParam, userId, sessionId,
      page = '1', pageSize = '50',
    } = (ctx as any).query ?? {};

    try {
      const logger = this.skillLogger ?? (this.app as any).skillLogger;
      if (!logger) {
        ctx.body = { data: [], meta: { count: 0 } };
        return;
      }

      let appId: number | null = null;
      if (appIdParam) {
        if (!isNaN(Number(appIdParam))) {
          appId = Number(appIdParam);
        } else {
          const appsRepo = this.db.getRepository('apps');
          const appRecord = await appsRepo.findOne({ filter: { name: appIdParam } });
          if (appRecord) {
            appId = appRecord.id;
          }
        }
      }

      const rows = await logger.recent({
        skillName, appId: appId !== null ? appId : undefined, userId, sessionId,
        limit: Math.min(Number(pageSize), 200),
      });
      ctx.body = { data: rows, meta: { count: rows.length, page: Number(page) } };
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = { errors: [{ message: err.message, code: 'LOGS_ERROR' }] };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Resolve the list of user roles from the context.
   * First try currentUser.roles (if already populated by ACL middleware),
   * then fallback to querying from the roleUsers table.
   */
  private async resolveUserRoles(ctx: Context): Promise<string[]> {
    const currentUser = (ctx as any).state?.currentUser;
    if (!currentUser) return [];

    // already has roles field
    if (Array.isArray(currentUser.roles) && currentUser.roles.length > 0) {
      return currentUser.roles.map((r: any) => typeof r === 'object' ? r.name : r).filter(Boolean);
    }

    // query from roleUsers + roles tables
    try {
      const roleUsersRepo = this.db?.getRepository?.('roleUsers');
      const rolesRepo = this.db?.getRepository?.('roles');
      if (!roleUsersRepo || !rolesRepo) return [];

      const roleUserRecords = await roleUsersRepo.find({
        filter: { userId: currentUser.id },
      });

      const roleIds = roleUserRecords.map((ru: any) => ru.roleId).filter(Boolean);
      if (!roleIds.length) return [];

      const roleRecords = await rolesRepo.find({ filter: { id: roleIds } });
      return roleRecords.map((r: any) => r.name).filter(Boolean);
    } catch {
      return [];
    }
  }

  private async buildRuntimeSystemPrompt(
    appId: string | number | undefined,
    skillCount: number,
    roles: string[] = [],
    currentPage?: { title: string; path: string; schemaUid?: string }
  ): Promise<string> {
    const appsRepo = this.db.getRepository('apps');
    const appMenusRepo = this.db.getRepository('appMenus');
    const uiSchemasRepo = this.db.getRepository('uiSchemas');

    let numericAppId: number | null = null;
    let stringAppId: string | null = null;

    if (appId) {
      if (!isNaN(Number(appId))) {
        numericAppId = Number(appId);
        if (appsRepo) {
          try {
            const appRec = await appsRepo.findOne({ filter: { id: numericAppId } });
            if (appRec) {
              stringAppId = appRec.name;
            }
          } catch { /* ignore */ }
        }
      } else {
        stringAppId = String(appId);
        if (appsRepo) {
          try {
            const appRec = await appsRepo.findOne({ filter: { name: stringAppId } });
            if (appRec) {
              numericAppId = appRec.id;
            }
          } catch { /* ignore */ }
        }
      }
    }

    // 1. Fetch all collections from database
    const collections = this.db.getCollections();
    console.log("[AI Prompt Debug] Registered collections in db:", collections.map((c: any) => c.name));

    // 2. Filter collections that the current user has permission to view
    const readableCollections = collections.filter((col: any) => {
      // If user is a super admin/developer, they bypass ACL checks
      const isPlatformAdmin = roles.some((role) =>
        ['root', 'admin', 'developer'].includes(role)
      );
      if (isPlatformAdmin) return true;

      // Otherwise, query FormAI's ACL engine to see if the user has list access
      const aclEngine = this.acl || (this.app as any).acl;
      return roles.some((role) => {
        const perm = aclEngine?.can(role, col.name, 'list');
        return perm !== false && perm !== undefined;
      });
    });

    // 3. Serialize filtered schemas into a compact Markdown structure for System Prompt context
    const schemaDetails = readableCollections
      .map((col: any) => {
        const fields = col.getFields()
          .map((f: any) => {
            const relInfo = f.target ? ` (Relation to ${f.target}${f.through ? ' through ' + f.through : ''})` : '';
            return `  - ${f.name} (${f.type}${f.allowNull === false ? ', required' : ''}${f.comment ? ', ' + f.comment : ''})${relInfo}`;
          })
          .join('\n');
        return `- Collection: \`${col.name}\` (Title: "${col.options.title || col.name}"${col.options.comment ? ', Comment: ' + col.options.comment : ''})\n  Fields:\n${fields}`;
      })
      .join('\n\n');

    // 4. Fetch menu navigation context to align AI Assistant with active page UI
    let menuContext = '';
    if (numericAppId && stringAppId && appMenusRepo && uiSchemasRepo) {
      try {
        const menus = await appMenusRepo.find({
          filter: { appId: numericAppId, type: 'page' },
        });

        const uiSchemas = await uiSchemasRepo.find({
          filter: { appId: stringAppId },
        });

        const menuLines: string[] = [];
        for (const menu of menus) {
          const schema = uiSchemas.find((s: any) => s.uid === menu.schemaUid);
          let boundCollection = 'None';

          if (schema && schema.schema) {
            const findTableCollection = (node: any): string | null => {
              if (!node || typeof node !== 'object') return null;
              if (node['x-component'] === 'Table' && node['x-component-props']?.collection) {
                return node['x-component-props'].collection;
              }
              if (node.properties) {
                for (const key of Object.keys(node.properties)) {
                  const res = findTableCollection(node.properties[key]);
                  if (res) return res;
                }
              }
              return null;
            };

            const colName = findTableCollection(schema.schema);
            if (colName) {
              boundCollection = colName;
            }
          }

          menuLines.push(`- Menu Title: "${menu.title}" (Path: "${menu.path || ''}", Component: Table, Bound Database Collection: \`${boundCollection}\`)`);
        }

        if (menuLines.length > 0) {
          menuContext = [
            'UI Navigation & Page Context:',
            'Here are the active frontend menu items and their corresponding page UI data bindings:',
            ...menuLines,
            '',
          ].join('\n');
        }
      } catch (err: any) {
        console.warn('[AI Prompt] Failed to fetch menu context for prompt:', err.message);
      }
    }

    // 5. Active Page Context
    let activePageContext = '';
    if (currentPage) {
      activePageContext = [
        'Current Active Page Context:',
        `The user is currently viewing the page: "${currentPage.title}" (Path: "${currentPage.path || ''}", Schema UID: "${currentPage.schemaUid || ''}")`,
        'When the user requests to modify, query, or perform operations on "this page", "current page", or refers to the open view, they are referring to this active page.',
        '',
      ].join('\n');
    }

    return [
      'You are an intelligent AI assistant integrated into the Formai application platform.',
      appId ? `You are operating within the "${appId}" application context.` : '',
      `You have access to ${skillCount} skills that can query and manipulate real application data.`,
      '',
      'Database Schema Context:',
      'Here are the collections and their exact schemas in the current application database that you are permitted to read:',
      schemaDetails || 'No readable collections defined yet.',
      '',
      menuContext,
      activePageContext,
      'Guidelines:',
      '- NEVER ask the user for table names, field names, or database relationships. You are fully schema-aware of the schema listed above.',
      '- Always confirm what you understand from the user\'s request before executing write operations.',
      '- For list/query operations, summarize the results clearly and concisely.',
      '- If a required parameter is missing, ask the user for it.',
      '- Respond in the same language as the user.',
      '- When returning data results, present them in a readable format.',
      '- Never expose raw database error messages to the user; translate them into friendly language.',
    ].filter(Boolean).join('\n');
  }

  private async handleUserAction(sessionId: string, payload: any) {
    if (!this.gateway) return;
    const schemaUid = this.gateway.getSessionSchema(sessionId);
    if (!schemaUid) {
      console.warn(`[AG-UI Gateway] No schemaUid synced for session: ${sessionId}`);
      return;
    }

    console.log(`[AG-UI Gateway] Action '${payload.actionType}' by session '${sessionId}' on schema '${schemaUid}'`);
    
    // Broadcast the action to all OTHER clients synced to this schemaUid
    this.gateway.broadcastToSchema(schemaUid, sessionId, {
      operation: 'peerAction',
      payload: {
        sessionId,
        ...payload
      }
    });
  }
}

