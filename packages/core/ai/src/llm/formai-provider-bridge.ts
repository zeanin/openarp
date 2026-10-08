import type { AIMessage, AIMessageChunk, ChatOptions } from '@formai/shared';
import type { LLMManager } from './manager';

/**
 * AI SDK LanguageModelV1 Call Options compatibility interface
 */
export interface LanguageModelV1PromptMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{
    type: 'text' | 'image' | 'tool-call' | 'tool-result';
    text?: string;
    toolCallId?: string;
    toolName?: string;
    args?: any;
    result?: any;
  }>;
}

export interface LanguageModelV1CallOptions {
  prompt: LanguageModelV1PromptMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  headers?: Record<string, string>;
  mode?: {
    type: 'regular' | 'object-json' | 'object-tool';
    [key: string]: any;
  };
  tools?: Array<{
    type: 'function';
    name: string;
    description?: string;
    parameters: Record<string, any>;
  }>;
  [key: string]: any;
}

export type LanguageModelV1StreamPart =
  | { type: 'text-delta'; textDelta: string }
  | { type: 'tool-call'; toolCallType: 'function'; toolCallId: string; toolName: string; args: string }
  | { type: 'finish'; finishReason: 'stop' | 'length' | 'tool-calls' | 'error' | 'other'; usage: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; error: unknown };

export interface LanguageModelV1GenerateResult {
  text?: string;
  toolCalls?: Array<{
    toolCallType: 'function';
    toolCallId: string;
    toolName: string;
    args: string;
  }>;
  finishReason: 'stop' | 'length' | 'tool-calls' | 'error' | 'other';
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  rawCall: {
    rawPrompt: unknown;
    rawSettings: Record<string, unknown>;
  };
  warnings?: any[];
}

export interface LanguageModelV1StreamResult {
  stream: ReadableStream<LanguageModelV1StreamPart>;
  rawCall: {
    rawPrompt: unknown;
    rawSettings: Record<string, unknown>;
  };
  warnings?: any[];
}

export interface FormAiBridgeOptions {
  providerName?: string;
  tenantId?: string;
  orgId?: string;
  userId?: string;
  apiKey?: string;
}

/**
 * Standard LanguageModelV1 implementation backed by FormAI's enterprise LLMManager.
 * Connects Qwen, DeepSeek, OpenAI, Anthropic, and BYOK tenants to any Vercel AI SDK runtime.
 */
export class FormAiLanguageModelBridge {
  readonly specificationVersion = 'v1' as const;
  readonly defaultObjectGenerationMode = 'json' as const;

  constructor(
    public readonly llmManager: LLMManager,
    public readonly modelId: string = 'qwen-plus',
    public readonly provider: string = 'formai-gateway',
    public readonly options: FormAiBridgeOptions = {}
  ) {}

  /**
   * Translates AI SDK LanguageModelV1 prompt messages into FormAI AIMessage format.
   */
  private convertPromptToMessages(prompt: LanguageModelV1PromptMessage[]): AIMessage[] {
    const messages: AIMessage[] = [];

    for (const msg of prompt) {
      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
        continue;
      }

      if (Array.isArray(msg.content)) {
        let textContent = '';
        const toolCalls: any[] = [];
        let toolCallId: string | undefined;

        for (const part of msg.content) {
          if (part.type === 'text' && typeof part.text === 'string') {
            textContent += (textContent ? '\n' : '') + part.text;
          } else if (part.type === 'tool-call') {
            toolCalls.push({
              id: part.toolCallId || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'function',
              function: {
                name: part.toolName || '',
                arguments: typeof part.args === 'string' ? part.args : JSON.stringify(part.args ?? {}),
              },
            });
          } else if (part.type === 'tool-result') {
            toolCallId = part.toolCallId;
            const resStr = typeof part.result === 'string' ? part.result : JSON.stringify(part.result ?? '');
            textContent += (textContent ? '\n' : '') + resStr;
          }
        }

        messages.push({
          role: msg.role,
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolCallId,
        });
      }
    }

    return messages;
  }

  /**
   * Prepares ChatOptions from LanguageModelV1CallOptions and bridge context.
   */
  private buildChatOptions(options: LanguageModelV1CallOptions): ChatOptions {
    const chatOpts: ChatOptions = {
      model: this.modelId,
      provider: this.options.providerName,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      topP: options.topP,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      stop: options.stopSequences,
    };

    if (options.tools && options.tools.length > 0) {
      chatOpts.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || {},
      }));
    }

    return chatOpts;
  }

  /**
   * Synchronous turn completion via FormAI LLMManager.
   */
  async doGenerate(options: LanguageModelV1CallOptions): Promise<LanguageModelV1GenerateResult> {
    const messages = this.convertPromptToMessages(options.prompt);
    const chatOpts = this.buildChatOptions(options);

    const response = await this.llmManager.chat(messages, chatOpts);

    const toolCalls = response.toolCalls?.map((tc) => ({
      toolCallType: 'function' as const,
      toolCallId: tc.id,
      toolName: tc.function.name,
      args: tc.function.arguments,
    }));

    const finishReason = toolCalls && toolCalls.length > 0 ? 'tool-calls' : 'stop';

    return {
      text: response.content || '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
      },
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {
          model: this.modelId,
          provider: this.provider,
          temperature: options.temperature,
        },
      },
    };
  }

  /**
   * Streaming completion yielding standard LanguageModelV1StreamPart chunks.
   */
  async doStream(options: LanguageModelV1CallOptions): Promise<LanguageModelV1StreamResult> {
    const messages = this.convertPromptToMessages(options.prompt);
    const chatOpts = this.buildChatOptions(options);

    const stream = this.llmManager.chatStream(messages, chatOpts);

    const readable = new ReadableStream<LanguageModelV1StreamPart>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              controller.enqueue({
                type: 'text-delta',
                textDelta: chunk.content,
              });
            }

            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              for (const tc of chunk.toolCalls) {
                controller.enqueue({
                  type: 'tool-call',
                  toolCallType: 'function',
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  args: tc.function.arguments,
                });
              }
            }
          }

          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: { promptTokens: 0, completionTokens: 0 },
          });
          controller.close();
        } catch (err) {
          controller.enqueue({
            type: 'error',
            error: err,
          });
          controller.error(err);
        }
      },
    });

    return {
      stream: readable,
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {
          model: this.modelId,
          provider: this.provider,
          temperature: options.temperature,
        },
      },
    };
  }
}

/**
 * Creates a LanguageModelV1 provider factory function compatible with Agent-Native
 */
export function createFormAiLanguageModelProvider(llmManager: LLMManager, defaultOptions?: FormAiBridgeOptions) {
  return (modelId: string = 'qwen-plus', options?: FormAiBridgeOptions) => {
    return new FormAiLanguageModelBridge(llmManager, modelId, 'formai-gateway', {
      ...defaultOptions,
      ...options,
    });
  };
}
