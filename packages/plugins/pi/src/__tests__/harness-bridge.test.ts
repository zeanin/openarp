import { describe, it, expect, beforeEach } from 'vitest';
import {
  initAgentHarnessEngine,
  getPiHarnessAdapter,
} from '../harness-bridge';
import {
  saveAgentHarnessSession,
  getLatestAgentHarnessSessionForThread,
  listAgentHarnessSessions,
  agentHarnessEventToAgentChatEvents,
} from '@agent-native/core/agent/harness';
import { PiAgentService } from '../pi-service';

describe('Pi Harness Bridge & Agent-Native Session State', () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = 'pglite://memory';
    await initAgentHarnessEngine();
  });

  it('initializes agent harness engine and creates session tables in memory', async () => {
    const sessions = await listAgentHarnessSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('resolves official ai-sdk-harness:pi adapter with appropriate capabilities', () => {
    const adapter = getPiHarnessAdapter({
      permissionMode: 'allow-edits',
      thinkingLevel: 'high',
    });

    expect(adapter.name).toBe('ai-sdk-harness:pi');
    expect(adapter.capabilities.resumable).toBe(true);
    expect(adapter.capabilities.hostTools).toBe(true);
    expect(adapter.capabilities.fileEvents).toBe(true);
  });

  it('saves and restores turn resumeState from SQL agent_harness_sessions table', async () => {
    const threadId = `thread_test_${Date.now()}`;
    const initialResumeState = {
      turn: 1,
      model: 'qwen-max',
      tokensUsed: 420,
      contextSnapshot: 'Initialized schema and collections',
    };

    const saved = await saveAgentHarnessSession({
      id: `sess_${Date.now()}`,
      harnessName: 'ai-sdk-harness:pi',
      threadId,
      status: 'idle',
      resumeState: initialResumeState,
      ownerEmail: 'architect@formai.io',
      orgId: 'org_acme',
    });

    expect(saved.id).toBeDefined();
    expect(saved.harnessName).toBe('ai-sdk-harness:pi');

    // Fetch latest session for thread
    const latest = await getLatestAgentHarnessSessionForThread(threadId, 'ai-sdk-harness:pi');

    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(saved.id);
    expect(latest?.resumeState).toEqual(initialResumeState);
    expect(latest?.ownerEmail).toBe('architect@formai.io');
    expect(latest?.orgId).toBe('org_acme');
  });

  it('translates harness events into standard AgentChatEvents', () => {
    const textDeltaEvent: any = {
      type: 'text-delta',
      text: 'I have created the sales collection.',
    };

    const textChatEvents = agentHarnessEventToAgentChatEvents(textDeltaEvent);
    expect(Array.isArray(textChatEvents)).toBe(true);
    expect(textChatEvents).toHaveLength(1);
    expect(textChatEvents[0].type).toBe('text');
    expect((textChatEvents[0] as any).text).toBe('I have created the sales collection.');

    const toolStartEvent: any = {
      type: 'tool-start',
      name: 'create_collection',
      input: { name: 'sales' },
    };

    const toolChatEvents = agentHarnessEventToAgentChatEvents(toolStartEvent);
    expect(toolChatEvents[0].type).toBe('tool_start');
    expect((toolChatEvents[0] as any).tool).toBe('create_collection');
  });

  it('exposes initHarness and runTurn on PiAgentService', async () => {
    const mockApp = { db: null };
    const service = new PiAgentService(mockApp);

    expect(typeof service.initHarness).toBe('function');
    expect(typeof service.runTurn).toBe('function');

    await expect(service.initHarness()).resolves.toBeUndefined();
  });
});
