import { z } from 'zod';
import type { LLMManager } from '../llm/manager';

export interface WorkflowNode {
  id: string;
  type: string;
  title: string;
  config: Record<string, any>;
  upstreamId?: string;
  downstreamId?: string;
}

export interface WorkflowDefinition {
  title: string;
  triggerType: string;
  triggerConfig: Record<string, any>;
  nodes: WorkflowNode[];
}

export interface GeneratedWorkflow extends WorkflowDefinition {
  description?: string;
}

// ---- Zod schema for structured output ----

const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  config: z.record(z.any()).default({}),
  upstreamId: z.string().optional(),
  downstreamId: z.string().optional(),
});

const WorkflowDefinitionSchema = z.object({
  title: z.string(),
  triggerType: z.enum(['manual', 'collection', 'schedule']),
  triggerConfig: z.record(z.any()).default({}),
  nodes: z.array(WorkflowNodeSchema),
});

const SYSTEM_PROMPT = `You are an expert workflow automation designer for Formai.
Generate workflow definitions from natural language descriptions.

Available trigger types:
- manual: Triggered manually via API call
- collection: Triggered on collection CRUD events (afterCreate, afterUpdate, afterDestroy)
- schedule: Triggered on a cron/interval schedule

Available node types:
- condition: Conditional branch. config: { expression?, field?, operator?, value?, trueBranch?, falseBranch? }
- query: Query records. config: { collection, filter?, fields?, limit? }
- create: Create a record. config: { collection, values }
- update: Update records. config: { collection, filter, values }
- destroy: Delete records. config: { collection, filter }
- calculation: Evaluate expression. config: { expression, resultKey? }
- http-request: Call external API. config: { url, method?, headers?, body? }
- external-data-sync: Synchronize external data twin graph into internal collection. config: { sourceId, syncStrategy, targetCollection, transformRules: Array<{ sourceField, targetField, type? }> }
- decision-simulation: Agentic decision & scenario simulator. config: { goal, collections: string[], targetMetric?, options? }
- manual: Pause for human approval. config: { assignees?, title?, description? }
- loop: Iterate array. config: { target, itemVar? }
- parallel: Run branches in parallel. config: { branches: string[][] }

Node connection: first node has no upstreamId, each node connects via upstreamId/downstreamId.
Node IDs should be short strings like n1, n2, n3.`;

export class A2FlowEngine {
  constructor(private llm: LLMManager) {}

  /**
   * Generate a workflow definition from a natural language prompt.
   */
  async generateWorkflow(
    prompt: string,
    context?: { collections?: any[]; existingCollections?: any[] },
  ): Promise<GeneratedWorkflow> {
    const collections = context?.collections ?? context?.existingCollections ?? [];
    let userPrompt = `Generate a workflow for:\n\n${prompt}`;
    if (collections.length > 0) {
      userPrompt += `\n\nAvailable database collections for relations and CRUD actions:`;
      for (const col of collections) {
        if (typeof col === 'string') {
          userPrompt += `\n- name: ${col}`;
        } else {
          userPrompt += `\n- name: ${col.name} (${col.title || ''})`;
          if (col.fields && col.fields.length > 0) {
            userPrompt += `\n  fields:`;
            for (const f of col.fields) {
              userPrompt += `\n    - ${f.name} (${f.title || ''}): ${f.type || 'string'}`;
            }
          }
        }
      }
    }
    userPrompt += '\n\nRespond with ONLY the JSON object.';

    const result = await this.llm.generate(WorkflowDefinitionSchema, userPrompt, {
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.2,
    });

    return result as GeneratedWorkflow;
  }

}
