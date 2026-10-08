import { describe, it, expect, vi } from 'vitest';
import {
  matchDomainTemplate,
  getDomainTemplateById,
  ALL_DOMAIN_TEMPLATES,
  generatePageSchemaForArchetype,
  generateListPageSchema,
  generateDetailPageSchema,
  generateDashboardPageSchema,
  generateKanbanPageSchema,
  generateCalendarPageSchema,
  seedAppMockData,
} from '../index';

describe('Domain Template Registry & Matcher', () => {
  it('has 5 pre-registered enterprise domains', () => {
    expect(ALL_DOMAIN_TEMPLATES.length).toBe(5);
    const ids = ALL_DOMAIN_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('crm');
    expect(ids).toContain('project_management');
    expect(ids).toContain('inventory_wms');
    expect(ids).toContain('finance_invoicing');
    expect(ids).toContain('hr_attendance');
  });

  it('matches CRM template from natural language query', () => {
    const matched = matchDomainTemplate('我们需要一个销售团队使用的客户关系管理系统，追踪销售商机和合同');
    expect(matched).not.toBeNull();
    expect(matched?.id).toBe('crm');
    expect(matched?.collections.length).toBeGreaterThanOrEqual(4);
  });

  it('matches Project Management template from English/Chinese queries', () => {
    const matched = matchDomainTemplate('敏捷研发协作项目管理平台，管理任务工单和里程碑');
    expect(matched).not.toBeNull();
    expect(matched?.id).toBe('project_management');

    const matchedEn = matchDomainTemplate('agile task tracking and project sprint management');
    expect(matchedEn?.id).toBe('project_management');
  });

  it('matches Inventory WMS template from keywords', () => {
    const matched = matchDomainTemplate('建立一个仓库库存管理系统，管理物料SKU以及出入库流水单据');
    expect(matched?.id).toBe('inventory_wms');
  });

  it('matches Finance template', () => {
    const matched = matchDomainTemplate('企业日常财务发票与员工差旅报销记账审批');
    expect(matched?.id).toBe('finance_invoicing');
  });

  it('matches HR template', () => {
    const matched = matchDomainTemplate('公司员工花名册与部门考勤请假审批系统');
    expect(matched?.id).toBe('hr_attendance');
  });

  it('fetches domain template by ID', () => {
    const t = getDomainTemplateById('crm');
    expect(t?.name).toContain('CRM');
  });
});

describe('Page Archetypes Generator', () => {
  const mockFields = [
    { name: 'name', type: 'string', title: '名称' },
    { name: 'amount', type: 'decimal', title: '金额' },
    { name: 'status', type: 'string', title: '状态', enumOptions: [{ label: '进行中', value: 'in_progress' }] },
    { name: 'createdAt', type: 'datetime', title: '创建时间' },
  ];

  it('generates enhanced List Page schema with filter panel and table actions', () => {
    const schema: any = generateListPageSchema('订单管理', {
      collectionName: 'app_test_orders',
      fields: mockFields,
    });

    expect(schema['x-component']).toBe('Page');
    expect(schema.properties.filterPanel).toBeDefined();
    expect(schema.properties.filterPanel['x-component']).toBe('FilterBlock');
    expect(schema.properties.grid.properties.col1.properties.tableCard.properties.table).toBeDefined();
    expect(schema.properties.grid.properties.col1.properties.tableCard.properties.actionBar).toBeDefined();
  });

  it('generates Detail Page schema with description grid', () => {
    const schema: any = generateDetailPageSchema('客户档案', {
      collectionName: 'app_test_customers',
      fields: mockFields,
      relatedCollections: [{ name: 'app_test_contacts', title: '联系人' }],
    });

    expect(schema['x-component']).toBe('Page');
    expect(schema.properties.grid.properties.colHeader).toBeDefined();
    expect(schema.properties.grid.properties.colTabs).toBeDefined();
  });

  it('generates Dashboard Page schema with dynamic KPIs and charts based on fields', () => {
    const schema: any = generateDashboardPageSchema('销售驾驶舱', {
      collectionName: 'app_test_deals',
      fields: mockFields,
    });

    expect(schema['x-component']).toBe('Page');
    expect(schema.properties.gridTop.properties.statCard1).toBeDefined();
    // Dynamic KPI recognizes amount field
    const stat1Props = schema.properties.gridTop.properties.statCard1.properties.stat1['x-component-props'];
    expect(stat1Props.field).toBe('amount');
    expect(stat1Props.aggregation).toBe('sum');
    expect(schema.properties.gridMid.properties.colChart1.properties.trendChartCard).toBeDefined();
  });

  it('generates Kanban Page schema', () => {
    const schema: any = generateKanbanPageSchema('敏捷任务看板', {
      collectionName: 'app_test_tasks',
      fields: mockFields,
    });

    expect(schema['x-component']).toBe('Page');
    const kanbanProps = schema.properties.grid.properties.col1.properties.kanbanCard.properties.kanban['x-component-props'];
    expect(kanbanProps['x-component']).toBeUndefined();
    expect(kanbanProps.groupBy).toBe('status');
  });

  it('generates Calendar Page schema', () => {
    const schema: any = generateCalendarPageSchema('日程排班', {
      collectionName: 'app_test_schedules',
      fields: mockFields,
    });

    expect(schema['x-component']).toBe('Page');
    const calProps = schema.properties.grid.properties.col1.properties.calCard.properties.calendar['x-component-props'];
    expect(calProps.dateField).toBe('createdAt');
  });

  it('dispatches appropriate archetypes via generatePageSchemaForArchetype', () => {
    const dash = generatePageSchemaForArchetype('项目总览驾驶舱', { fields: mockFields });
    expect(dash.properties.gridTop).toBeDefined();

    const kanban = generatePageSchemaForArchetype('销售商机看板', { fields: mockFields });
    expect(kanban.properties.grid.properties.col1.properties.kanbanCard).toBeDefined();

    const list = generatePageSchemaForArchetype('用户管理列表', { fields: mockFields });
    expect(list.properties.filterPanel).toBeDefined();
  });
});

describe('Intelligent Mock Data Seeding', () => {
  it('seeds records into collections maintaining foreign keys', async () => {
    const createdRecords: Record<string, any[]> = {
      app_crm_customers: [],
      app_crm_deals: [],
    };

    const mockDb = {
      getRepository: vi.fn((colName: string) => {
        if (!createdRecords[colName]) createdRecords[colName] = [];
        return {
          count: vi.fn(async () => createdRecords[colName].length),
          find: vi.fn(async () => createdRecords[colName]),
          create: vi.fn(async ({ values }) => {
            const id = createdRecords[colName].length + 1;
            const item = { id, ...values };
            createdRecords[colName].push(item);
            return item;
          }),
        };
      }),
    };

    const crmTemplate = getDomainTemplateById('crm')!;
    const collectionsToSeed = [
      {
        name: 'app_crm_customers',
        fields: crmTemplate.collections.find((c) => c.name === 'customers')?.fields,
      },
      {
        name: 'app_crm_deals',
        fields: crmTemplate.collections.find((c) => c.name === 'deals')?.fields,
      },
    ];

    const results = await seedAppMockData(mockDb, collectionsToSeed, crmTemplate);
    expect(results.length).toBe(2);
    expect(createdRecords['app_crm_customers'].length).toBeGreaterThan(0);
    expect(createdRecords['app_crm_deals'].length).toBeGreaterThan(0);

    // Verify deals customer_id points to existing customer ID
    const customerIds = createdRecords['app_crm_customers'].map((c) => c.id);
    const dealsWithCustomer = createdRecords['app_crm_deals'].filter((d) => d.customer_id != null);
    for (const deal of dealsWithCustomer) {
      expect(customerIds).toContain(deal.customer_id);
    }
  });
});
