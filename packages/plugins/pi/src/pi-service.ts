import path from 'node:path';
import fs from 'node:fs/promises';
import { loadPiCodingAgent } from './loader';
import type { SkillContext } from '@formai/shared';
import { createTenantScopedTools } from './tool-bridge';
import { FormAiTenantSessionManager } from './session-manager';
import { initAgentHarnessEngine, runPiTurn, type RunPiTurnOptions, type RunPiTurnResult } from './harness-bridge';

/**
 * Extract and join text from message content blocks.
 * Local implementation avoiding ERR_PACKAGE_PATH_NOT_EXPORTED when running in CJS/tsx runtimes.
 */
export function contentText(content: any, separator: string = '\n'): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join(separator);
}

export interface PiProviderConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: any;
}

export interface CreatePiSessionOptions {
  sessionId?: string;
  workingDirectory?: string;
  providerConfig?: PiProviderConfig;
  skillContext?: SkillContext;
  enablePlatformSkills?: boolean;
  systemPrompt?: string;
  isTransient?: boolean;
  storageMode?: 'database' | 'file' | 'memory';
  storageDir?: string;
  db?: any;
}

export interface RunPiPromptOptions {
  outputSchema?: any;
  signal?: AbortSignal;
  onTokenDelta?: (delta: string) => void;
  onEvent?: (event: any) => void;
  syncToDatabase?: boolean;
  tenantManager?: FormAiTenantSessionManager;
}

/**
 * Checks and prevents directory traversal attacks outside the designated tenant workspace
 */
export function assertPathInTenantWorkspace(targetPath: string, workspaceDir: string): string {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedWorkspace = path.resolve(workspaceDir);

  if (!resolvedTarget.startsWith(resolvedWorkspace)) {
    throw new Error(
      `[Security Violation] Path traversal attempt detected outside tenant workspace: ${targetPath} not in ${workspaceDir}`
    );
  }
  return resolvedTarget;
}

export class PiAgentService {
  constructor(private app: any) {}

  /**
   * Initializes the Agent-Native SQL sessions table and builtin harnesses
   */
  async initHarness(): Promise<void> {
    await initAgentHarnessEngine();
  }

  /**
   * Executes a Turn using the official ai-sdk-harness:pi with automated SQL session persistence
   */
  async runTurn(options: RunPiTurnOptions): Promise<RunPiTurnResult> {
    return runPiTurn(options);
  }

  /**
   * Creates an isolated, tenant-safe Pi Agent Session
   */
  async createSession(options: CreatePiSessionOptions = {}) {
    const {
      sessionId,
      workingDirectory = process.cwd(),
      providerConfig = {},
      skillContext = {},
      enablePlatformSkills = true,
      isTransient = true,
      storageMode,
      storageDir,
      db = this.app.db,
    } = options;

    // Ensure workingDirectory exists
    await fs.mkdir(workingDirectory, { recursive: true });

    // 1. Configure isolated SessionManager (supporting database, file, and in-memory modes)
    const effectiveMode = storageMode || (isTransient ? 'memory' : (process.env.FORMAI_SESSION_STORAGE === 'database' && db ? 'database' : 'file'));
    const tenantMgr = new FormAiTenantSessionManager(
      {
        tenantId: skillContext.tenantId,
        appId: skillContext.appId ?? undefined,
        userId: skillContext.userId ?? undefined,
      },
      { storageMode: effectiveMode, storageDir, db }
    );

    const sessionManagerInstance = await tenantMgr.getUnderlyingSessionManager(sessionId, workingDirectory);

    // 2. Configure Scoped Tools
    const tools = enablePlatformSkills ? createTenantScopedTools(this.app, skillContext) : [];

    // 3. Create ModelRuntime with clean in-memory config (BYOK / isolated credentials)
    const { createAgentSession, ModelRuntime } = await loadPiCodingAgent();
    const modelRuntime = await ModelRuntime.create();

    const rawProviderName = (providerConfig.provider || process.env.AI_DEFAULT_PROVIDER || 'openai').toLowerCase();
    const isQwen = rawProviderName === 'aliyun' || rawProviderName === 'dashscope' || rawProviderName === 'qwen';
    const providerName = isQwen ? 'qwen' : rawProviderName;

    const defaultQwenBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const effectiveBaseUrl = providerConfig.baseUrl || (isQwen ? defaultQwenBaseUrl : undefined);

    const effectiveApiKey = providerConfig.apiKey
      || (isQwen ? (process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || process.env.OPENAI_API_KEY) : undefined)
      || process.env[`${providerName.toUpperCase()}_API_KEY`]
      || process.env.OPENAI_API_KEY;

    // Prepare requested model definition
    const requestedModel = providerConfig.model || (isQwen ? 'qwen-plus' : (providerName === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'));
    const isAnthropic = providerName.includes('anthropic');

    const synthesizedModel = {
      id: requestedModel,
      name: requestedModel,
      api: (isAnthropic ? 'anthropic-messages' : 'openai-completions') as any,
      provider: providerName,
      baseUrl: effectiveBaseUrl || (isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
      reasoning: false,
      input: ['text', 'image'] as any,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    };

    // Ensure provider is registered in ModelRuntime
    const existingProv = typeof modelRuntime.getProvider === 'function' ? modelRuntime.getProvider(providerName) : undefined;
    if (!existingProv && typeof modelRuntime.registerProvider === 'function') {
      modelRuntime.registerProvider(providerName, {
        name: isQwen ? 'Aliyun DashScope Qwen' : providerName,
        baseUrl: effectiveBaseUrl || (isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
        apiKey: effectiveApiKey,
        models: [synthesizedModel],
      });
    }

    if (effectiveApiKey && typeof modelRuntime.setRuntimeApiKey === 'function') {
      await modelRuntime.setRuntimeApiKey(providerName, effectiveApiKey).catch(() => {});
      if (isQwen) {
        await modelRuntime.setRuntimeApiKey('aliyun', effectiveApiKey).catch(() => {});
        await modelRuntime.setRuntimeApiKey('dashscope', effectiveApiKey).catch(() => {});
        await modelRuntime.setRuntimeApiKey('qwen-token-plan', effectiveApiKey).catch(() => {});
      }
    }

    let model = typeof modelRuntime.getModel === 'function' ? modelRuntime.getModel(providerName, requestedModel) : undefined;
    if (!model) {
      model = synthesizedModel;
    }

    // 4. Instantiate Pi Agent Session
    const { session } = await createAgentSession({
      cwd: workingDirectory,
      sessionManager: sessionManagerInstance,
      modelRuntime,
      model,
      customTools: tools as any,
      tools: [],
    });

    try {
      if (typeof session.setModel === 'function') {
        await session.setModel(model);
      }
    } catch (e: any) {
      console.warn(`[Pi Plugin] Notice setting model ${requestedModel} on ${providerName}: ${e.message}`);
    }

    return {
      session,
      sessionId: session.sessionManager?.getSessionId?.() || sessionId || `pi_${Math.random().toString(36).slice(2, 10)}`,
      tenantManager: tenantMgr,
    };
  }

  /**
   * Executes a prompt turn with strict output schema extraction and streaming events
   */
  async runPrompt(session: any, prompt: string, options: RunPiPromptOptions = {}): Promise<string> {
    const { outputSchema, signal, onTokenDelta, onEvent } = options;

    let finalResponse = '';
    let lastError: string | null = null;

    // Register event listener
    const unsubscribe = session.subscribe((event: any) => {
      if (onEvent) {
        onEvent(event);
      }

      // Stream assistant tokens
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        const delta = event.assistantMessageEvent.delta;
        if (onTokenDelta) {
          onTokenDelta(delta);
        }
      }

      // Record any error condition from assistant message
      if (event.message?.role === 'assistant') {
        if (event.message.stopReason === 'error' && event.message.errorMessage) {
          lastError = event.message.errorMessage;
        }
      }

      // Capture completed assistant message (message_end, turn_end, or legacy message_completed)
      if (
        (event.type === 'message_end' || event.type === 'turn_end' || event.type === 'message_completed') &&
        event.message?.role === 'assistant'
      ) {
        const text = contentText(event.message.content, '');
        if (text) {
          finalResponse = text;
        } else if (typeof event.message.content === 'string') {
          finalResponse = event.message.content;
        }
      }
    });

    try {
      let augmentedPrompt = prompt;
      if (outputSchema) {
        augmentedPrompt += `\n\n[STRICT JSON REQUIREMENT]:\nYou must return ONLY a raw JSON object matching the following JSON Schema. Do NOT include any conversational text, explanations, or multiple markdown blocks. Return only valid JSON:\n${JSON.stringify(outputSchema, null, 2)}`;
      }

      // Execute prompt via Pi Agent Session
      await session.prompt(augmentedPrompt);

      // If finalResponse wasn't captured from event subscriptions, inspect last assistant message from session
      if (!finalResponse) {
        const msgs = session.messages || session.agent?.state?.messages || session.agent?.messages || [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant') {
            if (msgs[i].stopReason === 'error' && msgs[i].errorMessage) {
              lastError = msgs[i].errorMessage;
            }
            const text = contentText(msgs[i].content, '');
            if (text) {
              finalResponse = text;
              break;
            } else if (typeof msgs[i].content === 'string' && msgs[i].content) {
              finalResponse = msgs[i].content;
              break;
            }
          }
        }
      }

      // If response is still empty and an error occurred during generation, throw descriptive error
      if (!finalResponse && lastError) {
        throw new Error(`[Pi Agent Engine] Generation turn failed: ${lastError}`);
      }

      if (options.tenantManager) {
        await options.tenantManager.syncToDatabase(session);
      }

      return finalResponse;
    } finally {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    }
  }
}
