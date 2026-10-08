import { describe, it, expect, vi } from 'vitest';
import {
  BlueprintMarketplace,
  computeBlueprintDiff,
  IncrementalCompiler,
  TenantAgentGovernanceManager,
} from '../index';

describe('Blueprint Marketplace (ARP 3.1)', () => {
  it('lists verified domain blueprints with ratings and tags', () => {
    const marketplace = new BlueprintMarketplace();
    const list = marketplace.listBlueprints();
    expect(list.length).toBeGreaterThanOrEqual(5);

    const crmPkg = list.find((p) => p.category === 'crm');
    expect(crmPkg).toBeDefined();
    expect(crmPkg?.isVerified).toBe(true);
    expect(crmPkg?.rating).toBeGreaterThanOrEqual(4.5);
  });

  it('filters blueprints by category, query and tags', () => {
    const marketplace = new BlueprintMarketplace();
    const crmOnly = marketplace.listBlueprints({ category: 'crm' });
    expect(crmOnly.every((p) => p.category === 'crm')).toBe(true);

    const searched = marketplace.listBlueprints({ query: '仓储' });
    expect(searched.length).toBeGreaterThan(0);
    expect(searched[0].name).toContain('进销存');
  });

  it('publishes and deploys a blueprint into target app', async () => {
    const marketplace = new BlueprintMarketplace();
    const customPkg = marketplace.publishBlueprint({
      name: '智能电商客服中心',
      version: '1.0.0',
      author: 'E-Commerce Ops',
      category: 'ecommerce',
      description: '自动化智能工单与评价分析',
      tags: ['Ecommerce', 'Tickets'],
      blueprint: {
        collections: [
          {
            name: 'tickets',
            title: '售后工单',
            fields: [{ name: 'title', type: 'string', title: '工单标题' }],
          },
        ],
        menus: [{ title: '工单看板', type: 'page', collection: 'tickets' }],
        workflows: [{ title: '超时升级工单', description: '超过2小时自动转人工' }],
      },
    });

    expect(customPkg.id).toBeDefined();
    expect(marketplace.getBlueprint(customPkg.id)).toBeDefined();

    // 1-Click Deployment
    const res = await marketplace.deployBlueprint(customPkg.id, {
      targetAppId: 'app_shop_01',
      seedMockData: false,
    });

    expect(res.status).toBe('success');
    expect(res.createdCollections).toContain('tickets');
    expect(res.createdPages).toContain('工单看板');
    expect(res.createdWorkflows).toContain('超时升级工单');
  });
});

describe('Blueprint Diff & Incremental Compiler (ARP 3.2)', () => {
  const oldBlueprint = {
    collections: [
      {
        name: 'orders',
        title: '订单表',
        fields: [
          { name: 'order_no', type: 'string', title: '订单号' },
          { name: 'amount', type: 'decimal', title: '金额' },
        ],
      },
    ],
    menus: [{ title: '订单管理', type: 'page', collection: 'orders' }],
    workflows: [{ title: '订单支付成功通知', trigger: { type: 'record_created' } }],
  };

  const newBlueprint = {
    collections: [
      {
        name: 'orders',
        title: '订单表',
        fields: [
          { name: 'order_no', type: 'string', title: '订单号' },
          { name: 'amount', type: 'decimal', title: '金额' },
          { name: 'priority', type: 'string', title: '优先级' }, // Added field!
        ],
      },
      {
        name: 'deliveries', // Added collection!
        title: '物流发货单',
        fields: [{ name: 'tracking_no', type: 'string', title: '运单号' }],
      },
    ],
    menus: [
      { title: '订单管理', type: 'page', collection: 'orders' },
      { title: '发货明细', type: 'page', collection: 'deliveries' }, // Added page!
    ],
    workflows: [{ title: '订单支付成功通知', trigger: { type: 'record_created' } }],
  };

  it('detects added collections, modified fields, and added pages', () => {
    const diff = computeBlueprintDiff(oldBlueprint, newBlueprint);
    expect(diff.hasChanges).toBe(true);
    expect(diff.hasBreakingChanges).toBe(false);

    expect(diff.collections.added.length).toBe(1);
    expect(diff.collections.added[0].name).toBe('deliveries');

    expect(diff.collections.modified.length).toBe(1);
    expect(diff.collections.modified[0].name).toBe('orders');
    expect(diff.collections.modified[0].addedFields.length).toBe(1);
    expect(diff.collections.modified[0].addedFields[0].name).toBe('priority');

    expect(diff.pages.added.length).toBe(1);
    expect(diff.pages.added[0].title).toBe('发货明细');
  });

  it('detects breaking changes when collections or fields are dropped', () => {
    const brokenBlueprint = {
      collections: [], // orders removed!
      menus: [],
    };
    const diff = computeBlueprintDiff(oldBlueprint, brokenBlueprint);
    expect(diff.hasBreakingChanges).toBe(true);
    expect(diff.breakingReasons.length).toBeGreaterThan(0);
  });

  it('applies non-destructive incremental changes using ALTER TABLE simulation', async () => {
    const createdFields: any[] = [];
    const mockDb = {
      getRepository: vi.fn((name: string) => ({
        create: vi.fn(async ({ values }) => {
          if (name === 'fields') createdFields.push(values);
          return { id: 1, ...values };
        }),
      })),
      syncCollection: vi.fn(async (colName, opts) => {
        expect(opts.alter).toBe(true); // Non-destructive ALTER TABLE
      }),
    };

    const diff = computeBlueprintDiff(oldBlueprint, newBlueprint);
    const compiler = new IncrementalCompiler(mockDb);

    const result = await compiler.applyDiff('my_store_app', diff);
    expect(result.status).toBe('success');
    expect(result.addedCollections).toContain('app_my_store_app_deliveries');
    expect(result.alteredCollections).toContain('app_my_store_app_orders');
    expect(result.addedFieldsCount).toBeGreaterThanOrEqual(1);

    // Verify priority field was created
    const priorityField = createdFields.find((f) => f.name === 'priority');
    expect(priorityField).toBeDefined();
    expect(priorityField.collectionName).toBe('app_my_store_app_orders');
  });
});

describe('Multi-Tenant Agent Governance (ARP 3.3)', () => {
  it('enforces quota limits for concurrent agents, tokens, and proactive runners', () => {
    const gov = new TenantAgentGovernanceManager();
    gov.setTenantPolicy({
      tenantId: 'tenant_acme',
      agentQuota: {
        maxConcurrentAgents: 2,
        maxMonthlyTokens: 1000,
        maxProactiveAgentCount: 1,
      },
      dataIsolation: {},
      auditPolicy: {
        logAllToolCalls: true,
        requireApprovalFor: [],
        retentionDays: 30,
      },
    });

    // Check allowed within quota
    const q1 = gov.checkQuota('tenant_acme', { concurrentCount: 1, tokens: 500 });
    expect(q1.allowed).toBe(true);

    // Check quota breach
    const q2 = gov.checkQuota('tenant_acme', { concurrentCount: 3 });
    expect(q2.allowed).toBe(false);
    expect(q2.reason).toContain('Exceeded max concurrent agents');

    gov.recordTokenUsage('tenant_acme', 800);
    const q3 = gov.checkQuota('tenant_acme', { tokens: 300 }); // 800 + 300 > 1000
    expect(q3.allowed).toBe(false);
    expect(q3.reason).toContain('monthly token quota');
  });

  it('masks sensitive PII data before prompt injection', () => {
    const gov = new TenantAgentGovernanceManager();
    const rawRecords = [
      {
        id: 1,
        name: '张三',
        email: 'zhangsan@corp.com',
        password: 'PlainTextPassword123!',
        salary: 35000,
        secret_token: 'sk-998811',
      },
    ];

    const masked = gov.maskPiiData('default', 'users', rawRecords);
    expect(masked[0].name).toBe('张三');
    expect(masked[0].password).toBe('****** [PII MASKED]');
    expect(masked[0].salary).toBe('****** [PII MASKED]');
  });

  it('enforces data isolation and logs activity with approval routing', () => {
    const gov = new TenantAgentGovernanceManager();
    gov.setTenantPolicy({
      tenantId: 'tenant_strict',
      agentQuota: { maxConcurrentAgents: 5, maxMonthlyTokens: 100000, maxProactiveAgentCount: 2 },
      dataIsolation: {
        allowedCollections: ['orders', 'products'],
        readOnlyCollections: ['products'],
      },
      auditPolicy: {
        logAllToolCalls: true,
        requireApprovalFor: ['delete', 'destroy'],
        retentionDays: 60,
      },
    });

    // 1. Access to unallowed collection
    const check1 = gov.validateAgentAction('tenant_strict', {
      actionType: 'query',
      collection: 'salaries',
      agentId: 'agent_01',
    });
    expect(check1.allowed).toBe(false);

    // 2. Write to read-only collection
    const check2 = gov.validateAgentAction('tenant_strict', {
      actionType: 'update_record',
      collection: 'products',
      agentId: 'agent_01',
    });
    expect(check2.allowed).toBe(false);

    // 3. Sensitive delete action requiring supervisor approval
    const check3 = gov.validateAgentAction('tenant_strict', {
      actionType: 'delete_order',
      collection: 'orders',
      agentId: 'agent_01',
    });
    expect(check3.allowed).toBe(true);
    expect(check3.requiresApproval).toBe(true);

    const logs = gov.getAuditLogs('tenant_strict');
    expect(logs.length).toBe(3);
  });
});
