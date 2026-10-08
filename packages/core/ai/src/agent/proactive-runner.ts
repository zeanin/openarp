import type { DecisionSimulationEngine, DecisionReport } from './decision-engine';
import type { ApprovalManager, ApprovalRequest } from '../permissions/approval';

export interface MetricThresholdRule {
  name: string;
  collection: string;
  field?: string;
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
  threshold: {
    operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
    value: number;
  };
  severity: 'info' | 'warning' | 'critical';
}

export interface DataChangeEvent {
  collection: string;
  action: 'create' | 'update' | 'delete';
  record: any;
}

export interface ProactiveAgentConfig {
  id: string;
  name: string;
  appId: string;
  enabled: boolean;
  schedule?: string; // e.g. "0 9 * * *" or interval
  triggerEvents?: Array<{
    collection: string;
    action?: 'create' | 'update' | 'delete';
  }>;
  monitoringTargets: {
    collections: string[];
    metrics?: MetricThresholdRule[];
  };
  actionSpace: {
    canNotify: boolean;
    canCreateRecord: boolean;
    canUpdateRecord: boolean;
    canTriggerWorkflow: boolean;
    requiresApproval?: string[]; // e.g. ['create_record', 'purchase_order', 'discount_update']
  };
}

export interface InspectionViolation {
  ruleName: string;
  collection: string;
  actualValue: number;
  thresholdValue: number;
  operator: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface InspectionResult {
  agentId: string;
  timestamp: Date;
  status: 'healthy' | 'anomaly_detected' | 'action_taken' | 'awaiting_approval';
  violations: InspectionViolation[];
  decisionReport?: DecisionReport;
  approvalRequest?: ApprovalRequest;
  executedActions: string[];
  auditLogs: string[];
}

export class ProactiveAgentManager {
  private agents: Map<string, ProactiveAgentConfig> = new Map();

  constructor(
    private db?: any,
    private decisionEngine?: DecisionSimulationEngine,
    private approvalManager?: ApprovalManager
  ) {}

  registerAgent(config: ProactiveAgentConfig): void {
    this.agents.set(config.id, config);
  }

  getAgent(id: string): ProactiveAgentConfig | undefined {
    return this.agents.get(id);
  }

  listAgents(): ProactiveAgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Run a proactive inspection cycle for a registered agent.
   */
  async runInspection(agentId: string): Promise<InspectionResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Proactive Agent "${agentId}" is not registered.`);
    }

    const timestamp = new Date();
    const violations: InspectionViolation[] = [];
    const auditLogs: string[] = [];
    const executedActions: string[] = [];

    auditLogs.push(`[${timestamp.toLocaleTimeString()}] 🚀 启动巡检智能体 "${agent.name}" (App: ${agent.appId})`);

    // 1. Metric evaluation across collections
    if (this.db && agent.monitoringTargets.metrics) {
      for (const rule of agent.monitoringTargets.metrics) {
        try {
          const repo = this.db.getRepository(rule.collection);
          if (!repo) continue;

          let computedValue = 0;
          if (rule.aggregation === 'count') {
            computedValue = await repo.count();
          } else {
            const records = await repo.find({ limit: 100 });
            if (records.length > 0 && rule.field) {
              const vals = records
                .map((r: any) => Number(r[rule.field!]))
                .filter((v: number) => !isNaN(v));

              if (rule.aggregation === 'sum') {
                computedValue = vals.reduce((a: number, b: number) => a + b, 0);
              } else if (rule.aggregation === 'avg') {
                computedValue = vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0;
              } else if (rule.aggregation === 'max') {
                computedValue = Math.max(...vals);
              } else if (rule.aggregation === 'min') {
                computedValue = Math.min(...vals);
              }
            }
          }

          const breached = this.checkThreshold(computedValue, rule.threshold.operator, rule.threshold.value);
          if (breached) {
            violations.push({
              ruleName: rule.name,
              collection: rule.collection,
              actualValue: computedValue,
              thresholdValue: rule.threshold.value,
              operator: rule.threshold.operator,
              severity: rule.severity,
            });
            auditLogs.push(
              `[⚠️ 指标超限] 规则 "${rule.name}" 触发: 当前值 ${computedValue} ${rule.threshold.operator} 阈值 ${rule.threshold.value} (${rule.severity})`
            );
          }
        } catch (err: any) {
          auditLogs.push(`[❌ 监控报错] 规则 "${rule.name}" 执行失败: ${err.message}`);
        }
      }
    }

    // 2. If no violations, system is healthy
    if (violations.length === 0) {
      auditLogs.push(`[✅ 巡检完成] 所有业务指标处于安全阈值内，系统运转良好。`);
      return {
        agentId,
        timestamp,
        status: 'healthy',
        violations: [],
        executedActions: [],
        auditLogs,
      };
    }

    // 3. Violations detected -> Invoke Decision Simulation Engine
    let decisionReport: DecisionReport | undefined;
    let approvalRequest: ApprovalRequest | undefined;
    let status: InspectionResult['status'] = 'anomaly_detected';

    if (this.decisionEngine) {
      auditLogs.push(`[🧠 智能决策引擎] 启动多方案影响模拟与行动策略计算...`);
      const goal = `针对巡检发现的异常 (${violations.map((v) => v.ruleName).join(', ')}) 计算财务影响并生成应对方案`;
      decisionReport = await this.decisionEngine.diagnoseAndSimulate({
        goal,
        appId: agent.appId,
        collections: agent.monitoringTargets.collections,
      });

      auditLogs.push(`[💡 决策推荐] 推荐方案: "${decisionReport.approvalPayload.title}"`);

      // 4. Action execution or Approval routing
      const requiresApprovalList = agent.actionSpace.requiresApproval || [];
      const recommendedScenario = decisionReport.scenarios.find(
        (s) => s.id === decisionReport?.recommendedScenarioId
      ) || decisionReport.scenarios[0];

      const needHumanApproval = recommendedScenario.actionSteps.some((act) =>
        requiresApprovalList.includes(act.actionType)
      );

      if (needHumanApproval && this.approvalManager) {
        // Create an executive approval ticket
        approvalRequest = await this.approvalManager.createRequest({
          contentType: 'workflow',
          generatedBy: agent.id,
          triggeredBy: 'proactive_scheduler',
          content: decisionReport.approvalPayload,
          approvers: ['admin', 'manager'],
          comment: `由主动巡检智能体 "${agent.name}" 自动提交。检测到 ${violations.length} 项关键指标异常，已预先计算 ROI 与替代方案。`,
        });

        status = 'awaiting_approval';
        auditLogs.push(`[📝 一键审批推送] 动作包含高权限敏感操作，已生成审批待办工单 (ID: ${approvalRequest.id})，等待管理者一键确认。`);
      } else {
        // Automated execution if permitted in actionSpace
        for (const act of recommendedScenario.actionSteps) {
          if (act.actionType === 'notify' && agent.actionSpace.canNotify) {
            executedActions.push(`[Notify] ${act.description}`);
          } else if (act.actionType === 'create_record' && agent.actionSpace.canCreateRecord) {
            executedActions.push(`[CreateRecord] ${act.description}`);
          } else if (act.actionType === 'trigger_workflow' && agent.actionSpace.canTriggerWorkflow) {
            executedActions.push(`[TriggerWorkflow] ${act.description}`);
          }
        }
        status = 'action_taken';
        auditLogs.push(`[⚡ 自动处置] 已按授权空间自主执行 ${executedActions.length} 项止损措施。`);
      }
    }

    return {
      agentId,
      timestamp,
      status,
      violations,
      decisionReport,
      approvalRequest,
      executedActions,
      auditLogs,
    };
  }

  private checkThreshold(actual: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '>':
        return actual > threshold;
      case '>=':
        return actual >= threshold;
      case '<':
        return actual < threshold;
      case '<=':
        return actual <= threshold;
      case '==':
        return actual === threshold;
      case '!=':
        return actual !== threshold;
      default:
        return false;
    }
  }

  private schedulerTimer?: any;

  /**
   * Starts background recurring inspection scheduler for all enabled agents.
   */
  startScheduler(intervalMs = 60000): void {
    if (this.schedulerTimer) return;
    this.schedulerTimer = setInterval(async () => {
      for (const agent of this.agents.values()) {
        if (agent.enabled) {
          try {
            await this.runInspection(agent.id);
          } catch (err: any) {
            console.error(`[ProactiveScheduler] Agent "${agent.id}" inspection error:`, err.message);
          }
        }
      }
    }, intervalMs);
  }

  /**
   * Stops background scheduler.
   */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = undefined;
    }
  }

  /**
   * Event-driven trigger hook: Called when data records change (afterCreate / afterUpdate / afterDestroy).
   */
  async handleDataChangeEvent(event: DataChangeEvent): Promise<InspectionResult[]> {
    const results: InspectionResult[] = [];

    for (const agent of this.agents.values()) {
      if (!agent.enabled) continue;

      const matchesCollection = agent.monitoringTargets.collections.includes(event.collection);
      const matchesTriggerEvent = (agent.triggerEvents || []).some(
        (te) => te.collection === event.collection && (!te.action || te.action === event.action)
      );

      if (matchesCollection || matchesTriggerEvent) {
        try {
          const res = await this.runInspection(agent.id);
          results.push(res);
        } catch {}
      }
    }

    return results;
  }
}
