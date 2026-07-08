import React, { useMemo, useState } from 'react';
import { ISchema } from '@formai/shared';
import { ComponentRegistry } from '../registry';
import { ComponentRegistryContext, useComponentRegistry } from '../hooks/useComponentRegistry';
import { DesignableContext, DesignableContextValue } from '../hooks/useDesignable';
import { SchemaComponent } from './SchemaComponent';

export interface SchemaRendererProps {
  schema: ISchema;
  components?: Record<string, React.ComponentType<any>>;
  scope?: Record<string, any>;
  designable?: boolean;
  onPatch?: DesignableContextValue['onPatch'];
  onRemove?: DesignableContextValue['onRemove'];
  onInsert?: DesignableContextValue['onInsert'];
  onSelectBlock?: DesignableContextValue['onSelectBlock'];
  onMove?: DesignableContextValue['onMove'];
}

/**
 * Recursively renders a schema tree.
 *
 * For each node:
 * 1. Check x-visible / x-display for visibility
 * 2. Look up x-component in the registry
 * 3. If x-decorator exists, wrap with decorator component
 * 4. Recursively render properties (children)
 * 5. Handle items for array type schemas
 *
 * When designable=true, injects DesignableContext so every
 * SchemaComponent can show design-time overlays.
 */
export interface A2UIComponent {
  id: string;
  type: string;
  parentId?: string;
  props?: Record<string, any>;
  sort?: number;
  decorator?: string;
  decoratorProps?: Record<string, any>;
  [key: string]: any;
}

export function treeToFlat(schema: any): A2UIComponent[] {
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema.components)) return schema.components;

  const components: A2UIComponent[] = [];

  function traverse(node: any, parentId?: string, name?: string): string {
    const id = node['x-uid'] || name || `node_${Math.random().toString(36).slice(2, 6)}`;
    
    const props = node['x-component-props'] || {};
    if (node.title && !props.title) {
      props.title = node.title;
    }
    const nodeName = node.name || name;
    if (nodeName && !props.name) {
      props.name = nodeName;
    }

    const comp: A2UIComponent = {
      id,
      type: node['x-component'] || 'CardItem',
      parentId,
      props,
      sort: node['x-index'],
      decorator: node['x-decorator'],
      decoratorProps: node['x-decorator-props'],
      // Preserve other schema properties
      title: node.title,
      name: node.name,
      required: node.required,
      'x-validator': node['x-validator'],
      'x-reactions': node['x-reactions'],
      'x-visible': node['x-visible'],
      'x-hidden': node['x-hidden'],
      'x-disabled': node['x-disabled'],
      'x-read-only': node['x-read-only'],
      'x-editable': node['x-editable'],
      'x-pattern': node['x-pattern'],
      'x-display': node['x-display'],
      'x-content': node['x-content'],
      'x-data': node['x-data'],
      description: node.description,
      default: node.default,
      enum: node.enum,
    };

    components.push(comp);

    if (node.properties) {
      Object.entries(node.properties).forEach(([key, child]) => {
        traverse(child, id, key);
      });
    }

    if (node.items) {
      traverse(node.items, id, 'items');
    }

    return id;
  }

  traverse(schema);
  return components;
}

export function flatToTree(components: A2UIComponent[]): ISchema {
  if (!Array.isArray(components) || components.length === 0) {
    return { type: 'void', 'x-component': 'Page', properties: {} };
  }

  const map = new Map<string, ISchema>();
  const componentIds = new Set(components.map(c => c.id));
  const sortedComponents = [...components].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  for (const c of sortedComponents) {
    map.set(c.id, {
      type: c.props?.type || 'void',
      title: c.props?.title || c.title,
      name: c.props?.name || c.name,
      'x-component': c.type,
      'x-component-props': c.props || {},
      'x-decorator': c.decorator,
      'x-decorator-props': c.decoratorProps,
      'x-uid': c.id,
      'x-index': c.sort,
      required: c.required,
      'x-validator': c['x-validator'],
      'x-reactions': c['x-reactions'],
      'x-visible': c['x-visible'],
      'x-hidden': c['x-hidden'],
      'x-disabled': c['x-disabled'],
      'x-read-only': c['x-read-only'],
      'x-editable': c['x-editable'],
      'x-pattern': c['x-pattern'],
      'x-display': c['x-display'],
      'x-content': c['x-content'],
      'x-data': c['x-data'],
      description: c.description,
      default: c.default,
      enum: c.enum,
      properties: {},
    });
  }

  let root: ISchema | null = null;

  for (const c of sortedComponents) {
    const node = map.get(c.id)!;
    if (c.parentId && componentIds.has(c.parentId)) {
      const parentNode = map.get(c.parentId)!;
      if (!parentNode.properties) {
        parentNode.properties = {};
      }
      const propertyKey = c.props?.name || c.id;
      parentNode.properties[propertyKey] = node;
    } else {
      if (!root) {
        root = node;
      } else {
        if (root.properties) {
          const propertyKey = c.props?.name || c.id;
          root.properties[propertyKey] = node;
        }
      }
    }
  }

  return root || { type: 'void', 'x-component': 'Page', properties: {} };
}

export const SchemaRenderer: React.FC<SchemaRendererProps> = ({
  schema,
  components,
  scope: _scope,
  designable = false,
  onPatch,
  onRemove,
  onInsert,
  onSelectBlock,
  onMove,
}) => {
  const parentRegistry = useComponentRegistry();
  const [hoveredUid, setHoveredUid] = useState<string | null>(null);

  const normalizedSchema = useMemo(() => {
    if (Array.isArray(schema)) {
      return flatToTree(schema);
    }
    if (schema && typeof schema === 'object' && Array.isArray((schema as any).components)) {
      return flatToTree((schema as any).components);
    }
    return schema;
  }, [schema]);

  // If extra components provided, build a merged registry
  const registry = useMemo(() => {
    if (!components || Object.keys(components).length === 0) {
      return parentRegistry;
    }
    const merged = new ComponentRegistry();
    // Copy parent entries
    for (const [name, reg] of parentRegistry.getAll().entries()) {
      merged.register(name, reg);
    }
    // Register additional components
    for (const [name, comp] of Object.entries(components)) {
      merged.register(name, { component: comp });
    }
    return merged;
  }, [parentRegistry, components]);

  // Build the DesignableContext value — stable reference via useMemo
  const designableContextValue = useMemo<DesignableContextValue>(
    () => ({
      designable,
      setDesignable: () => {},
      onPatch,
      onRemove,
      onInsert,
      onSelectBlock,
      hoveredUid,
      setHoveredUid,
      onMove,
    }),
    [designable, onPatch, onRemove, onInsert, onSelectBlock, hoveredUid, onMove],
  );

  return (
    <ComponentRegistryContext.Provider value={registry}>
      <DesignableContext.Provider value={designableContextValue}>
        <SchemaNode schema={normalizedSchema} />
      </DesignableContext.Provider>
    </ComponentRegistryContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Internal recursive node renderer
// ---------------------------------------------------------------------------

interface SchemaNodeProps {
  schema: ISchema;
  name?: string;
}

const SchemaNode: React.FC<SchemaNodeProps> = ({ schema, name }) => {
  // Visibility: x-visible=false or x-display='none' hides the node entirely
  if (schema['x-visible'] === false || schema['x-display'] === 'none') {
    return null;
  }

  // Render children (properties)
  const childNodes = renderProperties(schema);

  return React.createElement(SchemaComponent, { schema, name, key: schema['x-uid'] }, childNodes);
};

/**
 * Render schema.properties as an array of SchemaNode elements.
 */
function renderProperties(schema: ISchema): React.ReactNode {
  const nodes: React.ReactElement[] = [];

  if (schema.properties) {
    // Sort by x-index if present, and always push 'actions' to the very end
    const entries = Object.entries(schema.properties).sort(([keyA, a], [keyB, b]) => {
      // FilterBlock always goes first
      const aIsFilter = a['x-component'] === 'FilterBlock';
      const bIsFilter = b['x-component'] === 'FilterBlock';
      if (aIsFilter && !bIsFilter) return -1;
      if (bIsFilter && !aIsFilter) return 1;

      // Space/actionBar always goes before Table/KanbanView/etc.
      const aIsActionBar = a['x-component'] === 'Space' || keyA.toLowerCase().includes('actionbar');
      const bIsActionBar = b['x-component'] === 'Space' || keyB.toLowerCase().includes('actionbar');
      const aIsMainContent = a['x-component'] === 'Table' || a['x-component'] === 'KanbanView' || a['x-component'] === 'KnowledgeWiki';
      const bIsMainContent = b['x-component'] === 'Table' || b['x-component'] === 'KanbanView' || b['x-component'] === 'KnowledgeWiki';

      if (aIsActionBar && bIsMainContent) return -1;
      if (bIsActionBar && aIsMainContent) return 1;

      if (keyA === 'actions' && keyB !== 'actions') return 1;
      if (keyB === 'actions' && keyA !== 'actions') return -1;

      const ai = a['x-index'] ?? 0;
      const bi = b['x-index'] ?? 0;
      return ai - bi;
    });

    for (const [key, child] of entries) {
      const uid = child['x-uid'] || key;
      nodes.push(React.createElement(SchemaNode, { schema: child, name: key, key: uid }));
    }
  }

  // Handle array items
  if (schema.type === 'array' && schema.items) {
    nodes.push(
      React.createElement(SchemaNode, {
        schema: schema.items,
        key: schema.items['x-uid'] || 'items',
      }),
    );
  }

  return nodes.length > 0 ? nodes : undefined;
}
