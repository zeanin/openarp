import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import {
  ClientApplication,
  SchemaComponentProvider,
  createAPIClient,
  APIClientProvider,
  DesignModeProvider,
  ThemeProvider,
  useTheme,
} from '@formai/client';
import {
  ConfigProvider,
  theme,
  Spin,
  Form,
  Input,
  Button,
  Card,
  Typography,
  message,
  Row,
  Col,
  Statistic,
  Space,
  Tag,
  Table,
  Modal,
  Avatar,
  Dropdown,
  Select,
  Popconfirm,
  Alert,
  Upload,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  RocketOutlined,
  ApiOutlined,
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  LoadingOutlined,
  FolderOpenOutlined,
  CloudUploadOutlined,
  FileOutlined,
  CopyOutlined,
  DownloadOutlined,
  EyeOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';

// Local layout and page components
import { PlatformLayout } from './layouts/PlatformLayout';
import { AppLayout } from './layouts/AppLayout';
import { AppLauncherPage } from './pages/AppLauncherPage';
import { SchemaPage } from './pages/SchemaPage';
import { AppManagementPage } from './pages/AppManagementPage';
import { AppWorkspacePage } from './pages/AppWorkspacePage';
import { ClipsPage } from './pages/modules/ClipsPage';
import { AdminGuard } from './guards/AdminGuard';
import { AppGuard } from './guards/AppGuard';
import { FormaiRobotIcon } from './components/FormaiRobotIcon';

const { Title, Text, Paragraph } = Typography;
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ─── Application setup ────────────────────────────────────────────────────────

const app = new ClientApplication({ apiBaseURL: API_BASE, registerCoreComponents: true });
const apiClient = createAPIClient(API_BASE);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getToken() { return localStorage.getItem('formai_token'); }
function setToken(t: string) { localStorage.setItem('formai_token', t); }
function clearToken() {
  localStorage.removeItem('formai_token');
  localStorage.removeItem('formai_refresh_token');
}

async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
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

// ─── Login Page ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: (user: any, role: string) => void }) {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/api/auth/signIn', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setToken(res.data.token);
      localStorage.setItem('formai_refresh_token', res.data.refreshToken || '');
      onLogin(res.data.user, res.data.user?.role || res.data.user?.roles?.[0] || 'member');
      // Store role in localStorage for child components without prop access
      localStorage.setItem('formai_current_role', res.data.user?.role || res.data.user?.roles?.[0] || 'member');
      message.success('Signed in successfully');
    } catch (err: any) {
      message.error(err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: token.colorBgLayout }}>
      <Card style={{ width: 380, boxShadow: token.boxShadow }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <FormaiRobotIcon style={{ fontSize: 40, color: token.colorPrimary }} />
          <Title level={3} style={{ margin: '12px 0 4px' }}>Formai</Title>
          <Text type="secondary">AI-Native Application Platform</Text>
        </div>
        <Form layout="vertical" onFinish={handleSubmit}>
          <Form.Item label="Username" name="username" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder="root" size="large" />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="password" size="large" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>Sign In</Button>
          </Form.Item>
        </Form>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Default: root / admin123</Text>
        </div>
      </Card>
    </div>
  );
}

// ─── Platform admin pages (previously in App.tsx) ─────────────────────────────

function DashboardContent({ onOpenAIPanel }: { onOpenAIPanel: () => void }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ apps: 0, collections: 0, workflows: 0, users: 1 });
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [recentApps, setRecentApps] = useState<any[]>([]);

  useEffect(() => {
    apiFetch<any>('/api/health').then(() => setServerOk(true)).catch(() => setServerOk(false));
    Promise.all([
      apiFetch<any>('/api/apps?pageSize=100').catch(() => null),
      apiFetch<any>('/api/collections?pageSize=1').catch(() => null),
      apiFetch<any>('/api/workflows?pageSize=1').catch(() => null),
      apiFetch<any>('/api/users?pageSize=1').catch(() => null),
    ]).then(([apps, cols, wfs, users]) => {
      setStats({
        apps: apps?.meta?.count ?? 0,
        collections: cols?.meta?.count ?? 0,
        workflows: wfs?.meta?.count ?? 0,
        users: users?.meta?.count ?? 1,
      });
      setRecentApps((apps?.data ?? []).slice(0, 4));
    });
  }, []);

  const DEMO_PROMPTS = ['Create a CRM with customers, contacts and deals', 'Build an inventory management app', 'Design a project tracking dashboard'];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>Dashboard</Title>
        <Text type="secondary">Platform Overview — AI-Native Application Platform</Text>
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card variant="borderless" style={{ background: token.colorBgTextHover, cursor: 'pointer' }} onClick={() => navigate('/admin/apps')}>
            <Statistic title="Apps" value={stats.apps} prefix={<AppstoreOutlined style={{ color: token.colorPrimary }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card variant="borderless" style={{ background: token.colorBgTextHover }}>
            <Statistic title="Collections" value={stats.collections} prefix={<DatabaseOutlined style={{ color: '#1677ff' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card variant="borderless" style={{ background: token.colorBgTextHover }}>
            <Statistic title="Workflows" value={stats.workflows} prefix={<ThunderboltOutlined style={{ color: token.colorWarning }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card variant="borderless" style={{ background: token.colorBgTextHover }}>
            <Statistic title="Users" value={stats.users} prefix={<UserOutlined style={{ color: token.colorSuccess }} />} />
          </Card>
        </Col>
      </Row>

      {/* Recent Apps */}
      {recentApps.length > 0 && (
        <Card title={<Space><AppstoreOutlined style={{ color: token.colorPrimary }} /><span>Your Apps</span></Space>} size="small" style={{ marginBottom: 16 }} extra={<Button size="small" type="link" onClick={() => navigate('/admin/apps')}>View All</Button>}>
          <Row gutter={[12, 12]}>
            {recentApps.map((app: any) => {
              const statusCfg: any = { draft: 'orange', published: 'green', archived: 'default' };
              return (
                <Col key={app.name} xs={12} sm={6}>
                  <Card
                    size="small"
                    hoverable
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/admin/apps/${app.name}`)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{app.icon || '📦'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.title}</div>
                        <Tag color={statusCfg[app.status] || 'default'} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}>{app.status}</Tag>
                      </div>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Card>
      )}

      <Card title="System Status" size="small" style={{ marginBottom: 16 }} extra={
        serverOk === null ? <Tag icon={<LoadingOutlined />}>Checking...</Tag>
          : serverOk ? <Tag icon={<CheckCircleOutlined />} color="success">Online</Tag>
            : <Tag color="error">Offline</Tag>
      }>
        <Text type="secondary">Version 0.1.0</Text>
      </Card>

      <Card title={<Space><RocketOutlined style={{ color: token.colorPrimary }} /><span>Quick Start with AI</span></Space>} size="small" style={{ marginBottom: 16 }}>
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Describe what you want to build. AI will generate collections, schemas, workflows and wire them into an App.
        </Paragraph>
        <Space wrap>
          {DEMO_PROMPTS.map((p) => (
            <Tag key={p} color="blue" style={{ cursor: 'pointer' }} onClick={onOpenAIPanel}>{p}</Tag>
          ))}
        </Space>
      </Card>

      <Card title={<Space><ApiOutlined style={{ color: token.colorPrimary }} /><span>AI-Native Architecture</span></Space>} size="small">
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}><Card size="small" title="A2App" variant="borderless"><Text type="secondary" style={{ fontSize: 12 }}>Natural Language → Complete App (collections + pages + menus + roles)</Text></Card></Col>
          <Col xs={24} sm={8}><Card size="small" title="A2Page" variant="borderless"><Text type="secondary" style={{ fontSize: 12 }}>Natural Language → Page Schema → Menu item in an App</Text></Card></Col>
          <Col xs={24} sm={8}><Card size="small" title="A2Data" variant="borderless"><Text type="secondary" style={{ fontSize: 12 }}>Natural Language → Page-level data actions (filter, create, update)</Text></Card></Col>
        </Row>
      </Card>
    </div>
  );
}

function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await apiFetch<any>('/api/users?pageSize=50'); setUsers(res?.data ?? []); }
    catch (err: any) { message.error(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleInvite = async (values: any) => {
    try {
      await apiFetch('/api/users/register', { method: 'POST', body: JSON.stringify({ values }) });
      message.success('User created'); setOpen(false); form.resetFields(); load();
    } catch (err: any) { message.error(err.message); }
  };

  const columns = [
    { title: 'User', key: 'user', render: (_: any, r: any) => <Space><Avatar icon={<UserOutlined />} size="small" /><div><Text strong>{r.nickname || r.username}</Text><br /><Text type="secondary" style={{ fontSize: 12 }}>@{r.username}</Text></div></Space> },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={v === 'active' ? 'success' : 'default'}>{v}</Tag> },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Users</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New User</Button>
        </Space>
      </div>
      <Table dataSource={users} columns={columns} rowKey="id" loading={loading} size="small" />
      <Modal title="Create User" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Create">
        <Form form={form} layout="vertical" onFinish={handleInvite}>
          <Form.Item label="Username" name="username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Email" name="email"><Input type="email" /></Form.Item>
          <Form.Item label="Nickname" name="nickname"><Input /></Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}><Input.Password /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function SettingsPage() {
  const { token } = theme.useToken();
  const [providers, setProviders] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  
  // Storage settings state
  const [storageForm] = Form.useForm();
  const [storageSettings, setStorageSettings] = useState<{ maxUploadSize: number }>({ maxUploadSize: 50 });
  const [storageLoading, setStorageLoading] = useState(false);

  const loadProviders = useCallback(async () => {
    try { const res = await apiFetch<any>('/api/ai/providers'); setProviders(res?.data ?? []); }
    catch { setProviders([]); }
  }, []);

  const loadStorageSettings = useCallback(async () => {
    setStorageLoading(true);
    try {
      const res = await apiFetch<any>('/api/system-settings?group=storage');
      const maxUpload = res?.data?.find((s: any) => s.key === 'maxUploadSize');
      if (maxUpload) {
        const val = Number(maxUpload.value);
        setStorageSettings({ maxUploadSize: val });
        storageForm.setFieldsValue({ maxUploadSize: val });
      }
    } catch {
      // ignore
    } finally {
      setStorageLoading(false);
    }
  }, [storageForm]);

  useEffect(() => {
    loadProviders();
    loadStorageSettings();
  }, [loadProviders, loadStorageSettings]);

  const handleAdd = async (values: any) => {
    try {
      await apiFetch('/api/ai/providers', { method: 'POST', body: JSON.stringify(values) });
      message.success('Provider added'); setOpen(false); form.resetFields(); loadProviders();
    } catch (err: any) { message.error(err.message); }
  };

  const handleSetDefault = async (name: string) => {
    try {
      await apiFetch(`/api/ai/providers/${encodeURIComponent(name)}/default`, { method: 'POST' });
      message.success(`Switched active provider to ${name}`);
      loadProviders();
    } catch (err: any) {
      message.error(err.message || 'Failed to switch provider');
    }
  };

  const handleSaveStorage = async (values: any) => {
    setStorageLoading(true);
    try {
      await apiFetch('/api/system-settings', {
        method: 'POST',
        body: JSON.stringify([{ key: 'maxUploadSize', value: Number(values.maxUploadSize), group: 'storage' }]),
      });
      message.success('Storage settings saved successfully');
      loadStorageSettings();
    } catch (err: any) {
      message.error(err.message || 'Failed to save storage settings');
    } finally {
      setStorageLoading(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={3} style={{ margin: '0 0 24px' }}>Settings</Title>
      
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card 
            title={<Space><ApiOutlined style={{ color: token.colorPrimary }} /><span>LLM Providers</span></Space>} 
            size="small" 
            extra={<Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Add Provider</Button>}
            style={{ height: '100%', borderRadius: 8 }}
          >
            {providers.length === 0 ? (
              <Alert message="No LLM providers configured" description="Add OpenAI, Anthropic or Qwen key to enable AI features." type="warning" showIcon />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                {providers.map((p) => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: p.isDefault ? '#f0f5ff' : '#fafafa', border: `1px solid ${p.isDefault ? '#d6e4ff' : '#f0f0f0'}`, borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize', color: p.isDefault ? '#1d39c4' : '#262626' }}>{p.name}</span>
                      {p.isDefault ? (
                        <Tag color="blue" style={{ borderRadius: 4, fontWeight: 500 }}>Active Default</Tag>
                      ) : (
                        <Tag color="default" style={{ borderRadius: 4 }}>Inactive</Tag>
                      )}
                    </div>
                    {!p.isDefault && (
                      <Button size="small" type="primary" ghost style={{ borderRadius: 4, fontSize: 12 }} onClick={() => handleSetDefault(p.name)}>
                        Set as Default
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card 
            title={<Space><FolderOpenOutlined style={{ color: '#52c41a' }} /><span>Storage Provider Settings</span></Space>} 
            size="small"
            style={{ height: '100%', borderRadius: 8 }}
          >
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#389e0d' }}>Local File Storage</span>
                  <Tag color="success" style={{ borderRadius: 4, fontWeight: 500 }}>Active Storage</Tag>
                </div>
              </div>
            </div>
            
            <Form form={storageForm} layout="vertical" onFinish={handleSaveStorage} initialValues={storageSettings}>
              <Form.Item label="Storage Directory Path" tooltip="Physical folder on the server where uploaded files are persisted.">
                <Input value="./storage/uploads" disabled style={{ background: '#f5f5f5', color: '#8c8c8c' }} />
              </Form.Item>
              <Form.Item 
                label="Maximum Upload File Size (MB)" 
                name="maxUploadSize" 
                rules={[{ required: true, message: 'Please specify max upload size' }]}
              >
                <Input type="number" min={1} suffix="MB" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={storageLoading} style={{ borderRadius: 4 }}>
                  Save Storage Settings
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card title="System Information" size="small" style={{ borderRadius: 8 }}>
        <Space direction="vertical"><Text>Version: 0.1.0</Text><Text>Platform: Formai AI-Native</Text></Space>
      </Card>

      <Modal title="Add LLM Provider" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Save">
        <Form form={form} layout="vertical" onFinish={handleAdd}>
          <Form.Item label="Provider Type" name="type" rules={[{ required: true }]} initialValue="openai">
            <Select options={[
              { value: 'openai', label: 'OpenAI (GPT-4o)' },
              { value: 'anthropic', label: 'Anthropic (Claude)' },
              { value: 'qwen', label: 'Qwen (Tongyi Qianwen)' }
            ]} />
          </Form.Item>
          <Form.Item label="API Key" name={['config', 'apiKey']} rules={[{ required: true }]}><Input.Password placeholder="API Key" /></Form.Item>
          <Form.Item label="Base URL (optional)" name={['config', 'baseURL']}><Input placeholder="Base URL" /></Form.Item>
          <Form.Item label="Model (optional)" name={['config', 'model']}><Input placeholder="Model name (e.g., gpt-4o or qwen-plus)" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function FilesPage() {
  const { token } = theme.useToken();
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ count: 0, totalSize: 0, imageCount: 0 });

  const loadAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>('/api/attachments?pageSize=100&sort=-createdAt');
      const data = res?.data ?? [];
      setAttachments(data);
      
      const totalSize = data.reduce((acc: number, curr: any) => acc + (curr.size || 0), 0);
      const imageCount = data.filter((f: any) => f.mimetype?.startsWith('image/')).length;
      setStats({
        count: data.length,
        totalSize,
        imageCount
      });
    } catch (err: any) {
      message.error(err.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/api/attachments/${id}`, { method: 'DELETE' });
      message.success('File deleted successfully');
      loadAttachments();
    } catch (err: any) {
      message.error(err.message || 'Failed to delete file');
    }
  };

  const handleCopyUrl = (url: string) => {
    const fullUrl = `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl);
    message.success('File URL copied to clipboard');
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const uploadProps = {
    name: 'file',
    action: `${API_BASE}/api/attachments/upload`,
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
    showUploadList: false,
    onChange(info: any) {
      if (info.file.status === 'done') {
        message.success(`${info.file.name} uploaded successfully`);
        loadAttachments();
      } else if (info.file.status === 'error') {
        message.error(`${info.file.name} upload failed: ${info.file.response?.errors?.[0]?.message || 'Server error'}`);
      }
    },
  };

  const columns = [
    {
      title: 'File Name',
      key: 'name',
      render: (_: any, r: any) => {
        const isImage = r.mimetype?.startsWith('image/');
        return (
          <Space size="middle">
            {isImage ? (
              <div style={{ width: 44, height: 44, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
                <img src={r.url} alt={r.filename} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'cover' }} />
              </div>
            ) : (
              <Avatar shape="square" size={44} icon={<FileOutlined />} style={{ background: '#e6f7ff', color: '#1890ff', borderRadius: 6 }} />
            )}
            <div>
              <Text strong style={{ fontSize: 14 }}>{r.filename}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 11 }}>{r.mimetype}</Text>
            </div>
          </Space>
        );
      }
    },
    {
      title: 'Size',
      dataIndex: 'size',
      key: 'size',
      render: (v: number) => formatBytes(v)
    },
    {
      title: 'Provider',
      dataIndex: 'storageType',
      key: 'storageType',
      render: (v: string) => <Tag color="blue" style={{ textTransform: 'capitalize' }}>{v}</Tag>
    },
    {
      title: 'Upload Time',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString()
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, r: any) => (
        <Space size="small">
          <Button 
            type="text" 
            icon={<CopyOutlined />} 
            onClick={() => handleCopyUrl(r.url)}
            title="Copy URL"
          />
          <Button 
            type="text" 
            icon={<DownloadOutlined />} 
            href={`${r.url}?download=1`}
            target="_blank"
            title="Download"
          />
          <Popconfirm 
            title="Delete File" 
            description="Are you sure you want to delete this file from disk and database?" 
            onConfirm={() => handleDelete(r.id)}
            okText="Delete" 
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Button 
              type="text" 
              danger 
              icon={<DeleteOutlined />} 
              title="Delete"
            />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: '24px 24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>File Manager</Title>
          <Text type="secondary">Upload, preview and manage files on local storage</Text>
        </div>
        <Upload.Dragger {...uploadProps} style={{ padding: '8px 16px', background: '#fafafa', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CloudUploadOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
            <Text strong>Drag & drop or click to upload</Text>
          </div>
        </Upload.Dragger>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card variant="borderless" style={{ background: '#f5f5f5', borderRadius: 8 }}>
            <Statistic title="Total Uploaded Files" value={stats.count} prefix={<FileOutlined style={{ color: token.colorPrimary }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card variant="borderless" style={{ background: '#f5f5f5', borderRadius: 8 }}>
            <Statistic title="Total Storage Used" value={formatBytes(stats.totalSize)} prefix={<FolderOpenOutlined style={{ color: '#52c41a' }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card variant="borderless" style={{ background: '#f5f5f5', borderRadius: 8 }}>
            <Statistic title="Images Count" value={stats.imageCount} prefix={<EyeOutlined style={{ color: '#faad14' }} />} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="All Attachments" style={{ borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.01)' }}>
        <Table 
          dataSource={attachments} 
          columns={columns} 
          rowKey="id" 
          loading={loading} 
          size="small" 
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  );
}

// ─── Routed Root App ──────────────────────────────────────────────────────────

function AppRoutes({ currentUser, currentRole, onSignOut }: { currentUser: any; currentRole: string | null; onSignOut: () => void }) {
  const RootComponent = app.getRootComponent();

  return (
    <RootComponent>
      <Routes>
        {/* Login */}
        <Route path="/login" element={
          currentUser
            ? <Navigate to={currentRole === 'root' || currentRole === 'admin' || currentRole === 'developer' ? '/admin/dashboard' : '/apps'} replace />
            : null
        } />

        {/* Platform Admin routes */}
        <Route path="/admin/*" element={
          <AdminGuard currentUser={currentUser} currentRole={currentRole}>
            <PlatformLayout currentUser={currentUser} onSignOut={onSignOut}>
              <Routes>
                <Route path="dashboard" element={<DashboardContent onOpenAIPanel={() => {}} />} />
                <Route path="apps" element={<AppManagementPage />} />
                <Route path="apps/:appId" element={<AppWorkspacePage />} />
                <Route path="apps/:appId/:tabKey" element={<AppWorkspacePage />} />
                <Route path="clips" element={<ClipsPage />} />
                <Route path="modules/clips" element={<ClipsPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="files" element={<FilesPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="*" element={<Navigate to="dashboard" replace />} />
              </Routes>
            </PlatformLayout>
          </AdminGuard>
        } />

        {/* App Launcher */}
        <Route path="/apps" element={
          <AppGuard currentUser={currentUser}>
            <AppLauncherPage currentUser={currentUser} currentRole={currentRole} />
          </AppGuard>
        } />

        {/* Individual App runtime */}
        <Route path="/apps/:appId" element={
          <AppGuard currentUser={currentUser}>
            <AppLayout currentUser={currentUser} onSignOut={onSignOut}>
              <div style={{ padding: 24 }}>
                <Title level={3}>Welcome</Title>
                <Text type="secondary">Select a page from the sidebar to get started.</Text>
              </div>
            </AppLayout>
          </AppGuard>
        } />

        <Route path="/apps/:appId/:menuPath" element={
          <AppGuard currentUser={currentUser}>
            <AppLayout currentUser={currentUser} onSignOut={onSignOut}>
              <SchemaPage />
            </AppLayout>
          </AppGuard>
        } />

        {/* Default redirect */}
        <Route path="/" element={
          currentUser
            ? <Navigate to={currentRole === 'root' || currentRole === 'admin' || currentRole === 'developer' ? '/admin/dashboard' : '/apps'} replace />
            : <Navigate to="/login" replace />
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </RootComponent>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

function App() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) { setAuthChecking(false); return; }
    apiFetch<any>('/api/auth/me')
      .then((res) => {
        setCurrentUser(res?.data ?? null);
        // Determine role from user data
        const role = res?.data?.role || res?.data?.roles?.[0] || 'member';
        setCurrentRole(role);
        // Store role in localStorage for child components without prop access
        localStorage.setItem('formai_current_role', role);
      })
      .catch(() => { clearToken(); })
      .finally(() => setAuthChecking(false));
  }, []);

  const handleLogin = useCallback((user: any, role: string) => {
    setCurrentUser(user);
    setCurrentRole(role);
  }, []);

  const handleSignOut = useCallback(async () => {
    try { await apiFetch('/api/auth/signOut', { method: 'POST' }); } catch {}
    clearToken();
    setCurrentUser(null);
    setCurrentRole(null);
    localStorage.removeItem('formai_current_role');
    message.info('Signed out');
  }, []);

  return (
    <ThemeProvider>
      <AppContent
        authChecking={authChecking}
        currentUser={currentUser}
        currentRole={currentRole}
        handleLogin={handleLogin}
        handleSignOut={handleSignOut}
      />
    </ThemeProvider>
  );
}

function AppContent({
  authChecking,
  currentUser,
  currentRole,
  handleLogin,
  handleSignOut,
}: {
  authChecking: boolean;
  currentUser: any;
  currentRole: string | null;
  handleLogin: (user: any, role: string) => void;
  handleSignOut: () => void;
}) {
  const { isDark } = useTheme();

  if (authChecking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 6 },
      }}
    >
      <APIClientProvider client={apiClient}>
        <SchemaComponentProvider>
          <DesignModeProvider>
            <BrowserRouter>
              {!currentUser ? (
                <Routes>
                  <Route path="*" element={<LoginPage onLogin={handleLogin} />} />
                </Routes>
              ) : (
                <AppRoutes
                  currentUser={currentUser}
                  currentRole={currentRole}
                  onSignOut={handleSignOut}
                />
              )}
            </BrowserRouter>
          </DesignModeProvider>
        </SchemaComponentProvider>
      </APIClientProvider>
    </ConfigProvider>
  );
}

export default App;
