import { describe, it, expect, beforeEach } from 'vitest';
import { LLMManager } from '../llm/manager';
import { MockLLMProvider } from '../llm/providers/mock';
import { FormAiLanguageModelBridge, createFormAiLanguageModelProvider } from '../llm/formai-provider-bridge';

describe('FormAiLanguageModelBridge', () => {
  let manager: LLMManager;
  let mock: MockLLMProvider;
  let bridge: FormAiLanguageModelBridge;

  beforeEach(() => {
    manager = new LLMManager();
    mock = new MockLLMProvider();
    manager.registerProvider(mock);
    bridge = new FormAiLanguageModelBridge(manager, 'mock-model', 'formai-gateway', {
      tenantId: 'tenant_1',
      orgId: 'org_1',
    });
  });

  it('exposes standard LanguageModelV1 properties', () => {
    expect(bridge.specificationVersion).toBe('v1');
    expect(bridge.defaultObjectGenerationMode).toBe('json');
    expect(bridge.modelId).toBe('mock-model');
    expect(bridge.provider).toBe('formai-gateway');
  });

  it('performs doGenerate with simple text prompt', async () => {
    mock.setResponses([
      { role: 'assistant', content: 'Hello from FormAI' },
    ]);

    const result = await bridge.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Hi!' }] },
      ],
      temperature: 0.7,
    });

    expect(result.text).toBe('Hello from FormAI');
    expect(result.finishReason).toBe('stop');
    expect(result.rawCall.rawSettings.model).toBe('mock-model');
  });

  it('performs doGenerate with tool calls', async () => {
    mock.setResponses([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'getWeather',
              arguments: '{"city":"Shanghai"}',
            },
          },
        ],
      },
    ]);

    const result = await bridge.doGenerate({
      prompt: [{ role: 'user', content: 'What is the weather in Shanghai?' }],
      tools: [
        {
          type: 'function',
          name: 'getWeather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
    });

    expect(result.finishReason).toBe('tool-calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].toolName).toBe('getWeather');
    expect(result.toolCalls?.[0].args).toBe('{"city":"Shanghai"}');
  });

  it('performs doStream producing text deltas and finish event', async () => {
    mock.setResponses([
      { role: 'assistant', content: 'Hello streaming world' },
    ]);

    const streamResult = await bridge.doStream({
      prompt: [{ role: 'user', content: 'Tell me a story' }],
    });

    const reader = streamResult.stream.getReader();
    const parts: any[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    const textParts = parts.filter((p) => p.type === 'text-delta');
    expect(textParts.map((p) => p.textDelta).join('')).toBe('Hello streaming world');

    const finishPart = parts.find((p) => p.type === 'finish');
    expect(finishPart).toBeDefined();
    expect(finishPart.finishReason).toBe('stop');
  });

  it('supports createFormAiLanguageModelProvider factory', () => {
    const providerFactory = createFormAiLanguageModelProvider(manager, {
      tenantId: 'tenant_test',
    });

    const instance = providerFactory('deepseek-r1', {
      orgId: 'org_test',
    });

    expect(instance.modelId).toBe('deepseek-r1');
    expect(instance.options.tenantId).toBe('tenant_test');
    expect(instance.options.orgId).toBe('org_test');
  });
});
