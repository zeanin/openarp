// Core schema utility
export { Schema } from './schema';

// React components
export { SchemaRenderer, treeToFlat, flatToTree } from './components/SchemaRenderer';
export type { SchemaRendererProps, A2UIComponent } from './components/SchemaRenderer';
export { SchemaComponent } from './components/SchemaComponent';
export type { SchemaComponentProps } from './components/SchemaComponent';
export { DesignableNode } from './components/DesignableNode';
export type { DesignableNodeProps } from './components/DesignableNode';

// Component registry
export {
  ComponentRegistry,
  getComponentRegistry,
  registerComponent,
} from './registry';
export type { ComponentRegistration } from './registry';

// Hooks
export { ComponentRegistryContext, useComponentRegistry } from './hooks/useComponentRegistry';
export { useSchema } from './hooks/useSchema';
export { useDesignable, DesignableContext } from './hooks/useDesignable';
export type { DesignableContextValue } from './hooks/useDesignable';

// Reaction system
export { evaluateReaction, evaluateReactions, createExpressionEvaluator } from './reactions';

// Persistence
export { MemorySchemaPersistence } from './persistence';
export type { SchemaPersistence } from './persistence';
