// Components
export * from './components';

// Designer
export * from './designer';

// Providers
export { SchemaComponentProvider } from './providers/SchemaComponentProvider';
export type { SchemaComponentProviderProps } from './providers/SchemaComponentProvider';
export { ThemeProvider, useTheme } from './providers/ThemeContext';
export {
  APIClientProvider,
  APIClientContext,
  useAPIClient,
  createAPIClient,
} from './providers/APIClientProvider';
export type {
  APIClient,
  APIClientProviderProps,
  APIRequestConfig,
} from './providers/APIClientProvider';

// Hooks
export { useRequest } from './hooks/useRequest';
export type { UseRequestOptions, UseRequestResult } from './hooks/useRequest';
export { useCollection, useCollectionField, CollectionContext } from './hooks/useCollection';
export type { Collection, CollectionField } from './hooks/useCollection';
export { useRecord, useRecordField, RecordContext } from './hooks/useRecord';
export type { RecordData } from './hooks/useRecord';

// Application
export { ClientApplication } from './application/Application';
export type { ApplicationOptions } from './application/Application';

// Re-export schema engine utilities for convenience
export {
  SchemaRenderer,
  treeToFlat,
  flatToTree,
  SchemaComponent,
  registerComponent,
  getComponentRegistry,
  ComponentRegistry,
  ComponentRegistryContext,
  useComponentRegistry,
  useSchema,
  useDesignable,
  DesignableContext,
  Schema,
  evaluateReaction,
  evaluateReactions,
  MemorySchemaPersistence,
} from '@formai/schema-engine';
export type {
  SchemaRendererProps,
  A2UIComponent,
  SchemaComponentProps,
  ComponentRegistration,
  DesignableContextValue,
  SchemaPersistence,
} from '@formai/schema-engine';
