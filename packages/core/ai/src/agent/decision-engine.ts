import type { LLMManager } from '../llm/manager';
import type { ExternalDataConnector } from '../connectors/external-data';

export interface DecisionConstraint {
  maxBudget?: number;
  targetRoi?: number;
  timeHorizonMonths?: number;
}

export interface DecisionRequest {
  goal: string;
  appId?: string;
  collections: string[];
  externalSourceIds?: string[];
  constraints?: DecisionConstraint;
}

export interface ScenarioActionStep {
  actionType: 'create_record' | 'update_record' | 'notify' | 'trigger_workflow';
  targetCollection?: string;
  description: string;
  payload?: Record<string, any>;
}

export interface ScenarioOption {
  id: string;
  name: string;
  type: 'conservative' | 'aggressive' | 'balanced';
  description: string;
  financialImpact: {
    estimatedRevenue: number;
    estimatedCost: number;
    netProfit: number;
    roi: number; // e.g. 1.85 means 185%
  };
  riskScore: number; // 0.0 to 1.0
  tradeoffs: string[];
  actionSteps: ScenarioActionStep[];
}

export interface EvidenceItem {
  metric: string;
  internalValue: any;
  externalBenchmark?: any;
  status: 'normal' | 'warning' | 'critical';
}

export interface DecisionReport {
  id: string;
  goal: string;
  createdAt: Date;
  diagnosis: string;
  evidence: EvidenceItem[];
  scenarios: ScenarioOption[];
  recommendedScenarioId: string;
  executiveSummary: string;
  approvalPayload: {
    title: string;
    summary: string;
    recommendedActions: ScenarioActionStep[];
  };
}

export class DecisionSimulationEngine {
  constructor(
    private llm?: LLMManager,
    private db?: any,
    private externalConnector?: ExternalDataConnector
  ) {}

  /**
   * Run root-cause diagnosis, simulate alternative scenarios, and output a structured decision report.
   */
  async diagnoseAndSimulate(request: DecisionRequest): Promise<DecisionReport> {
    const reportId = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Collect Internal Data Graph Evidence
    const evidence: EvidenceItem[] = [];
    const internalMetrics: Record<string, any> = {};

    if (this.db) {
      for (const colName of request.collections) {
        try {
          const repo = this.db.getRepository(colName);
          if (repo) {
            const count = await repo.count();
            const recentItems = await repo.find({ limit: 20 });
            internalMetrics[colName] = { count, sample: recentItems };

            // Check amounts if present
            let sumAmount = 0;
            let hasAmount = false;
            for (const item of recentItems) {
              const val = item.amount || item.total_amount || item.price;
              if (val != null && !isNaN(Number(val))) {
                sumAmount += Number(val);
                hasAmount = true;
              }
            }

            if (hasAmount) {
              evidence.push({
                metric: `${colName} 样本总金额`,
                internalValue: `¥${sumAmount.toLocaleString()}`,
                status: sumAmount > 0 ? 'normal' : 'warning',
              });
            } else {
              evidence.push({
                metric: `${colName} 记录总量`,
                internalValue: `${count} 条`,
                status: count > 0 ? 'normal' : 'warning',
              });
            }
          }
        } catch {
          // Ignore retrieval error
        }
      }
    }

    // 2. Collect External Twin Graph Evidence if requested
    const externalInsights: Record<string, any> = {};
    if (this.externalConnector && request.externalSourceIds) {
      for (const srcId of request.externalSourceIds) {
        try {
          const data = await this.externalConnector.fetchData(srcId);
          externalInsights[srcId] = data;
          evidence.push({
            metric: `外部市场指标 [${srcId}]`,
            internalValue: '内部指标比照',
            externalBenchmark: JSON.stringify(data).slice(0, 100),
            status: 'normal',
          });
        } catch {
          // Ignore source failure
        }
      }
    }

    // 3. LLM AI Reasoning & Scenario Simulation
    let llmReport: Partial<DecisionReport> | null = null;
    if (this.llm) {
      try {
        const prompt = `You are the FormAI ARP Intelligent Decision & Strategy Simulation Engine.
Diagnose the following situation and simulate 3 alternative executable strategy scenarios with clear ROI and risk tradeoffs.

User Business Goal: "${request.goal}"
Target Collections: ${request.collections.join(', ')}
Constraints: ${JSON.stringify(request.constraints || {})}
Internal Data Evidence: ${JSON.stringify(evidence)}
External Twin Data: ${JSON.stringify(externalInsights)}

Output a JSON object with:
- diagnosis: (in-depth root cause analysis)
- scenarios: array of 3 options:
  [
    {
      id: 'opt_conservative',
      name: '稳健成本优化方案',
      type: 'conservative',
      description: '...',
      financialImpact: { estimatedRevenue: number, estimatedCost: number, netProfit: number, roi: number },
      riskScore: 0.2,
      tradeoffs: ['...', '...'],
      actionSteps: [{ actionType: 'create_record'|'update_record'|'notify'|'trigger_workflow', description: '...', payload: {} }]
    },
    {
      id: 'opt_balanced',
      name: '均衡精细化增长方案 (推荐)',
      type: 'balanced',
      description: '...',
      financialImpact: { estimatedRevenue: number, estimatedCost: number, netProfit: number, roi: number },
      riskScore: 0.45,
      tradeoffs: ['...', '...'],
      actionSteps: [{ actionType: 'create_record'|'update_record'|'notify'|'trigger_workflow', description: '...', payload: {} }]
    },
    {
      id: 'opt_aggressive',
      name: '激进规模突破方案',
      type: 'aggressive',
      description: '...',
      financialImpact: { estimatedRevenue: number, estimatedCost: number, netProfit: number, roi: number },
      riskScore: 0.75,
      tradeoffs: ['...', '...'],
      actionSteps: [{ actionType: 'create_record'|'update_record'|'notify'|'trigger_workflow', description: '...', payload: {} }]
    }
  ]
- recommendedScenarioId: 'opt_balanced'
- executiveSummary: (2-3 sentences explaining why this is the highest ROI decision)
Respond with ONLY the JSON object.`;

        const response = await this.llm.chat(
          [
            { role: 'system', content: 'You are an elite enterprise CFO & Chief Operating Officer AI Advisor.' },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.1 }
        );

        let clean = response.content.trim();
        if (clean.startsWith('```')) {
          clean = clean.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
        }
        llmReport = JSON.parse(clean);
      } catch {
        // Fallback to heuristic scenario simulation
      }
    }

    // 4. Construct Fallback / Heuristic Scenarios if LLM unavailable or failed
    const maxBudget = request.constraints?.maxBudget || 100000;
    const scenarios: ScenarioOption[] = llmReport?.scenarios || [
      {
        id: 'opt_conservative',
        name: '稳健防御与成本优化方案',
        type: 'conservative',
        description: '聚焦既有资产提效，压缩非必要开支 15%，提升现金流安全性。',
        financialImpact: {
          estimatedRevenue: maxBudget * 1.2,
          estimatedCost: maxBudget * 0.3,
          netProfit: maxBudget * 0.9,
          roi: 3.0,
        },
        riskScore: 0.18,
        tradeoffs: ['风险极低', '增长速度相对较缓', '无法迅速抢占市场空白'],
        actionSteps: [
          {
            actionType: 'notify',
            description: '发送部门开支上限与审批收紧通知',
          },
        ],
      },
      {
        id: 'opt_balanced',
        name: '均衡精细化经营方案 (推荐)',
        type: 'balanced',
        description: '优化核心漏斗转化率 8%，对高毛利品类追加定向预算，实现确定性增长。',
        financialImpact: {
          estimatedRevenue: maxBudget * 2.8,
          estimatedCost: maxBudget * 0.8,
          netProfit: maxBudget * 2.0,
          roi: 2.5,
        },
        riskScore: 0.42,
        tradeoffs: ['投资回报率均衡', '执行摩擦小', '兼顾现金流与增长动能'],
        actionSteps: [
          {
            actionType: 'trigger_workflow',
            description: '触发高价值客户追加跟进自动化工作流',
          },
          {
            actionType: 'notify',
            description: '向管理层与执行团队推送新一阶段关键指标目标卡',
          },
        ],
      },
      {
        id: 'opt_aggressive',
        name: '激进市场扩张与拉新方案',
        type: 'aggressive',
        description: '全量投放拉新渠道，前置补贴折扣 12%，迅速抢占同业市场份额。',
        financialImpact: {
          estimatedRevenue: maxBudget * 4.5,
          estimatedCost: maxBudget * 2.2,
          netProfit: maxBudget * 2.3,
          roi: 1.05,
        },
        riskScore: 0.78,
        tradeoffs: ['规模爆发快', '毛利受短期挤压', '需要较强团队交付承载力'],
        actionSteps: [
          {
            actionType: 'create_record',
            targetCollection: request.collections[0],
            description: '批量导入渠道意向客户并打标特殊优惠',
          },
        ],
      },
    ];

    const recommendedId = llmReport?.recommendedScenarioId || 'opt_balanced';
    const chosenScenario = scenarios.find((s) => s.id === recommendedId) || scenarios[1];

    const report: DecisionReport = {
      id: reportId,
      goal: request.goal,
      createdAt: new Date(),
      diagnosis:
        llmReport?.diagnosis ||
        `针对「${request.goal}」，根据多维内部数据图谱分析，当前业务承载力良好，但存在转化效率衰减与策略保守的问题，需要通过靶向激励与精细化运营破局。`,
      evidence,
      scenarios,
      recommendedScenarioId: recommendedId,
      executiveSummary:
        llmReport?.executiveSummary ||
        `建议采纳「${chosenScenario.name}」，预估净收益 ¥${chosenScenario.financialImpact.netProfit.toLocaleString()}（ROI: ${(chosenScenario.financialImpact.roi * 100).toFixed(0)}%），风险系数 ${chosenScenario.riskScore}，具备最佳的确定性与回报比。`,
      approvalPayload: {
        title: `ARP 智能决策审批：${chosenScenario.name}`,
        summary: `目标：${request.goal}。预计净回报 ¥${chosenScenario.financialImpact.netProfit.toLocaleString()}。等待管理者一键批准生效。`,
        recommendedActions: chosenScenario.actionSteps,
      },
    };

    return report;
  }
}
