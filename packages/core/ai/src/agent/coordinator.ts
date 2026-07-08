import { LLMManager } from '../llm/manager';
import { A2DataEngine } from '../a2data/engine';
import { A2UIEngine } from '../a2ui/engine';
import { A2FlowEngine } from '../a2flow/engine';
import { A2MenuEngine } from '../a2menu/engine';
import { CritiqueEvaluator } from './evaluator';

export interface CoordinatorContext {
  db?: any;
  sessionId: string;
  parentId?: string;
}

export class MultiAgentCoordinator {
  private evaluator: CritiqueEvaluator;

  constructor(
    private llm: LLMManager,
    private a2data: A2DataEngine,
    private a2ui: A2UIEngine,
    private a2flow: A2FlowEngine,
    private a2menu: A2MenuEngine,
  ) {
    this.evaluator = new CritiqueEvaluator(llm);
  }

  /**
   * Main coordinate execution loop:
   * 1. Prompt LLM to analyze the initial request and break it down into specialized prompt tasks.
   * 2. Spin up sub-agents (DataAgent, UIAgent, FlowAgent, MenuAgent) to solve individual parts.
   * 3. Track steps by creating parent/child logs in the agent_traces table.
   */
  async coordinate(
    initialPrompt: string,
    model: string,
    provider: string,
    context: CoordinatorContext,
  ): Promise<any> {
    const { db, sessionId, parentId } = context;

    // 1. Create Orchestration Trace Log
    const orchTrace = await this.createTrace(db, sessionId, {
      parentId,
      agentName: 'Orchestrator',
      stepType: 'thought',
      title: 'Analyze and plan application structure',
      input: { initialPrompt },
    });

    const startTime = Date.now();

    try {
      const breakdownPrompt = `Break down the user request for a new application.
Request: "${initialPrompt}"

We need to generate:
1. Data collections (schemas, relations)
2. UI layout pages
3. Automated workflows
4. Menu structures

Please return a valid JSON object structure like:
{
  "collections": ["Prompt to generate collection 1", "Prompt to generate collection 2"],
  "pages": ["Prompt to generate page 1"],
  "workflows": ["Prompt to generate workflow 1"],
  "menus": "Prompt to generate menus"
}
Return ONLY valid JSON. Do not include markdown code block syntax (like \`\`\`json) in your final response.`;

      const response = await this.llm.chat(
        [
          {
            role: 'system',
            content:
              'You are an expert software PM and architect. Break down requirements into JSON format. Do not include markdown code block syntax (like ```json) in your final response.',
          },
          { role: 'user', content: breakdownPrompt },
        ],
        { model, provider, temperature: 0.1 },
      );

      let cleanedContent = response.content.trim();
      if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
      }

      const plan = JSON.parse(cleanedContent);
      await this.updateTrace(db, orchTrace.id, {
        output: plan,
        durationMs: Date.now() - startTime,
        status: 'success',
      });

      const results: any = {
        collections: [],
        pages: [],
        workflows: [],
        menus: null,
      };

      // 3. Delegate work to sub-agents
      // A. Generate database collections
      if (plan.collections && plan.collections.length > 0) {
        for (let i = 0; i < plan.collections.length; i++) {
          const colPrompt = plan.collections[i];
          const dataTrace = await this.createTrace(db, sessionId, {
            parentId: orchTrace.id,
            agentName: 'DataAgent',
            stepType: 'sub_agent_call',
            title: `Generate database collection: ${colPrompt.substring(0, 30)}...`,
            input: { prompt: colPrompt },
          });
          const colStart = Date.now();
          try {
            const collection = await this.a2data.generateCollection(colPrompt);
            results.collections.push(collection);
            await this.updateTrace(db, dataTrace.id, {
              output: collection,
              durationMs: Date.now() - colStart,
              status: 'success',
            });
          } catch (err: any) {
            await this.updateTrace(db, dataTrace.id, {
              durationMs: Date.now() - colStart,
              status: 'failed',
              errorMessage: err.message,
            });
            throw err;
          }
        }
      }

      // B. Generate UI Pages
      if (plan.pages && plan.pages.length > 0) {
        for (let i = 0; i < plan.pages.length; i++) {
          const pagePrompt = plan.pages[i];
          const uiTrace = await this.createTrace(db, sessionId, {
            parentId: orchTrace.id,
            agentName: 'UIAgent',
            stepType: 'sub_agent_call',
            title: `Generate page schema: ${pagePrompt.substring(0, 30)}...`,
            input: { prompt: pagePrompt },
          });
          const uiStart = Date.now();
          try {
            // Smart matching of collection based on page prompt
            let matchedColName = results.collections[0]?.name || 'items';
            let matchedColFields: string[] = [];
            for (const col of results.collections) {
              const colNameOnly = col.name.replace(/^(app|tb)_/, '').toLowerCase();
              const normalizedPrompt = pagePrompt.toLowerCase();
              const singularColName = colNameOnly.endsWith('s') ? colNameOnly.slice(0, -1) : colNameOnly;
              if (
                normalizedPrompt.includes(colNameOnly) ||
                normalizedPrompt.includes(singularColName) ||
                (col.title && normalizedPrompt.includes(col.title.toLowerCase()))
              ) {
                matchedColName = col.name;
                matchedColFields = col.fields.map((f: any) => f.name);
                break;
              }
            }
            if (matchedColFields.length === 0 && results.collections.length > 0) {
              const defaultCol = results.collections.find((c: any) => c.name === matchedColName) || results.collections[0];
              matchedColFields = defaultCol?.fields?.map((f: any) => f.name) || [];
            }

            let schema = await this.a2ui.generatePage({
              prompt: pagePrompt,
              collection: matchedColName,
              fields: matchedColFields,
              mode: 'create',
              context: {
                collections: results.collections.map((c: any) => c.name),
                existingPages: results.pages.map((p: any) => p.title),
              },
            });

            // Perform self-healing check
            schema = await this.evaluator.evaluateAndHealSchema(
              schema,
              pagePrompt,
              model,
              provider,
            );

            results.pages.push(schema);
            await this.updateTrace(db, uiTrace.id, {
              output: schema,
              durationMs: Date.now() - uiStart,
              status: 'success',
            });
          } catch (err: any) {
            await this.updateTrace(db, uiTrace.id, {
              durationMs: Date.now() - uiStart,
              status: 'failed',
              errorMessage: err.message,
            });
            throw err;
          }
        }
      }

      // C. Generate Workflows
      if (plan.workflows && plan.workflows.length > 0) {
        for (let i = 0; i < plan.workflows.length; i++) {
          const flowPrompt = plan.workflows[i];
          const flowTrace = await this.createTrace(db, sessionId, {
            parentId: orchTrace.id,
            agentName: 'FlowAgent',
            stepType: 'sub_agent_call',
            title: `Generate workflow nodes: ${flowPrompt.substring(0, 30)}...`,
            input: { prompt: flowPrompt },
          });
          const flowStart = Date.now();
          try {
            const workflow = await this.a2flow.generateWorkflow(flowPrompt);
            results.workflows.push(workflow);
            await this.updateTrace(db, flowTrace.id, {
              output: workflow,
              durationMs: Date.now() - flowStart,
              status: 'success',
            });
          } catch (err: any) {
            await this.updateTrace(db, flowTrace.id, {
              durationMs: Date.now() - flowStart,
              status: 'failed',
              errorMessage: err.message,
            });
            throw err;
          }
        }
      }

      // D. Generate Menus
      if (plan.menus) {
        const menuTrace = await this.createTrace(db, sessionId, {
          parentId: orchTrace.id,
          agentName: 'MenuAgent',
          stepType: 'sub_agent_call',
          title: 'Generate menus layout mapping',
          input: { prompt: plan.menus },
        });
        const menuStart = Date.now();
        try {
          const menus = await this.a2menu.generateMenus(plan.menus);
          results.menus = menus;
          await this.updateTrace(db, menuTrace.id, {
            output: menus,
            durationMs: Date.now() - menuStart,
            status: 'success',
          });
        } catch (err: any) {
          await this.updateTrace(db, menuTrace.id, {
            durationMs: Date.now() - menuStart,
            status: 'failed',
            errorMessage: err.message,
          });
          throw err;
        }
      }

      return results;
    } catch (err: any) {
      await this.updateTrace(db, orchTrace.id, {
        durationMs: Date.now() - startTime,
        status: 'failed',
        errorMessage: err.message,
      });
      throw err;
    }
  }

  private async createTrace(db: any, sessionId: string, values: any): Promise<any> {
    if (!db) return { id: 'mock-trace-id' };
    const traceRepo = db.getRepository('agentTraces');
    if (!traceRepo) return { id: 'mock-trace-id' };
    return await traceRepo.create({
      values: {
        sessionId,
        ...values,
      },
    });
  }

  private async updateTrace(db: any, traceId: string, values: any): Promise<void> {
    if (!db || traceId === 'mock-trace-id') return;
    const traceRepo = db.getRepository('agentTraces');
    if (!traceRepo) return;
    await traceRepo.update({
      filterByTk: traceId,
      values,
    });
  }
}
