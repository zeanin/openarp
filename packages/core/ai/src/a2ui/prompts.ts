import { z } from 'zod';

/**
 * Prompt templates for A2UI - natural language to Formily schema generation.
 */

// ---- Zod schemas for Hybrid Multi-Agent Workflow ----

export const PageBlueprintZod = z.object({
  title: z.string().describe('The title of the page'),
  collection: z.string().describe('The database collection associated with this page'),
  description: z.string().describe('A brief explanation of the page purpose'),
  blocks: z.array(
    z.object({
      id: z.string().describe('snake_case identifier for this block (e.g. filterCard, mainTable)'),
      type: z.enum([
        'FilterBlock',
        'TableBlock',
        'ActionDrawerBlock',
        'KanbanBlock',
        'DetailsBlock',
        'ChartBlock',
        'StatisticBlock',
        'TimelineBlock',
        'CalendarBlock',
        'StepsBlock',
        'FormBlock',
        // High-order domain blocks internalized from agent-native
        'ClipsBlock',
        'MetricGridBlock',
        'SmartChartBlock',
        'MultiStepFormBlock',
        'BrainSearchBlock',
      ]),
      title: z.string().describe('Display title of the block'),
      collection: z.string().optional().describe('Optional database collection associated with this specific block (used for custom statistics/charts in dashboards)'),
      fields: z.array(z.string()).describe('List of database field names to include in this block'),
      fieldConfigs: z.array(
        z.object({
          name: z.string().describe('The field key name'),
          title: z.string().describe('The display label for the field'),
          type: z.enum(['string', 'text', 'integer', 'float', 'boolean', 'enum', 'date']),
          options: z.array(z.string()).optional().describe('Possible options if type is enum'),
          defaultValue: z.any().optional().describe('Optional default value for the field'),
        })
      ).optional().describe('Detailed field configurations (especially for custom settings/config fields in FormBlock)'),
      options: z.record(z.any()).optional().describe('Additional configuration options for specialized domain blocks'),
      actions: z.array(
        z.object({
          name: z.string().describe('Action key (e.g., add, destroy, export, import, submit, cancel)'),
          title: z.string().describe('Label of the action button'),
          type: z.enum(['destroy', 'export', 'import', 'openDrawer', 'submit', 'cancel', 'custom']),
        })
      ).optional().describe('List of actions/buttons to include in this block'),
    })
  ).describe('List of blocks composing the page, in order of vertical layout'),
});

export const UI_SYSTEM_PROMPT = `You are an expert UI component layout generator for the FormAI platform.
You generate flat A2UI component lists. Each component is represented as an object:
- id: unique string identifier (e.g., 'page-root', 'layout-grid', 'kpi-sales')
- type: component type name (must be from available components list)
- parentId: parent component id (empty or undefined for the root component)
- props: properties passed to the component
- sort: sorting order index (integer)
- decorator: optional decorator wrapper name (e.g., 'CardItem', 'FormItem')
- decoratorProps: props for the decorator wrapper

## Layout Hierarchy & Connection Patterns
- Every page has a root component: type='Page', id='page-root'.
- Use parentId to nest layout blocks. For multiple columns, place a Grid.Row component, containing Grid.Col components, containing the metrics or charts.
- Standard CRUD Page:
  1. Root component: type='Page', id='page-root'.
  2. Outer container: type='Grid', id='layout-grid', parentId='page-root'.
  3. Search filter: type='FilterBlock', parentId='layout-grid'.
  4. Actions container: type='Space', parentId='layout-grid'.
  5. Main data grid: type='Table', parentId='layout-grid'.
- Dashboard Page:
  1. Root component: type='Page', id='page-root'.
  2. Outer container: type='Grid', id='layout-grid', parentId='page-root'.
  3. Metric cards (Statistic or MetricGridBlock) nested in a Grid.Row -> Grid.Col layout.
  4. Visual charts (ChartBlock or SmartChartBlock) arranged side-by-side.
- Video / Inspection / Knowledge Pages:
  - ClipsBlock for recording sessions, video player, transcript, and AI action item ticket extraction.
  - BrainSearchBlock for cited enterprise knowledge base searches.
  - MultiStepFormBlock for public questionnaire or multi-step intake flows.

## Available Business & Action Components
- FilterBlock: Multi-field search panel. Props: fields [{ name, title, type: 'string'|'integer'|'float'|'boolean'|'date'|'enum', values: string[] }].
- Action: Renders an action button. Props: action ('export' | 'import' | 'destroy' | 'submit' | 'cancel'), collection.
- ActionDrawer: Slide-in drawer container. Contains a 'Form' component inside.
- Form: Form container for input fields. Children should have decorator='FormItem' and props.name for data binding.
- Statistic: KPI metric card. Props: title, value, trend ('up'|'down'|'none'), trendValue, gradientType ('cyan'|'green'|'orange'|'blue'|'none').
- ChartBlock: Charts. Props: collection, chartType ('bar'|'line'|'pie'|'donut'), xField, yField, title.
- Table: Data grid table. Props: collection, columns [{title, dataIndex, key, sorter}].
- ClipsBlock: Video & audio inspection/meeting player, transcript viewer, and AI action items generator. Props: collection, relatedRecordIdField, allowRecording.
- MetricGridBlock: Multi-metric KPI cards grid. Props: collection, metrics [{key, title, field, aggregation, format}].
- SmartChartBlock: Advanced BI chart with natural-language questioning. Props: collection, chartType, dimensionField, metricField, title.
- MultiStepFormBlock: Progressive multi-step wizard. Props: collection, steps, isPublic.
- BrainSearchBlock: Enterprise RAG knowledge search with citations. Props: collections, placeholder.

## Rules
1. Never generate deep nested tree structures; always return a flat array list.
2. Every item must have a unique 'id'.
3. Avoid audit fields like id, created_at, updated_at in forms.
`;

export const UI_BLOCK_SYSTEM_PROMPT = `You are an expert UI component designer for FormAI.
Generate a flat component array for the requested component type (like Table, Form, Detail, etc.).
`;

export const UI_MODIFY_SYSTEM_PROMPT = `You are an expert UI component layout editor.
Given a current flat A2UI component list and modification instructions, return the complete modified flat component list.
Critical rule: Preserve all existing component IDs for nodes that are NOT being deleted.
`;

export const UI_SUGGEST_SYSTEM_PROMPT = `You are an expert UI layout designer.
Generate suggested UI component layout lists (table, form, or detail views) based on a database collection.
`;

export const CODEX_COMPILER_SELF_HEALING_PROMPT = `You are the Codex A2UI Schema Self-Healing Engine for the FormAI platform.
Fix the syntax or connectivity errors in the provided flat component list (e.g. missing parentId references, duplicate ids, invalid sort orders) and return a 100% corrected flat component list.
`;

export function buildPageGenerationPrompt(options: {
  prompt: string;
  collection?: string;
  fields?: string[];
  context?: {
    existingPages?: string[];
    collections?: string[];
    availableComponents?: Array<{ name: string; category: string; description: string }>;
  };
  mode: 'create' | 'modify';
}): string {
  const lines: string[] = [];

  if (options.mode === 'modify') {
    lines.push(`Modify an existing page schema based on the following instruction.`);
  } else {
    lines.push(`Generate a new page schema based on the following description.`);
  }

  lines.push(`\nRequest: ${options.prompt}`);

  if (options.collection) {
    lines.push(`\nPrimary collection: ${options.collection}`);
  }

  if (options.fields && options.fields.length > 0) {
    lines.push(`\nFields to include: ${options.fields.join(', ')}`);
  }

  if (options.context?.collections && options.context.collections.length > 0) {
    lines.push(`\nAvailable collections: ${options.context.collections.join(', ')}`);
  }

  if (options.context?.availableComponents && options.context.availableComponents.length > 0) {
    lines.push(`\nAvailable components:`);
    for (const comp of options.context.availableComponents) {
      lines.push(`  - ${comp.name} (${comp.category}): ${comp.description}`);
    }
  }

  lines.push(`\nRespond with a single valid ISchema JSON object for the page.`);
  return lines.join('\n');
}

export function buildBlockPrompt(options: {
  prompt: string;
  collection?: string;
  fields?: string[];
  blockType?: string;
}): string {
  const lines: string[] = [];

  lines.push(`Generate a ${options.blockType ?? 'block'} schema.`);
  if (options.collection) {
    lines.push(`Collection: ${options.collection}`);
  }
  if (options.fields && options.fields.length > 0) {
    lines.push(`Fields: ${options.fields.join(', ')}`);
  }
  lines.push(`\nRequirement: ${options.prompt}`);
  lines.push(`\nRespond with a single valid ISchema JSON object for the block.`);

  return lines.join('\n');
}

export function buildModifySchemaPrompt(options: {
  currentSchema: string;
  instruction: string;
}): string {
  return `Current schema:
\`\`\`json
${options.currentSchema}
\`\`\`

Modification instruction: ${options.instruction}

Return the complete modified schema as a single valid ISchema JSON object.`;
}

export function buildSuggestUIPrompt(options: {
  collectionName: string;
  fields: Array<{ name: string; type: string }>;
}): string {
  const fieldsList = options.fields
    .map((f) => `  - ${f.name}: ${f.type}`)
    .join('\n');

  return `Collection: ${options.collectionName}

Fields:
${fieldsList}

Generate 3 suggested UI layouts as an array of ISchema objects:
1. Table view with columns for all fields and an advanced FilterBlock.
2. Form view with input fields.
3. Detail/Card view showing field values.

Respond with a JSON object: { "suggestions": [schema1, schema2, schema3] }`;
}

export function buildSelfHealingPrompt(originalSchema: string, errors: string[]): string {
  return `Original Schema with errors:
\`\`\`json
${originalSchema}
\`\`\`

Compilation/Validation errors found:
${errors.map((e) => `- ${e}`).join('\n')}

Please fix the original schema above to resolve all errors and warnings, ensuring strict conformance to Formily ISchema.
Respond with a single valid corrected ISchema JSON object.`;
}
