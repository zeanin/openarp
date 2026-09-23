import type { SkillContext } from '@formai/shared';

export interface PiToolParameterSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

export interface PiToolDefinition {
  name: string;
  description: string;
  parameters: PiToolParameterSchema;
  execute: (args: Record<string, any>) => Promise<any>;
}

/**
 * Creates tenant-scoped and role-restricted Pi tools from FormAI SkillRegistry.
 * Guarantees that every execution carries the exact SkillContext (tenantId, appId, userId, roles).
 */
export function createTenantScopedTools(app: any, context: SkillContext = {}): PiToolDefinition[] {
  if (!app?.skillRegistry) {
    return [];
  }

  // 1. Get only the tools available for the current tenant/user/role scope
  const availableSkills = app.skillRegistry.getAvailableTools(context) || [];

  return availableSkills.map((skill: any) => ({
    name: skill.name,
    description: skill.description || `FormAI Platform Skill: ${skill.name}`,
    parameters: skill.inputSchema || {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
    execute: async (args: Record<string, any>) => {
      try {
        // Enforce execution with the exact tenant & user context
        const execResult = await app.skillRegistry.execute(skill.name, args || {}, context);

        if (execResult && typeof execResult === 'object' && execResult.type === 'confirmation') {
          return {
            isError: true,
            message: `Execution blocked: Action requires confirmation for skill "${skill.name}".`,
            confirmationId: execResult.confirmationId,
          };
        }

        return execResult?.result ?? execResult?.data ?? execResult ?? { success: true };
      } catch (err: any) {
        return {
          isError: true,
          message: `Skill execution error [${skill.name}]: ${err.message}`,
        };
      }
    },
  }));
}
