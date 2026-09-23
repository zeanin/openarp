import { describe, it, expect, vi } from 'vitest';
import { createTenantScopedTools } from '../tool-bridge';
import { assertPathInTenantWorkspace, PiAgentService } from '../pi-service';
import { FormAiTenantSessionManager } from '../session-manager';
import type { SkillContext } from '@formai/shared';

describe('Pi Plugin & Multi-Tenancy Engine', () => {
  describe('Tool Bridge & Tenant Context Propagation', () => {
    it('should generate Pi tool definitions and propagate SkillContext to executor', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ success: true, count: 42 });
      const mockSkillRegistry = {
        getAvailableTools: vi.fn().mockReturnValue([
          {
            name: 'query_collection',
            description: 'Query collection records',
            inputSchema: {
              type: 'object',
              properties: {
                collection: { type: 'string' },
              },
            },
          },
        ]),
        execute: mockExecute,
      };

      const mockApp = { skillRegistry: mockSkillRegistry };
      const tenantContext: SkillContext = {
        tenantId: 'tenant-enterprise-01',
        appId: 'app-erp-001',
        userId: 'user-admin',
        roles: ['developer', 'admin'],
      };

      const tools = createTenantScopedTools(mockApp, tenantContext);

      expect(mockSkillRegistry.getAvailableTools).toHaveBeenCalledWith(tenantContext);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('query_collection');
      expect(tools[0].description).toBe('Query collection records');

      // Execute tool
      const result = await tools[0].execute({ collection: 'orders' });

      expect(result).toEqual({ success: true, count: 42 });
      expect(mockExecute).toHaveBeenCalledWith(
        'query_collection',
        { collection: 'orders' },
        tenantContext
      );
    });

    it('should handle confirmation required skills gracefully', async () => {
      const mockSkillRegistry = {
        getAvailableTools: vi.fn().mockReturnValue([
          { name: 'drop_table', description: 'Dangerous action' },
        ]),
        execute: vi.fn().mockResolvedValue({
          type: 'confirmation',
          confirmationId: 'conf-12345',
        }),
      };

      const mockApp = { skillRegistry: mockSkillRegistry };
      const tools = createTenantScopedTools(mockApp, { tenantId: 'tenant-1' });

      const result = await tools[0].execute({ table: 'users' });
      expect(result.isError).toBe(true);
      expect(result.confirmationId).toBe('conf-12345');
    });
  });

  describe('Workspace Jail & Path Traversal Prevention', () => {
    it('should allow paths strictly inside tenant workspace', () => {
      const workspaceDir = '/tmp/formai/tenants/t1/apps/app1/workspace';
      const safePath = '/tmp/formai/tenants/t1/apps/app1/workspace/src/index.ts';

      const resolved = assertPathInTenantWorkspace(safePath, workspaceDir);
      expect(resolved).toBe(safePath);
    });

    it('should throw security violation on directory traversal attempt', () => {
      const workspaceDir = '/tmp/formai/tenants/t1/apps/app1/workspace';
      const escapePath = '/tmp/formai/tenants/t1/apps/app1/workspace/../../../../etc/passwd';

      expect(() => {
        assertPathInTenantWorkspace(escapePath, workspaceDir);
      }).toThrow(/Security Violation/);
    });
  });

  describe('FormAiTenantSessionManager', () => {
    it('should configure isolated session directory per tenant and app for file mode', () => {
      const manager = new FormAiTenantSessionManager({
        tenantId: 'tenant-alpha',
        appId: 'crm-app',
        userId: 'dev-1',
      }, { storageMode: 'file' });

      const dir = manager.getSessionDir();
      expect(dir).toContain('tenant-alpha');
      expect(dir).toContain('crm-app');
      expect(dir).toContain('sessions');
      expect(manager.getStorageMode()).toBe('file');
    });

    it('should support database storage mode and synchronize session to database repository via create or update', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 'sess-100' });
      const mockUpdate = vi.fn().mockResolvedValue({ id: 'sess-100' });
      const mockRepo = {
        findOne: vi.fn().mockResolvedValue(null),
        create: mockCreate,
        update: mockUpdate,
        collection: {
          hasField: (f: string) => ['tenant_id', 'app_id', 'user_id', 'entries', 'metadata'].includes(f),
        },
      };
      const mockDb = {
        getRepository: vi.fn().mockReturnValue(mockRepo),
      };

      const manager = new FormAiTenantSessionManager({
        tenantId: 'tenant-enterprise',
        appId: 'app-999',
        userId: 'user-777',
      }, {
        storageMode: 'database',
        db: mockDb,
      });

      expect(manager.getStorageMode()).toBe('database');

      const mockSession = {
        sessionManager: {
          getSessionId: () => 'sess-100',
          getEntries: () => [{ type: 'message', content: 'hello' }],
        },
      };

      await manager.syncToDatabase(mockSession, { task: 'blueprint-compilation' });

      expect(mockDb.getRepository).toHaveBeenCalledWith('agentSessions');
      expect(mockCreate).toHaveBeenCalledWith({
        values: expect.objectContaining({
          id: 'sess-100',
          tenant_id: 'tenant-enterprise',
          app_id: 'app-999',
          user_id: 'user-777',
          entries: [{ type: 'message', content: 'hello' }],
          metadata: { task: 'blueprint-compilation' },
        }),
      });
    });
  });

  describe('runPrompt Response Extraction', () => {
    it('should capture assistant final response from message_end event', async () => {
      const piService = new PiAgentService({});
      let listener: any = null;
      const mockSession = {
        subscribe: vi.fn().mockImplementation((fn) => {
          listener = fn;
          return () => {};
        }),
        prompt: vi.fn().mockImplementation(async () => {
          if (listener) {
            listener({
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: '{"collections":[{"name":"contacts"}]}' }],
              },
            });
          }
        }),
      };

      const result = await piService.runPrompt(mockSession, 'Generate DB schema');
      expect(result).toBe('{"collections":[{"name":"contacts"}]}');
    });

    it('should fallback to session.messages when event does not capture', async () => {
      const piService = new PiAgentService({});
      const mockSession = {
        subscribe: vi.fn().mockReturnValue(() => {}),
        prompt: vi.fn().mockResolvedValue(undefined),
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: '{"collections":[{"name":"leads"}]}' },
        ],
      };

      const result = await piService.runPrompt(mockSession, 'Generate DB schema');
      expect(result).toBe('{"collections":[{"name":"leads"}]}');
    });
  });
});
