import { describe, it, expect, vi } from 'vitest';
import {
  ExternalDataConnector,
  DecisionSimulationEngine,
  ProactiveAgentManager,
  ApprovalManager,
} from '../index';

describe('External Data Twin Graph Connector (ARP 2.2)', () => {
  it('initializes with default industry data feeds', () => {
    const connector = new ExternalDataConnector();
    const sources = connector.listSources();
    expect(sources.length).toBeGreaterThanOrEqual(3);

    const sourceIds = sources.map((s) => s.id);
    expect(sourceIds).toContain('market_fx_rates');
    expect(sourceIds).toContain('market_commodities');
    expect(sourceIds).toContain('competitor_intel');
  });

  it('fetches exchange rates and commodity indices', async () => {
    const connector = new ExternalDataConnector();
    const fxData = await connector.fetchData('market_fx_rates');
    expect(fxData.rates.CNY).toBe(7.245);

    const commodityData = await connector.fetchData('market_commodities');
    expect(Array.isArray(commodityData)).toBe(true);
    expect(commodityData[0].code).toBe('COPPER');
  });

  it('syncs transformed external feed into internal database collection', async () => {
    const connector = new ExternalDataConnector();
    const syncedRecords: any[] = [];
    const mockDb = {
      getRepository: vi.fn(() => ({
        create: vi.fn(async ({ values }) => {
          syncedRecords.push(values);
          return { id: syncedRecords.length, ...values };
        }),
      })),
    };

    const res = await connector.syncToCollection(
      'market_commodities',
      'app_inventory_commodity_prices',
      [
        { sourcePath: 'code', targetField: 'material_code', type: 'string' },
        { sourcePath: 'price', targetField: 'unit_price', type: 'number' },
        { sourcePath: 'changePercent', targetField: 'volatility', type: 'number' },
      ],
      mockDb
    );

    expect(res.status).toBe('success');
    expect(syncedRecords.length).toBeGreaterThan(0);
    expect(syncedRecords[0].material_code).toBe('COPPER');
    expect(syncedRecords[0].unit_price).toBe(74500.0);
  });
});

describe('Smart Decision & Scenario Simulation Engine (ARP 2.3)', () => {
  it('generates multi-scenario financial impacts, trade-offs and approval payload', async () => {
    const mockDb = {
      getRepository: vi.fn(() => ({
        count: vi.fn(async () => 45),
        find: vi.fn(async () => [
          { id: 1, amount: 25000.0, status: 'won' },
          { id: 2, amount: 80000.0, status: 'lost' },
        ]),
      })),
    };

    const externalConnector = new ExternalDataConnector();
    const engine = new DecisionSimulationEngine(undefined, mockDb, externalConnector);

    const report = await engine.diagnoseAndSimulate({
      goal: '分析本季度商机赢单率下滑原因，并在预算内给出提振策略',
      collections: ['app_crm_deals'],
      externalSourceIds: ['competitor_intel'],
      constraints: {
        maxBudget: 80000,
        targetRoi: 2.0,
      },
    });

    expect(report.scenarios.length).toBe(3);
    const types = report.scenarios.map((s) => s.type);
    expect(types).toContain('conservative');
    expect(types).toContain('balanced');
    expect(types).toContain('aggressive');

    const balancedOption = report.scenarios.find((s) => s.type === 'balanced')!;
    expect(balancedOption.financialImpact.roi).toBeGreaterThan(1.0);
    expect(balancedOption.financialImpact.netProfit).toBeGreaterThan(0);
    expect(balancedOption.tradeoffs.length).toBeGreaterThan(0);

    expect(report.approvalPayload).toBeDefined();
    expect(report.approvalPayload.title).toContain('ARP 智能决策审批');
    expect(report.approvalPayload.recommendedActions.length).toBeGreaterThan(0);
  });
});

describe('Proactive 7x24 Agent Runner & Monitoring (ARP 2.1)', () => {
  it('detects healthy status when all metrics are within safe thresholds', async () => {
    const mockDb = {
      getRepository: vi.fn(() => ({
        count: vi.fn(async () => 5),
        find: vi.fn(async () => [{ stock_quantity: 150 }]),
      })),
    };

    const manager = new ProactiveAgentManager(mockDb);
    manager.registerAgent({
      id: 'agent_inventory_guardian',
      name: '智能库存守门人',
      appId: 'app_wms',
      enabled: true,
      monitoringTargets: {
        collections: ['app_wms_products'],
        metrics: [
          {
            name: '低库存报警',
            collection: 'app_wms_products',
            field: 'stock_quantity',
            aggregation: 'min',
            threshold: { operator: '<=', value: 30 },
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

    const res = await manager.runInspection('agent_inventory_guardian');
    expect(res.status).toBe('healthy');
    expect(res.violations.length).toBe(0);
    expect(res.auditLogs.some((l) => l.includes('所有业务指标处于安全阈值内'))).toBe(true);
  });

  it('triggers anomaly, runs decision simulation, and submits 1-click executive approval request when high-risk actions are required', async () => {
    const mockDb = {
      getRepository: vi.fn(() => ({
        count: vi.fn(async () => 1),
        find: vi.fn(async () => [{ stock_quantity: 12 }]), // 12 <= 30 triggers violation
      })),
    };

    const decisionEngine = new DecisionSimulationEngine(undefined, mockDb);
    const approvalManager = new ApprovalManager();
    const manager = new ProactiveAgentManager(mockDb, decisionEngine, approvalManager);

    manager.registerAgent({
      id: 'agent_wms_proactive',
      name: '仓储供应链主动优化 Agent',
      appId: 'app_wms',
      enabled: true,
      monitoringTargets: {
        collections: ['app_wms_products'],
        metrics: [
          {
            name: '安全库存低位断货告警',
            collection: 'app_wms_products',
            field: 'stock_quantity',
            aggregation: 'min',
            threshold: { operator: '<=', value: 30 },
            severity: 'critical',
          },
        ],
      },
      actionSpace: {
        canNotify: true,
        canCreateRecord: true,
        canUpdateRecord: true,
        canTriggerWorkflow: true,
        requiresApproval: ['trigger_workflow', 'create_record'], // Requires manager signoff!
      },
    });

    const res = await manager.runInspection('agent_wms_proactive');
    expect(res.status).toBe('awaiting_approval');
    expect(res.violations.length).toBe(1);
    expect(res.violations[0].actualValue).toBe(12);
    expect(res.decisionReport).toBeDefined();

    // Verify approval request was generated and registered in ApprovalManager
    expect(res.approvalRequest).toBeDefined();
    expect(res.approvalRequest?.status).toBe('pending');
    expect(res.approvalRequest?.approvers).toContain('admin');

    const pendingList = approvalManager.getPendingForApprover('admin');
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].id).toBe(res.approvalRequest?.id);
  });
});
