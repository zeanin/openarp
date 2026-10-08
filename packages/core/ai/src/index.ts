// LLM
export { LLMManager } from './llm/manager';
export { BaseLLMProvider } from './llm/provider';
export type { LLMProvider } from './llm/provider';
export { OpenAIProvider } from './llm/providers/openai';
export type { OpenAIConfig } from './llm/providers/openai';
export { AnthropicProvider } from './llm/providers/anthropic';
export type { AnthropicConfig } from './llm/providers/anthropic';
export { QwenProvider } from './llm/providers/qwen';
export { MockLLMProvider } from './llm/providers/mock';
export { generateStructured, zodToJsonSchema } from './llm/structured-output';
export { FormAiLanguageModelBridge, createFormAiLanguageModelProvider } from './llm/formai-provider-bridge';
export type {
  LanguageModelV1CallOptions,
  LanguageModelV1GenerateResult,
  LanguageModelV1StreamResult,
  LanguageModelV1StreamPart,
  FormAiBridgeOptions,
} from './llm/formai-provider-bridge';

// A2Data
export { A2DataEngine } from './a2data/engine';

// A2UI
export { A2UIEngine, treeToFlat, flatToTree } from './a2ui/engine';
export type { GeneratePageOptions, GenerateBlockOptions, A2UIComponent } from './a2ui/engine';
export { validateSchema, fixSchema } from './a2ui/schema-validator';
export type { ValidationResult } from './a2ui/schema-validator';
export { ALL_EXAMPLES, CRUD_TABLE_EXAMPLE, FORM_EXAMPLE, DETAIL_EXAMPLE, DASHBOARD_EXAMPLE } from './a2ui/examples';

// A2Flow
export { A2FlowEngine } from './a2flow/engine';
export type { WorkflowDefinition, WorkflowNode } from './a2flow/engine';

// A2Menu
export { A2MenuEngine } from './a2menu/engine';
export type { MenuItemSuggestion, GeneratedMenus } from './a2menu/engine';

// Agent
export { AgentRuntime } from './agent/runtime';
export type { ExecutionContext } from './agent/runtime';
export { ToolRegistry } from './agent/tool-registry';
export type { ToolHandler } from './agent/tool-registry';
export { MultiAgentCoordinator } from './agent/coordinator';
export type { CoordinatorContext } from './agent/coordinator';
export { CritiqueEvaluator } from './agent/evaluator';

// Memory
export { VectorMemory } from './memory/vector-memory';
export type { VectorSearchResult } from './memory/vector-memory';

// Permissions
export { AIPermissionManager } from './permissions/ai-permission-manager';
export type { AIPermissionConfig, RoleAIPermission, ToolPermissionConfig } from './permissions/ai-permission-manager';
export { BuilderAIPermission } from './permissions/builder-ai';
export type { BuilderAIConfig, AuditEntry } from './permissions/builder-ai';
export { ApprovalManager } from './permissions/approval';
export type { ApprovalRequest, ApprovalStatus, ContentType } from './permissions/approval';
export { aiPermissionMiddleware } from './permissions/middleware';

// Runtime Skills
export { ResourceSkillRegistry } from './skills/resource-skill-registry';
export type { SkillExecutor, PreExecuteHook } from './skills/resource-skill-registry';
export { CollectionSkillAutoGenerator } from './skills/collection-skill-generator';
export type { CrudExecutorFactory } from './skills/collection-skill-generator';
export { SkillLogger, withLogging } from './skills/skill-logger';
export type { SkillLogEntry } from './skills/skill-logger';

// Domain Templates & Quality Baseline (ARP Phase 1)
export * from './templates';

// Proactive Runtime & Twin Graph Decision System (ARP Phase 2)
export { ExternalDataConnector } from './connectors/external-data';
export type {
  ExternalDataSource,
  TransformRule,
  SyncResult,
  SyncStrategy,
} from './connectors/external-data';
export { DecisionSimulationEngine } from './agent/decision-engine';
export type {
  DecisionRequest,
  DecisionConstraint,
  ScenarioOption,
  ScenarioActionStep,
  EvidenceItem,
  DecisionReport,
} from './agent/decision-engine';
export { ProactiveAgentManager } from './agent/proactive-runner';
export type {
  ProactiveAgentConfig,
  MetricThresholdRule,
  InspectionViolation,
  InspectionResult,
} from './agent/proactive-runner';

// Ecosystem & Platformization (ARP Phase 3)
export { BlueprintMarketplace } from './marketplace/marketplace';
export type {
  MarketplaceBlueprintPackage,
  MarketplaceFilter,
  DeploymentOptions,
  DeploymentResult,
} from './marketplace/types';
export { computeBlueprintDiff } from './compiler/blueprint-diff';
export type {
  BlueprintDiff,
  CollectionDiff,
  FieldDiff,
  PageDiff,
  WorkflowDiff,
} from './compiler/blueprint-diff';
export { IncrementalCompiler } from './compiler/incremental-compiler';
export type { IncrementalMigrationResult } from './compiler/incremental-compiler';
export { TenantAgentGovernanceManager } from './governance/tenant-governance';
export type {
  TenantAgentGovernanceConfig,
  AgentQuota,
  DataIsolationRule,
  AuditPolicy,
  AgentActivityLog,
} from './governance/tenant-governance';

// Relational Cross-Validation & Healing
export { validateBlueprintIntegrity, autoRepairBlueprint } from './validation/cross-validator';
export type { ValidationError, BlueprintValidationResult } from './validation/cross-validator';
export type { DataChangeEvent } from './agent/proactive-runner';




