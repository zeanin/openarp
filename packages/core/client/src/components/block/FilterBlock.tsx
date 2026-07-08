import React from 'react';
import { Form, Row, Col, Input, Select, DatePicker, Button, Card } from 'antd';
import { SearchOutlined, UndoOutlined } from '@ant-design/icons';
import AssociationField from '../data/AssociationField';

export interface FilterField {
  name: string;
  title: string;
  type?: 'string' | 'integer' | 'float' | 'boolean' | 'date' | 'datetime' | 'enum' | 'association' | string;
  values?: string[];
  collection?: string;
  labelField?: string;
  valueField?: string;
}

export interface FilterBlockProps {
  collection?: string;
  fields?: Array<FilterField | string>;
  style?: React.CSSProperties;
  className?: string;
}

export const FilterBlock: React.FC<FilterBlockProps> = ({
  collection,
  fields = [],
  style,
  className,
}) => {
  const [form] = Form.useForm();

  // Normalize fields list
  const normalizedFields: FilterField[] = fields.map((f) => {
    if (typeof f === 'string') {
      return {
        name: f,
        title: f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, ' '),
        type: 'string',
      };
    }
    return {
      name: f.name,
      title: f.title || f.name.charAt(0).toUpperCase() + f.name.slice(1).replace(/_/g, ' '),
      type: f.type || 'string',
      values: f.values,
      collection: f.collection,
      labelField: f.labelField,
      valueField: f.valueField,
    };
  });

  const handleSearch = () => {
    const rawValues = form.getFieldsValue();
    const filter: Record<string, any> = {};

    // Build standard operators (e.g., like for strings, eq for enums)
    Object.keys(rawValues).forEach((key) => {
      const val = rawValues[key];
      if (val === undefined || val === null || val === '') return;

      const fieldSpec = normalizedFields.find((f) => f.name === key);
      if (fieldSpec) {
        if (fieldSpec.type === 'string') {
          // Send operator structured filter
          filter[key] = { $like: `%${val}%` };
        } else if (fieldSpec.type === 'date' || fieldSpec.type === 'datetime') {
          // If range, handle it
          if (Array.isArray(val) && val.length === 2) {
            filter[key] = {
              $gte: val[0].startOf('day').toISOString(),
              $lte: val[1].endOf('day').toISOString(),
            };
          } else {
            filter[key] = val.toISOString();
          }
        } else {
          filter[key] = val;
        }
      } else {
        filter[key] = val;
      }
    });

    // Save filter parameters globally for ExportAction to fetch
    if (collection) {
      if (!(window as any).formaiCurrentFilters) {
        (window as any).formaiCurrentFilters = {};
      }
      (window as any).formaiCurrentFilters[collection] = filter;
    }

    // Dispatch custom event to Table or page listeners
    window.dispatchEvent(
      new CustomEvent('formai-filter-change', {
        detail: { collection, filter },
      })
    );
  };

  const handleReset = () => {
    form.resetFields();
    if (collection && (window as any).formaiCurrentFilters) {
      delete (window as any).formaiCurrentFilters[collection];
    }
    window.dispatchEvent(
      new CustomEvent('formai-filter-change', {
        detail: { collection, filter: {} },
      })
    );
  };

  const renderFieldInput = (field: FilterField) => {
    switch (field.type) {
      case 'association':
        return (
          <AssociationField
            placeholder={`Select ${field.title}`}
            collection={field.collection}
            labelField={field.labelField}
            valueField={field.valueField}
          />
        );
      case 'enum':
        const selectOptions = field.values?.map((v) => ({ label: v.toUpperCase(), value: v })) || [];
        return (
          <Select
            placeholder={`Select ${field.title}`}
            options={selectOptions}
            allowClear
          />
        );
      case 'date':
      case 'datetime':
        return (
          <DatePicker.RangePicker
            style={{ width: '100%' }}
            showTime={field.type === 'datetime'}
          />
        );
      case 'boolean':
        return (
          <Select
            placeholder={`Select ${field.title}`}
            options={[
              { label: 'Yes', value: true },
              { label: 'No', value: false },
            ]}
            allowClear
          />
        );
      case 'integer':
      case 'float':
        return <Input type="number" placeholder={`Input ${field.title}`} allowClear />;
      case 'string':
      default:
        return <Input placeholder={`Search ${field.title}`} allowClear />;
    }
  };

  if (normalizedFields.length === 0) {
    return null;
  }

  return (
    <Card
      bordered={true}
      style={{
        marginBottom: 16,
        background: '#fafafa',
        borderColor: '#f0f0f0',
        borderRadius: 8,
        boxShadow: 'none',
        ...style,
      }}
      className={className}
      bodyStyle={{ padding: '16px 24px 8px 24px' }}
    >
      <Form form={form} layout="vertical" onFinish={handleSearch}>
        <Row gutter={[16, 0]}>
          {normalizedFields.map((field) => (
            <Col xs={24} sm={12} md={8} lg={6} key={field.name}>
              <Form.Item
                name={field.name}
                label={
                  <span style={{ fontSize: 13, color: '#595959', fontWeight: 500, userSelect: 'none' }}>
                    {field.title}
                  </span>
                }
                style={{ marginBottom: 12 }}
              >
                {renderFieldInput(field)}
              </Form.Item>
            </Col>
          ))}
          <Col
            xs={24}
            sm={24}
            md={24}
            lg={24 - (normalizedFields.length * 6) % 24}
            style={{
              textAlign: 'right',
              marginBottom: 12,
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'flex-end',
              height: 56, // Align buttons perfectly with Form Item inputs
            }}
          >
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={handleSearch}
              style={{
                marginRight: 8,
                borderRadius: 6,
                boxShadow: 'none',
                background: '#1677ff',
                borderColor: '#1677ff',
                fontWeight: 500,
              }}
            >
              Search
            </Button>
            <Button
              icon={<UndoOutlined />}
              onClick={handleReset}
              style={{
                borderRadius: 6,
                color: '#595959',
                borderColor: '#d9d9d9',
                fontWeight: 500,
              }}
            >
              Reset
            </Button>
          </Col>
        </Row>
      </Form>
    </Card>
  );
};

export default FilterBlock;
