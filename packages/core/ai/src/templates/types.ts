export interface FieldTemplate {
  name: string;
  type: 'string' | 'text' | 'integer' | 'float' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'enum' | 'belongsTo' | 'hasMany' | 'jsonb';
  title: string;
  allowNull?: boolean;
  unique?: boolean;
  defaultValue?: any;
  target?: string;
  foreignKey?: string;
  enumOptions?: Array<{ label: string; value: string; color?: string }>;
  description?: string;
}

export interface CollectionTemplate {
  name: string;
  title: string;
  description?: string;
  category?: 'core' | 'transaction' | 'lookup' | 'log';
  fields: FieldTemplate[];
}

export type PageArchetype = 'list' | 'detail' | 'form' | 'dashboard' | 'kanban' | 'calendar' | 'knowledge';

export interface PageTemplate {
  title: string;
  type: PageArchetype;
  collection: string;
  icon?: string;
  path?: string;
  description?: string;
  config?: Record<string, any>;
}

export interface WorkflowActionTemplate {
  type: 'notification' | 'update_record' | 'create_record' | 'http_request' | 'approval_step';
  title: string;
  config: Record<string, any>;
}

export interface WorkflowTemplate {
  title: string;
  description: string;
  trigger: {
    type: 'record_created' | 'record_updated' | 'schedule' | 'manual';
    collection?: string;
    condition?: string;
  };
  actions: WorkflowActionTemplate[];
}

export interface MockFieldStrategy {
  type: 'name' | 'company' | 'email' | 'phone' | 'date' | 'amount' | 'status' | 'enum' | 'text' | 'number' | 'foreignKey';
  options?: any[];
  min?: number;
  max?: number;
}

export interface MockCollectionConfig {
  count?: number;
  presets?: Array<Record<string, any>>;
  fieldStrategies?: Record<string, MockFieldStrategy>;
}

export interface DomainTemplate {
  id: string;
  name: string;
  description: string;
  category: 'crm' | 'project' | 'inventory' | 'finance' | 'hr' | 'custom';
  keywords: string[];
  collections: CollectionTemplate[];
  pages: PageTemplate[];
  workflows: WorkflowTemplate[];
  mockData?: Record<string, MockCollectionConfig>;
}
