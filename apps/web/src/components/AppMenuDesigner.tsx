import React, { useState, useEffect, useCallback } from 'react';
import {
  Tree, Button, Space, Modal, Form, Input, Select, Typography,
  message, Popconfirm, Tag, Empty, Spin, Tooltip, Switch, Collapse, List, Badge,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, FileOutlined,
  FolderOutlined, LinkOutlined, HolderOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { FormaiRobotIcon } from './FormaiRobotIcon';
import type { DataNode } from 'antd/es/tree';

const { Text } = Typography;
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('formai_token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as any),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return json;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuItem {
  id: number;
  appId: number;
  title: string;
  icon?: string;
  type: 'page' | 'link' | 'group';
  schemaUid?: string;
  url?: string;
  parentId?: number | null;
  sort: number;
  permissionKey?: string;
  path?: string;
  hidden: boolean;
}

// ─── Build Ant Design TreeData from flat list ─────────────────────────────────

function buildTreeData(flat: MenuItem[]): DataNode[] {
  const map = new Map<number, DataNode & { _raw: MenuItem }>();
  flat.forEach((item) => {
    map.set(item.id, {
      key: item.id,
      title: renderMenuNode(item),
      children: [],
      _raw: item,
    } as any);
  });

  const roots: DataNode[] = [];
  flat.forEach((item) => {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      (map.get(item.parentId)!.children as any[]).push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

function renderMenuNode(item: MenuItem) {
  const typeIcon = item.type === 'group'
    ? <FolderOutlined style={{ marginRight: 6, color: '#fa8c16' }} />
    : item.type === 'link'
      ? <LinkOutlined style={{ marginRight: 6, color: '#1677ff' }} />
      : <FileOutlined style={{ marginRight: 6, color: '#52c41a' }} />;

  return (
    <Space size={4}>
      {typeIcon}
      <Text>{item.title}</Text>
      {item.path && <Text type="secondary" style={{ fontSize: 11 }}>/{item.path}</Text>}
      {item.permissionKey && <Tag style={{ fontSize: 10 }}>{item.permissionKey}</Tag>}
      {item.hidden && <Tag color="default" style={{ fontSize: 10 }}>Hidden</Tag>}
    </Space>
  );
}

// ─── AppMenuDesigner ──────────────────────────────────────────────────────────

interface AppMenuDesignerProps {
  appId: string;
  appName: string;
}

export function AppMenuDesigner({ appId, appName }: AppMenuDesignerProps) {
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [createParentId, setCreateParentId] = useState<number | null>(null);
  const [form] = Form.useForm();

  // AI Menu states
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPreviewMenus, setAiPreviewMenus] = useState<any[] | null>(null);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [aiGeneratePages, setAiGeneratePages] = useState(true);

  const slugify = (text: string) => {
    return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50);
  };

  const handleRecommendAiMenus = async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    setAiPreviewMenus(null);
    try {
      const res = await apiFetch<any>('/api/ai/a2menu', {
        method: 'POST',
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      if (res?.data?.menus) {
        setAiPreviewMenus(res.data.menus);
        message.success('✨ AI recommended navigation structure successfully!');
      } else {
        message.error('AI could not generate recommendations.');
      }
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleApplyAiMenus = async () => {
    if (!aiPreviewMenus) return;
    setBulkCreating(true);
    try {
      let createdCount = 0;
      for (const item of aiPreviewMenus) {
        let parentId: number | null = null;
        
        if (item.type === 'group') {
          // 1. Create group menu item
          const groupRes = await apiFetch<any>(`/api/apps/${appId}/menus`, {
            method: 'POST',
            body: JSON.stringify({
              values: {
                title: item.title,
                type: 'group',
                icon: item.icon || '📁',
                hidden: false,
              },
            }),
          });
          parentId = groupRes?.data?.id ?? null;
          createdCount++;
          
          // 2. Create children pages
          if (item.children && Array.isArray(item.children)) {
            for (const child of item.children) {
              const schemaUid = `${appId}_${slugify(child.title || '')}_${Math.random().toString(36).slice(2, 6)}`;
              
              // Generate AI page schema or fallback
              let schema: any = [
                {
                  id: 'page-root',
                  type: 'Page',
                  props: { title: child.title || 'Page' },
                  sort: 1
                }
              ];
              
              if (aiGeneratePages) {
                try {
                  const aiUiRes = await apiFetch<any>('/api/ai/a2ui', {
                    method: 'POST',
                    body: JSON.stringify({
                      prompt: `Create a page layout for "${child.title}" in an app named "${appName}".`,
                      mode: 'create',
                    }),
                  });
                  if (aiUiRes?.data) {
                    schema = aiUiRes.data;
                  }
                } catch (e) {
                  // fallback to basic
                }
              }
              
              // Create UI schema
              await apiFetch('/api/uiSchemas', {
                method: 'POST',
                body: JSON.stringify({
                  values: {
                    uid: schemaUid,
                    title: child.title,
                    appId,
                    schema,
                  },
                }),
              });
              
              // Create menu item
              await apiFetch(`/api/apps/${appId}/menus`, {
                method: 'POST',
                body: JSON.stringify({
                  values: {
                    title: child.title,
                    type: 'page',
                    icon: child.icon || '📄',
                    path: child.path || slugify(child.title),
                    schemaUid,
                    parentId,
                    hidden: false,
                  },
                }),
              });
              createdCount++;
            }
          }
        } else {
          // It's a top-level page or link
          const schemaUid = `${appId}_${slugify(item.title || '')}_${Math.random().toString(36).slice(2, 6)}`;
          
          let schema: any = [
            {
              id: 'page-root',
              type: 'Page',
              props: { title: item.title || 'Page' },
              sort: 1
            }
          ];
          
          if (item.type === 'page' && aiGeneratePages) {
            try {
              const aiUiRes = await apiFetch<any>('/api/ai/a2ui', {
                method: 'POST',
                body: JSON.stringify({
                  prompt: `Create a page layout for "${item.title}" in an app named "${appName}".`,
                  mode: 'create',
                }),
              });
              if (aiUiRes?.data) {
                schema = aiUiRes.data;
              }
            } catch (e) {
              // fallback
            }
          }
          
          if (item.type === 'page') {
            // Create UI schema
            await apiFetch('/api/uiSchemas', {
              method: 'POST',
              body: JSON.stringify({
                values: {
                  uid: schemaUid,
                  title: item.title,
                  appId,
                  schema,
                },
              }),
            });
          }
          
          // Create menu item
          await apiFetch(`/api/apps/${appId}/menus`, {
            method: 'POST',
            body: JSON.stringify({
              values: {
                title: item.title,
                type: item.type,
                icon: item.icon || (item.type === 'link' ? '🔗' : '📄'),
                path: item.type === 'page' ? (item.path || slugify(item.title)) : null,
                url: item.type === 'link' ? (item.url || 'https://google.com') : null,
                schemaUid: item.type === 'page' ? schemaUid : null,
                parentId: null,
                hidden: false,
              },
            }),
          });
          createdCount++;
        }
      }
      
      message.success(`✨ AI generated and configured ${createdCount} navigation menus and pages successfully!`);
      setAiModalOpen(false);
      setAiPrompt('');
      setAiPreviewMenus(null);
      load();
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setBulkCreating(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/api/apps/${appId}/menus`);
      setMenus(res?.data ?? []);
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (values: any) => {
    try {
      await apiFetch(`/api/apps/${appId}/menus`, {
        method: 'POST',
        body: JSON.stringify({ values: { ...values, parentId: createParentId } }),
      });
      message.success('Menu item created');
      setCreateOpen(false);
      setCreateParentId(null);
      form.resetFields();
      load();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleUpdate = async (values: any) => {
    if (!editItem) return;
    try {
      await apiFetch(`/api/apps/${appId}/menus/${editItem.id}`, {
        method: 'PUT',
        body: JSON.stringify({ values }),
      });
      message.success('Menu item updated');
      setEditItem(null);
      form.resetFields();
      load();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/api/apps/${appId}/menus/${id}`, { method: 'DELETE' });
      message.success('Menu item deleted');
      load();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const openCreateForParent = (parentId: number | null = null) => {
    setCreateParentId(parentId);
    form.resetFields();
    setCreateOpen(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditItem(item);
    form.setFieldsValue({
      title: item.title,
      type: item.type,
      path: item.path,
      schemaUid: item.schemaUid,
      url: item.url,
      permissionKey: item.permissionKey,
      hidden: item.hidden,
    });
  };

  const handleDrop = async (info: any) => {
    const dropKey = info.node.key as number;
    const dragKey = info.dragNode.key as number;
    const dropPos = info.node.pos.split('-');
    const dropPosition = info.dropPosition - Number(dropPos[dropPos.length - 1]);

    // Create a copy of the menus to manipulate
    const data = JSON.parse(JSON.stringify(menus)) as MenuItem[];

    // Find the drag item
    const dragItem = data.find(item => item.id === dragKey);
    if (!dragItem) return;

    // Find the drop item
    const dropItem = data.find(item => item.id === dropKey);
    if (!dropItem) return;

    // Deep structural check: cannot drop a Group into another Group or Page (it must be at top-level)
    if (dragItem.type === 'group' && !info.dropToGap) {
      message.warning('Groups must remain at the top level');
      return;
    }

    // Deep structural check: cannot drop any item into a non-group item
    if (!info.dropToGap && dropItem.type !== 'group') {
      message.warning('Only Groups can contain child pages');
      return;
    }

    // Let's filter out dragItem from the flat array first to avoid duplicate or wrong index calculation
    const remaining = data.filter(item => item.id !== dragKey);

    if (!info.dropToGap) {
      // Case 1: Dropped *into* the dropItem (making it a child of dropItem)
      dragItem.parentId = dropItem.id;
      
      // Get all siblings in this parent
      const siblings = remaining.filter(item => item.parentId === dropItem.id);
      siblings.sort((a, b) => a.sort - b.sort);
      
      // Put at the end
      dragItem.sort = siblings.length > 0 ? siblings[siblings.length - 1].sort + 10 : 10;
      remaining.push(dragItem);
    } else {
      // Case 2: Dropped onto the gap (above or below dropItem)
      // Check if trying to drag a group into a child level of another group via gap drop
      if (dragItem.type === 'group' && dropItem.parentId !== null) {
        message.warning('Groups must remain at the top level');
        return;
      }

      dragItem.parentId = dropItem.parentId;
      
      // Get all siblings in the target parent level
      const siblings = remaining.filter(item => item.parentId === dropItem.parentId);
      siblings.sort((a, b) => a.sort - b.sort);

      const dropIndex = siblings.findIndex(item => item.id === dropKey);
      
      // If dropPosition === -1, it means dropped before/above dropItem
      // Otherwise, it means dropped after/below dropItem
      let insertIndex = dropIndex;
      if (dropPosition !== -1) {
        insertIndex = dropIndex + 1;
      }

      siblings.splice(insertIndex, 0, dragItem);

      // Re-assign sorts for all siblings in this group to keep them sequential and avoid duplicates
      siblings.forEach((sib, index) => {
        sib.sort = (index + 1) * 10;
      });

      // Now merge these updated siblings back into the remaining array
      siblings.forEach(sib => {
        const idx = remaining.findIndex(item => item.id === sib.id);
        if (idx !== -1) {
          remaining[idx] = sib;
        } else {
          remaining.push(sib);
        }
      });
    }

    // State with updated dragItem
    const updatedMenus = [...remaining];
    if (!updatedMenus.some(item => item.id === dragItem.id)) {
      updatedMenus.push(dragItem);
    }

    // Sort updatedMenus by sort and then id to keep exact array ordering for Tree rendering
    updatedMenus.sort((a, b) => {
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.id - b.id;
    });

    // Optimistically update frontend state
    setMenus(updatedMenus);

    try {
      await apiFetch(`/api/apps/${appId}/menus/reorder`, {
        method: 'POST',
        body: JSON.stringify({ values: { items: updatedMenus.map(item => ({
          id: item.id,
          parentId: item.parentId,
          sort: item.sort,
        })) } }),
      });
      message.success('✨ Menu order saved successfully!');
    } catch (err: any) {
      message.error('Failed to save menu order: ' + err.message);
      load(); // rollback
    }
  };

  // Render actions for each tree node
  const treeDataWithActions = (flat: MenuItem[]): DataNode[] => {
    const map = new Map<number, DataNode>();
    flat.forEach((item) => {
      map.set(item.id, {
        key: item.id,
        title: (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
            <div style={{ flex: 1 }}>{renderMenuNode(item)}</div>
            <Space size={2} onClick={(e) => e.stopPropagation()}>
              {item.type === 'group' && (
                <Tooltip title="Add child menu item">
                  <Button
                    type="text" size="small" icon={<PlusOutlined />}
                    onClick={() => openCreateForParent(item.id)}
                  />
                </Tooltip>
              )}
              <Tooltip title="Edit">
                <Button
                  type="text" size="small" icon={<EditOutlined />}
                  onClick={() => openEdit(item)}
                />
              </Tooltip>
              <Popconfirm
                title="Delete this menu item?"
                description="Child items will also be deleted."
                onConfirm={() => handleDelete(item.id)}
                okType="danger"
                okText="Delete"
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </div>
        ),
        children: [],
      } as any);
    });

    const roots: DataNode[] = [];
    flat.forEach((item) => {
      const node = map.get(item.id)!;
      if (item.parentId && map.has(item.parentId)) {
        (map.get(item.parentId)!.children as any[]).push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  };

  const treeData = treeDataWithActions(menus);

  const menuFormFields = (
    <>
      <Form.Item label="Title" name="title" rules={[{ required: true }]}>
        <Input placeholder="e.g. Orders" />
      </Form.Item>
      <Form.Item label="Type" name="type" initialValue="page" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'page', label: 'Page (Schema)' },
            { value: 'group', label: 'Group (Folder)' },
            { value: 'link', label: 'External Link' },
          ]}
        />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(p, c) => p.type !== c.type}>
        {({ getFieldValue }) => {
          const type = getFieldValue('type');
          return (
            <>
              {type === 'page' && (
                <>
                  <Form.Item label="URL Path" name="path" extra="Slug used in the URL">
                    <Input placeholder="e.g. orders" />
                  </Form.Item>
                  <Form.Item label="Schema UID" name="schemaUid" extra="Link to a UI Schema record">
                    <Input placeholder="e.g. crm_orders_list" />
                  </Form.Item>
                </>
              )}
              {type === 'link' && (
                <Form.Item label="URL" name="url" rules={[{ required: true }]}>
                  <Input placeholder="https://..." />
                </Form.Item>
              )}
            </>
          );
        }}
      </Form.Item>
      <Form.Item label="Permission Key" name="permissionKey" extra="Leave empty to allow all app users">
        <Input placeholder={`e.g. ${appName}.orders.view`} />
      </Form.Item>
      <Form.Item label="Hidden" name="hidden" valuePropName="checked">
        <Select
          options={[{ value: false, label: 'Visible' }, { value: true, label: 'Hidden' }]}
          defaultValue={false}
        />
      </Form.Item>
    </>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text type="secondary">
          Drag to reorder. Groups can contain child pages.
        </Text>
        <Space>
          <Button icon={<FormaiRobotIcon />} size="small" type="primary" onClick={() => setAiModalOpen(true)} style={{ background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)', border: 'none' }}>
            ✨ AI Generate Menus
          </Button>
          <Button icon={<PlusOutlined />} size="small" onClick={() => openCreateForParent(null)}>
            Add Menu Item
          </Button>
        </Space>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
      ) : menus.length === 0 ? (
        <Empty description="No menu items yet. Add one to build your app's navigation." />
      ) : (
        <Tree
          treeData={treeData}
          showLine
          blockNode
          defaultExpandAll
          draggable
          onDrop={handleDrop}
        />
      )}

      {/* Create / Edit Modal */}
      <Modal
        title={editItem ? `Edit: ${editItem.title}` : `Add Menu Item${createParentId ? ' (child)' : ''}`}
        open={createOpen || !!editItem}
        onCancel={() => { setCreateOpen(false); setEditItem(null); form.resetFields(); }}
        onOk={() => form.submit()}
        okText={editItem ? 'Save' : 'Create'}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={editItem ? handleUpdate : handleCreate}
        >
          {menuFormFields}
        </Form>
      </Modal>

      {/* AI Menus Modal */}
      <Modal
        title={
          <Space>
            <FormaiRobotIcon style={{ color: '#722ed1' }} />
            <span>AI Menu &amp; Page Generator</span>
          </Space>
        }
        open={aiModalOpen}
        onCancel={() => {
          if (!bulkCreating) {
            setAiModalOpen(false);
            setAiPrompt('');
            setAiPreviewMenus(null);
          }
        }}
        onOk={handleApplyAiMenus}
        okText={bulkCreating ? 'Designing & Creating...' : 'Apply Recommendations'}
        cancelButtonProps={{ disabled: bulkCreating }}
        okButtonProps={{ disabled: !aiPreviewMenus || bulkCreating, type: 'primary' }}
        confirmLoading={bulkCreating}
        width={560}
      >
        <Spin spinning={bulkCreating} tip="✨ AI is designing and bulk-creating recommended pages &amp; menus...">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
            <div style={{ background: '#f8fbff', border: '1px dashed #1677ff', borderRadius: 8, padding: 12, fontSize: 13 }}>
              💡 Describe what this app or new module is for, and AI will recommend a structured menu tree and auto-generate clean page elements for each!
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Module or App Purpose</Text>
              <Input.TextArea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., A comprehensive logistics management module, including cargo tracking, container inventories, supplier databases, and scheduling workflows."
                rows={3}
                disabled={aiGenerating || bulkCreating}
              />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Switch checked={aiGeneratePages} onChange={setAiGeneratePages} disabled={aiGenerating || bulkCreating} />
                <Text style={{ fontSize: 13 }}>✨ Auto-generate rich page elements (tables, forms, fields) with AI</Text>
              </Space>
              <Button
                type="primary"
                onClick={handleRecommendAiMenus}
                loading={aiGenerating}
                disabled={!aiPrompt.trim() || bulkCreating}
                style={{ background: '#722ed1', borderColor: '#722ed1' }}
              >
                Recommend
              </Button>
            </div>

            {aiPreviewMenus && (
              <div style={{ border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ background: '#fafafa', padding: '8px 12px', borderBottom: '1px solid #e8e8e8', fontWeight: 600, fontSize: 13 }}>
                  ✨ Recommended Menu &amp; Page Structure
                </div>
                <div style={{ padding: 12, maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {aiPreviewMenus.map((item, idx) => (
                    <div key={idx} style={{ background: '#fcfcfc', border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space>
                          <span style={{ fontSize: 16 }}>{item.icon || (item.type === 'group' ? '📁' : '📄')}</span>
                          <Text strong>{item.title}</Text>
                          <Tag style={{ fontSize: 10 }}>{item.type.toUpperCase()}</Tag>
                        </Space>
                        {item.path && <Text type="secondary" style={{ fontSize: 11 }}>/{item.path}</Text>}
                      </div>
                      
                      {item.children && item.children.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 24, marginTop: 8, borderLeft: '1px dashed #d9d9d9' }}>
                          {item.children.map((child: any, cIdx: number) => (
                            <div key={cIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                              <Space>
                                <span>{child.icon || '📄'}</span>
                                <Text>{child.title}</Text>
                              </Space>
                              {child.path && <Text type="secondary" style={{ fontSize: 10 }}>/{child.path}</Text>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Spin>
      </Modal>
    </div>
  );
}
