export interface AgentQuota {
  maxConcurrentAgents: number;
  maxMonthlyTokens: number;
  maxProactiveAgentCount: number;
}

export interface DataIsolationRule {
  allowedCollections?: string[]; // If specified, agent can only query these collections
  deniedFields?: string[]; // PII fields to mask, e.g. ['password', 'id_card', 'salary', 'secret']
  readOnlyCollections?: string[];
}

export interface AuditPolicy {
  logAllToolCalls: boolean;
  requireApprovalFor: string[]; // e.g. ['delete', 'bulk_update', 'create_payment']
  retentionDays: number;
}

export interface TenantAgentGovernanceConfig {
  tenantId: string;
  agentQuota: AgentQuota;
  dataIsolation: DataIsolationRule;
  auditPolicy: AuditPolicy;
}

export interface AgentActivityLog {
  id: string;
  tenantId: string;
  agentId: string;
  action: string;
  targetCollection?: string;
  status: 'allowed' | 'blocked' | 'requires_approval';
  reason?: string;
  timestamp: Date;
}

export class TenantAgentGovernanceManager {
  private policies: Map<string, TenantAgentGovernanceConfig> = new Map();
  private usageStats: Map<string, { currentConcurrent: number; tokensUsed: number; proactiveAgents: number }> =
    new Map();
  private auditLogs: AgentActivityLog[] = [];

  constructor() {
    this.setDefaultPolicy();
  }

  private setDefaultPolicy(): void {
    this.setTenantPolicy({
      tenantId: 'default',
      agentQuota: {
        maxConcurrentAgents: 10,
        maxMonthlyTokens: 5_000_000,
        maxProactiveAgentCount: 5,
      },
      dataIsolation: {
        deniedFields: ['password', 'secret', 'id_card', 'token', 'apiKey', 'salary'],
      },
      auditPolicy: {
        logAllToolCalls: true,
        requireApprovalFor: ['delete', 'destroy', 'transfer_money', 'publish_contract'],
        retentionDays: 90,
      },
    });
  }

  setTenantPolicy(config: TenantAgentGovernanceConfig): void {
    this.policies.set(config.tenantId, config);
    if (!this.usageStats.has(config.tenantId)) {
      this.usageStats.set(config.tenantId, { currentConcurrent: 0, tokensUsed: 0, proactiveAgents: 0 });
    }
  }

  getTenantPolicy(tenantId: string): TenantAgentGovernanceConfig {
    return this.policies.get(tenantId) || this.policies.get('default')!;
  }

  /**
   * Validates if a tenant is within its agent execution quota limits.
   */
  checkQuota(
    tenantId: string,
    req: { concurrentCount?: number; tokens?: number; proactiveCount?: number }
  ): { allowed: boolean; reason?: string } {
    const policy = this.getTenantPolicy(tenantId);
    const usage = this.usageStats.get(tenantId) || { currentConcurrent: 0, tokensUsed: 0, proactiveAgents: 0 };

    if (req.concurrentCount && usage.currentConcurrent + req.concurrentCount > policy.agentQuota.maxConcurrentAgents) {
      return {
        allowed: false,
        reason: `Exceeded max concurrent agents quota (${policy.agentQuota.maxConcurrentAgents}).`,
      };
    }

    if (req.tokens && usage.tokensUsed + req.tokens > policy.agentQuota.maxMonthlyTokens) {
      return {
        allowed: false,
        reason: `Exceeded monthly token quota (${policy.agentQuota.maxMonthlyTokens.toLocaleString()}).`,
      };
    }

    if (req.proactiveCount && usage.proactiveAgents + req.proactiveCount > policy.agentQuota.maxProactiveAgentCount) {
      return {
        allowed: false,
        reason: `Exceeded max proactive agents limit (${policy.agentQuota.maxProactiveAgentCount}).`,
      };
    }

    return { allowed: true };
  }

  recordTokenUsage(tenantId: string, tokens: number): void {
    const usage = this.usageStats.get(tenantId) || { currentConcurrent: 0, tokensUsed: 0, proactiveAgents: 0 };
    usage.tokensUsed += tokens;
    this.usageStats.set(tenantId, usage);
  }

  /**
   * Sanitizes and masks sensitive PII fields before feeding records into Agent prompts or tools.
   */
  maskPiiData(tenantId: string, collectionName: string, records: any[]): any[] {
    const policy = this.getTenantPolicy(tenantId);
    const denied = new Set(
      (policy.dataIsolation.deniedFields || []).map((f) => f.toLowerCase())
    );

    return records.map((record) => {
      if (!record || typeof record !== 'object') return record;
      const masked: Record<string, any> = { ...record };

      for (const [key, value] of Object.entries(record)) {
        const keyLower = key.toLowerCase();
        if (denied.has(keyLower) || keyLower.includes('password') || keyLower.includes('secret')) {
          masked[key] = '****** [PII MASKED]';
        }
      }

      return masked;
    });
  }

  /**
   * Validates if an agent operation is permitted or requires explicit executive approval.
   */
  validateAgentAction(
    tenantId: string,
    action: { actionType: string; collection?: string; agentId: string }
  ): { allowed: boolean; requiresApproval: boolean; reason?: string } {
    const policy = this.getTenantPolicy(tenantId);

    // 1. Data Isolation check
    if (policy.dataIsolation.allowedCollections && action.collection) {
      const allowed = policy.dataIsolation.allowedCollections.includes(action.collection);
      if (!allowed) {
        this.logAudit({
          tenantId,
          agentId: action.agentId,
          action: action.actionType,
          targetCollection: action.collection,
          status: 'blocked',
          reason: `Access to collection "${action.collection}" is not in tenant allowed list.`,
        });
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Collection "${action.collection}" is not accessible under tenant policy.`,
        };
      }
    }

    // Read-only collection check
    if (
      policy.dataIsolation.readOnlyCollections &&
      action.collection &&
      policy.dataIsolation.readOnlyCollections.includes(action.collection) &&
      (action.actionType.includes('create') || action.actionType.includes('update') || action.actionType.includes('delete'))
    ) {
      this.logAudit({
        tenantId,
        agentId: action.agentId,
        action: action.actionType,
        targetCollection: action.collection,
        status: 'blocked',
        reason: `Collection "${action.collection}" is marked read-only.`,
      });
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Collection "${action.collection}" is read-only.`,
      };
    }

    // 2. Approval check
    const needApproval = policy.auditPolicy.requireApprovalFor.some((keyword) =>
      action.actionType.toLowerCase().includes(keyword.toLowerCase())
    );

    this.logAudit({
      tenantId,
      agentId: action.agentId,
      action: action.actionType,
      targetCollection: action.collection,
      status: needApproval ? 'requires_approval' : 'allowed',
      reason: needApproval ? 'Action requires supervisor approval according to audit policy.' : undefined,
    });

    return {
      allowed: true,
      requiresApproval: needApproval,
      reason: needApproval ? 'Requires executive approval before execution.' : undefined,
    };
  }

  private logAudit(entry: Omit<AgentActivityLog, 'id' | 'timestamp'>): void {
    const log: AgentActivityLog = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      ...entry,
    };
    this.auditLogs.push(log);
  }

  getAuditLogs(tenantId?: string): AgentActivityLog[] {
    if (tenantId) {
      return this.auditLogs.filter((l) => l.tenantId === tenantId);
    }
    return [...this.auditLogs];
  }
}
