import type { ISchema } from '@formai/shared';
import { z } from 'zod';
import type { LLMManager } from '../llm/manager';
import { zodToJsonSchema } from '../llm/structured-output';
import {
  UI_SYSTEM_PROMPT,
  UI_BLOCK_SYSTEM_PROMPT,
  UI_MODIFY_SYSTEM_PROMPT,
  UI_SUGGEST_SYSTEM_PROMPT,
  CODEX_COMPILER_SELF_HEALING_PROMPT,
  PageBlueprintZod,
  buildPageGenerationPrompt,
  buildBlockPrompt,
  buildModifySchemaPrompt,
  buildSuggestUIPrompt,
  buildSelfHealingPrompt,
} from './prompts';

export interface GeneratePageOptions {
  prompt: string;
  collection?: string;
  fields?: string[];
  context?: {
    existingPages?: string[];
    collections?: string[];
    availableComponents?: Array<{ name: string; category: string; description: string }>;
    schemaUid?: string;
    pageSchema?: any;
    selectedBlockUid?: string | null;
    selectedBlockSchema?: any | null;
    sessionId?: string;
  };
  mode: 'create' | 'modify';
  codex?: any;
  llmProviderConfig?: any;
}

export interface GenerateBlockOptions {
  prompt: string;
  collection?: string;
  fields?: string[];
  blockType?: string;
  codex?: any;
  llmProviderConfig?: any;
}

export interface A2UIComponent {
  id: string;
  type: string;
  parentId?: string;
  props?: Record<string, any>;
  sort?: number;
  decorator?: string;
  decoratorProps?: Record<string, any>;
  [key: string]: any;
}

// Helper to flatten a nested ISchema to flat components list
export function treeToFlat(schema: any): A2UIComponent[] {
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema.components)) return schema.components;

  const components: A2UIComponent[] = [];

  function traverse(node: any, parentId?: string, name?: string): string {
    const id = node['x-uid'] || name || `node_${Math.random().toString(36).slice(2, 6)}`;
    
    const props = node['x-component-props'] || {};
    if (node.title && !props.title) {
      props.title = node.title;
    }
    const nodeName = node.name || name;
    if (nodeName && !props.name) {
      props.name = nodeName;
    }

    const comp: A2UIComponent = {
      id,
      type: node['x-component'] || 'CardItem',
      parentId,
      props,
      sort: node['x-index'],
      decorator: node['x-decorator'],
      decoratorProps: node['x-decorator-props'],
      // Preserve other schema properties
      title: node.title,
      name: node.name,
      required: node.required,
      'x-validator': node['x-validator'],
      'x-reactions': node['x-reactions'],
      'x-visible': node['x-visible'],
      'x-hidden': node['x-hidden'],
      'x-disabled': node['x-disabled'],
      'x-read-only': node['x-read-only'],
      'x-editable': node['x-editable'],
      'x-pattern': node['x-pattern'],
      'x-display': node['x-display'],
      'x-content': node['x-content'],
      'x-data': node['x-data'],
      description: node.description,
      default: node.default,
      enum: node.enum,
    };

    components.push(comp);

    if (node.properties) {
      Object.entries(node.properties).forEach(([key, child]) => {
        traverse(child, id, key);
      });
    }

    if (node.items) {
      traverse(node.items, id, 'items');
    }

    return id;
  }

  traverse(schema);
  return components;
}

// Helper to expand flat components list to a nested ISchema tree
export function flatToTree(components: A2UIComponent[]): ISchema {
  if (!Array.isArray(components) || components.length === 0) {
    return { type: 'void', 'x-component': 'Page', properties: {} };
  }

  const map = new Map<string, ISchema>();
  const componentIds = new Set(components.map(c => c.id));
  const sortedComponents = [...components].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  for (const c of sortedComponents) {
    map.set(c.id, {
      type: c.props?.type || 'void',
      title: c.props?.title || c.title,
      name: c.props?.name || c.name,
      'x-component': c.type,
      'x-component-props': c.props || {},
      'x-decorator': c.decorator,
      'x-decorator-props': c.decoratorProps,
      'x-uid': c.id,
      'x-index': c.sort,
      required: c.required,
      'x-validator': c['x-validator'],
      'x-reactions': c['x-reactions'],
      'x-visible': c['x-visible'],
      'x-hidden': c['x-hidden'],
      'x-disabled': c['x-disabled'],
      'x-read-only': c['x-read-only'],
      'x-editable': c['x-editable'],
      'x-pattern': c['x-pattern'],
      'x-display': c['x-display'],
      'x-content': c['x-content'],
      'x-data': c['x-data'],
      description: c.description,
      default: c.default,
      enum: c.enum,
      properties: {},
    });
  }

  let root: ISchema | null = null;

  for (const c of sortedComponents) {
    const node = map.get(c.id)!;
    if (c.parentId && componentIds.has(c.parentId)) {
      const parentNode = map.get(c.parentId)!;
      if (!parentNode.properties) {
        parentNode.properties = {};
      }
      const propertyKey = c.props?.name || c.id;
      parentNode.properties[propertyKey] = node;
    } else {
      if (!root) {
        root = node;
      } else {
        if (root.properties) {
          const propertyKey = c.props?.name || c.id;
          root.properties[propertyKey] = node;
        }
      }
    }
  }

  return root || { type: 'void', 'x-component': 'Page', properties: {} };
}

// ---- Zod schemas for structured LLM output ----
export const A2UIComponentZod = z.object({
  id: z.string().describe('Unique identifier for this component (e.g. kpi-sales)'),
  type: z.string().describe('Component name, must match available components list'),
  parentId: z.string().optional().describe('Parent component id'),
  props: z.record(z.any()).optional().describe('Component properties'),
  sort: z.number().optional().describe('Sort order value'),
  decorator: z.string().optional().describe('Optional decorator, e.g. FormItem'),
  decoratorProps: z.record(z.any()).optional().describe('Decorator props')
});

const A2UIComponentsZod = z.array(A2UIComponentZod);

const SuggestUIZod = z.object({
  suggestions: z.array(A2UIComponentsZod),
});

export class A2UIEngine {
  public gateway?: any;

  constructor(private llm: LLMManager, private db?: any) {}

  private resolveFieldComponent(fieldName: string, collectionName?: string): { type: string; props: Record<string, any> } {
    const colName = collectionName;
    
    // 1. Try to find the field definition in the DB if available
    if (this.db && colName) {
      try {
        const col = this.db.getCollection(colName);
        const field = col?.getField(fieldName);
        if (field) {
          if (['belongsTo', 'hasOne', 'hasMany', 'belongsToMany'].includes(field.type)) {
            return {
              type: 'AssociationField',
              props: {
                name: fieldName,
                collection: field.target,
                labelField: 'name',
                valueField: 'id',
              },
            };
          }
          if (field.type === 'enum') {
            return {
              type: 'Select',
              props: {
                name: fieldName,
                options: field.values?.map((v: string) => ({ label: v.toUpperCase(), value: v })) || [],
              },
            };
          }
          if (field.type === 'boolean') {
            return {
              type: 'Switch',
              props: {
                name: fieldName,
                checkedChildren: 'ON',
                unCheckedChildren: 'OFF',
              },
            };
          }
          if (field.type === 'date' || field.type === 'datetime') {
            return {
              type: 'DatePicker',
              props: {
                name: fieldName,
              },
            };
          }
          if (['integer', 'float', 'double', 'decimal'].includes(field.type)) {
            return {
              type: 'Input',
              props: {
                name: fieldName,
                type: 'number',
              },
            };
          }
          if (field.type === 'text') {
            return {
              type: 'Input',
              props: {
                name: fieldName,
                multiline: true,
              },
            };
          }
        }
      } catch (e) {
        console.warn(`[A2UIEngine] Failed to resolve field definition from DB for ${colName}.${fieldName}:`, e);
      }
    }

    // 2. Heuristics fallback
    const lowerName = fieldName.toLowerCase();
    
    // Common association fields: ends with _id, or user/company references
    if (lowerName.endsWith('_id') || ['assigned_to', 'owner', 'user', 'company', 'customer', 'client', 'vendor', 'project', 'department'].includes(lowerName)) {
      let targetCollection = fieldName.endsWith('_id') ? fieldName.slice(0, -3) : fieldName;
      if (['assigned_to', 'owner', 'user'].includes(targetCollection)) {
        targetCollection = 'users';
      } else if (targetCollection === 'company') {
        targetCollection = 'companies';
      } else if (targetCollection === 'category') {
        targetCollection = 'categories';
      } else if (!targetCollection.endsWith('s')) {
        targetCollection = targetCollection + 's';
      }

      // Preserve table/app prefix if parent collection has it
      if (colName) {
        const prefixMatch = colName.match(/^(app|tb)_/);
        if (prefixMatch) {
          targetCollection = `${prefixMatch[0]}${targetCollection}`;
        }
      }

      return {
        type: 'AssociationField',
        props: {
          name: fieldName,
          collection: targetCollection,
          labelField: 'name',
          valueField: 'id',
        },
      };
    }

    // Common enum/metadata fields
    const enumFieldsMap: Record<string, string[]> = {
      status: ['active', 'inactive', 'draft', 'completed', 'pending'],
      priority: ['low', 'medium', 'high', 'critical'],
      stage: ['lead', 'contacted', 'proposal', 'negotiation', 'won', 'lost'],
      role: ['admin', 'member', 'guest'],
      gender: ['male', 'female', 'other'],
      rating: ['1', '2', '3', '4', '5'],
      lead_source: ['website', 'referral', 'advertisement', 'cold_call', 'other'],
    };

    if (enumFieldsMap[lowerName]) {
      return {
        type: 'Select',
        props: {
          name: fieldName,
          options: enumFieldsMap[lowerName].map((v) => ({ label: v.toUpperCase(), value: v })),
        },
      };
    }

    // Date/Time heuristic
    if (lowerName.includes('date') || lowerName.includes('time') || lowerName.endsWith('_at')) {
      return {
        type: 'DatePicker',
        props: {
          name: fieldName,
        },
      };
    }

    // Default to plain Input
    return {
      type: 'Input',
      props: {
        name: fieldName,
      },
    };
  }

  private async executePrompt<T>(
    schema: z.ZodSchema<T>,
    prompt: string,
    systemPrompt: string,
    options?: { codex?: any; llmProviderConfig?: any }
  ): Promise<T> {
    const codex = options?.codex;
    const llmProviderConfig = options?.llmProviderConfig;
    if (codex && llmProviderConfig) {
      try {
        const thread = codex.startThread({
          workingDirectory: process.cwd(),
          skipGitRepoCheck: true,
          model: llmProviderConfig.model,
          llmProvider: llmProviderConfig,
        });
        const jsonSchema = zodToJsonSchema(schema);
        const systemContent = [
          systemPrompt || 'You are a helpful assistant.',
          '',
          'You must respond with valid JSON that matches the following JSON Schema:',
          '```json',
          JSON.stringify(jsonSchema, null, 2),
          '```',
          '',
          'Respond ONLY with the JSON object. No markdown, no explanation, no extra text.',
        ].join('\n');

        const fullPrompt = `System instructions:\n${systemContent}\n\nUser request:\n${prompt}`;
        const turn = await thread.run(fullPrompt, { outputSchema: jsonSchema });
        const clean = turn.finalResponse.trim();
        let raw = clean;
        if (raw.startsWith('```')) {
          raw = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
        }
        return JSON.parse(raw) as T;
      } catch (err: any) {
        console.warn(`[A2UIEngine] Codex generation failed: ${err.message}. Falling back to standard LLM.`);
      }
    }

    return this.llm.generate(schema, prompt, {
      systemPrompt,
      temperature: 0.2,
    });
  }

  private async selfHealSchema(originalSchema: any[], errors: string[], options?: { codex?: any; llmProviderConfig?: any }): Promise<any[]> {
    const rawJson = JSON.stringify(originalSchema, null, 2);
    const healingPrompt = buildSelfHealingPrompt(rawJson, errors);
    return this.executePrompt(A2UIComponentsZod, healingPrompt, CODEX_COMPILER_SELF_HEALING_PROMPT, options);
  }

  async generatePage(options: GeneratePageOptions): Promise<any> {
    const sessionId = options.context?.sessionId;
    try {
      if (this.gateway && sessionId) {
        this.gateway.sendUIUpdate(sessionId, {
          surfaceId: 'page-surface',
          operation: 'generationStatus',
          status: 'generating_blueprint',
          message: options.mode === 'modify'
            ? 'A2Architect is preparing modifications...'
            : 'A2Architect is designing your page structure blueprint...'
        });
      }

      if (options.mode === 'modify') {
        const ctx = options.context as any;
        const currentSchema = ctx?.selectedBlockSchema || ctx?.pageSchema || [];
        const flatSchema = treeToFlat(currentSchema);
        const currentSchemaJson = JSON.stringify(flatSchema, null, 2);
        const userPrompt = buildModifySchemaPrompt({
          currentSchema: currentSchemaJson,
          instruction: options.prompt,
        });

        const res = await this.executePrompt(A2UIComponentsZod, userPrompt, UI_MODIFY_SYSTEM_PROMPT, options);
        if (this.gateway && sessionId) {
          this.gateway.sendUIUpdate(sessionId, {
            surfaceId: 'page-surface',
            operation: 'generationStatus',
            status: 'completed',
            message: 'Page UI modification completed!'
          });
        }
        return res;
      }

      const isDashboard = /dashboard/i.test(options.prompt);
      const isSettings = /setting/i.test(options.prompt);

      console.log('[A2UIEngine] Multi-Agent Pipeline: Stage 1 (A2Architect Blueprint Generation)');
      const collection = options.collection || 'generic_records';
      const fields = options.fields || ['name', 'status'];

      let systemPrompt = 'You are the A2Architect page structure designer. Create a logical enterprise application view blueprint.';
      let architectPrompt = `Generate a page blueprint for a business application view based on the user request.
User Prompt: "${options.prompt}"
Target Collection: "${collection}"
Available Fields: ${fields.join(', ')}`;

      if (isSettings) {
        systemPrompt = `You are the A2Architect page structure designer. Create a logical enterprise application Settings page blueprint.
Since this is a Settings/Configuration page, design one or more custom 'FormBlock' blocks matching the user request.
For each FormBlock, define custom fieldConfigs representing configuration fields matching the application's domain (e.g. for a library app, include borrowing limits, late fees, notifications; for a fleet app, speed limits, vehicle tracking options, etc.). Do NOT use standard database fields unless requested. Use field types: string, boolean, integer, float, enum. Make it fit the specific context of the app.`;

        architectPrompt = `Generate a page blueprint for a settings view.
User Prompt: "${options.prompt}"
Available database collections as context: ${options.context?.collections?.join(', ') || 'none'}`;
      } else if (isDashboard) {
        systemPrompt = `You are the A2Architect page structure designer. Create a logical enterprise application Dashboard page blueprint.
Since this is a Dashboard, it should summarize multiple collections. Design a layout containing:
1. Multiple 'StatisticBlock' blocks (KPI metrics) at the top. Specify the 'collection' and 'fields' to use for each statistic card.
2. Multiple 'ChartBlock' blocks (visual trends/distribution). Specify the 'collection', 'fields', and 'title' for each chart.
3. Chronological timeline ('TimelineBlock') or summary tables ('TableBlock').
Use the available collections list below to bind each statistic and chart block to the correct database collection (e.g., if you have 'app_crm_deals', put collection='app_crm_deals' in the chart/statistic block).`;

        architectPrompt = `Generate a page blueprint for a dashboard view.
User Prompt: "${options.prompt}"
Available database collections to bind: ${options.context?.collections?.join(', ') || 'none'}`;
      }

      const blueprintRaw = await this.executePrompt(z.any(), architectPrompt, systemPrompt, options);

      // If it's already a flat or legacy schema, flatten and return
      if (blueprintRaw && (blueprintRaw['x-component'] === 'Page' || Array.isArray(blueprintRaw) || blueprintRaw.components)) {
        console.log('[A2UIEngine] Direct schema detected in blueprint.');
        const res = treeToFlat(blueprintRaw);
        if (this.gateway && sessionId) {
          this.gateway.sendUIUpdate(sessionId, {
            surfaceId: 'page-surface',
            operation: 'generationStatus',
            status: 'completed',
            message: 'Page UI generation successfully completed!'
          });
        }
        return res;
      }

      const blueprint = blueprintRaw as z.infer<typeof PageBlueprintZod>;

      if (this.gateway && sessionId && blueprint) {
        this.gateway.sendUIUpdate(sessionId, {
          surfaceId: 'page-surface',
          operation: 'generationStatus',
          status: 'generating_components',
          message: `Blueprint created: "${blueprint.title || 'Page'}". Assembling components...`
        });
      }

      console.log('[A2UIEngine] Multi-Agent Pipeline: Stage 2 & 3 (A2UI Component Generation)');

      const components: A2UIComponent[] = [];

      // Root Page
      components.push({
        id: 'page-root',
        type: 'Page',
        props: {
          title: blueprint.title || 'Page',
        },
        sort: 1,
      });

      // Grid Container
      components.push({
        id: 'layout-grid',
        type: 'Grid',
        parentId: 'page-root',
        props: {
          cols: 1,
        },
        sort: 2,
      });

      let blockIndex = 10;
      let i = 0;

      while (i < blueprint.blocks.length) {
        const block = blueprint.blocks[i];

        if (block.type === 'StatisticBlock') {
          const stats: typeof blueprint.blocks = [];
          while (i < blueprint.blocks.length && blueprint.blocks[i].type === 'StatisticBlock') {
            stats.push(blueprint.blocks[i]);
            i++;
          }

          const span = Math.max(1, Math.floor(24 / stats.length));
          const rowId = `statsRow_${blockIndex}`;

          components.push({
            id: rowId,
            type: 'Grid.Row',
            parentId: 'layout-grid',
            sort: blockIndex,
          });

          stats.forEach((stat, sIndex) => {
            const colId = `col_${stat.id}`;
            components.push({
              id: colId,
              type: 'Grid.Col',
              parentId: rowId,
              props: { span },
              sort: sIndex,
            });

            const fieldName = stat.fields[0]?.toLowerCase() || '';
            const titleLower = stat.title.toLowerCase();

            let prefix: string | undefined = undefined;
            let suffix: string | undefined = undefined;
            let val = 120;

            if (fieldName.includes('rate') || fieldName.includes('ratio') || fieldName.includes('percent') || titleLower.includes('rate') || titleLower.includes('ratio') || titleLower.includes('percent')) {
              suffix = '%';
              val = 23;
            } else if (fieldName.includes('amount') || fieldName.includes('price') || fieldName.includes('revenue') || fieldName.includes('cost') || fieldName.includes('budget') || fieldName.includes('sales') || titleLower.includes('revenue') || titleLower.includes('sales') || titleLower.includes('amount')) {
              prefix = '$';
              val = 450000;
            } else if (fieldName.includes('count') || fieldName.includes('total') || fieldName.includes('active') || fieldName.includes('users') || fieldName.includes('leads') || titleLower.includes('count') || titleLower.includes('total') || titleLower.includes('active')) {
              val = 750;
            }

            components.push({
              id: stat.id,
              type: 'Statistic',
              parentId: colId,
              props: {
                title: stat.title,
                value: val,
                prefix,
                suffix,
                trend: sIndex === 0 ? 'up' : sIndex === 1 ? 'down' : 'none',
                trendValue: sIndex === 0 ? '12%' : sIndex === 1 ? '5%' : undefined,
                gradientType: sIndex % 4 === 0 ? 'cyan' : sIndex % 4 === 1 ? 'green' : sIndex % 4 === 2 ? 'orange' : 'blue',
              },
            });
          });

          blockIndex += 10;
          continue;
        }

        if (block.type === 'ChartBlock') {
          const charts: typeof blueprint.blocks = [];
          while (i < blueprint.blocks.length && blueprint.blocks[i].type === 'ChartBlock') {
            charts.push(blueprint.blocks[i]);
            i++;
          }

          const span = Math.max(1, Math.floor(24 / charts.length));
          const rowId = `chartsRow_${blockIndex}`;

          components.push({
            id: rowId,
            type: 'Grid.Row',
            parentId: 'layout-grid',
            sort: blockIndex,
          });

          charts.forEach((chart, cIndex) => {
            const colId = `col_${chart.id}`;
            components.push({
              id: colId,
              type: 'Grid.Col',
              parentId: rowId,
              props: { span },
              sort: cIndex,
            });

            components.push({
              id: chart.id,
              type: 'ChartBlock',
              parentId: colId,
              props: {
                collection: chart.collection || blueprint.collection,
                chartType: cIndex === 0 ? 'line' : 'donut',
                xField: chart.fields[0] || 'status',
                yField: chart.fields[1] || 'amount',
                title: chart.title,
              },
            });
          });

          blockIndex += 10;
          continue;
        }

        if (block.type === 'FilterBlock') {
          const targetCol = block.collection || blueprint.collection;
          components.push({
            id: block.id,
            type: 'FilterBlock',
            parentId: 'layout-grid',
            sort: blockIndex,
            props: {
              collection: targetCol,
              fields: block.fields.map((f) => {
                const resolved = this.resolveFieldComponent(f, targetCol);
                let filterType = 'string';
                let filterValues: string[] | undefined = undefined;
                let filterCollection: string | undefined = undefined;

                if (resolved.type === 'AssociationField') {
                  filterType = 'association';
                  filterCollection = resolved.props.collection;
                } else if (resolved.type === 'Select') {
                  filterType = 'enum';
                  filterValues = resolved.props.options?.map((opt: any) => opt.value);
                } else if (resolved.type === 'DatePicker') {
                  filterType = 'date';
                } else if (resolved.type === 'Switch') {
                  filterType = 'boolean';
                } else if (resolved.props.type === 'number') {
                  filterType = 'integer';
                }

                return {
                  name: f,
                  title: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' '),
                  type: filterType,
                  values: filterValues,
                  collection: filterCollection,
                  labelField: resolved.props.labelField,
                  valueField: resolved.props.valueField,
                };
              }),
            },
          });
        } else if (block.type === 'KanbanBlock') {
          components.push({
            id: block.id,
            type: 'KanbanView',
            parentId: 'layout-grid',
            sort: blockIndex,
            props: {
              collection: block.collection || blueprint.collection,
              groupBy: block.fields[0] || 'status',
              titleField: block.fields[1] || 'name',
              descriptionField: block.fields[2] || 'description',
              columns: [
                { key: 'qualified', title: 'Qualified', color: '#e6f4ff' },
                { key: 'contacted', title: 'Contacted', color: '#f9f0ff' },
                { key: 'proposal', title: 'Proposal', color: '#fffbe6' },
                { key: 'closed_won', title: 'Closed Won', color: '#f6ffed' },
              ],
            },
          });
        } else if (block.type === 'TimelineBlock') {
          components.push({
            id: block.id,
            type: 'Timeline',
            parentId: 'layout-grid',
            decorator: 'CardItem',
            decoratorProps: { title: block.title },
            sort: blockIndex,
            props: {
              items: [
                { label: '2026-06-08', children: 'Record created' },
                { label: '2026-06-09', children: 'AI automated processing complete' },
                { label: '2026-06-10', children: 'Status updated to Completed' },
              ],
            },
          });
        } else if (block.type === 'CalendarBlock') {
          components.push({
            id: block.id,
            type: 'Calendar',
            parentId: 'layout-grid',
            sort: blockIndex,
            props: {
              collection: block.collection || blueprint.collection,
              dateField: block.fields[0] || 'createdAt',
              titleField: block.fields[1] || 'name',
            },
          });
        } else if (block.type === 'StepsBlock') {
          components.push({
            id: block.id,
            type: 'Steps',
            parentId: 'layout-grid',
            decorator: 'CardItem',
            decoratorProps: { title: block.title },
            sort: blockIndex,
            props: {
              current: 1,
              items: [
                { title: 'Ingestion', description: 'Record ingested' },
                { title: 'Processing', description: 'Process data' },
                { title: 'Complete', description: 'Finish action' },
              ],
            },
          });
        } else if (block.type === 'FormBlock') {
          const cardId = `card_${block.id}`;
          const formId = `form_${block.id}`;

          components.push({
            id: cardId,
            type: 'CardItem',
            parentId: 'layout-grid',
            sort: blockIndex,
            props: { title: block.title },
          });

          components.push({
            id: formId,
            type: 'Form',
            parentId: cardId,
            props: { layout: 'vertical' },
          });

          const configs = block.fieldConfigs || [];
          if (configs.length === 0 && block.fields && block.fields.length > 0) {
            block.fields.forEach((f, fIdx) => {
              if (['id', 'created_at', 'updated_at', 'deleted_at', 'is_deleted'].includes(f)) return;
              const resolved = this.resolveFieldComponent(f, blueprint.collection);
              components.push({
                id: `${formId}_field_${f}`,
                type: resolved.type,
                parentId: formId,
                decorator: 'FormItem',
                decoratorProps: { title: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' ') },
                props: resolved.props,
                sort: fIdx,
              });
            });
          } else {
            configs.forEach((field, fIdx) => {
              let compType = 'Input';
              let compProps: any = { name: field.name };

              if (field.type === 'boolean') {
                compType = 'Switch';
                compProps.checkedChildren = 'ON';
                compProps.unCheckedChildren = 'OFF';
                if (field.defaultValue !== undefined) {
                  compProps.defaultChecked = !!field.defaultValue;
                }
              } else if (field.type === 'enum') {
                compType = 'Select';
                compProps.options = field.options?.map((opt: string) => ({ label: opt, value: opt })) || [];
                if (field.defaultValue !== undefined) {
                  compProps.defaultValue = field.defaultValue;
                }
              } else if (field.type === 'date') {
                compType = 'DatePicker';
              } else if (field.type === 'integer' || field.type === 'float') {
                compProps.type = 'number';
                compProps.placeholder = `Enter ${field.title.toLowerCase()}...`;
                if (field.defaultValue !== undefined) {
                  compProps.defaultValue = field.defaultValue;
                }
              } else if (field.type === 'text') {
                compProps.multiline = true;
                compProps.placeholder = `Enter ${field.title.toLowerCase()}...`;
                if (field.defaultValue !== undefined) {
                  compProps.defaultValue = field.defaultValue;
                }
              } else {
                compProps.placeholder = `Enter ${field.title.toLowerCase()}...`;
                if (field.defaultValue !== undefined) {
                  compProps.defaultValue = field.defaultValue;
                }
              }

              components.push({
                id: `${formId}_field_${field.name}`,
                type: compType,
                parentId: formId,
                decorator: 'FormItem',
                decoratorProps: { title: field.title },
                props: compProps,
                sort: fIdx,
              });
            });
          }

          const spaceId = `space_${block.id}`;
          components.push({
            id: spaceId,
            type: 'Space',
            parentId: formId,
            props: { align: 'end', style: { width: '100%', justifyContent: 'flex-end', marginTop: 16 } },
            sort: 100,
          });

          components.push({
            id: `btn_save_${block.id}`,
            type: 'Action',
            parentId: spaceId,
            props: { title: `Save ${block.title}`, type: 'primary', action: 'submit' },
            sort: 10,
          });
        } else if (block.type === 'TableBlock') {
          const tableActions = block.actions || [];
          const actionBarId = `actionBar_${block.id}`;
          const targetBlockCol = block.collection || blueprint.collection;

          components.push({
            id: actionBarId,
            type: 'Space',
            parentId: 'layout-grid',
            sort: blockIndex,
            props: { style: { marginBottom: 16 } },
          });

          const hasAddAction = tableActions.some((a) => a.name === 'add');
          if (hasAddAction) {
            const drawerId = `drawer_${block.id}`;
            const formId = `addForm_${block.id}`;

            components.push({
              id: `addBtn_${block.id}`,
              type: 'Action',
              parentId: actionBarId,
              props: { title: 'Add New', action: 'openDrawer', drawerId },
            });

            components.push({
              id: drawerId,
              type: 'ActionDrawer',
              parentId: 'page-root',
              props: { title: 'Add New', width: 600 },
            });

            components.push({
              id: formId,
              type: 'Form',
              parentId: drawerId,
              props: { collection: targetBlockCol },
            });

            fields.forEach((f, fIdx) => {
              if (['id', 'created_at', 'updated_at', 'deleted_at', 'is_deleted'].includes(f)) return;
              const resolved = this.resolveFieldComponent(f, targetBlockCol);
              components.push({
                id: `${formId}_field_${f}`,
                type: resolved.type,
                parentId: formId,
                decorator: 'FormItem',
                decoratorProps: { title: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' ') },
                props: resolved.props,
                sort: fIdx,
              });
            });
          }

          const hasImportAction = tableActions.some((a) => a.name === 'import');
          if (hasImportAction) {
            components.push({
              id: `import_${block.id}`,
              type: 'Action',
              parentId: actionBarId,
              props: { title: 'Import', action: 'import', collection: targetBlockCol },
            });
          }

          const hasExportAction = tableActions.some((a) => a.name === 'export');
          if (hasExportAction) {
            components.push({
              id: `export_${block.id}`,
              type: 'Action',
              parentId: actionBarId,
              props: { title: 'Export', action: 'export', collection: targetBlockCol },
            });
          }

          const hasDeleteAction = tableActions.some((a) => a.name === 'destroy');
          if (hasDeleteAction) {
            components.push({
              id: `delete_${block.id}`,
              type: 'Action',
              parentId: actionBarId,
              props: {
                title: 'Delete Selected',
                action: 'destroy',
                danger: true,
                collection: targetBlockCol,
                confirmTitle: 'Are you sure you want to delete selected records?',
              },
            });
          }

          const tableColumns = block.fields.map((f) => ({
            title: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' '),
            dataIndex: f,
            key: f,
            sorter: true,
            render: f === 'status' ? 'status' : f === 'amount' || f === 'price' ? 'amount' : undefined,
          }));

          components.push({
            id: block.id,
            type: 'Table',
            parentId: 'layout-grid',
            sort: blockIndex + 1,
            props: {
              collection: targetBlockCol,
              columns: tableColumns,
              rowSelection: true,
              pagination: { pageSize: 10, showSizeChanger: true },
            },
          });
        }

        blockIndex += 10;
        i++;
      }

      if (this.gateway && sessionId) {
        this.gateway.sendUIUpdate(sessionId, {
          surfaceId: 'page-surface',
          operation: 'generationStatus',
          status: 'completed',
          message: 'Page UI generation successfully completed!'
        });
      }

      return components;
    } catch (err: any) {
      if (this.gateway && sessionId) {
        this.gateway.sendUIUpdate(sessionId, {
          surfaceId: 'page-surface',
          operation: 'generationStatus',
          status: 'failed',
          message: `Generation failed: ${err.message}`
        });
      }
      throw err;
    }
  }

  async generateBlock(options: GenerateBlockOptions): Promise<any> {
    const userPrompt = buildBlockPrompt(options);
    return this.executePrompt(A2UIComponentsZod, userPrompt, UI_BLOCK_SYSTEM_PROMPT, options);
  }

  async modifySchema(currentSchema: any, instruction: string, options?: { codex?: any; llmProviderConfig?: any }): Promise<any> {
    const flatSchema = treeToFlat(currentSchema);
    const currentSchemaJson = JSON.stringify(flatSchema, null, 2);
    const userPrompt = buildModifySchemaPrompt({
      currentSchema: currentSchemaJson,
      instruction,
    });

    return this.executePrompt(A2UIComponentsZod, userPrompt, UI_MODIFY_SYSTEM_PROMPT, options);
  }

  async suggestUI(
    collectionName: string,
    fields: Array<{ name: string; type: string }>,
    options?: { codex?: any; llmProviderConfig?: any }
  ): Promise<any[][]> {
    const userPrompt = buildSuggestUIPrompt({ collectionName, fields });
    const result = await this.executePrompt(SuggestUIZod, userPrompt, UI_SUGGEST_SYSTEM_PROMPT, options);
    return result.suggestions;
  }

  private buildSystemPrompt(context?: GeneratePageOptions['context']): string {
    const parts: string[] = [UI_SYSTEM_PROMPT];

    if (context?.availableComponents && context.availableComponents.length > 0) {
      parts.push('\n## Available Components');
      for (const comp of context.availableComponents) {
        parts.push(`- ${comp.name} (${comp.category}): ${comp.description}`);
      }
    }

    return parts.join('\n');
  }
}
