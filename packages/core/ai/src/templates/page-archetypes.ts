import type { ISchema } from '@formai/shared';

export function slugify(text: string): string {
  if (!text) return 'item';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}

export interface FieldMeta {
  name: string;
  type: string;
  title?: string;
  allowNull?: boolean;
  unique?: boolean;
  defaultValue?: any;
  target?: string;
  foreignKey?: string;
  enumOptions?: Array<{ label: string; value: string; color?: string }>;
}

export interface ArchetypeOptions {
  collectionName?: string;
  fields?: FieldMeta[];
  relatedCollections?: Array<{ name: string; title: string; foreignKey?: string }>;
  appId?: string;
}

/**
 * 1. LIST PAGE ARCHETYPE (列表查询与多操作页)
 * FilterBlock + Action Bar (New Drawer, Batch Delete, Export) + High-Fidelity Table
 */
export function generateListPageSchema(title: string, options: ArchetypeOptions = {}): ISchema {
  const { collectionName, fields = [] } = options;
  const pageUid = `page_list_${slugify(title)}_${Math.random().toString(36).slice(2, 7)}`;

  // Build Table Columns
  const columns: any[] = [{ title: 'ID', dataIndex: 'id', key: 'id', width: 80 }];
  const formFields: Record<string, any> = {};
  let fieldIdx = 1;

  if (fields.length > 0) {
    fields.forEach((f) => {
      if (f.name === 'id') return;
      const nameLower = f.name.toLowerCase();

      const colProps: any = {
        title: f.title || f.name,
        dataIndex: f.name,
        key: f.name,
      };

      if (f.type === 'float' || f.type === 'integer' || f.type === 'decimal' || nameLower.includes('amount') || nameLower.includes('price') || nameLower.includes('cost')) {
        colProps.render = 'Amount';
      } else if (f.type === 'date' || f.type === 'datetime' || nameLower.includes('date') || nameLower.includes('at')) {
        colProps.render = 'DateTime';
      } else if (nameLower.includes('status') || nameLower.includes('stage') || nameLower.includes('state') || f.enumOptions) {
        colProps.render = 'Badge';
      } else if (f.type === 'boolean') {
        colProps.render = 'Tag';
      }
      columns.push(colProps);

      // Single record create form fields (skip hasMany)
      if (f.type !== 'hasMany') {
        let component = 'Input';
        const componentProps: any = {};

        if (f.type === 'boolean') {
          component = 'Checkbox';
        } else if (f.type === 'integer' || f.type === 'float' || f.type === 'decimal') {
          component = 'NumberInput';
        } else if (f.type === 'date' || f.type === 'datetime') {
          component = 'DatePicker';
        } else if (f.type === 'text') {
          component = 'TextArea';
        } else if (f.type === 'belongsTo') {
          component = 'AssociationField';
          componentProps.placeholder = `选择${f.title || f.name}`;
          componentProps.collection = f.target;
          componentProps.labelField = 'name';
          componentProps.valueField = 'id';
        } else if (f.enumOptions && f.enumOptions.length > 0) {
          component = 'Select';
          componentProps.options = f.enumOptions;
        }

        const validators: any[] = [];
        if (f.allowNull === false) {
          validators.push({ required: true, message: `${f.title || f.name} 为必填项` });
        }

        formFields[f.name] = {
          type: f.type === 'integer' || f.type === 'float' || f.type === 'decimal' ? 'number' : (f.type === 'boolean' ? 'boolean' : 'string'),
          'x-uid': `field_${slugify(title)}_${f.name}`,
          title: f.title || f.name,
          'x-decorator': 'FormItem',
          'x-component': component,
          'x-component-props': componentProps,
          'x-validator': validators.length > 0 ? validators : undefined,
          'x-index': fieldIdx++,
        };
      }
    });
  } else {
    columns.push({ title: '名称', dataIndex: 'name', key: 'name' });
    formFields['name'] = {
      type: 'string',
      'x-uid': `field_${slugify(title)}_name`,
      title: '名称',
      'x-decorator': 'FormItem',
      'x-component': 'Input',
      'x-validator': [{ required: true, message: '名称为必填项' }],
      'x-index': fieldIdx++,
    };
  }

  columns.push({ title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: 'DateTime' });

  // Add Action buttons inside Table rows (Actions column)
  columns.push({
    title: '操作',
    key: 'actions',
    render: 'RowActions',
    actions: [
      { name: 'edit', title: '编辑', type: 'openDrawer' },
      { name: 'delete', title: '删除', type: 'destroy', danger: true },
    ],
  });

  // Filter fields
  const filterFieldsList = fields
    .filter((f) => f.type !== 'hasMany' && f.type !== 'jsonb' && f.type !== 'text')
    .slice(0, 6)
    .map((f) => ({
      name: f.name,
      title: f.title || f.name,
      type: f.type === 'belongsTo' ? 'string' : f.type,
      options: f.enumOptions,
    }));

  return {
    type: 'void',
    'x-uid': pageUid,
    'x-component': 'Page',
    'x-component-props': { title },
    properties: {
      filterPanel: {
        type: 'void',
        'x-uid': `filter_${slugify(title)}`,
        'x-component': 'FilterBlock',
        'x-index': 10,
        'x-component-props': {
          collection: collectionName,
          fields: filterFieldsList,
        },
        style: { marginBottom: 16 },
      },
      grid: {
        type: 'void',
        'x-uid': `grid_${slugify(title)}`,
        'x-component': 'Grid',
        'x-index': 20,
        properties: {
          col1: {
            type: 'void',
            'x-uid': `gridCol_${slugify(title)}_1`,
            'x-component': 'Grid.Column',
            'x-component-props': { span: 24 },
            properties: {
              tableCard: {
                type: 'void',
                'x-uid': `card_${slugify(title)}`,
                'x-component': 'CardItem',
                'x-component-props': { title: `${title}列表` },
                properties: collectionName
                  ? {
                      actionBar: {
                        type: 'void',
                        'x-uid': `actionBar_${slugify(title)}`,
                        'x-component': 'Space',
                        'x-index': 10,
                        style: { marginBottom: 16 },
                        properties: {
                          createDrawer: {
                            type: 'void',
                            'x-uid': `actionCreateDrawer_${slugify(title)}`,
                            'x-component': 'ActionDrawer',
                            'x-component-props': {
                              triggerText: '新建记录',
                              triggerType: 'primary',
                              drawerTitle: `新建${title}`,
                            },
                            properties: {
                              createForm: {
                                type: 'object',
                                'x-uid': `createForm_${slugify(title)}`,
                                'x-component': 'Form',
                                'x-component-props': {
                                  collection: collectionName,
                                  layout: 'vertical',
                                },
                                properties: {
                                  ...formFields,
                                  actions: {
                                    type: 'void',
                                    'x-uid': `formActions_${slugify(title)}`,
                                    'x-component': 'Space',
                                    style: { marginTop: 24, display: 'flex', justifyContent: 'flex-end' },
                                    'x-index': 100,
                                    properties: {
                                      submit: {
                                        type: 'void',
                                        'x-uid': `actionSubmit_${slugify(title)}`,
                                        'x-component': 'Action',
                                        'x-component-props': { title: '确认提交', type: 'primary', htmlType: 'submit' },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                          deleteBatch: {
                            type: 'void',
                            'x-uid': `actionDeleteBatch_${slugify(title)}`,
                            'x-component': 'Action',
                            'x-component-props': {
                              title: '批量删除',
                              danger: true,
                              action: 'destroy',
                              collection: collectionName,
                              confirmTitle: '确认删除选中的数据项？此操作不可逆。',
                            },
                          },
                          exportAction: {
                            type: 'void',
                            'x-uid': `actionExport_${slugify(title)}`,
                            'x-component': 'Action',
                            'x-component-props': {
                              title: '导出数据',
                              action: 'export',
                              collection: collectionName,
                            },
                          },
                        },
                      },
                      table: {
                        type: 'array',
                        'x-uid': `table_${slugify(title)}`,
                        'x-component': 'Table',
                        'x-index': 20,
                        'x-component-props': {
                          collection: collectionName,
                          rowKey: 'id',
                          columns,
                          rowSelection: true,
                          pagination: { pageSize: 15 },
                        },
                      },
                    }
                  : {},
              },
            },
          },
        },
      },
    },
  };
}

/**
 * 2. DETAIL PAGE ARCHETYPE (实体详情与关联聚合页)
 * Entity Header Summary + Field Grid Card + Related Tabs + Audit Timeline
 */
export function generateDetailPageSchema(title: string, options: ArchetypeOptions = {}): ISchema {
  const { collectionName, fields = [], relatedCollections = [] } = options;
  const pageUid = `page_detail_${slugify(title)}_${Math.random().toString(36).slice(2, 7)}`;

  // Build detail description items
  const descItems: Record<string, any> = {};
  fields.forEach((f, idx) => {
    descItems[f.name] = {
      type: 'void',
      'x-component': 'Descriptions.Item',
      'x-component-props': { label: f.title || f.name },
      'x-index': idx + 1,
      properties: {
        val: {
          type: 'string',
          'x-component': 'Input',
          'x-component-props': { readPretty: true },
        },
      },
    };
  });

  // Build tab panes for related sub-collections if any
  const tabProperties: Record<string, any> = {};
  if (relatedCollections.length > 0) {
    relatedCollections.forEach((rc, idx) => {
      const tabKey = `tab_${slugify(rc.name)}`;
      tabProperties[tabKey] = {
        type: 'void',
        'x-component': 'Tabs.TabPane',
        'x-component-props': { tab: rc.title },
        'x-index': idx + 1,
        properties: {
          subTable: {
            type: 'array',
            'x-component': 'Table',
            'x-component-props': {
              collection: rc.name,
              rowKey: 'id',
              pagination: { pageSize: 5 },
            },
          },
        },
      };
    });
  }

  return {
    type: 'void',
    'x-uid': pageUid,
    'x-component': 'Page',
    'x-component-props': { title: `${title}详情` },
    properties: {
      grid: {
        type: 'void',
        'x-component': 'Grid',
        properties: {
          colHeader: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 24 },
            properties: {
              headerCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: '基本信息概览' },
                properties: {
                  descBlock: {
                    type: 'void',
                    'x-component': 'Descriptions',
                    'x-component-props': {
                      column: 3,
                      bordered: true,
                      collection: collectionName,
                    },
                    properties: descItems,
                  },
                },
              },
            },
          },
          ...(relatedCollections.length > 0
            ? {
                colTabs: {
                  type: 'void',
                  'x-component': 'Grid.Column',
                  'x-component-props': { span: 24 },
                  style: { marginTop: 16 },
                  properties: {
                    tabsCard: {
                      type: 'void',
                      'x-component': 'CardItem',
                      'x-component-props': { title: '关联业务数据' },
                      properties: {
                        tabs: {
                          type: 'void',
                          'x-component': 'Tabs',
                          properties: tabProperties,
                        },
                      },
                    },
                  },
                },
              }
            : {}),
        },
      },
    },
  };
}

/**
 * 3. DASHBOARD PAGE ARCHETYPE (智能化动态驾驶舱)
 * Dynamically figures out KPIs and Charts based on actual collection fields!
 */
export function generateDashboardPageSchema(title: string, options: ArchetypeOptions = {}): ISchema {
  const { collectionName, fields = [] } = options;
  const pageUid = `page_dashboard_${slugify(title)}_${Math.random().toString(36).slice(2, 7)}`;

  // Find amount/price field
  const amountField = fields.find(
    (f) =>
      f.type === 'decimal' ||
      f.type === 'float' ||
      f.name.toLowerCase().includes('amount') ||
      f.name.toLowerCase().includes('price') ||
      f.name.toLowerCase().includes('total')
  );

  // Find status field
  const statusField = fields.find(
    (f) =>
      f.name.toLowerCase().includes('status') ||
      f.name.toLowerCase().includes('stage') ||
      f.name.toLowerCase().includes('type') ||
      (f.enumOptions && f.enumOptions.length > 0)
  );

  // Dynamic KPI Cards
  const kpi1Title = amountField ? `累计${amountField.title || '金额'}` : '总记录规模';
  const kpi2Title = statusField ? `${statusField.title || '状态'}监控` : '活跃事项';
  const kpi3Title = '本月新增量';
  const kpi4Title = '整体达成率';

  return {
    type: 'void',
    'x-uid': pageUid,
    'x-component': 'Page',
    'x-component-props': { title },
    properties: {
      gridTop: {
        type: 'void',
        'x-component': 'Grid',
        'x-component-props': { cols: 4 },
        properties: {
          statCard1: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: kpi1Title },
            properties: {
              stat1: {
                type: 'void',
                'x-component': 'Statistic',
                'x-component-props': {
                  title: kpi1Title,
                  collection: collectionName,
                  field: amountField ? amountField.name : 'id',
                  aggregation: amountField ? 'sum' : 'count',
                  format: amountField ? 'currency' : 'number',
                  trend: 'up',
                  trendValue: '+12.5%',
                  gradientType: 'blue',
                },
              },
            },
          },
          statCard2: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: kpi2Title },
            properties: {
              stat2: {
                type: 'void',
                'x-component': 'Statistic',
                'x-component-props': {
                  title: kpi2Title,
                  collection: collectionName,
                  aggregation: 'count',
                  trend: 'up',
                  trendValue: '+8.3%',
                  gradientType: 'green',
                },
              },
            },
          },
          statCard3: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: kpi3Title },
            properties: {
              stat3: {
                type: 'void',
                'x-component': 'Statistic',
                'x-component-props': {
                  title: kpi3Title,
                  collection: collectionName,
                  aggregation: 'count',
                  trend: 'up',
                  trendValue: '+15.2%',
                  gradientType: 'orange',
                },
              },
            },
          },
          statCard4: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: kpi4Title },
            properties: {
              stat4: {
                type: 'void',
                'x-component': 'Statistic',
                'x-component-props': {
                  title: kpi4Title,
                  value: '96.8%',
                  trend: 'none',
                  gradientType: 'cyan',
                },
              },
            },
          },
        },
      },
      gridMid: {
        type: 'void',
        'x-component': 'Grid',
        style: { marginTop: 16 },
        properties: {
          colChart1: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 16 },
            properties: {
              trendChartCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: '业务增长趋势' },
                properties: {
                  chart1: {
                    type: 'void',
                    'x-component': 'SmartChartBlock',
                    'x-component-props': {
                      title: '月度趋势分析',
                      collection: collectionName,
                      chartType: 'line',
                      dimensionField: 'createdAt',
                      metricField: amountField ? amountField.name : 'id',
                    },
                  },
                },
              },
            },
          },
          colChart2: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 8 },
            properties: {
              distChartCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: statusField ? `${statusField.title}分布` : '结构占比' },
                properties: {
                  chart2: {
                    type: 'void',
                    'x-component': 'SmartChartBlock',
                    'x-component-props': {
                      title: '状态分布统计',
                      collection: collectionName,
                      chartType: 'donut',
                      dimensionField: statusField ? statusField.name : 'status',
                      metricField: 'id',
                    },
                  },
                },
              },
            },
          },
        },
      },
      gridBottom: {
        type: 'void',
        'x-component': 'Grid',
        style: { marginTop: 16 },
        properties: {
          colRecent: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 24 },
            properties: {
              tableCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: '最新动态流水' },
                properties: collectionName
                  ? {
                      table: {
                        type: 'array',
                        'x-component': 'Table',
                        'x-component-props': {
                          collection: collectionName,
                          rowKey: 'id',
                          pageSize: 5,
                        },
                      },
                    }
                  : {},
              },
            },
          },
        },
      },
    },
  };
}

/**
 * 4. KANBAN PAGE ARCHETYPE (看板协同页)
 */
export function generateKanbanPageSchema(title: string, options: ArchetypeOptions = {}): ISchema {
  const { collectionName, fields = [] } = options;
  const pageUid = `page_kanban_${slugify(title)}_${Math.random().toString(36).slice(2, 7)}`;

  // Find status/stage field
  const statusField = fields.find(
    (f) =>
      f.name.toLowerCase().includes('status') ||
      f.name.toLowerCase().includes('stage') ||
      f.name.toLowerCase().includes('state')
  );

  const columns = statusField?.enumOptions
    ? statusField.enumOptions.map((opt) => ({
        key: opt.value,
        title: opt.label,
        color: opt.color || '#e6f4ff',
      }))
    : [
        { key: 'todo', title: '待开始', color: '#f5f5f5' },
        { key: 'in_progress', title: '进行中', color: '#e6f4ff' },
        { key: 'done', title: '已完成', color: '#f6ffed' },
      ];

  return {
    type: 'void',
    'x-uid': pageUid,
    'x-component': 'Page',
    'x-component-props': { title },
    properties: {
      grid: {
        type: 'void',
        'x-component': 'Grid',
        properties: {
          col1: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 24 },
            properties: {
              kanbanCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title },
                properties: {
                  kanban: {
                    type: 'void',
                    'x-component': 'KanbanView',
                    'x-component-props': {
                      collection: collectionName,
                      groupBy: statusField ? statusField.name : 'status',
                      titleField: 'title',
                      descriptionField: 'description',
                      columns,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * 5. CALENDAR PAGE ARCHETYPE (日程日历视图页)
 */
export function generateCalendarPageSchema(title: string, options: ArchetypeOptions = {}): ISchema {
  const { collectionName, fields = [] } = options;
  const pageUid = `page_cal_${slugify(title)}_${Math.random().toString(36).slice(2, 7)}`;

  const dateField = fields.find(
    (f) =>
      f.type === 'date' ||
      f.type === 'datetime' ||
      f.name.toLowerCase().includes('date') ||
      f.name.toLowerCase().includes('time')
  );

  return {
    type: 'void',
    'x-uid': pageUid,
    'x-component': 'Page',
    'x-component-props': { title },
    properties: {
      grid: {
        type: 'void',
        'x-component': 'Grid',
        properties: {
          col1: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 24 },
            properties: {
              calCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title },
                properties: {
                  calendar: {
                    type: 'void',
                    'x-component': 'CalendarBlock',
                    'x-component-props': {
                      collection: collectionName,
                      dateField: dateField ? dateField.name : 'createdAt',
                      titleField: 'name',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * 6. REPORT / PIVOT PAGE ARCHETYPE (多维数据透视与报表导出页)
 */
export function generateReportPageSchema(title: string, options: ArchetypeOptions = {}): ISchema {
  const { collectionName, fields = [] } = options;
  const pageUid = `page_report_${slugify(title)}_${Math.random().toString(36).slice(2, 7)}`;

  const amountField = fields.find(
    (f) =>
      f.type === 'decimal' ||
      f.type === 'float' ||
      f.name.toLowerCase().includes('amount') ||
      f.name.toLowerCase().includes('price') ||
      f.name.toLowerCase().includes('total')
  );

  return {
    type: 'void',
    'x-uid': pageUid,
    'x-component': 'Page',
    'x-component-props': { title },
    properties: {
      filterPanel: {
        type: 'void',
        'x-component': 'FilterBlock',
        'x-index': 10,
        'x-component-props': {
          collection: collectionName,
          fields: fields.slice(0, 5).map((f) => ({ name: f.name, title: f.title || f.name, type: f.type })),
        },
        style: { marginBottom: 16 },
      },
      gridSummary: {
        type: 'void',
        'x-component': 'Grid',
        'x-component-props': { cols: 3 },
        properties: {
          col1: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: '统计条目数' },
            properties: {
              stat1: {
                type: 'void',
                'x-component': 'Statistic',
                'x-component-props': { collection: collectionName, aggregation: 'count' },
              },
            },
          },
          col2: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: amountField ? `${amountField.title}总计` : '汇总核算' },
            properties: {
              stat2: {
                type: 'void',
                'x-component': 'Statistic',
                'x-component-props': {
                  collection: collectionName,
                  field: amountField ? amountField.name : 'id',
                  aggregation: amountField ? 'sum' : 'count',
                  format: amountField ? 'currency' : 'number',
                },
              },
            },
          },
          col3: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: '数据完整率' },
            properties: {
              stat3: {
                type: 'void',
                'x-component': 'Statistic',
                'x-component-props': { value: '99.4%', trend: 'none' },
              },
            },
          },
        },
      },
      gridTable: {
        type: 'void',
        'x-component': 'Grid',
        style: { marginTop: 16 },
        properties: {
          colMain: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 24 },
            properties: {
              reportCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: `${title}透视明细` },
                properties: {
                  actionBar: {
                    type: 'void',
                    'x-component': 'Space',
                    style: { marginBottom: 16 },
                    properties: {
                      exportBtn: {
                        type: 'void',
                        'x-component': 'Action',
                        'x-component-props': { title: '导出完整 Excel 报表', action: 'export', collection: collectionName },
                      },
                    },
                  },
                  table: {
                    type: 'array',
                    'x-component': 'Table',
                    'x-component-props': {
                      collection: collectionName,
                      rowKey: 'id',
                      pagination: { pageSize: 20 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * 7. APPROVAL PAGE ARCHETYPE (审批流全景与待办操作页)
 */
export function generateApprovalPageSchema(title: string, options: ArchetypeOptions = {}): ISchema {
  const { collectionName } = options;
  const pageUid = `page_approval_${slugify(title)}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    type: 'void',
    'x-uid': pageUid,
    'x-component': 'Page',
    'x-component-props': { title },
    properties: {
      grid: {
        type: 'void',
        'x-component': 'Grid',
        properties: {
          stepsCol: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 24 },
            properties: {
              stepCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: '标准审批SOP阶段' },
                properties: {
                  steps: {
                    type: 'void',
                    'x-component': 'StepsBlock',
                    'x-component-props': {
                      current: 1,
                      steps: [
                        { title: '发起提交', description: '申请人提交单据' },
                        { title: '业务主管审核', description: '部门经理初审' },
                        { title: '财务/法务复核', description: '合规核销' },
                        { title: '归档生效', description: '自动落盘' },
                      ],
                    },
                  },
                },
              },
            },
          },
          tableCol: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 24 },
            style: { marginTop: 16 },
            properties: {
              approvalTableCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: '当前待审批单据' },
                properties: {
                  table: {
                    type: 'array',
                    'x-component': 'Table',
                    'x-component-props': {
                      collection: collectionName,
                      rowKey: 'id',
                      columns: [
                        { title: '单号', dataIndex: 'id', key: 'id' },
                        { title: '申请摘要', dataIndex: 'title', key: 'title' },
                        { title: '申请人', dataIndex: 'applicant', key: 'applicant' },
                        { title: '状态', dataIndex: 'status', key: 'status', render: 'Badge' },
                        {
                          title: '审批操作',
                          key: 'op',
                          render: 'RowActions',
                          actions: [
                            { name: 'approve', title: '一键批准', type: 'submit' },
                            { name: 'reject', title: '驳回修改', type: 'custom', danger: true },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Master Page Schema Generator: Inspects title and metadata to select archetype.
 */
export function generatePageSchemaForArchetype(
  title: string,
  options: ArchetypeOptions = {}
): ISchema {
  const titleLower = title.toLowerCase();

  if (/dashboard|overview|驾驶舱|概览|数据看板|总览/i.test(titleLower)) {
    return generateDashboardPageSchema(title, options);
  }

  if (/report|报表|透视|统计分析|对账单/i.test(titleLower)) {
    return generateReportPageSchema(title, options);
  }

  if (/approval|审批|审核|待办/i.test(titleLower)) {
    return generateApprovalPageSchema(title, options);
  }

  if (/kanban|board|敏捷看板|任务看板|商机看板/i.test(titleLower)) {
    return generateKanbanPageSchema(title, options);
  }

  if (/calendar|日程|日历|排班/i.test(titleLower)) {
    return generateCalendarPageSchema(title, options);
  }

  if (/detail|详情|档案卡/i.test(titleLower)) {
    return generateDetailPageSchema(title, options);
  }

  // Default is the enhanced list page
  return generateListPageSchema(title, options);
}
