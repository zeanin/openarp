/**
 * Resource-Bound AI Skills — Runtime Skill System Type Definitions
 *
 * Skills are bound to specific resources (Collection/Page/Workflow/Role/Menu),
 * triggered by end-users via AI chat, where AI automatically discovers and invokes
 * the corresponding skill to operate on real data.
 */

/** Resource type to which the skill belongs */
export type ResourceType = 'collection' | 'page' | 'workflow' | 'role' | 'menu';

/** Skill execution handler type */
export type SkillHandlerType = 'auto_crud' | 'rest_action' | 'webhook';

/** auto_crud: System-generated CRUD skills, directly calling the Resourcer */
export interface AutoCrudHandler {
  type: 'auto_crud';
  /** Name of the corresponding collection */
  collection: string;
  /** CRUD action name */
  action: 'list' | 'get' | 'create' | 'update' | 'delete';
}

/** rest_action: Call custom Resource Action registered on the platform */
export interface RestActionHandler {
  type: 'rest_action';
  /** Name of the resource registered in the Resourcer */
  resource: string;
  /** Action name */
  action: string;
  /** Optional: Parameter mapping (skill inputs → action inputs) */
  paramMapping?: Record<string, string>;
}

/** webhook: Call an external HTTP interface */
export interface WebhookHandler {
  type: 'webhook';
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  /** Parameter location */
  paramIn?: 'body' | 'query';
}

export type SkillHandler = AutoCrudHandler | RestActionHandler | WebhookHandler;

/**
 * ResourceSkill — Complete skill definition
 * Stored in the `resource_skills` metadata table, and used as the runtime registration format.
 */
export interface ResourceSkill {
  /** Globally unique name, recommended format: {resource}_{action}, e.g., orders_cancel */
  name: string;
  /** Display title, e.g., "Cancel Order" */
  title: string;
  /**
   * Description read by the AI. Quality directly affects AI routing accuracy.
   * Recommended to include: When to use + What it can do + What it cannot do.
   * e.g., "Invoked when a user wants to cancel one or more orders. Accepts order ID or filter conditions."
   */
  description: string;
  /** Bound resource type */
  resourceType: ResourceType;
  /** Bound resource name, e.g., "orders" */
  resourceName: string;
  /** App ID to which it belongs, null means shared across the platform */
  appId?: number | string | null;
  /**
   * Input parameter JSON Schema (used by AI for Function Calling parameters definition).
   * Refers to OpenAI function calling parameters format.
   */
  inputSchema: SkillInputSchema;
  /** Whether the operation requires user confirmation before execution (recommended for high-risk operations) */
  requiresConfirm: boolean;
  /** List of roles allowed to trigger this skill, empty array means available to all roles */
  rolesAllowed: string[];
  /** Skill type */
  skillType: 'auto' | 'custom';
  /** Execution handler configuration */
  handler: SkillHandler;
  /** Whether it is enabled */
  enabled: boolean;
}

/** Skill input parameters Schema (JSON Schema subset) */
export interface SkillInputSchema {
  type: 'object';
  properties: Record<string, SkillParamDef>;
  required?: string[];
  description?: string;
}

/** Single parameter definition */
export interface SkillParamDef {
  type: 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: { type: string };
  default?: any;
}

/**
 * Skill execution context (used by AgentRuntime)
 * Used to filter the list of skills available to the current user/App.
 */
export interface SkillContext {
  /** Current Tenant ID */
  tenantId?: string;
  /** Current App ID */
  appId?: number | string | null;
  /** Current User ID */
  userId?: number | string;
  /** Current user roles list */
  roles?: string[];
  /**
   * Optional: Limit loading of skills for specific resources (performance optimization + scope control)
   * If omitted, all skills available to the current App will be loaded.
   */
  resourceScope?: Array<{ type: ResourceType; name: string }>;
}

/**
 * Runtime chat request (POST /api/ai/runtime-chat)
 */
export interface RuntimeChatRequest {
  message: string;
  appId?: number | string;
  sessionId?: string;
  resourceScope?: Array<{ type: ResourceType; name: string }>;
}

/**
 * Skill execution confirmation request (returned when requiresConfirm = true)
 */
export interface SkillConfirmationRequest {
  confirmationId: string;
  skillName: string;
  skillTitle: string;
  /** Human-readable action description */
  humanReadableAction: string;
  /** Arguments AI plans to pass */
  args: Record<string, any>;
  /** Expiration time (ms timestamp) */
  expiresAt: number;
}

