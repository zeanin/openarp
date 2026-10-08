import { describe, it, expect, vi } from 'vitest';
import {
  validateBlueprintIntegrity,
  autoRepairBlueprint,
  generateReportPageSchema,
  generateApprovalPageSchema,
  generatePageSchemaForArchetype,
  ProactiveAgentManager,
} from '../index';

describe('Cross-Validation & Auto-Healing (ARP Stage 2)', () => {
  const invalidBlueprint = {
    collections: [
      {
        name: 'orders',
        title: '订单表',
        fields: [
          { name: 'title', type: 'string', title: '订单标题' },
          { name: 'customer_id', type: 'belongsTo', title: '客户', target: 'non_existent_customers' }, // Invalid FK target!
        ],
      },
    ],
    menus: [
      { title: '订单管理', type: 'page', collection: 'orders' },
      { title: '未知单据', type: 'page', collection: 'missing_ghost_col' }, // Missing collection!
    ],
    workflows: [
      {
        title: '幽灵表自动流',
        trigger: { type: 'record_created', collection: 'ghost_col' }, // Workflow target mismatch!
      },
    ],
  };

  it('detects relational inconsistencies across DB, UI, and Workflows', () => {
    const res = validateBlueprintIntegrity(invalidBlueprint);
    expect(res.valid).toBe(false);
    expect(res.errorsCount).toBeGreaterThan(0);
    expect(res.warningsCount).toBeGreaterThan(0);

    const issueTypes = res.issues.map((i) => i.type);
    expect(issueTypes).toContain('invalid_foreign_key');
    expect(issueTypes).toContain('missing_collection');
    expect(issueTypes).toContain('workflow_target_mismatch');
  });

  it('auto-heals blueprint by provisioning missing collections and remapping dangling targets', () => {
    const { repairedBlueprint, repairedCount } = autoRepairBlueprint(invalidBlueprint);
    expect(repairedCount).toBeGreaterThanOrEqual(2);

    // Verify target collection was auto-provisioned
    const colNames = repairedBlueprint.collections.map((c: any) => c.name);
    expect(colNames).toContain('non_existent_customers');

    // Run validation again on repaired blueprint
    const reValidation = validateBlueprintIntegrity(repairedBlueprint);
    expect(reValidation.valid).toBe(true);
    expect(reValidation.errorsCount).toBe(0);
  });
});

describe('Report and Approval Page Archetypes', () => {
  const mockFields = [
    { name: 'order_no', type: 'string', title: '订单号' },
    { name: 'total_amount', type: 'decimal', title: '订单总额' },
  ];

  it('generates Report Page schema with summary KPI grid and export action', () => {
    const schema: any = generateReportPageSchema('销售业绩统计分析', {
      collectionName: 'app_test_orders',
      fields: mockFields,
    });

    expect(schema['x-component']).toBe('Page');
    expect(schema.properties.gridSummary).toBeDefined();
    expect(schema.properties.filterPanel).toBeDefined();

    const tableCard = schema.properties.gridTable.properties.colMain.properties.reportCard;
    expect(tableCard.properties.actionBar.properties.exportBtn['x-component-props'].action).toBe('export');
  });

  it('generates Approval Page schema with StepsBlock and ApprovalTable', () => {
    const schema: any = generateApprovalPageSchema('费用报销审批待办', {
      collectionName: 'app_test_expenses',
      fields: mockFields,
    });

    expect(schema['x-component']).toBe('Page');
    const stepsBlock = schema.properties.grid.properties.stepsCol.properties.stepCard.properties.steps;
    expect(stepsBlock['x-component']).toBe('StepsBlock');

    const tableCard = schema.properties.grid.properties.tableCol.properties.approvalTableCard;
    expect(tableCard.properties.table).toBeDefined();
  });

  it('dispatches report and approval titles correctly via generatePageSchemaForArchetype', () => {
    const rep = generatePageSchemaForArchetype('月度财务透视报表', { fields: mockFields });
    expect(rep.properties.gridSummary).toBeDefined();

    const appv = generatePageSchemaForArchetype('合同用印审批待办', { fields: mockFields });
    expect(appv.properties.grid.properties.stepsCol).toBeDefined();
  });
});

describe('Proactive Agent Scheduler & Event Hooks', () => {
  it('triggers inspection upon data change events', async () => {
    const mockDb = {
      getRepository: vi.fn(() => ({
        count: vi.fn(async () => 1),
        find: vi.fn(async () => [{ stock: 5 }]),
      })),
    };

    const manager = new ProactiveAgentManager(mockDb);
    manager.registerAgent({
      id: 'agent_event_guard',
      name: '仓储物料即时监听智能体',
      appId: 'app_wms',
      enabled: true,
      triggerEvents: [{ collection: 'app_wms_stocks', action: 'update' }],
      monitoringTargets: {
        collections: ['app_wms_stocks'],
        metrics: [
          {
            name: '库存下限',
            collection: 'app_wms_stocks',
            field: 'stock',
            aggregation: 'min',
            threshold: { operator: '<=', value: 10 },
            severity: 'critical',
          },
        ],
      },
      actionSpace: {
        canNotify: true,
        canCreateRecord: false,
        canUpdateRecord: false,
        canTriggerWorkflow: false,
      },
    });

    // Fire data change event
    const results = await manager.handleDataChangeEvent({
      collection: 'app_wms_stocks',
      action: 'update',
      record: { id: 1, stock: 5 },
    });

    expect(results.length).toBe(1);
    expect(results[0].status).toBe('anomaly_detected');
    expect(results[0].violations.length).toBe(1);
  });

  it('starts and stops background interval timer', () => {
    vi.useFakeTimers();
    const manager = new ProactiveAgentManager();
    manager.startScheduler(1000);
    expect((manager as any).schedulerTimer).toBeDefined();

    manager.stopScheduler();
    expect((manager as any).schedulerTimer).toBeUndefined();
    vi.useRealTimers();
  });
});
