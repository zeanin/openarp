import path from 'node:path';
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
  startAgentHarnessRun,
  getLatestAgentHarnessSessionForThread,
  ensureAgentHarnessSessionTables,
  agentHarnessEventToAgentChatEvents,
  type AgentHarnessAdapter,
  type AgentHarnessEvent,
  type StoredAgentHarnessSession,
} from '@agent-native/core/agent/harness';
import type { SkillContext } from '@formai/shared';

export type ActiveRun = ReturnType<typeof startAgentHarnessRun>;

let harnessInitialized = false;

/**
 * Initializes Agent-Native Harness registry and SQL persistence tables.
 */
export async function initAgentHarnessEngine(): Promise<void> {
  if (harnessInitialized) return;

  // Prevent @agent-native/core from leaking data files into package directories
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL === 'memory' || process.env.DATABASE_URL === ':memory:') {
      process.env.DATABASE_URL = 'pglite://memory';
    }
  } else if (!process.env.DATABASE_URL) {
    // 1. Inherit PostgreSQL connection from FormAI .env (DB_HOST, DB_NAME, etc.) if configured
    const { DB_HOST, DB_PORT = '5432', DB_USER, DB_PASSWORD, DB_NAME } = process.env;
    if (DB_HOST && DB_NAME) {
      const auth = DB_USER ? `${encodeURIComponent(DB_USER)}${DB_PASSWORD ? `:${encodeURIComponent(DB_PASSWORD)}` : ''}@` : '';
      process.env.DATABASE_URL = `postgres://${auth}${DB_HOST}:${DB_PORT}/${DB_NAME}`;
    } else {
      // 2. Otherwise fall back to workspace root .data/pglite, never inside packages/
      const workspaceRoot = process.env.FORMAI_WORKSPACE_ROOT || process.cwd();
      process.env.DATABASE_URL = `pglite:${path.resolve(workspaceRoot, '.data/pglite')}`;
    }
  }

  // 1. Ensure SQL agent_harness_sessions table exists in Postgres / PGlite
  await ensureAgentHarnessSessionTables();

  // 2. Register official harnesses (including ai-sdk-harness:pi)
  registerBuiltinAgentHarnesses();

  harnessInitialized = true;
}

export interface PiHarnessAdapterOptions {
  permissionMode?: 'allow-all' | 'allow-edits' | 'allow-reads';
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  modelProvider?: any;
  providers?: Record<string, any>;
  credentials?: any;
  agentDir?: string;
  [key: string]: any;
}

/**
 * Resolves the official Pi Harness adapter configured with FormAI runtime options.
 */
export function getPiHarnessAdapter(options: PiHarnessAdapterOptions = {}): AgentHarnessAdapter {
  const {
    permissionMode = 'allow-edits',
    thinkingLevel = 'medium',
    modelProvider,
    providers,
    credentials,
    agentDir,
    ...rest
  } = options;

  return resolveAgentHarness('ai-sdk-harness:pi', {
    permissionMode,
    harnessOptions: {
      thinkingLevel,
      ...(modelProvider ? { modelProvider } : {}),
      ...(providers ? { providers } : {}),
      ...(credentials ? { credentials } : {}),
      ...(agentDir ? { agentDir } : {}),
      ...rest,
    },
  });
}

function normalizeToolsRecord(tools: any[] | Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!tools) return undefined;
  if (!Array.isArray(tools)) return tools;
  const rec: Record<string, unknown> = {};
  for (const t of tools) {
    if (t?.name) {
      rec[t.name] = t;
    }
  }
  return rec;
}

export interface RunPiTurnOptions {
  threadId: string;
  prompt: string;
  runId?: string;
  turnId?: string;
  adapter?: AgentHarnessAdapter;
  adapterOptions?: PiHarnessAdapterOptions;
  instructions?: string;
  tools?: any[] | Record<string, unknown>;
  skillContext?: SkillContext;
  ownerEmail?: string | null;
  orgId?: string | null;
  onTokenDelta?: (delta: string) => void;
  onHarnessEvent?: (event: AgentHarnessEvent) => void;
  onChatEvent?: (event: any) => void;
  outputSchema?: any;
  signal?: AbortSignal;
}

export interface RunPiTurnResult {
  runId: string;
  threadId: string;
  finalResponse: string;
  lastSession: StoredAgentHarnessSession | null;
  events: AgentHarnessEvent[];
  activeRun: ActiveRun;
}

/**
 * Executes a Turn driven by ai-sdk-harness:pi with automated SQL resumeState persistence.
 */
export async function runPiTurn(options: RunPiTurnOptions): Promise<RunPiTurnResult> {
  await initAgentHarnessEngine();

  const {
    threadId,
    prompt,
    runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    turnId,
    adapter = getPiHarnessAdapter(options.adapterOptions),
    instructions = 'You are the FormAI Application Architect and enterprise assistant.',
    tools,
    skillContext = {},
    ownerEmail = (skillContext as any).userEmail || (skillContext as any).email || null,
    orgId = skillContext.tenantId || (skillContext as any).orgId || null,
    onTokenDelta,
    onHarnessEvent,
    onChatEvent,
    outputSchema,
    signal,
  } = options;

  // 1. Recover resumeState from SQL agent_harness_sessions table
  const lastSession = await getLatestAgentHarnessSessionForThread(threadId, 'ai-sdk-harness:pi');

  // Format prompt with output schema requirement if provided
  let effectivePrompt = prompt;
  if (outputSchema) {
    effectivePrompt += `\n\n[STRICT JSON REQUIREMENT]:\nYou must return ONLY a raw JSON object matching the following JSON Schema. Do NOT include conversational text or markdown blocks:\n${JSON.stringify(outputSchema, null, 2)}`;
  }

  const events: AgentHarnessEvent[] = [];
  let finalResponse = '';

  const normalizedTools = normalizeToolsRecord(tools);

  // 2. Start Agent Harness Run with official adapter
  return new Promise<RunPiTurnResult>((resolve, reject) => {
    let resolved = false;

    const activeRun = startAgentHarnessRun({
      runId,
      threadId,
      turnId,
      adapter,
      input: { prompt: effectivePrompt },
      createSession: {
        sessionId: lastSession?.id,
        resumeState: lastSession?.resumeState,
        instructions,
        tools: normalizedTools,
      },
      ownerEmail,
      orgId,
      onHarnessEvent: (event: AgentHarnessEvent) => {
        events.push(event);

        if (onHarnessEvent) {
          try {
            onHarnessEvent(event);
          } catch (e) {
            console.error('[Pi Harness] onHarnessEvent listener error:', e);
          }
        }

        // Accumulate text-delta
        if (event.type === 'text-delta') {
          finalResponse += event.text;
          if (onTokenDelta) onTokenDelta(event.text);
        }

        // Translate to AgentChatEvents for frontend streaming
        if (onChatEvent) {
          try {
            const chatEvents = agentHarnessEventToAgentChatEvents(event);
            for (const ce of chatEvents) {
              onChatEvent(ce);
            }
          } catch (e) {
            console.warn('[Pi Harness] Event translation warning:', e);
          }
        }
      },
      onRunComplete: async (run: ActiveRun) => {
        if (resolved) return;
        resolved = true;

        try {
          const updatedSession = await getLatestAgentHarnessSessionForThread(threadId, 'ai-sdk-harness:pi');

          resolve({
            runId,
            threadId,
            finalResponse,
            lastSession: updatedSession,
            events,
            activeRun: run,
          });
        } catch (err) {
          reject(err);
        }
      },
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        activeRun.abort.abort();
        if (!resolved) {
          resolved = true;
          reject(new Error(`[Pi Harness] Run ${runId} was aborted.`));
        }
      });
    }
  });
}
