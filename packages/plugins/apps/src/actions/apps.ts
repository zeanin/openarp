import type { Context, Next } from 'koa';
import { PassThrough } from 'stream';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { PiAgentService } from '@formai/plugin-pi';
import { exportAppToWorkspace } from './workspace-sync';




const slugify = (text: string) => {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50);
};

const semanticMap: Record<string, string[]> = {
  '采购': ['purchase', 'supplier', 'procure'],
  '销售': ['sale', 'customer', 'customer_id'],
  '库存': ['inventory', 'product', 'warehouse', 'stock'],
  '物流': ['shipping', 'logistics', 'delivery', 'transport'],
  '财务': ['financial', 'account', 'journal', 'billing', 'invoice'],
};

const DbBlueprintSchema = z.object({
  collections: z.array(z.object({
    name: z.string().describe('snake_case database-safe collection name, e.g. "customers", "support_tickets"'),
    title: z.string().describe('Human readable display name, e.g. "Customers", "Support Tickets"'),
    fields: z.array(z.object({
      name: z.string().describe('snake_case field name, e.g. "email", "phone", "customer_id"'),
      type: z.enum([
        'string', 'text', 'integer', 'float', 'boolean', 'date', 'datetime', 'jsonb', 'belongsTo', 'hasMany', 'hasOne', 'uuid', 'decimal'
      ]).describe('data type or relationship type'),
      title: z.string().describe('display label for field, e.g. "Email", "Phone Address"'),
      allowNull: z.boolean().optional().describe('Whether the field can be null. Default is true.'),
      unique: z.boolean().optional().describe('Whether the field values must be unique. Default is false.'),
      defaultValue: z.any().optional().describe('Default value of the field.'),
      target: z.string().optional().describe('Target collection name if type is a relationship (e.g. "customers", "users").'),
      foreignKey: z.string().optional().describe('Foreign key field name in database if type is relationship.'),
    })).describe('List of recommended fields for the collection'),
  })).describe('List of database collections'),
  skills: z.array(z.object({
    name: z.string().describe('snake_case skill identifier, e.g. "calculate_total", "approve_ticket"'),
    title: z.string().describe('Display name of the business skill, e.g. "Calculate Invoice Total"'),
    description: z.string().describe('Detailed description of what this business skill does'),
    collection: z.string().describe('Associated collection name, e.g. "orders", or "global"'),
  })).optional().describe('Specialized custom business skills defining the app logic beyond basic CRUD'),
});

const UiBlueprintSchema = z.object({
  menus: z.array(z.object({
    title: z.string().describe('Human readable display label for the menu item, e.g. "Dashboard", "Inventory Management"'),
    icon: z.string().describe('Ant Design Icon name, e.g. "DashboardOutlined", "BoxOutlined", "UserOutlined", "SettingOutlined"'),
    collection: z.string().optional().describe('Optional name of the collection this menu links to, e.g. "products", "orders"'),
    type: z.enum(['group', 'page', 'link']).describe('Whether this is a grouping header, a direct page or an external link'),
    children: z.array(z.object({
      title: z.string().describe('Human readable display label for sub-menu, e.g. "Warehouse Status"'),
      icon: z.string().describe('Ant Design Icon name, e.g. "DatabaseOutlined"'),
      collection: z.string().describe('Associated collection name to link, e.g. "inventory_items"'),
    })).optional().describe('Sub-menus if type is "group"'),
  })).describe('Custom sidebar navigation layout design'),
});

const WorkflowBlueprintSchema = z.object({
  workflows: z.array(z.object({
    title: z.string().describe('Title of the workflow automation, e.g. "Auto-assign Support Tickets"'),
    description: z.string().describe('Brief description of trigger and action nodes needed, e.g. "When support ticket is created, if priority is high, assign to tier 2 team"'),
  })).describe('List of workflow automations'),
});


const generateDashboardPageSchema = (title: string, collectionName?: string, fields?: any[]) => {
  return {
    type: 'void',
    'x-uid': `page_dashboard_${Math.random().toString(36).slice(2, 6)}`,
    'x-component': 'Page',
    'x-component-props': { title },
    properties: {
      gridTop: {
        type: 'void',
        'x-component': 'Grid',
        'x-component-props': { cols: 4 },
        properties: {
          card1: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: 'Total Volume' },
            properties: {
              stat1: {
                type: 'void',
                'x-component': 'Input',
                'x-component-props': { readPretty: true, defaultValue: '¥1,245,800.00' }
              }
            }
          },
          card2: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: 'Active Items' },
            properties: {
              stat2: {
                type: 'void',
                'x-component': 'Input',
                'x-component-props': { readPretty: true, defaultValue: '342' }
              }
            }
          },
          card3: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: 'Pending Audits' },
            properties: {
              stat3: {
                type: 'void',
                'x-component': 'Input',
                'x-component-props': { readPretty: true, defaultValue: '18' }
              }
            }
          },
          card4: {
            type: 'void',
            'x-component': 'CardItem',
            'x-component-props': { title: 'Completion Rate' },
            properties: {
              stat4: {
                type: 'void',
                'x-component': 'Input',
                'x-component-props': { readPretty: true, defaultValue: '94.5%' }
              }
            }
          }
        }
      },
      gridBottom: {
        type: 'void',
        'x-component': 'Grid',
        style: { marginTop: 16 },
        properties: {
          colLeft: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 16 },
            properties: {
              tableCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: 'Recent Transactions' },
                properties: collectionName ? {
                  table: {
                    type: 'array',
                    'x-component': 'Table',
                    'x-component-props': {
                      collection: collectionName,
                      rowKey: 'id',
                      pageSize: 5,
                      columns: [
                        { title: 'ID', dataIndex: 'id', key: 'id' },
                        { title: 'Title', dataIndex: 'name', key: 'name' },
                        { title: 'Amount', dataIndex: 'amount', key: 'amount', render: 'Amount' },
                        { title: 'Status', dataIndex: 'status', key: 'status', render: 'Badge' },
                        { title: 'Created At', dataIndex: 'createdAt', key: 'createdAt', render: 'DateTime' }
                      ]
                    }
                  }
                } : {}
              }
            }
          },
          colRight: {
            type: 'void',
            'x-component': 'Grid.Column',
            'x-component-props': { span: 8 },
            properties: {
              summaryCard: {
                type: 'void',
                'x-component': 'CardItem',
                'x-component-props': { title: 'Operational Status' },
                properties: {
                  desc: {
                    type: 'void',
                    'x-component': 'Empty',
                    'x-component-props': { description: 'System status is active. All components running.' }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
};

const generateWikiPageSchema = (title: string, wikiCollectionName: string) => {
  return {
    type: 'void',
    'x-uid': `page_wiki_${Math.random().toString(36).slice(2, 6)}`,
    'x-component': 'Page',
    'x-component-props': { title },
    properties: {
      wiki: {
        type: 'void',
        'x-uid': `wiki_${slugify(title)}`,
        'x-component': 'KnowledgeWiki',
        'x-component-props': {
          collection: wikiCollectionName
        }
      }
    }
  };
};

const generateDefaultPageSchema = (title: string, collectionName?: string, fields?: any[]) => {
  const isKanban = /kanban|board|tasks|看板|任务看板/i.test(title);

  if (isKanban) {
    return {
      type: 'void',
      'x-uid': `page_kanban_${slugify(title)}_${Math.random().toString(36).slice(2, 6)}`,
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
                        groupBy: 'status',
                        titleField: 'name',
                        descriptionField: 'description',
                        columns: [
                          { key: 'todo', title: 'To Do', color: '#f5f5f5' },
                          { key: 'in_progress', title: 'In Progress', color: '#e6f4ff' },
                          { key: 'done', title: 'Done', color: '#f6ffed' }
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };
  }

  const columns: any[] = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
  ];

  const formFields: Record<string, any> = {};
  let fieldIdx = 1;

  if (fields && fields.length > 0) {
    fields.forEach((f: any) => {
      const nameLower = f.name.toLowerCase();
      if (f.name !== 'id') {
        const colProps: any = {
          title: f.title || f.name,
          dataIndex: f.name,
          key: f.name,
        };
        if (f.type === 'float' || f.type === 'integer' || f.type === 'decimal' || nameLower.includes('amount') || nameLower.includes('price')) {
          colProps.render = 'Amount';
        } else if (f.type === 'date' || f.type === 'datetime' || nameLower.includes('date') || nameLower.includes('at')) {
          colProps.render = 'DateTime';
        } else if (nameLower.includes('status') || nameLower.includes('state')) {
          colProps.render = 'Badge';
        }
        columns.push(colProps);

        // Build Formily schema field properties
        // Skip list/hasMany relations inside the single record create form
        if (f.type !== 'hasMany') {
          let component = 'Input';
          const componentProps: any = {};
          if (f.type === 'boolean') {
            component = 'Checkbox';
          } else if (f.type === 'integer' || f.type === 'float' || f.type === 'decimal') {
            component = 'NumberInput';
          } else if (f.type === 'date' || f.type === 'datetime') {
            component = 'DatePicker';
          } else if (f.type === 'belongsTo') {
            component = 'AssociationField';
            componentProps.placeholder = `Select ${f.title || f.name}`;
            componentProps.collection = f.target;
            componentProps.labelField = 'name';
            componentProps.valueField = 'id';
          }

          const validators: any[] = [];
          if (f.allowNull === false || f.required === true) {
            validators.push({ required: true, message: `${f.title || f.name} is required` });
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
      }
    });
  } else {
    columns.push({ title: 'Name', dataIndex: 'name', key: 'name' });
    formFields['name'] = {
      type: 'string',
      'x-uid': `field_${slugify(title)}_name`,
      title: 'Name',
      'x-decorator': 'FormItem',
      'x-component': 'Input',
      'x-validator': [{ required: true, message: 'Name is required' }],
      'x-index': fieldIdx++,
    };
  }

  columns.push({ title: 'Created At', dataIndex: 'createdAt', key: 'createdAt' });

  // Add Form submit actions
  formFields['actions'] = {
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
        'x-component-props': { title: 'Submit', type: 'primary', htmlType: 'submit' },
      },
    },
  };

  const filterFieldsList = fields?.filter(f => f.type !== 'hasMany' && f.type !== 'jsonb').map(f => ({
    name: f.name,
    title: f.title || f.name,
    type: f.type === 'belongsTo' ? 'string' : f.type,
  })) || [];

  return {
    type: 'void',
    'x-uid': `page_${slugify(title)}_${Math.random().toString(36).slice(2, 6)}`,
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
        style: { marginBottom: 16 }
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
                'x-component-props': { title: `${title} List` },
                properties: collectionName ? {
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
                          triggerText: 'Add New',
                          triggerType: 'primary',
                          drawerTitle: `Add New ${title}`,
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
                            properties: formFields,
                          },
                        },
                      },
                      delete: {
                        type: 'void',
                        'x-uid': `actionDelete_${slugify(title)}`,
                        'x-component': 'Action',
                        'x-component-props': {
                          title: 'Delete',
                          danger: true,
                          action: 'destroy',
                          collection: collectionName,
                          confirmTitle: `Are you sure you want to delete selected records?`,
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
                    },
                  },
                } : {
                  empty: {
                    type: 'void',
                    'x-component': 'Empty',
                    'x-component-props': { description: 'This page is ready for custom content!' },
                  }
                },
              },
            },
          },
        },
      },
    },
  };
};

async function logCompilationToWiki(db: any, app: any, blueprint: any, compilationLogs: string[]): Promise<void> {
  let memoryNodesRepo: any;
  try {
    memoryNodesRepo = db.getRepository(`app_${app.name}_memory_nodes`);
  } catch {
    // Collection not yet registered (app compiled before KnowledgeWiki feature)
    return;
  }
  if (!memoryNodesRepo) return;

  const now = new Date();
  const formatTime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const timestamp = formatTime(now);
  const logTitle = `System Build - ${timestamp}`;
  const logUid = `build_log_${Date.now()}`;

  const collections = blueprint.collections || [];
  const skills = blueprint.skills || [];
  const menus = blueprint.menus || [];
  const workflows = blueprint.workflows || [];

  // Generate target links array for SVG force-directed graphs
  const links: string[] = ['System Overview', 'System Build Log History'];
  collections.forEach((c: any) => {
    if (c.name !== 'memory_nodes') {
      links.push(`${c.title || c.name} Collection`);
    }
  });
  menus.forEach((m: any) => {
    if (m.type === 'page' && m.title) links.push(`${m.title} Page`);
    if (m.children) {
      m.children.forEach((c: any) => {
        if (c.title) links.push(`${c.title} Page`);
      });
    }
  });
  workflows.forEach((w: any) => links.push(`Workflow - ${w.title}`));

  // 1. Build the System Build trace log node (type: 'activity')
  let logContent = `# 🛠️ ${logTitle}\n\n`;
  logContent += `> [!IMPORTANT]\n`;
  logContent += `> **Build Status**: Success ✅\n`;
  logContent += `> **Application**: ${app.title} (ID: ${app.id})\n`;
  logContent += `> **Trigger Time**: ${timestamp}\n\n`;

  logContent += `This build note records the compilation results and database/UI alterations executed by the FormAI Compiler. Go back to [[System Overview]] for the consolidated application status.\n\n`;

  logContent += `## 🗃️ 1. Database Schema Alterations\n`;
  if (collections.length > 0) {
    logContent += `The following database tables were synchronized and mapped to standard CRUD resource skills:\n\n`;
    logContent += `| Collection Name | Title | Fields Count | Category |\n`;
    logContent += `| :--- | :--- | :--- | :--- |\n`;
    collections.forEach((col: any) => {
      if (col.name === 'memory_nodes') return;
      const pageLink = `[[${col.title || col.name} Collection]]`;
      logContent += `| \`${col.name}\` | ${pageLink} | ${col.fields?.length || 0} | Entity 🟦 |\n`;
    });
    logContent += `\n`;
  } else {
    logContent += `No database collections configured in this build.\n\n`;
  }

  if (skills.length > 0) {
    logContent += `### Specialized Custom Skills\n`;
    skills.forEach((sk: any) => {
      logContent += `- **\`${sk.name}\` (${sk.title})**: ${sk.description}\n`;
    });
    logContent += `\n`;
  }

  logContent += `## 🎨 2. Responsive UI Portals & Navigation\n`;
  logContent += `Dynamic UI pages and sidebar routing items created:\n\n`;
  logContent += `| Menu Item | Type | Icon | Target Schema |\n`;
  logContent += `| :--- | :--- | :--- | :--- |\n`;
  menus.forEach((m: any) => {
    const pageLink = m.type === 'page' ? `[[${m.title} Page]]` : m.title;
    logContent += `| ${pageLink} | \`${m.type}\` | ${m.icon || ''} | \`${m.collection || 'None'}\` |\n`;
    if (m.children) {
      m.children.forEach((c: any) => {
        const childLink = `[[${c.title} Page]]`;
        logContent += `| &nbsp;&nbsp; └─ ${childLink} | \`page\` | ${c.icon || ''} | \`${c.collection || ''}\` |\n`;
      });
    }
  });
  logContent += `\n`;

  logContent += `## ⚡ 3. Registered Automated Workflows\n`;
  if (workflows.length > 0) {
    logContent += `Dynamic trigger manager registered event-driven rules for:\n\n`;
    workflows.forEach((w: any) => {
      const flowLink = `[[Workflow - ${w.title}]]`;
      logContent += `- **${flowLink}**: ${w.description}\n`;
    });
    logContent += `\n`;
  } else {
    logContent += `No workflows registered in this build.\n\n`;
  }

  logContent += `## 📋 4. FormAI Compile Logs Timeline\n`;
  logContent += `\`\`\`text\n`;
  compilationLogs.forEach((l) => {
    logContent += `${l}\n`;
  });
  logContent += `\`\`\`\n`;

  // Create the build log record in memory_nodes
  await memoryNodesRepo.create({
    values: {
      uid: logUid,
      title: logTitle,
      type: 'activity',
      content: logContent,
      meta: {
        timestamp,
        collections: collections.map((c: any) => c.name),
        pages: menus.map((m: any) => m.title),
        workflows: workflows.map((w: any) => w.title),
      },
      links: [...new Set(links)],
      backlinks: [],
    }
  });

  // 2. Create or update [[System Overview]] node (type: 'entity')
  const overviewTitle = 'System Overview';
  let overviewContent = `# 🌐 System Overview: ${app.title}\n\n`;
  overviewContent += `Welcome to the Obsidian-Style KnowledgeWiki space of the **${app.title}** application. This workspace contains deterministically synced records describing the overall application design system, databases, UI menus, and process automation rules.\n\n`;
  overviewContent += `> [!NOTE]\n`;
  overviewContent += `> This documentation is dynamically maintained by the FormAI Compiler. Every time a build or modification is successfully compiled, a corresponding history trace is appended to [[System Build Log History]].\n\n`;

  overviewContent += `## 🗃️ Core Entities & Databases\n`;
  overviewContent += `These are the main relational collections serving the business context of ${app.title}:\n\n`;
  collections.forEach((col: any) => {
    if (col.name === 'memory_nodes') return;
    overviewContent += `- **[[${col.title || col.name} Collection]]**: ${col.title || col.name} data management and CRUD properties.\n`;
  });
  overviewContent += `\n`;

  overviewContent += `## 🎨 App UI Portals & Views\n`;
  overviewContent += `Navigate to page blueprints to inspect custom layouts:\n\n`;
  menus.forEach((m: any) => {
    if (m.type === 'page') {
      overviewContent += `- **[[${m.title} Page]]** (Icon: ${m.icon || '📄'})\n`;
    }
    if (m.children) {
      m.children.forEach((c: any) => {
        overviewContent += `  - **[[${c.title} Page]]** (Icon: ${c.icon || '📄'})\n`;
      });
    }
  });
  overviewContent += `\n`;

  overviewContent += `## ⚡ Process Automation Workflows\n`;
  if (workflows.length > 0) {
    workflows.forEach((w: any) => {
      overviewContent += `- **[[Workflow - ${w.title}]]**: ${w.description}\n`;
    });
    overviewContent += `\n`;
  } else {
    overviewContent += `No workflows registered.\n\n`;
  }

  overviewContent += `## 🕒 Recent Compilation Traces\n`;
  overviewContent += `To audit past builds, check the compile history page: [[System Build Log History]] or inspect the dynamic relationship graph on the right.\n`;

  const overviewLinks = [...new Set([
    'System Build Log History',
    ...collections.filter((c: any) => c.name !== 'memory_nodes').map((c: any) => `${c.title || c.name} Collection`),
    ...workflows.map((w: any) => `Workflow - ${w.title}`),
    ...menus.map((m: any) => m.type === 'page' ? `${m.title} Page` : null).filter(Boolean),
    ...menus.flatMap((m: any) => m.children ? m.children.map((c: any) => `${c.title} Page`) : []).filter(Boolean)
  ])];

  const existingOverview = await memoryNodesRepo.findOne({ filter: { title: overviewTitle } });
  if (existingOverview) {
    await memoryNodesRepo.update({
      filter: { id: existingOverview.id },
      values: {
        content: overviewContent,
        links: overviewLinks,
      }
    });
  } else {
    await memoryNodesRepo.create({
      values: {
        uid: 'system_overview',
        title: overviewTitle,
        type: 'entity',
        content: overviewContent,
        meta: {},
        links: overviewLinks,
        backlinks: [],
      }
    });
  }

  // 3. Create or update [[System Build Log History]] node
  const historyTitle = 'System Build Log History';
  let historyContent = `# 🕒 System Build Log History\n\n`;
  historyContent += `This page keeps an audit trail of all FormAI orchestrator compilations. Click on any log to inspect its timeline and specific schema changes.\n\n`;
  
  let historyNodes = await memoryNodesRepo.find({
    filter: { type: 'activity', title: { $like: 'System Build - %' } },
    sort: ['-createdAt'],
    limit: 50,
  });

  // Force-include the current build log if not yet returned in the find query
  if (!historyNodes.some((n: any) => n.title === logTitle)) {
    historyNodes = [{ title: logTitle, createdAt: now.toISOString() }, ...historyNodes];
  }

  historyNodes.forEach((n: any) => {
    const nodeDate = n.createdAt ? new Date(n.createdAt) : now;
    const formatted = formatTime(nodeDate);
    historyContent += `- **[[${n.title}]]** (Compiled at: \`${formatted}\`)\n`;
  });

  const historyLinks = historyNodes.map((n: any) => n.title);
  const existingHistory = await memoryNodesRepo.findOne({ filter: { title: historyTitle } });
  if (existingHistory) {
    await memoryNodesRepo.update({
      filter: { id: existingHistory.id },
      values: {
        content: historyContent,
        links: historyLinks,
      }
    });
  } else {
    await memoryNodesRepo.create({
      values: {
        uid: 'system_build_history',
        title: historyTitle,
        type: 'activity',
        content: historyContent,
        meta: {},
        links: historyLinks,
        backlinks: [],
      }
    });
  }

  // 4. Create or update dedicated notes for each Collection
  for (const col of collections) {
    if (col.name === 'memory_nodes') continue;
    const colTitle = `${col.title || col.name} Collection`;

    let colContent = `# 🗃️ Collection: ${col.title || col.name}\n\n`;
    colContent += `> [!NOTE]\n`;
    colContent += `> **Technical Table**: \`app_${app.name}_${col.name}\`\n`;
    colContent += `> **Category**: System Entity 🟦\n\n`;
    colContent += `This collection was designed by the **🗃️ Database Schema Architect** to support the data models of the **${app.title}** application.\n\n`;
    
    colContent += `## 📋 Database Fields & Schema\n\n`;
    colContent += `| Field Name | Display Title | Data Type | Key/Relation | Nullable |\n`;
    colContent += `| :--- | :--- | :--- | :--- | :--- |\n`;
    colContent += `| \`id\` | Primary ID | \`integer\` | Primary Key 🔑 | No ❌ |\n`;
    
    col.fields.forEach((f: any) => {
      let relStr = '';
      if (['belongsTo', 'hasMany', 'hasOne', 'belongsToMany'].includes(f.type)) {
        relStr = `Relation 🔗 -> \`[[${f.target} Collection]]\``;
      }
      colContent += `| \`${f.name}\` | ${f.title || f.name} | \`${f.type}\` | ${relStr || 'Standard Field'} | ${f.allowNull !== false ? 'Yes' : 'No ❌'} |\n`;
    });
    colContent += `\n`;

    colContent += `## ⚡ Provisioned Operations & Skills\n`;
    colContent += `Standard CRUD actions automatically exposed as skills for UI blocks or agents:\n`;
    colContent += `- \`app_${app.name}_${col.name}_list\`: Queries and search records\n`;
    colContent += `- \`app_${app.name}_${col.name}_get\`: Retrieves a single record details\n`;
    colContent += `- \`app_${app.name}_${col.name}_create\`: Inserts a new record\n`;
    colContent += `- \`app_${app.name}_${col.name}_update\`: Modifies an existing record\n`;
    colContent += `- \`app_${app.name}_${col.name}_delete\`: Permanently removes records\n\n`;

    colContent += `## 🕒 Traceability\n`;
    colContent += `- Linked by the overall [[System Overview]] map.\n`;

    const colLinks = ['System Overview'];
    col.fields.forEach((f: any) => {
      if (['belongsTo', 'hasMany', 'hasOne', 'belongsToMany'].includes(f.type) && f.target) {
        colLinks.push(`${f.target} Collection`);
      }
    });

    const existingColNode = await memoryNodesRepo.findOne({ filter: { title: colTitle } });
    if (existingColNode) {
      await memoryNodesRepo.update({
        filter: { id: existingColNode.id },
        values: {
          content: colContent,
          links: [...new Set(colLinks)],
        }
      });
    } else {
      await memoryNodesRepo.create({
        values: {
          uid: `entity_collection_${col.name}`,
          title: colTitle,
          type: 'entity',
          content: colContent,
          meta: { collectionName: col.name },
          links: [...new Set(colLinks)],
          backlinks: [],
        }
      });
    }
  }

  // 5. Create or update dedicated notes for each Page
  const allPages: any[] = [];
  menus.forEach((m: any) => {
    if (m.type === 'page') allPages.push(m);
    if (m.children) {
      m.children.forEach((c: any) => allPages.push(c));
    }
  });

  for (const page of allPages) {
    const pageTitle = `${page.title} Page`;

    let pageContent = `# 🎨 Page View: ${page.title}\n\n`;
    pageContent += `> [!NOTE]\n`;
    pageContent += `> **UI Component**: Responsive Portal Page\n`;
    pageContent += `> **Component Icon**: ${page.icon || '📄'}\n`;
    pageContent += `> **Routing Path**: \`/${page.path || slugify(page.title)}\`\n\n`;

    pageContent += `This page view is dynamically constructed by the **🎨 UI Frontend Engineer**. It displays a modern responsive web view within the **${app.title}** application.\n\n`;
    
    if (page.collection) {
      const linkName = `${page.collection} Collection`;
      pageContent += `## 🔗 Data Binding\n`;
      pageContent += `This page is bound to the database collection [[${linkName}]]. The UI components automatically render list columns, CRUD dialogs, and detail fields synchronized with that table.\n\n`;
    }

    pageContent += `## 🕒 Traceability\n`;
    pageContent += `- Navigate back to [[System Overview]] to view the full application structure.\n`;

    const pageLinks = ['System Overview'];
    if (page.collection) {
      pageLinks.push(`${page.collection} Collection`);
    }

    const existingPageNode = await memoryNodesRepo.findOne({ filter: { title: pageTitle } });
    if (existingPageNode) {
      await memoryNodesRepo.update({
        filter: { id: existingPageNode.id },
        values: {
          content: pageContent,
          links: pageLinks,
        }
      });
    } else {
      await memoryNodesRepo.create({
        values: {
          uid: `ui_page_${slugify(page.title)}`,
          title: pageTitle,
          type: 'note',
          content: pageContent,
          meta: { pageTitle: page.title },
          links: pageLinks,
          backlinks: [],
        }
      });
    }
  }

  // 6. Create or update dedicated notes for each Workflow
  for (const w of workflows) {
    const flowTitle = `Workflow - ${w.title}`;

    let wContent = `# ⚡ Workflow: ${w.title}\n\n`;
    wContent += `> [!NOTE]\n`;
    wContent += `> **Rule Engine**: Event-Driven Workflow Automation\n`;
    wContent += `> **Category**: System Activity 🟪\n\n`;

    wContent += `This automation flow was configured by the **⚡ Workflow Automation Specialist** to run background logic inside the **${app.title}** server environment.\n\n`;
    
    wContent += `## ⚙️ Trigger & Behavior Specification\n`;
    wContent += `**Description of triggers & actions**:\n`;
    wContent += `> ${w.description}\n\n`;

    wContent += `## 🕒 Traceability\n`;
    wContent += `- Registered in the global active TriggerManager during app compilation.\n`;
    wContent += `- Referenced by the [[System Overview]] directory map.\n`;

    const wLinks = ['System Overview'];
    const existingWorkflowNode = await memoryNodesRepo.findOne({ filter: { title: flowTitle } });
    if (existingWorkflowNode) {
      await memoryNodesRepo.update({
        filter: { id: existingWorkflowNode.id },
        values: {
          content: wContent,
          links: wLinks,
        }
      });
    } else {
      await memoryNodesRepo.create({
        values: {
          uid: `workflow_node_${slugify(w.title)}`,
          title: flowTitle,
          type: 'activity',
          content: wContent,
          meta: { workflowTitle: w.title },
          links: wLinks,
          backlinks: [],
        }
      });
    }
  }
}

const VALID_FIELD_TYPES = new Set([
  'string', 'text', 'integer', 'float', 'boolean', 'date', 'datetime',
  'jsonb', 'belongsTo', 'hasMany', 'hasOne', 'uuid', 'decimal',
]);

const RELATION_TYPES = new Set(['belongsTo', 'hasMany', 'hasOne', 'belongsToMany']);

/**
 * Repairs and normalises a raw LLM-generated DB blueprint object so that
 * downstream code can safely assume the shape matches DbBlueprintSchema.
 *
 * Fixes applied:
 *  - Ensures `collections` is always an array
 *  - Ensures every collection has a `name`, `title`, and `fields` array
 *  - Coerces snake_case/kebab-case collection & field names
 *  - Falls back unknown field types to `string`
 *  - Removes relation fields that are missing a `target`
 *  - De-duplicates fields by name within the same collection
 */
function repairDbBlueprint(raw: any): any {
  if (!raw || typeof raw !== 'object') {
    return { collections: [], skills: [] };
  }

  // Top-level: ensure collections array
  let collections: any[] = [];
  if (Array.isArray(raw.collections)) {
    collections = raw.collections;
  } else if (raw.collections && typeof raw.collections === 'object') {
    // Some models return an object keyed by collection name
    collections = Object.entries(raw.collections).map(([key, val]: [string, any]) => ({
      name: key,
      ...(typeof val === 'object' ? val : {}),
    }));
  }

  const repairedCollections = collections
    .filter((col: any) => col && typeof col === 'object')
    .map((col: any) => {
      // Normalise name
      const rawName = (col.name || col.collectionName || col.table || '').toString();
      const name = rawName.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 50) || 'unknown_collection';

      const title = col.title || col.label || col.displayName || rawName || name;

      // Normalise fields
      let rawFields: any[] = [];
      if (Array.isArray(col.fields)) {
        rawFields = col.fields;
      } else if (col.fields && typeof col.fields === 'object') {
        rawFields = Object.entries(col.fields).map(([fieldName, fieldDef]: [string, any]) => ({
          name: fieldName,
          ...(typeof fieldDef === 'object' ? fieldDef : { type: 'string' }),
        }));
      }

      const seenFieldNames = new Set<string>();
      const fields = rawFields
        .filter((f: any) => f && typeof f === 'object')
        .map((f: any) => {
          const fieldName = ((f.name || f.field || f.column || '').toString())
            .toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 50) || 'field';

          // Coerce type
          let fieldType = (f.type || 'string').toString().toLowerCase();
          // Map common LLM aliases
          const typeAliases: Record<string, string> = {
            'number': 'float', 'int': 'integer', 'bigint': 'integer', 'varchar': 'string',
            'char': 'string', 'text[]': 'jsonb', 'array': 'jsonb', 'json': 'jsonb',
            'timestamp': 'datetime', 'bool': 'boolean', 'numeric': 'decimal',
            'double': 'float', 'real': 'float', 'belongs_to': 'belongsTo',
            'has_many': 'hasMany', 'has_one': 'hasOne',
          };
          if (typeAliases[fieldType]) fieldType = typeAliases[fieldType];
          if (!VALID_FIELD_TYPES.has(fieldType)) fieldType = 'string';

          // Drop relation fields without a target
          if (RELATION_TYPES.has(fieldType) && !f.target) {
            return null;
          }

          return {
            name: fieldName,
            type: fieldType,
            title: f.title || f.label || fieldName,
            allowNull: f.allowNull !== undefined ? Boolean(f.allowNull) : true,
            unique: f.unique !== undefined ? Boolean(f.unique) : false,
            defaultValue: f.defaultValue,
            target: f.target,
            foreignKey: f.foreignKey,
          };
        })
        .filter((f: any): f is NonNullable<typeof f> => {
          if (!f) return false;
          if (f.name === 'id') return false; // id is auto-added downstream
          if (seenFieldNames.has(f.name)) return false;
          seenFieldNames.add(f.name);
          return true;
        });

      return { name, title, fields };
    });

  // Repair skills array
  let skills: any[] = [];
  if (Array.isArray(raw.skills)) {
    skills = raw.skills.filter((s: any) => s && s.name);
  }

  return { collections: repairedCollections, skills };
}

export async function autoGenerateAppModules(ctx: any, app: any, description: string): Promise<void> {
  const db = (ctx as any).app.db;
  const llm = (ctx as any).app.llm;
  const a2flow = (ctx as any).app.a2flow;
  const a2menu = (ctx as any).app.a2menu;

  const compilationLogs: string[] = [];

  const log = async (msg: string, type: 'info' | 'warn' | 'error' = 'info') => {
    const formatted = `[AI App Auto-Generate] ${msg}`;
    if (type === 'error') console.error(formatted);
    else if (type === 'warn') console.warn(formatted);
    else console.log(formatted);

    compilationLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);

    if (ctx.onCompilationLog) {
      await ctx.onCompilationLog(msg);
    }
  };

  if (!llm || !a2flow || !a2menu) {
    await log('AI engines not fully loaded, skipping module generation', 'warn');
    return;
  }

  try {
    await log('1. Deploying specialized Multi-Agent Team (🗃️ Database Architect, 🎨 UI Engineer, ⚡ Workflow Specialist)...');

    // Pre-sync database records to local workspace files
    let appWorkspaceDir: string | undefined;
    try {
      appWorkspaceDir = await exportAppToWorkspace(db, app);
      await log(`[Workspace Sync] Exported application records to local workspace files at ${appWorkspaceDir}`);
    } catch (syncErr: any) {
      await log(`[⚠️ Workspace Sync Error] Failed to export app workspace: ${syncErr.message}`, 'warn');
    }
    
    // Resolve LLM configuration from the default/active provider of LLMManager
    const activeProviderName = llm.defaultProvider || 'openai';
    const activeProvider = llm.getProvider(activeProviderName);
    const activeModel = activeProvider?.defaultModel || 'gpt-4o';
    const providerConfig = activeProvider?.config || {};

    const rawProvider = activeProviderName.toLowerCase();
    const mappedProvider = (rawProvider === 'qwen' || rawProvider === 'dashscope' || rawProvider === 'aliyun')
      ? 'aliyun'
      : ['openai', 'ollama', 'lmstudio', 'amazon-bedrock'].includes(rawProvider)
        ? rawProvider
        : 'openai';

    const isStandardOpenAI = rawProvider === 'openai' && !(providerConfig.baseURL || providerConfig.baseUrl);

    const llmProviderConfig = {
      provider: mappedProvider as any,
      apiKey: providerConfig.apiKey || process.env.OPENAI_API_KEY || undefined,
      baseUrl: providerConfig.baseURL || providerConfig.baseUrl || process.env.OPENAI_BASE_URL || undefined,
      model: activeModel,
      temperature: 0.0,
      reasoningEffort: undefined,
    };

    // Retrieve past session IDs from app settings (supporting both piSessions and legacy codexSessions)
    const sessions = app.settings?.piSessions || app.settings?.codexSessions || {};
    const dbSessionId = sessions.db || null;
    const uiSessionId = sessions.ui || null;
    const flowSessionId = sessions.flow || null;

    // Construct multi-tenant execution context
    const tenantId = (ctx as any).state?.tenantId || (app as any).tenant_id || 'default';
    const userId = (ctx as any).state?.user?.id || 'system';
    const userRoles = (ctx as any).state?.user?.roles || ['developer'];
    const skillContext = {
      tenantId,
      appId: app.id,
      userId,
      roles: userRoles,
    };

    const taskId = ctx.taskId || `run_${Math.random().toString(36).slice(2, 10)}`;
    await log(`[Lead Release Manager] Initializing Pi Agent sessions with tenant context (Tenant: ${tenantId}, App: ${app.id}, Task: ${taskId})...`);

    // Get Pi Agent Service from application instance
    const piService: PiAgentService = (ctx as any).app.pi || new PiAgentService((ctx as any).app);

    // Initialize 3 independent, tenant-safe Pi agent sessions
    const [dbSessionRes, uiSessionRes, flowSessionRes] = await Promise.all([
      piService.createSession({
        sessionId: dbSessionId,
        workingDirectory: appWorkspaceDir,
        providerConfig: llmProviderConfig,
        skillContext,
        enablePlatformSkills: false,
        isTransient: false,
      }),
      piService.createSession({
        sessionId: uiSessionId,
        workingDirectory: appWorkspaceDir,
        providerConfig: llmProviderConfig,
        skillContext,
        enablePlatformSkills: false,
        isTransient: false,
      }),
      piService.createSession({
        sessionId: flowSessionId,
        workingDirectory: appWorkspaceDir,
        providerConfig: llmProviderConfig,
        skillContext,
        enablePlatformSkills: false,
        isTransient: false,
      }),
    ]);

    const dbSchemaCodex = zodToJsonSchema(DbBlueprintSchema, { target: 'openAi' });
    const uiSchemaCodex = zodToJsonSchema(UiBlueprintSchema, { target: 'openAi' });
    const flowSchemaCodex = zodToJsonSchema(WorkflowBlueprintSchema, { target: 'openAi' });

    let dbPrompt = `You are a specialized Database Schema Architect. Your role is to design/extract a high-precision, relational database schema and skills for the application "${app.title}".
Analyze the blueprint input below and generate the collection structures (fields, relationships, constraints) and custom skill definitions.

Do NOT attempt to run any shell commands, tools, or explore the filesystem. Do NOT write any SQL statements or markdown explanations.
Directly output the schema in the requested JSON format.

Blueprint Input:
"${description}"`;

    let uiPrompt = `You are a specialized UX/UI Frontend Engineer. Your role is to design a responsive sidebar menu layout and navigation schemas for the application "${app.title}".
Analyze the blueprint input below and design the custom page list, grouping cards, and sidebar hierarchy.

Do NOT attempt to run any shell commands, tools, or explore the filesystem. Do NOT write any code files or markdown explanations.
Directly output the navigation schemas in the requested JSON format.

Blueprint Input:
"${description}"`;

    let flowPrompt = `You are a specialized Workflow Automation Specialist. Your role is to design the event-driven business rules and trigger workflows for the application "${app.title}".
Analyze the blueprint input below and map out triggers, actions, and automation metadata.

Do NOT attempt to run any shell commands, tools, or explore the filesystem. Do NOT write any code files or markdown explanations.
Directly output the workflows in the requested JSON format.

Blueprint Input:
"${description}"`;

    if (!isStandardOpenAI) {
      dbPrompt += `\n\nIMPORTANT: You must return ONLY a raw JSON object matching the following JSON Schema. Do NOT include any conversational text or explanation. Return only the JSON (do NOT wrap it in conversational text, and if you use markdown code blocks, use ONLY a single \`\`\`json block):
${JSON.stringify(dbSchemaCodex, null, 2)}`;

      uiPrompt += `\n\nIMPORTANT: You must return ONLY a raw JSON object matching the following JSON Schema. Do NOT include any conversational text or explanation. Return only the JSON (do NOT wrap it in conversational text, and if you use markdown code blocks, use ONLY a single \`\`\`json block):
${JSON.stringify(uiSchemaCodex, null, 2)}`;

      flowPrompt += `\n\nIMPORTANT: You must return ONLY a raw JSON object matching the following JSON Schema. Do NOT include any conversational text or explanation. Return only the JSON (do NOT wrap it in conversational text, and if you use markdown code blocks, use ONLY a single \`\`\`json block):
${JSON.stringify(flowSchemaCodex, null, 2)}`;
    }

    let dbTurn: { finalResponse: string }, uiTurn: { finalResponse: string }, flowTurn: { finalResponse: string };
    if (isStandardOpenAI) {
      await log('2. Starting parallel blueprint compilation via Pi Agent Engine...');
      const [dbResText, uiResText, flowResText] = await Promise.all([
        piService.runPrompt(dbSessionRes.session, dbPrompt, { outputSchema: dbSchemaCodex, tenantManager: dbSessionRes.tenantManager }),
        piService.runPrompt(uiSessionRes.session, uiPrompt, { outputSchema: uiSchemaCodex, tenantManager: uiSessionRes.tenantManager }),
        piService.runPrompt(flowSessionRes.session, flowPrompt, { outputSchema: flowSchemaCodex, tenantManager: flowSessionRes.tenantManager }),
      ]);
      await log('2. Multi-Agent team successfully generated all blueprints.');
      dbTurn = { finalResponse: dbResText };
      uiTurn = { finalResponse: uiResText };
      flowTurn = { finalResponse: flowResText };
    } else {
      await log('Lead Release Manager: Non-OpenAI provider detected. Running compilation tasks sequentially via Pi Agent Engine...');
      
      await log('2a. Launching 🗃️ DB Architect via Pi...');
      let dbChars = 0;
      let dbLastTick = Date.now();
      const dbResText = await piService.runPrompt(dbSessionRes.session, dbPrompt, {
        outputSchema: dbSchemaCodex,
        tenantManager: dbSessionRes.tenantManager,
        onTokenDelta: (delta) => {
          dbChars += delta.length;
          const now = Date.now();
          if (now - dbLastTick > 3000) {
            dbLastTick = now;
            log(`[🗃️ DB Architect] Generating database schema (~${dbChars} chars generated)...`).catch(() => {});
          }
        },
      });
      await log('2a. 🗃️ DB Architect completed schema design.');
      dbTurn = { finalResponse: dbResText };

      await log('2b. Launching 🎨 UI Engineer via Pi...');
      let uiChars = 0;
      let uiLastTick = Date.now();
      const uiResText = await piService.runPrompt(uiSessionRes.session, uiPrompt, {
        outputSchema: uiSchemaCodex,
        tenantManager: uiSessionRes.tenantManager,
        onTokenDelta: (delta) => {
          uiChars += delta.length;
          const now = Date.now();
          if (now - uiLastTick > 3000) {
            uiLastTick = now;
            log(`[🎨 UI Engineer] Generating UI navigation layout (~${uiChars} chars generated)...`).catch(() => {});
          }
        },
      });
      await log('2b. 🎨 UI Engineer completed UI design.');
      uiTurn = { finalResponse: uiResText };

      await log('2c. Launching ⚡ Workflow Specialist via Pi...');
      let flowChars = 0;
      let flowLastTick = Date.now();
      const flowResText = await piService.runPrompt(flowSessionRes.session, flowPrompt, {
        outputSchema: flowSchemaCodex,
        tenantManager: flowSessionRes.tenantManager,
        onTokenDelta: (delta) => {
          flowChars += delta.length;
          const now = Date.now();
          if (now - flowLastTick > 3000) {
            flowLastTick = now;
            log(`[⚡ Workflow Specialist] Generating workflow rules (~${flowChars} chars generated)...`).catch(() => {});
          }
        },
      });
      await log('2c. ⚡ Workflow Specialist completed workflow design.');
      flowTurn = { finalResponse: flowResText };
    }

    // Save updated session IDs back to database settings (persisting both piSessions and codexSessions compatibility)
    try {
      const appsRepo = db.getRepository('apps');
      if (appsRepo) {
        const currentSettings = app.settings || {};
        const newSettings = {
          ...currentSettings,
          piSessions: {
            db: dbSessionRes.sessionId,
            ui: uiSessionRes.sessionId,
            flow: flowSessionRes.sessionId,
          },
          codexSessions: {
            db: dbSessionRes.sessionId,
            ui: uiSessionRes.sessionId,
            flow: flowSessionRes.sessionId,
          },
        };
        await appsRepo.update({
          filter: { id: app.id },
          values: { settings: newSettings }
        });
        app.settings = newSettings;
        await log(`[Lead Release Manager] Saved Pi thread session IDs back to application settings.`);
      }
    } catch (saveErr: any) {
      await log(`[⚠️ AI App Auto-Generate] Failed to save thread sessions to database: ${saveErr.message}`, 'warn');
    }

    await log('Lead Release Manager: Compilation tasks complete! Integrating blueprints...');

    const parsePayload = (response: string, role: string) => {
      const clean = response.trim();
      
      // 1. Try to parse directly
      try {
        return JSON.parse(clean);
      } catch (e) {
        // ignore and try extraction methods
      }

      // 2. Try to extract JSON code blocks specifically: ```json ... ```
      const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/gi;
      let match;
      while ((match = jsonBlockRegex.exec(clean)) !== null) {
        try {
          return JSON.parse(match[1].trim());
        } catch (e) {
          // ignore
        }
      }

      // 3. Try to extract any other code blocks: ``` ... ```
      const genericBlockRegex = /```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```/gi;
      genericBlockRegex.lastIndex = 0;
      while ((match = genericBlockRegex.exec(clean)) !== null) {
        try {
          return JSON.parse(match[1].trim());
        } catch (e) {
          // ignore
        }
      }

      // 4. Try to extract by locating the first { or [ and last } or ]
      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          return JSON.parse(clean.substring(firstBrace, lastBrace + 1));
        } catch (e) {
          // ignore
        }
      }

      const firstBracket = clean.indexOf('[');
      const lastBracket = clean.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        try {
          return JSON.parse(clean.substring(firstBracket, lastBracket + 1));
        } catch (e) {
          // ignore
        }
      }

      // If all failed, throw the original parse error with full response
      try {
        return JSON.parse(clean);
      } catch (err: any) {
        throw new Error(`[${role}] Failed to parse JSON output: ${err.message}. Response: ${response}`);
      }
    };

    let dbBlueprintCodex: any = parsePayload(dbTurn.finalResponse, '🗃️ DB Architect');
    dbBlueprintCodex = repairDbBlueprint(dbBlueprintCodex);
    if (!dbBlueprintCodex.collections) dbBlueprintCodex.collections = [];
    dbBlueprintCodex.collections.push({
      name: 'memory_nodes',
      title: 'Business Memory & Wiki Nodes',
      fields: [
        { name: 'uid', type: 'string', title: 'Unique ID', unique: true, allowNull: false },
        { name: 'title', type: 'string', title: 'Page Title', unique: false, allowNull: false },
        { name: 'type', type: 'string', title: 'Node Type', unique: false, allowNull: false },
        { name: 'content', type: 'text', title: 'Markdown Content', allowNull: true },
        { name: 'meta', type: 'jsonb', title: 'Structured Metadata', allowNull: true },
        { name: 'links', type: 'jsonb', title: 'Wiki Links List', allowNull: true },
        { name: 'backlinks', type: 'jsonb', title: 'Backlinks List', allowNull: true },
      ]
    });

    const uiBlueprintCodex: any = parsePayload(uiTurn.finalResponse, '🎨 UI Engineer');
    const flowBlueprintCodex: any = parsePayload(flowTurn.finalResponse, '⚡ Workflow Specialist');

    const collectionsListCodex = (dbBlueprintCodex.collections || []).map((c: any) => c.name.toLowerCase());
    const validatedWorkflowsCodex = (flowBlueprintCodex.workflows || []).map((flow: any) => {
      const lowerDesc = flow.description.toLowerCase();
      const invalidRefs = collectionsListCodex.filter((colName: string) => lowerDesc.includes(colName));
      if (invalidRefs.length === 0 && collectionsListCodex.length > 0) {
        console.warn(`[Lead Release Manager] Warning: Workflow "${flow.title}" does not clearly map to any DB collection.`);
      }
      return flow;
    });

    const blueprint = {
      collections: dbBlueprintCodex.collections || [],
      skills: dbBlueprintCodex.skills || [],
      menus: uiBlueprintCodex.menus || [],
      workflows: validatedWorkflowsCodex,
    };

    await log('Lead Release Manager: Integrity checks passed! Synchronizing database schema passes...');

    // 2. Generate Collections programmatically in two passes
    const createdCollections: string[] = [];
    const collectionMap = new Map<string, any>();
    const collectionsRepo = db.getRepository('collections');
    const skillsRepo = db.getRepository('resource_skills');

    // PASS 1: Define all collections in db mapping and create collection / fields metadata
    for (const col of blueprint.collections) {
      try {
        const rawColName = col.name;
        const colPrefix = `app_${app.name}_`;
        const prefixedColName = col.name.startsWith(colPrefix) ? col.name : `${colPrefix}${col.name}`;

        await log(`[🗃️ DB Architect] Pass 1: Defining collection mapping for ${prefixedColName} (raw: ${rawColName})...`);

        const autoTableName = prefixedColName;
        const recordOptions = {
          tableName: autoTableName,
          timestamps: true,
        };

        const mappedFields = [
          { name: 'id', type: 'integer', autoIncrement: true, primaryKey: true },
          ...col.fields.map(f => {
            const isRelation = ['belongsTo', 'hasMany', 'hasOne', 'belongsToMany'].includes(f.type);
            let target = f.target;
            if (isRelation && target && target !== 'users' && target !== 'database') {
              target = target.startsWith(colPrefix) ? target : `${colPrefix}${target}`;
            }
            
            let defaultValue = f.defaultValue;
            if (f.type === 'date' || f.type === 'datetime') {
              if (typeof defaultValue === 'string' && (defaultValue.toLowerCase().includes('now') || defaultValue.toLowerCase().includes('today') || defaultValue.trim() === '')) {
                defaultValue = undefined;
              }
            }

            let foreignKey = f.foreignKey;
            if (f.type === 'belongsTo' && foreignKey === 'id') {
              foreignKey = undefined;
            }

            return {
              name: f.name,
              type: f.type,
              title: f.title,
              allowNull: f.allowNull !== undefined ? f.allowNull : true,
              unique: f.unique !== undefined ? f.unique : false,
              defaultValue: defaultValue,
              target: target,
              foreignKey: foreignKey,
            };
          })
        ];

        // Check if collection already exists in database metadata or in-memory
        const existingCol = await collectionsRepo.findOne({ filter: { name: prefixedColName } });
        if (existingCol || db.hasCollection(prefixedColName)) {
          await log(`[🗃️ DB Architect] Collection "${prefixedColName}" already exists. Re-registering.`);
          
          db.collection({
            name: prefixedColName,
            title: col.title || rawColName,
            fields: mappedFields,
            tableName: autoTableName,
            ...recordOptions,
          });
          
          // Re-sync fields metadata for existing collection
          const fieldsRepo = db.getRepository('fields');
          if (fieldsRepo) {
            for (const f of col.fields) {
              const isRelation = ['belongsTo', 'hasMany', 'hasOne', 'belongsToMany'].includes(f.type);
              let target = f.target;
              if (isRelation && target && target !== 'users' && target !== 'database') {
                target = target.startsWith(colPrefix) ? target : `${colPrefix}${target}`;
              }
              const existingField = await fieldsRepo.findOne({
                filter: { collectionName: prefixedColName, name: f.name }
              });
              let foreignKey = f.foreignKey;
              if (f.type === 'belongsTo' && foreignKey === 'id') {
                foreignKey = undefined;
              }
              if (existingField) {
                await fieldsRepo.update({
                  filter: { id: existingField.id },
                  values: {
                    type: f.type,
                    options: {
                      title: f.title,
                      allowNull: f.allowNull !== undefined ? f.allowNull : true,
                      unique: f.unique !== undefined ? f.unique : false,
                      defaultValue: f.defaultValue,
                      target: target,
                      foreignKey: foreignKey,
                    }
                  }
                });
              } else {
                await fieldsRepo.create({
                  values: {
                    collectionName: prefixedColName,
                    name: f.name,
                    type: f.type,
                    options: {
                      title: f.title,
                      allowNull: f.allowNull !== undefined ? f.allowNull : true,
                      unique: f.unique !== undefined ? f.unique : false,
                      defaultValue: f.defaultValue,
                      target: target,
                      foreignKey: foreignKey,
                    },
                    sort: 0,
                  },
                });
              }
            }
          }
        } else {
          // Create collection metadata
          await collectionsRepo.create({
            values: {
              name: prefixedColName,
              title: col.title || rawColName,
              appId: app.name, // string appId
              options: recordOptions,
            },
          });

          db.collection({
            name: prefixedColName,
            title: col.title || rawColName,
            fields: mappedFields,
            tableName: autoTableName,
            ...recordOptions,
          });

          // Persist fields metadata to fields_meta so they appear in UI and load correctly on restart
          const fieldsRepo = db.getRepository('fields');
          if (fieldsRepo) {
            for (const f of col.fields) {
              const isRelation = ['belongsTo', 'hasMany', 'hasOne', 'belongsToMany'].includes(f.type);
              let target = f.target;
              if (isRelation && target && target !== 'users' && target !== 'database') {
                target = target.startsWith(colPrefix) ? target : `${colPrefix}${target}`;
              }
              let foreignKey = f.foreignKey;
              if (f.type === 'belongsTo' && foreignKey === 'id') {
                foreignKey = undefined;
              }
              await fieldsRepo.create({
                values: {
                  collectionName: prefixedColName,
                  name: f.name,
                  type: f.type,
                  options: {
                    title: f.title,
                    allowNull: f.allowNull !== undefined ? f.allowNull : true,
                    unique: f.unique !== undefined ? f.unique : false,
                    defaultValue: f.defaultValue,
                    target: target,
                    foreignKey: foreignKey,
                  },
                  sort: 0,
                },
              });
            }
          }
        }

        createdCollections.push(prefixedColName);
        collectionMap.set(prefixedColName, { ...col, fields: mappedFields });

        // Persist CRUD skills for this collection in resource_skills (safe upsert)
        if (skillsRepo) {
          const crudActions = ['list', 'get', 'create', 'update', 'delete'];
          for (const act of crudActions) {
            const skillName = `${prefixedColName}_${act}`;
            const defaultEnabled = ['list', 'get'].includes(act);
            const requiresConfirm = act === 'delete';

            const existingSkill = await skillsRepo.findOne({ filter: { name: skillName } });
            const skillValues = {
              name: skillName,
              title: `${col.title || rawColName} - ${act.toUpperCase()}`,
              description: `Auto-generated ${act} skill for ${prefixedColName}`,
              resourceType: 'collection',
              resourceName: prefixedColName,
              appId: app.id,
              skillType: 'auto',
              enabled: defaultEnabled,
              requiresConfirm,
              rolesAllowed: [],
              handler: { type: 'auto_crud', collection: prefixedColName, action: act },
              inputSchema: { type: 'object', properties: {} },
              options: {},
            };

            if (existingSkill) {
              await skillsRepo.update({
                filter: { name: skillName },
                values: skillValues,
              });
            } else {
              await skillsRepo.create({
                values: skillValues,
              });
            }
          }
        }
      } catch (colErr: any) {
        await log(`[⚠️ AI App Auto-Generate] Pass 1 Failed for collection ${col.name}: ${colErr.message}`);
      }
    }

    // PASS 2: Setup relationships and sync physical tables using an iterative dependency resolution loop to resolve foreign keys
    await log('[🗃️ DB Architect] Pass 2: Setting up database relationships and physical table synchronization...');

    // Setup relations for all created collections first so Sequelize is fully aware of all foreign keys (e.g. hasMany targets)
    for (const prefixedColName of createdCollections) {
      try {
        const col = db.getCollection(prefixedColName);
        if (col) {
          col.setupRelations();
        }
      } catch (relErr: any) {
        console.warn(`[AI App Auto-Generate] Failed initial setupRelations for ${prefixedColName}:`, relErr.message);
      }
    }

    let unsynced = [...createdCollections];
    let retries = 5;
    let lastUnsyncedCount = unsynced.length;
    let passErrors: Record<string, string> = {};

    while (unsynced.length > 0 && retries > 0) {
      const failedThisPass: string[] = [];

      for (const prefixedColName of unsynced) {
        try {
          await db.syncCollection(prefixedColName, { alter: true });
          await log(`[🗃️ DB Architect] Successfully synchronized database schema for ${prefixedColName}`);
        } catch (syncErr: any) {
          failedThisPass.push(prefixedColName);
          passErrors[prefixedColName] = syncErr.message;
        }
      }

      unsynced = failedThisPass;
      retries--;

      // If we didn't make any progress in this pass, break to avoid an infinite loop
      if (unsynced.length === lastUnsyncedCount) {
        break;
      }
      lastUnsyncedCount = unsynced.length;
    }

    // Log any remaining sync failures that couldn't be resolved in 5 passes
    if (unsynced.length > 0) {
      for (const prefixedColName of unsynced) {
        console.error(`[AI App Auto-Generate] Pass 2 Sync Failed for collection ${prefixedColName}:`, passErrors[prefixedColName]);
      }
    }

    // 2.5. Generate Custom Skills
    if (skillsRepo && (blueprint as any).skills) {
      await log('[🗃️ DB Architect] Provisioning custom business skills...');
      for (const sk of (blueprint as any).skills) {
        try {
          const colPrefix = `app_${app.name}_`;
          const rawColName = sk.collection;
          const prefixedColName = (rawColName && rawColName !== 'global')
            ? (rawColName.startsWith(colPrefix) ? rawColName : `${colPrefix}${rawColName}`)
            : 'global';

          const skillName = `${app.name}_custom_${sk.name}`;
          const skillValues = {
            name: skillName,
            title: sk.title,
            description: sk.description,
            resourceType: prefixedColName === 'global' ? 'global' : 'collection',
            resourceName: prefixedColName,
            appId: app.id,
            skillType: 'custom',
            enabled: true,
            requiresConfirm: sk.name.includes('delete') || sk.name.includes('approve') || sk.name.includes('publish') || sk.name.includes('submit'),
            rolesAllowed: [],
            handler: { type: 'custom_action', action: sk.name },
            inputSchema: { type: 'object', properties: {} },
            options: {},
          };

          const existingSkill = await skillsRepo.findOne({ filter: { name: skillName } });
          if (existingSkill) {
            await skillsRepo.update({
              filter: { name: skillName },
              values: skillValues,
            });
          } else {
            await skillsRepo.create({
              values: skillValues,
            });
          }
        } catch (skillErr: any) {
          console.error(`[AI App Auto-Generate] Failed to create custom skill ${sk.name}:`, skillErr.message);
        }
      }
    }

    // 3. Generate Sidebar/Menus
    await log('[🎨 UI Engineer] 3. Designing app sidebar menus and dynamic UI page schemas...');
    const menuStructure = { menus: blueprint.menus || [] };

    const appMenusRepo = db.getRepository('appMenus');
    const uiSchemasRepo = db.getRepository('uiSchemas');

    // Clean up existing menus and dynamic schemas for this app to prevent duplicates
    if (appMenusRepo) {
      await appMenusRepo.destroy({ filter: { appId: app.id } });
    }
    if (uiSchemasRepo) {
      await uiSchemasRepo.destroy({ filter: { appId: app.name } });
    }

    let menuSort = 1;
    for (const menuItem of menuStructure.menus) {
      try {
        let parentId: number | null = null;

        if (menuItem.type === 'group') {
          // Create Group Menu Item
          const groupRecord = await appMenusRepo.create({
            values: {
              appId: app.id,
              title: menuItem.title,
              type: 'group',
              icon: menuItem.icon || '📁',
              parentId: null,
              sort: menuSort++,
              hidden: false,
            },
          });
          parentId = groupRecord.id;

          if (menuItem.children && Array.isArray(menuItem.children)) {
            let childSort = 1;
            for (const childItem of menuItem.children) {
              const schemaUid = `${app.name}_${slugify(childItem.title || '')}_${Math.random().toString(36).slice(2, 6)}`;
              
              // Find matching collection to link this page
              let matchedCol = createdCollections[0];
              let matchedColFields = collectionMap.get(matchedCol)?.fields || [];
              let bestScore = 0;

              for (const [prefixedName, bCol] of collectionMap.entries()) {
                const titleLower = childItem.title.toLowerCase();
                const bColTitleLower = (bCol.title || '').toLowerCase();
                const bColNameLower = (bCol.name || '').toLowerCase();
                const rawNameLower = (prefixedName.split(`app_${app.name}_`)[1] || '').toLowerCase();

                let score = 0;
                if (titleLower === bColTitleLower) {
                  score += 1000;
                }
                if (titleLower.includes(bColTitleLower) || bColTitleLower.includes(titleLower)) {
                  score += 500;
                }
                if (titleLower.includes(bColNameLower) || bColNameLower.includes(titleLower)) {
                  score += 200;
                }
                if (titleLower.includes(rawNameLower) || rawNameLower.includes(titleLower)) {
                  score += 100;
                }

                // Check character overlap for non-noisy keywords
                const cleanTitle = titleLower.replace(/管理|列表|查询|页面|app/gi, '');
                const cleanBColTitle = bColTitleLower.replace(/管理|列表|查询|页面|app/gi, '');
                if (cleanTitle && cleanBColTitle) {
                  const overlapCount = [...cleanTitle].filter(char => cleanBColTitle.includes(char)).length;
                  if (overlapCount > 0) {
                    score += overlapCount * 50;
                  }
                }

                // Apply English-Chinese semantic map bonuses & transaction priority
                for (const [cnTerm, enTerms] of Object.entries(semanticMap)) {
                  if (childItem.title.includes(cnTerm)) {
                    enTerms.forEach(enTerm => {
                      if (bColNameLower.includes(enTerm) || bColTitleLower.includes(enTerm)) {
                        if (rawNameLower.includes('order') || rawNameLower.includes('transaction') || rawNameLower.includes('document') || rawNameLower.includes('entry')) {
                          score += 1500;
                        } else if (rawNameLower === `${enTerm}s` || rawNameLower === enTerm || rawNameLower.includes(enTerm)) {
                          score += 800;
                        } else {
                          score += 300;
                        }
                      }
                    });
                  }
                }

                if (score > bestScore) {
                  bestScore = score;
                  matchedCol = prefixedName;
                  matchedColFields = bCol.fields;
                }
              }

              await log(`[🎨 UI Engineer] Generating UI page schema for page "${childItem.title}" linked to collection "${matchedCol.replace(`app_${app.name}_`, '')}"...`);

              let pageSchema;
              if (/dashboard|overview|home|看板|数据看板/i.test(childItem.title)) {
                pageSchema = generateDashboardPageSchema(childItem.title, matchedCol, matchedColFields);
              } else {
                pageSchema = generateDefaultPageSchema(childItem.title, matchedCol, matchedColFields);
              }

              // Save UI schema
              await uiSchemasRepo.create({
                values: {
                  uid: schemaUid,
                  title: childItem.title,
                  appId: app.name,
                  schema: pageSchema,
                },
              });

              await log(`[🎨 UI Engineer] Creating Child Menu Item: ${childItem.title}`);

              // Create Child Menu Item
              await appMenusRepo.create({
                values: {
                  appId: app.id,
                  title: childItem.title,
                  type: 'page',
                  icon: childItem.icon || '📄',
                  path: childItem.path || slugify(childItem.title),
                  schemaUid,
                  parentId,
                  sort: childSort++,
                  hidden: false,
                },
              });
            }
          }
        } else {
          // Top-level Page or Link
          let schemaUid: string | null = null;

          if (menuItem.type === 'page') {
            schemaUid = `${app.name}_${slugify(menuItem.title || '')}_${Math.random().toString(36).slice(2, 6)}`;
            
            // Find matching collection to link this page
            let matchedCol = createdCollections[0];
            let matchedColFields = collectionMap.get(matchedCol)?.fields || [];
            let bestScore = 0;

            for (const [prefixedName, bCol] of collectionMap.entries()) {
              const titleLower = menuItem.title.toLowerCase();
              const bColTitleLower = (bCol.title || '').toLowerCase();
              const bColNameLower = (bCol.name || '').toLowerCase();
              const rawNameLower = (prefixedName.split(`app_${app.name}_`)[1] || '').toLowerCase();

              let score = 0;
              if (titleLower === bColTitleLower) {
                score += 1000;
              }
              if (titleLower.includes(bColTitleLower) || bColTitleLower.includes(titleLower)) {
                score += 500;
              }
              if (titleLower.includes(bColNameLower) || bColNameLower.includes(titleLower)) {
                score += 200;
              }
              if (titleLower.includes(rawNameLower) || rawNameLower.includes(titleLower)) {
                score += 100;
              }

              // Check character overlap for non-noisy keywords
              const cleanTitle = titleLower.replace(/管理|列表|查询|页面|app/gi, '');
              const cleanBColTitle = bColTitleLower.replace(/管理|列表|查询|页面|app/gi, '');
              if (cleanTitle && cleanBColTitle) {
                const overlapCount = [...cleanTitle].filter(char => cleanBColTitle.includes(char)).length;
                if (overlapCount > 0) {
                  score += overlapCount * 50;
                }
              }

              // Apply English-Chinese semantic map bonuses & transaction priority
              for (const [cnTerm, enTerms] of Object.entries(semanticMap)) {
                if (menuItem.title.includes(cnTerm)) {
                  enTerms.forEach(enTerm => {
                    if (bColNameLower.includes(enTerm) || bColTitleLower.includes(enTerm)) {
                      if (rawNameLower.includes('order') || rawNameLower.includes('transaction') || rawNameLower.includes('document') || rawNameLower.includes('entry')) {
                        score += 1500;
                      } else if (rawNameLower === `${enTerm}s` || rawNameLower === enTerm || rawNameLower.includes(enTerm)) {
                        score += 800;
                      } else {
                        score += 300;
                      }
                    }
                  });
                }
              }

              if (score > bestScore) {
                bestScore = score;
                matchedCol = prefixedName;
                matchedColFields = bCol.fields;
              }
            }

            await log(`[🎨 UI Engineer] Generating UI page schema for page "${menuItem.title}" linked to collection "${matchedCol.replace(`app_${app.name}_`, '')}"...`);

            let pageSchema;
            if (/dashboard|overview|home|看板|数据看板/i.test(menuItem.title)) {
              pageSchema = generateDashboardPageSchema(menuItem.title, matchedCol, matchedColFields);
            } else {
              pageSchema = generateDefaultPageSchema(menuItem.title, matchedCol, matchedColFields);
            }

            await uiSchemasRepo.create({
              values: {
                uid: schemaUid,
                title: menuItem.title,
                appId: app.name,
                schema: pageSchema,
              },
            });
          }

          await log(`[🎨 UI Engineer] Creating Top-level Menu Item: ${menuItem.title} (${menuItem.type})`);

          // Create Top-level Menu Item
          await appMenusRepo.create({
            values: {
              appId: app.id,
              title: menuItem.title,
              type: menuItem.type,
              icon: menuItem.icon || (menuItem.type === 'link' ? '🔗' : '📄'),
              path: menuItem.type === 'page' ? (menuItem.path || slugify(menuItem.title)) : null,
              url: menuItem.type === 'link' ? (menuItem.url || 'https://google.com') : null,
              schemaUid,
              parentId: null,
              sort: menuSort++,
              hidden: false,
            },
          });
        }
      } catch (menuErr: any) {
        console.error(`[AI App Auto-Generate] Failed to create menu item ${menuItem.title}:`, menuErr.message);
      }
    }

    // 3.5 Auto-provision of Knowledge Wiki portal is skipped for the generated app.

    // 4. Generate Workflows
    const workflowsRepo = db.getRepository('workflows');
    if (workflowsRepo) {
      await log('[⚡ Workflow Specialist] 4. Deploying automated workflows & business rules...');
      // Clean up existing workflows for this app to prevent duplicates
      await workflowsRepo.destroy({ filter: { appId: app.id } });

      const workflowPlugin = (ctx as any).app.pluginManager.get('workflow');

      for (const flow of blueprint.workflows) {
        try {
          const collectionsContext = blueprint.collections.map((col: any) => {
            const colPrefix = `app_${app.name}_`;
            const prefixedName = col.name.startsWith(colPrefix) ? col.name : `${colPrefix}${col.name}`;
            return {
              name: prefixedName,
              title: col.title || col.name,
              fields: col.fields.map((f: any) => ({ name: f.name, title: f.title || f.name, type: f.type }))
            };
          });

          const flowDef = await a2flow.generateWorkflow(flow.description, {
            collections: collectionsContext,
          });


          const flowRecord = await workflowsRepo.create({
            values: {
              title: flow.title,
              description: flow.description,
              appId: app.id,
              enabled: true,
              triggerType: flowDef.triggerType || 'manual',
              triggerConfig: flowDef.triggerConfig || {},
              nodes: flowDef.nodes || [],
            },
          });

          // Dynamic compilation trigger registration so workflows execute instantly in-process!
          if (workflowPlugin?.triggerManager && workflowPlugin?.executor) {
            await log(`[⚡ Workflow Specialist] Dynamically registering trigger for workflow "${flowRecord.title}" (ID: ${flowRecord.id}) in TriggerManager...`);
            try {
              workflowPlugin.triggerManager.register(
                flowRecord.id,
                flowRecord.triggerType,
                flowRecord.triggerConfig ?? {},
                async (triggerCtx: any) => {
                  await workflowPlugin.executor.execute(flowRecord, triggerCtx);
                }
              );
            } catch (triggerErr: any) {
              console.warn(`[AI App Auto-Generate] Dynamic workflow trigger registration failed for "${flowRecord.title}": ${triggerErr.message}`);
            }
          }
        } catch (flowErr: any) {
          console.error(`[AI App Auto-Generate] Failed to create workflow ${flow.title}:`, flowErr.message);
        }
      }
    }

    // 5. Create default App Roles
    const appRolesRepo = db.getRepository('appRoles');
    if (appRolesRepo) {
      await log('[🎨 UI Engineer] Creating default Admin role & security configuration...');
      const existingRole = await appRolesRepo.findOne({ filter: { appId: app.id, name: 'admin' } });
      if (!existingRole) {
        await appRolesRepo.create({
          values: {
            appId: app.id,
            name: 'admin',
            title: 'Admin',
            permissions: ['*'],
            isDefault: true,
          },
        });
      }
    }

    // 6. Generate and save Markdown Blueprint document to DB
    let md = `# 🌐 Formai Application Blueprint: ${app.title}\n\n`;
    md += `## 🎯 1. User Scenarios & Product Value\n`;
    md += `This application serves the business needs of "${app.title}", supporting core user scenarios such as:\n`;
    for (const col of blueprint.collections) {
      md += `- Managing and auditing "${col.title || col.name}" processes.\n`;
    }
    md += `\n`;

    md += `## ⚡ 2. Business Logic & AI Skills\n`;
    md += `Formai is an AI-native platform where core business actions are represented as **Skills** that users or buttons can execute.\n\n`;
    md += `### Auto-generated CRUD Skills\n`;
    md += `Each collection automatically supports standard data operations:\n`;
    for (const col of blueprint.collections) {
      md += `- \`${col.name}_list\`, \`${col.name}_get\`, \`${col.name}_create\`, \`${col.name}_update\`, \`${col.name}_delete\`\n`;
    }
    md += `\n`;

    if ((blueprint as any).skills && (blueprint as any).skills.length > 0) {
      md += `### Specialized Custom Skills\n`;
      for (const sk of (blueprint as any).skills) {
        md += `- **\`${sk.name}\` (${sk.title})**: ${sk.description}\n`;
        md += `  - **Context**: Linked to collection \`${sk.collection || 'global'}\`\n`;
        md += `  - **Dynamic Safeguard**: ${sk.name.includes('delete') || sk.name.includes('approve') || sk.name.includes('publish') ? 'Yes (Requires user confirmation)' : 'No'}\n`;
      }
      md += `\n`;
    }

    md += `## 🗃️ 3. Functional Design\n`;
    md += `> [!NOTE]\n> The Formai engine dynamically compiles and syncs these underlying technical capabilities in the background to support the scenarios and skills defined above.\n\n`;
    
    md += `### A. Data Entities (Collections)\n`;
    for (const col of blueprint.collections) {
      md += `- **\`${col.name}\` (${col.title || col.name})**:\n`;
      md += `  Fields:\n`;
      for (const f of col.fields) {
        md += `  - \`${f.name}\`: \`${f.type}\` (${f.title || f.name})\n`;
      }
      md += `\n`;
    }

    md += `### B. User Portals (Menus & Pages)\n`;
    md += `Responsive front-end pages and navigation sidebar structures generated from collection layouts:\n`;
    for (const col of blueprint.collections) {
      md += `- Menu Link -> Linked to \`${col.name}\` list view & forms\n`;
    }
    md += `\n`;

    md += `### C. Automated Tasks (Workflows)\n`;
    for (const flow of blueprint.workflows) {
      md += `- **${flow.title}**:\n`;
      md += `  - **Actions**: ${flow.description}\n`;
    }
    md += `\n`;

    const appsRepo = db.getRepository('apps');
    if (appsRepo) {
      await appsRepo.update({
        filterByTk: app.id,
        values: { blueprint: md }
      });
      await log('[Lead Release Manager] Markdown Blueprint updated successfully in DB.');
    }

    // Post-sync compiled database schemas and configurations back to local workspace files
    try {
      if (appsRepo) {
        const reloadedApp = await appsRepo.findOne({ filter: { id: app.id } });
        if (reloadedApp) {
          await exportAppToWorkspace(db, reloadedApp);
          await log('[Workspace Sync] Post-compilation export to workspace completed successfully.');
        }
      }
    } catch (postSyncErr: any) {
      await log(`[⚠️ Workspace Sync Error] Failed post-compilation export to workspace: ${postSyncErr.message}`, 'warn');
    }

    // Compilation build logs and database schemas are no longer automatically synced to preserve the business domain focus of the Wiki.

    await log('🎉 Complete application modules created successfully!');
  } catch (err: any) {
    console.error('[AI App Auto-Generate] Error during generation:', err.message);
    await log(`Error during generation: ${err.message}`, 'error');
    throw err;
  }
}

// ─── Apps CRUD Actions ────────────────────────────────────────────────────────

export async function list(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const currentRole = (ctx as any).state.currentRole;
  const { page = 1, pageSize = 20, filter } = (ctx as any).action?.params || {};

  const isAdmin = currentRole === 'root' || currentRole === 'admin' || currentRole === 'developer';

  const repo = db.getRepository('apps');
  let filterObj: any = {};
  if (filter && typeof filter === 'object') {
    Object.assign(filterObj, filter);
  }

  // Non-admins only see published apps
  if (!isAdmin) {
    filterObj.status = 'published';
  }

  const { rows, count } = await repo.findAndCount({
    filter: filterObj,
    sort: ['-createdAt'],
    page: Number(page),
    pageSize: Number(pageSize),
  });

  ctx.body = {
    data: rows.map(serializeApp),
    meta: {
      count,
      page: Number(page),
      pageSize: Number(pageSize),
    },
  };
  await next();
}

export async function get(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { filterByTk } = (ctx as any).action?.params || {};

  const repo = db.getRepository('apps');
  const app = await repo.findOne({
    filter: isNaN(Number(filterByTk)) ? { name: filterByTk } : { id: filterByTk },
  });

  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  ctx.body = { data: serializeApp(app) };
  await next();
}

export async function create(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const currentUser = (ctx as any).state.currentUser;
  const { values } = (ctx as any).action?.params || {};

  if (!values?.name || !values?.title) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'name and title are required', code: 'VALIDATION_ERROR' }] };
    return;
  }

  if (!/^[a-z][a-z0-9_-]*$/.test(values.name)) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'name must be lowercase letters, numbers, hyphens or underscores', code: 'VALIDATION_ERROR' }] };
    return;
  }

  const repo = db.getRepository('apps');
  const existing = await repo.findOne({ filter: { name: values.name } });
  if (existing) {
    ctx.status = 409;
    ctx.body = { errors: [{ message: `App "${values.name}" already exists`, code: 'CONFLICT' }] };
    return;
  }

  const app = await repo.create({
    values: {
      name: values.name,
      title: values.title,
      description: values.description || null,
      icon: values.icon || null,
      status: 'draft',
      basePath: `/apps/${values.name}`,
      createdById: currentUser?.id || null,
      settings: values.settings || {},
    },
  });

  try {
    await exportAppToWorkspace(db, app);
  } catch (err: any) {
    console.error(`[Workspace Sync Error] Failed to export app workspace:`, err.message);
  }

  if (values.aiGenerate) {
    await autoGenerateAppModules(ctx, app, values.description || '');
  }

  ctx.status = 201;
  ctx.body = { data: serializeApp(app) };
  await next();
}

export async function update(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { filterByTk, values } = (ctx as any).action?.params || {};

  const repo = db.getRepository('apps');
  const app = await repo.findOne({
    filter: isNaN(Number(filterByTk)) ? { name: filterByTk } : { id: filterByTk },
  });

  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  const allowed = ['title', 'description', 'icon', 'settings', 'blueprint'];
  const updateData: any = {};
  for (const key of allowed) {
    if (values?.[key] !== undefined) updateData[key] = values[key];
  }

  const updated = await repo.update({ filterByTk: app.id, values: updateData });
  const updatedApp = updated[0] || app;

  try {
    await exportAppToWorkspace(db, updatedApp);
  } catch (err: any) {
    console.error(`[Workspace Sync Error] Failed to export updated app workspace:`, err.message);
  }

  ctx.body = { data: serializeApp(updatedApp) };
  await next();
}

export async function destroy(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { filterByTk } = (ctx as any).action?.params || {};

  const repo = db.getRepository('apps');
  const app = await repo.findOne({
    filter: isNaN(Number(filterByTk)) ? { name: filterByTk } : { id: filterByTk },
  });

  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  // Cascade delete menus and roles
  await db.getRepository('appMenus').destroy({ filter: { appId: app.id } });
  await db.getRepository('appRoles').destroy({ filter: { appId: app.id } });

  // Cascade delete app-owned entities
  const appName = app.name; // use app.name as appId across collections
  try { await db.getRepository('uiSchemas').destroy({ filter: { appId: appName } }); } catch { /* ignore */ }
  try { await db.getRepository('workflows').destroy({ filter: { appId: app.id } }); } catch { /* ignore */ }
  try { await db.getRepository('resource_skills').destroy({ filter: { appId: app.id } }); } catch { /* ignore */ }
  try { await db.getRepository('resource_skills').destroy({ filter: { appId: appName } }); } catch { /* ignore */ }
  try {
    // Delete app-owned collections (but NOT platform-shared ones)
    const collectionsRepo = db.getRepository('collections');
    const appCollections = await collectionsRepo.find({ filter: { appId: appName } });
    for (const col of appCollections) {
      try {
        // Delete corresponding Skills from DB & Registry
        try {
          const skillRegistry = (ctx as any).app.skillRegistry;
          if (skillRegistry) {
            skillRegistry.unregisterByResource('collection', col.name);
          }
          await db.getRepository('resource_skills').destroy({
            filter: { resourceType: 'collection', resourceName: col.name }
          });
        } catch (skillErr: any) {
          console.error(`[App Destroy] Failed to delete skills for collection "${col.name}":`, skillErr.message);
        }

        // Remove fields metadata
        await db.getRepository('fields').destroy({ filter: { collectionName: col.name } });
        
        // Drop the physical table using its correct physical name
        const tableName = col.options?.tableName || (col.appId ? col.name : `t_${col.name}`);
        console.log(`[App Destroy] Dropping physical table "${tableName}" for collection "${col.name}"`);
        const qi = db.sequelize.getQueryInterface();
        await qi.dropTable(tableName, { cascade: true });

        // Remove collection from in-memory collection map
        db.removeCollection(col.name);
      } catch (colErr: any) {
        console.error(`[App Destroy] Failed to drop collection "${col.name}":`, colErr.message);
      }
    }
    await collectionsRepo.destroy({ filter: { appId: appName } });
  } catch (err: any) {
    console.error(`[App Destroy] Error during collection cascade delete:`, err.message);
  }

  // Delete app-scoped role resource permissions
  try { await db.getRepository('roleResources').destroy({ filter: { appId: appName } }); } catch { /* ignore */ }

  // Delete user-app role assignments
  try { await db.getRepository('userAppRoles').destroy({ filter: { appId: app.id } }); } catch { /* ignore */ }

  await repo.destroy({ filterByTk: app.id });

  ctx.body = { data: { success: true } };
  await next();
}

export async function publish(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { filterByTk } = (ctx as any).action?.params || {};

  const repo = db.getRepository('apps');
  const app = await repo.findOne({
    filter: isNaN(Number(filterByTk)) ? { name: filterByTk } : { id: filterByTk },
  });

  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  const updated = await repo.update({ filterByTk: app.id, values: { status: 'published' } });
  ctx.body = { data: serializeApp(updated[0] || app) };
  await next();
}

export async function archive(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { filterByTk } = (ctx as any).action?.params || {};

  const repo = db.getRepository('apps');
  const app = await repo.findOne({
    filter: isNaN(Number(filterByTk)) ? { name: filterByTk } : { id: filterByTk },
  });

  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  const updated = await repo.update({ filterByTk: app.id, values: { status: 'archived' } });
  ctx.body = { data: serializeApp(updated[0] || app) };
  await next();
}

export async function unpublish(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { filterByTk } = (ctx as any).action?.params || {};

  const repo = db.getRepository('apps');
  const app = await repo.findOne({
    filter: isNaN(Number(filterByTk)) ? { name: filterByTk } : { id: filterByTk },
  });

  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  const updated = await repo.update({ filterByTk: app.id, values: { status: 'draft' } });
  ctx.body = { data: serializeApp(updated[0] || app) };
  await next();
}

// ─── /api/my/apps — apps accessible to current user ──────────────────────────

export async function myApps(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const currentUser = (ctx as any).state.currentUser;
  const currentRole = (ctx as any).state.currentRole;

  if (!currentUser) {
    ctx.status = 401;
    ctx.body = { errors: [{ message: 'Authentication required', code: 'UNAUTHORIZED' }] };
    return;
  }

  const appsRepo = db.getRepository('apps');
  const isAdmin = currentRole === 'root' || currentRole === 'admin' || currentRole === 'developer';

  if (isAdmin) {
    const apps = await appsRepo.find({
      filter: { status: { $ne: 'archived' } },
      sort: ['-createdAt'],
    });
    ctx.body = { data: apps.map(serializeApp) };
    await next();
    return;
  }

  // Regular users: find apps via userAppRoles
  const assignments = await db.getRepository('userAppRoles').find({
    filter: { userId: currentUser.id },
  });

  const appIds = [...new Set(assignments.map((a: any) => a.appId))];
  if (appIds.length === 0) {
    ctx.body = { data: [] };
    await next();
    return;
  }

  const apps = await appsRepo.find({
    filter: { id: { $in: appIds }, status: 'published' },
    sort: ['title'],
  });

  ctx.body = { data: apps.map(serializeApp) };
  await next();
}

// ─── /api/my/permissions ─────────────────────────────────────────────────────

export async function myPermissions(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const currentUser = (ctx as any).state.currentUser;
  const currentRole = (ctx as any).state.currentRole;
  const appId = (ctx as any).query?.app as string;

  if (!currentUser) {
    ctx.status = 401;
    ctx.body = { errors: [{ message: 'Authentication required', code: 'UNAUTHORIZED' }] };
    return;
  }

  const isAdmin = currentRole === 'root' || currentRole === 'admin' || currentRole === 'developer';

  if (isAdmin) {
    ctx.body = { data: { role: currentRole, permissions: ['*'], isAdmin: true } };
    await next();
    return;
  }

  if (!appId) {
    ctx.body = { data: { role: currentRole, permissions: [], isAdmin: false } };
    await next();
    return;
  }

  const appsRepo = db.getRepository('apps');
  const app = await appsRepo.findOne({
    filter: isNaN(Number(appId)) ? { name: appId } : { id: appId },
  });

  if (!app) {
    ctx.body = { data: { role: null, permissions: [], isAdmin: false } };
    await next();
    return;
  }

  const assignments = await db.getRepository('userAppRoles').find({
    filter: { userId: currentUser.id, appId: app.id },
  });

  if (assignments.length === 0) {
    ctx.body = { data: { role: null, permissions: [], isAdmin: false } };
    await next();
    return;
  }

  const roleIds = assignments.map((a: any) => a.appRoleId);
  const roles = await db.getRepository('appRoles').find({ filter: { id: { $in: roleIds } } });
  const permissions = roles.flatMap((r: any) => r.permissions || []);

  ctx.body = {
    data: {
      roles: roles.map((r: any) => ({ id: r.id, name: r.name, title: r.title })),
      permissions: [...new Set(permissions)],
      isAdmin: false,
    },
  };
  await next();
}

// ─── /api/apps/:appName/stats ────────────────────────────────────────────────

export async function appStats(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { appName } = (ctx as any).params;

  if (!appName) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'appName is required', code: 'VALIDATION_ERROR' }] };
    return;
  }

  // Verify app exists
  const appsRepo = db.getRepository('apps');
  const app = await appsRepo.findOne({ filter: { name: appName } });
  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  // Count app-scoped resources
  const [collectionsRes, schemasRes, workflowsRes, menusRes, rolesRes] = await Promise.all([
    db.getRepository('collections').findAndCount({ filter: { appId: appName } }).catch(() => ({ rows: [], count: 0 }) as any),
    db.getRepository('uiSchemas').findAndCount({ filter: { appId: appName } }).catch(() => ({ rows: [], count: 0 }) as any),
    db.getRepository('workflows').findAndCount({ filter: { appId: app.id } }).catch(() => ({ rows: [], count: 0 }) as any),
    db.getRepository('appMenus').findAndCount({ filter: { appId: app.id } }).catch(() => ({ rows: [], count: 0 }) as any),
    db.getRepository('appRoles').findAndCount({ filter: { appId: app.id } }).catch(() => ({ rows: [], count: 0 }) as any),
  ]);

  ctx.body = {
    data: {
      app: serializeApp(app),
      collections: collectionsRes.count,
      schemas: schemasRes.count,
      workflows: workflowsRes.count,
      menus: menusRes.count,
      roles: rolesRes.count,
    },
  };
  await next();
}

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeApp(app: any) {
  return {
    id: app.id,
    name: app.name,
    title: app.title,
    description: app.description,
    status: app.status,
    icon: app.icon,
    basePath: app.basePath || `/apps/${app.name}`,
    settings: app.settings || {},
    blueprint: app.blueprint || '',
    createdById: app.createdById,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

export async function autoUpdateApp(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { id } = ctx.params;
  const { confirm } = (ctx.request.body as any) || (ctx as any).action?.params || {};

  const repo = db.getRepository('apps');
  const app = await repo.findOne({
    filter: isNaN(Number(id)) ? { name: id } : { id: Number(id) },
  });

  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  const blueprint = app.blueprint;
  if (!blueprint) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'App Blueprint is empty. Please edit or chat with AI to generate a blueprint first.', code: 'BLUEPRINT_EMPTY' }] };
    return;
  }

  // Check if the app is an existing app with collections or menus already created
  const collectionsRepo = db.getRepository('collections');
  const collectionsCount = await collectionsRepo.count({ filter: { appId: app.name } });
  
  const menusRepo = db.getRepository('appMenus');
  const menusCount = await menusRepo.count({ filter: { appId: app.id } });
  
  const isExistingApp = app.status !== 'draft' || collectionsCount > 0 || menusCount > 0;

  if (isExistingApp && !confirm) {
    // 1. Retrieve current compiled app structure
    const collections = await db.getRepository('collections').find({ filter: { appId: app.name } });
    const collectionNames = collections.map((c: any) => c.name);
    
    let fields: any[] = [];
    if (collectionNames.length > 0) {
      fields = await db.getRepository('fields').find({
        filter: { collectionName: { $in: collectionNames } }
      });
    }
    
    const menus = await db.getRepository('appMenus').find({ filter: { appId: app.id } });
    const workflows = await db.getRepository('workflows').find({ filter: { appId: app.id } });

    // Format a high-level representation of the current structure
    const currentStructure = {
      collections: collections.map((c: any) => ({
        name: c.name.replace(`app_${app.name}_`, ''), // show raw name
        title: c.title,
        fields: fields.filter((f: any) => f.collectionName === c.name).map((f: any) => ({
          name: f.name,
          type: f.type,
          title: f.options?.title || f.name,
          target: f.options?.target?.replace(`app_${app.name}_`, ''),
        }))
      })),
      menus: menus.map((m: any) => ({
        title: m.title,
        type: m.type,
      })),
      workflows: workflows.map((w: any) => ({
        title: w.title,
        description: w.description,
      }))
    };

    // 2. Use LLM to perform comparison and output markdown differences
    const llm = (ctx as any).app.llm;
    if (llm) {
      const userPrompt = `You are a professional software architect. Compare the currently compiled application structure (given in JSON below) with the new Blueprint specification (given in Markdown below).
      
New Blueprint:
${blueprint}

Current Application Structure:
${JSON.stringify(currentStructure, null, 2)}

Provide a clear, high-level summary of the proposed modifications in the same language used in the new blueprint (e.g. English or Chinese). Categorize the changes into the following sections:
- **Database Tables & Fields (数据库表与字段)**
- **Navigation Menus & Pages (导航菜单与页面)**
- **Automated Workflows (自动化工作流)**

Also, add a "⚠️ Risk Warning / 风险提示" section if there are any destructive changes (such as missing/deleted tables or changed column types) that could potentially affect existing data. If everything is safe, state that the migration is safe and incremental.

Be concise, clear, and professional. Do not use any HTML tags. Output raw Markdown only.`;

      console.log("[AI App Auto-Update] Generating dry-run comparison summary...");
      const response = await llm.chat([
        { role: 'system', content: 'You are an expert enterprise software architect and FormAI platform compiler.' },
        { role: 'user', content: userPrompt }
      ], { temperature: 0.2 });

      ctx.body = {
        data: {
          needsConfirmation: true,
          summary: response.content,
        }
      };
      await next();
      return;
    }
  }

  // Check if there is an active compilation task for this app
  const taskRepo = db.getRepository('compilationTasks');
  const activeTask = await taskRepo.findOne({
    filter: {
      appId: app.id,
      status: { $in: ['pending', 'processing'] }
    }
  });

  if (activeTask) {
    ctx.status = 409;
    ctx.body = { errors: [{ message: 'Another compilation task is already in progress for this application.', code: 'COMPILATION_IN_PROGRESS' }] };
    return;
  }

  // Enqueue a new compilation task in the database queue
  const task = await taskRepo.create({
    values: {
      appId: app.id,
      blueprint,
      status: 'pending',
      logs: [`[${new Date().toLocaleTimeString()}] Enqueued compilation task in database queue...`],
    }
  });

  ctx.body = {
    data: {
      success: true,
      message: 'App compilation enqueued successfully in database task queue!',
      taskId: task.id,
    }
  };
  await next();
}

export async function activeCompilation(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { id } = ctx.params;
  
  let appId = Number(id);
  if (isNaN(appId)) {
    const appsRepo = db.getRepository('apps');
    const appRecord = await appsRepo.findOne({ filter: { name: id } });
    if (appRecord) {
      appId = appRecord.id;
    } else {
      ctx.status = 404;
      ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
      return;
    }
  }

  const taskRepo = db.getRepository('compilationTasks');
  const activeTask = await taskRepo.findOne({
    filter: {
      appId,
      status: { $in: ['pending', 'processing'] }
    }
  });

  ctx.body = { data: activeTask ? { id: activeTask.id, status: activeTask.status, logs: activeTask.logs } : null };
  await next();
}

export async function resetCompilation(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { id } = ctx.params;
  
  let appId = Number(id);
  if (isNaN(appId)) {
    const appsRepo = db.getRepository('apps');
    const appRecord = await appsRepo.findOne({ filter: { name: id } });
    if (appRecord) {
      appId = appRecord.id;
    } else {
      ctx.status = 404;
      ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
      return;
    }
  }

  const taskRepo = db.getRepository('compilationTasks');
  const activeTasks = await taskRepo.find({
    filter: {
      appId,
      status: { $in: ['pending', 'processing'] }
    }
  });

  if (activeTasks.length > 0) {
    for (const task of activeTasks) {
      const logs = Array.isArray(task.logs) ? task.logs : [];
      logs.push(`[${new Date().toLocaleTimeString()}] ❌ Task manually cancelled/reset by user.`);
      await taskRepo.update({
        filter: { id: task.id },
        values: {
          status: 'failed',
          error: 'Task manually cancelled/reset by user.',
          logs,
          finishedAt: new Date(),
        }
      });
    }
  }

  ctx.body = { data: { success: true, message: 'All pending/processing compilation tasks have been reset successfully.' } };
  await next();
}

export async function compilationStream(ctx: Context): Promise<void> {
  const db = (ctx as any).app.db;
  const { id } = ctx.params;
  
  // Resolve appId (supports both numeric ID and app name string)
  let appId = Number(id);
  if (isNaN(appId)) {
    const appsRepo = db.getRepository('apps');
    const appRecord = await appsRepo.findOne({ filter: { name: id } });
    if (appRecord) {
      appId = appRecord.id;
    } else {
      ctx.status = 404;
      ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
      return;
    }
  }

  ctx.request.socket.setKeepAlive(true);
  ctx.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const stream = new PassThrough();
  ctx.body = stream;

  let lastLogIndex = 0;
  const taskRepo = db.getRepository('compilationTasks');

  const interval = setInterval(async () => {
    try {
      const latestTask = await taskRepo.findOne({
        filter: { appId },
        sort: ['-id'], // Get the latest task for this app
      });

      if (!latestTask) {
        stream.write(`data: ${JSON.stringify({ type: 'error', message: 'No compilation tasks found for this application.' })}\n\n`);
        clearInterval(interval);
        stream.end();
        return;
      }

      const logs = Array.isArray(latestTask.logs) ? latestTask.logs : [];
      if (logs.length > lastLogIndex) {
        const newLogs = logs.slice(lastLogIndex);
        lastLogIndex = logs.length;
        
        for (const logLine of newLogs) {
          stream.write(`data: ${JSON.stringify({ type: 'log', message: logLine })}\n\n`);
        }
      }

      if (latestTask.status === 'completed') {
        stream.write(`data: ${JSON.stringify({ type: 'completed', message: 'Compilation completed successfully!' })}\n\n`);
        clearInterval(interval);
        stream.end();
      } else if (latestTask.status === 'failed') {
        stream.write(`data: ${JSON.stringify({ type: 'failed', error: latestTask.error || 'Unknown compilation error' })}\n\n`);
        clearInterval(interval);
        stream.end();
      }
    } catch (err: any) {
      stream.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      clearInterval(interval);
      stream.end();
    }
  }, 1000);

  ctx.req.on('close', () => {
    clearInterval(interval);
    stream.end();
  });
}

export async function syncWiki(ctx: Context, next: Next): Promise<void> {
  const db = (ctx as any).app.db;
  const { id } = ctx.params;

  const repo = db.getRepository('apps');
  const app = await repo.findOne({
    filter: isNaN(Number(id)) ? { name: id } : { id: Number(id) },
  });

  if (!app) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'App not found', code: 'NOT_FOUND' }] };
    return;
  }

  try {
    // ── Bootstrap memory_nodes table if it doesn't exist yet ─────────────────
    // Apps compiled before the KnowledgeWiki feature was added won't have this table.
    const memoryNodesCollectionName = `app_${app.name}_memory_nodes`;
    if (!db.hasCollection(memoryNodesCollectionName)) {
      const memoryNodesFields = [
        { name: 'id', type: 'integer', autoIncrement: true, primaryKey: true },
        { name: 'uid', type: 'string', unique: true, allowNull: false },
        { name: 'title', type: 'string', unique: false, allowNull: false },
        { name: 'type', type: 'string', unique: false, allowNull: false },
        { name: 'content', type: 'text', allowNull: true },
        { name: 'meta', type: 'jsonb', allowNull: true },
        { name: 'links', type: 'jsonb', allowNull: true },
        { name: 'backlinks', type: 'jsonb', allowNull: true },
      ];

      db.collection({
        name: memoryNodesCollectionName,
        title: 'Business Memory & Wiki Nodes',
        fields: memoryNodesFields,
        tableName: memoryNodesCollectionName,
        timestamps: true,
      });

      await db.syncCollection(memoryNodesCollectionName, { alter: true });

      // Persist collection metadata so it survives server restarts
      const collectionsMetaRepo = db.getRepository('collections');
      const existingMeta = await collectionsMetaRepo.findOne({ filter: { name: memoryNodesCollectionName } });
      if (!existingMeta) {
        await collectionsMetaRepo.create({
          values: {
            name: memoryNodesCollectionName,
            title: 'Business Memory & Wiki Nodes',
            appId: app.name,
            options: { tableName: memoryNodesCollectionName, timestamps: true },
          },
        });
      }
    }

    const llm = (ctx as any).app.llm;
    if (!llm) {
      throw new Error('LLM Service is not registered on this platform');
    }

    const systemPrompt = `You are an expert business analyst and business domain consultant.
Based on the application's details, generate 5 to 7 key business domain knowledge concepts, rules, glossaries, policies, or workflows.
Application: "${app.title}"
Description: "${app.description || ''}"
Blueprint Schema:
${app.blueprint || '(None)'}

Requirements for the generated business knowledge nodes:
1. Each node must be a pure business domain concept, definition, rule, or policy (e.g. for a "Compliance Monitoring Workflow", topics could be "Sanctions Screening Policy", "Compliance Workflow SLA", "Risk Assessment Tiering").
2. Do NOT output technical implementation details, database tables, or pages. Keep it entirely focused on the business domain knowledge.
3. Use Chinese if the application title, description, or blueprint contains Chinese; otherwise, use English.
4. Each node must interlink with other generated nodes using Obsidian-style double square brackets: [[Target Title]]. Ensure every node has at least 1-2 [[wiki-links]] referencing other nodes in the generated set, so that they form a beautiful, connected graph map.
5. Format the output as a valid JSON array of objects.

JSON Schema for the array elements:
[
  {
    "title": "Concept/Policy Title",
    "type": "entity", // Use 'entity' for core concepts/terms, 'activity' for processes/procedures/workflows
    "content": "# Concept Title\\n\\nDetailed, professional paragraph 1 explaining the concept...\\n\\nDetailed paragraph 2 explaining policies or rules...\\n\\nReferences: [[Another Concept Title]].",
    "links": ["Another Concept Title"]
  }
]

Provide the JSON array only, without markdown code blocks.`;

    console.log("[AI Wiki Generate] Triggering domain knowledge generation...");
    const response = await llm.chat([
      { role: 'system', content: 'You are an expert business analyst who outputs clean JSON only.' },
      { role: 'user', content: systemPrompt }
    ], { temperature: 0.3 });

    let rawText = response.content || '';
    rawText = rawText.replace(/^\s*```json\s*|```\s*$/g, '').trim();
    let generatedNodes: any[] = [];
    try {
      generatedNodes = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('[Wiki Generate] JSON Parse failed, trying to extract array:', rawText);
      const startIdx = rawText.indexOf('[');
      const endIdx = rawText.lastIndexOf(']');
      if (startIdx !== -1 && endIdx !== -1) {
        generatedNodes = JSON.parse(rawText.substring(startIdx, endIdx + 1));
      } else {
        throw new Error('Failed to parse business knowledge JSON response from LLM');
      }
    }

    const memoryNodesRepo = db.getRepository(memoryNodesCollectionName);
    
    // Clear out only auto-generated nodes of type 'entity' and 'activity'
    await memoryNodesRepo.destroy({
      filter: {
        type: { $in: ['entity', 'activity'] }
      }
    });

    // Insert newly generated business domain nodes
    for (const node of generatedNodes) {
      const slug = (node.title || 'node').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50);
      const uid = `domain_${slug}_${Math.random().toString(36).slice(2, 6)}`;
      
      await memoryNodesRepo.create({
        values: {
          uid,
          title: node.title,
          type: node.type || 'entity',
          content: node.content,
          meta: {},
          links: node.links || [],
          backlinks: [],
        }
      });
    }

    ctx.body = {
      data: {
        success: true,
        message: `Business knowledge graph generated successfully! Generated ${generatedNodes.length} domain knowledge pages.`,
        stats: {
          nodes: generatedNodes.length,
        },
      },
    };
  } catch (err: any) {
    console.error('[Wiki Sync] Error:', err.message);
    ctx.status = 500;
    ctx.body = { errors: [{ message: `Wiki sync failed: ${err.message}`, code: 'SYNC_ERROR' }] };
  }

  await next();
}
