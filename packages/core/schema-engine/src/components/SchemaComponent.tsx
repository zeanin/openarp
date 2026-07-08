import React from 'react';
import { ISchema } from '@formai/shared';
import { useComponentRegistry } from '../hooks/useComponentRegistry';
import { useDesignable } from '../hooks/useDesignable';
import { DesignableNode } from './DesignableNode';

export interface SchemaComponentProps {
  schema: ISchema;
  name?: string;
  children?: React.ReactNode;
}

/**
 * Renders a single schema node:
 * 1. Looks up x-component in registry
 * 2. Wraps with x-decorator if present
 * 3. Passes x-component-props and children through
 * 4. In design mode, wraps the output in a DesignableNode overlay
 */
export const SchemaComponent: React.FC<SchemaComponentProps> = ({ schema, name, children }) => {
  const registry = useComponentRegistry();
  const { designable } = useDesignable();

  const componentName = schema['x-component'];
  const decoratorName = schema['x-decorator'];
  const componentProps = schema['x-component-props'] || {};
  const decoratorProps = schema['x-decorator-props'] || {};
  const uid = schema['x-uid'] as string | undefined;

  // Resolve component
  let content: React.ReactNode = children ?? null;

  if (componentName) {
    const registration = registry.get(componentName);
    if (registration) {
      const Comp = registration.component;
      const mergedProps = { ...registration.defaultProps, ...componentProps };
      content = React.createElement(Comp, mergedProps, children);
    } else {
      // Fallback: render as a div with data attribute when component not found
      content = React.createElement(
        'div',
        { 'data-schema-component': componentName, ...componentProps },
        children,
      );
    }
  }

  // Wrap with decorator if specified
  if (decoratorName) {
    const decoratorReg = registry.get(decoratorName);
    if (decoratorReg) {
      const Decorator = decoratorReg.component;
      
      const schemaFieldProps: any = {};
      if (decoratorName === 'FormItem') {
        schemaFieldProps.label = schema.title || schema['x-decorator-props']?.title || schema['x-component-props']?.title || schema['x-decorator-props']?.label || schema['x-component-props']?.label;
        schemaFieldProps.name = schema['x-component-props']?.name || schema.name || name;
        if (schema['x-validator']) {
          const validators = Array.isArray(schema['x-validator']) ? schema['x-validator'] : [schema['x-validator']];
          const hasRequired = validators.some((v: any) => v && (v.required === true || v === 'required'));
          if (hasRequired) {
            schemaFieldProps.required = true;
          }
        }
      }

      const mergedDecoratorProps = { 
        ...decoratorReg.defaultProps, 
        ...schemaFieldProps, 
        ...decoratorProps 
      };
      content = React.createElement(Decorator, mergedDecoratorProps, content);
    } else {
      content = React.createElement(
        'div',
        { 'data-schema-decorator': decoratorName, ...decoratorProps },
        content,
      );
    }
  }

  // In design mode, wrap with DesignableNode overlay (only for named components with uid)
  if (designable && componentName && uid) {
    content = (
      <DesignableNode uid={uid} schema={schema} componentName={componentName}>
        {content}
      </DesignableNode>
    );
  }

  return React.createElement(React.Fragment, null, content);
};
