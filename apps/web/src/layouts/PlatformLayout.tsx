import React, { useState, useMemo } from 'react';
import { Layout, Menu, Button, Typography, Tag, Space, Avatar, Dropdown, theme, Tooltip } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  UserOutlined,
  FolderOutlined,
  SettingOutlined,
  AppstoreAddOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  EditOutlined,
  EyeOutlined,
  LogoutOutlined,
  ArrowLeftOutlined,
  MenuOutlined,
  TeamOutlined,
  ScheduleOutlined,
  BookOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { FormaiRobotIcon } from '../components/FormaiRobotIcon';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;


const PLATFORM_MENU = [
  { key: '/admin/dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
  { key: '/admin/apps', label: 'Apps', icon: <AppstoreAddOutlined /> },
  { key: '/admin/clips', label: 'Clips & Audio', icon: <VideoCameraOutlined /> },
  { key: '/admin/users', label: 'Users', icon: <UserOutlined /> },
  { key: '/admin/files', label: 'Files', icon: <FolderOutlined /> },
  { key: '/admin/settings', label: 'Settings', icon: <SettingOutlined /> },
];

// When inside an app workspace, the sidebar shows app-scoped resources
const APP_WORKSPACE_MENU = (appId: string) => [
  { key: `/admin/apps/${appId}`, label: 'Overview', icon: <DashboardOutlined /> },
  { key: `/admin/apps/${appId}/collections`, label: 'Data', icon: <DatabaseOutlined /> },
  { key: `/admin/apps/${appId}/schemas`, label: 'Pages', icon: <AppstoreOutlined /> },
  { key: `/admin/apps/${appId}/menus`, label: 'Menus', icon: <MenuOutlined /> },
  { key: `/admin/apps/${appId}/workflows`, label: 'Workflows', icon: <ThunderboltOutlined /> },
  { key: `/admin/apps/${appId}/wiki`, label: 'Wiki', icon: <BookOutlined /> },
  { key: `/admin/apps/${appId}/roles`, label: 'Roles', icon: <TeamOutlined /> },
  { key: `/admin/apps/${appId}/jobs`, label: 'Jobs', icon: <ScheduleOutlined /> },
];

interface PlatformLayoutProps {
  currentUser: any;
  onSignOut: () => void;
  children: React.ReactNode;
}

export function PlatformLayout({ currentUser, onSignOut, children }: PlatformLayoutProps) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 768);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  React.useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Detect if we're inside an app workspace
  const appMatch = location.pathname.match(/^\/admin\/apps\/([^/]+)/);
  const currentAppId = appMatch?.[1] || null;
  const isInAppWorkspace = !!currentAppId;

  const currentMenuItems = isInAppWorkspace
    ? APP_WORKSPACE_MENU(currentAppId)
    : PLATFORM_MENU;

  const selectedKey = useMemo(() => {
    const sortedItems = [...currentMenuItems].sort((a, b) => b.key.length - a.key.length);
    const match = sortedItems.find((item) => location.pathname.startsWith(item.key));
    return match?.key || currentMenuItems[0]?.key;
  }, [location.pathname, currentMenuItems]);

  const menuItems = currentMenuItems.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
    onClick: () => {
      if (window.innerWidth < 768) {
        setCollapsed(true);
      }
      navigate(item.key);
    },
  }));

  const userMenuItems = [
    { key: 'signout', icon: <LogoutOutlined />, label: 'Sign Out', onClick: onSignOut },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 12px' : '0 24px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          height: 52,
          lineHeight: '52px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12 }}>
          {isMobile && (
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((v) => !v)}
              style={{ padding: '0 8px' }}
            />
          )}
          <FormaiRobotIcon style={{ fontSize: 28, color: token.colorPrimary }} />
          <Title level={4} style={{ margin: 0, color: token.colorText, fontSize: isMobile ? 18 : 22 }}>Formai</Title>
          {!isMobile && <Tag color="orange" style={{ marginLeft: 4 }}>Admin</Tag>}
        </div>
        <Space size="middle">
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} style={{ background: token.colorPrimary }} />
              <Text style={{ fontSize: 13 }}>{currentUser?.nickname || currentUser?.username}</Text>
            </Space>
          </Dropdown>
        </Space>
      </Header>

      <Layout style={{ position: 'relative' }}>
        {isMobile && !collapsed && (
          <div
            onClick={() => setCollapsed(true)}
            style={{
              position: 'fixed',
              top: 52,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.45)',
              zIndex: 98,
              transition: 'all 0.3s',
            }}
          />
        )}
        <Sider
          collapsible collapsed={collapsed} trigger={null} width={isMobile ? 240 : 220} collapsedWidth={isMobile ? 0 : 60}
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            overflow: 'auto',
            height: 'calc(100vh - 52px)',
            position: isMobile ? 'fixed' : 'sticky',
            zIndex: isMobile ? 99 : 1,
            top: 52,
            left: 0,
            boxShadow: isMobile && !collapsed ? '4px 0 16px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Back button when in app workspace */}
            {isInAppWorkspace && (
              <div style={{ padding: '8px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  size="small"
                  onClick={() => navigate('/admin/apps')}
                  style={{ padding: 0, color: token.colorTextSecondary, fontSize: 12 }}
                >
                  All Apps
                </Button>
              </div>
            )}
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              items={menuItems}
              style={{ border: 'none', background: 'transparent', paddingTop: 8, flex: 1 }}
            />
            <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}>
              <Button
                type="text" block
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed((v) => !v)}
                style={{ height: 44, borderRadius: 0 }}
              >
                {!collapsed && 'Collapse'}
              </Button>
            </div>
          </div>
        </Sider>

        <Content style={{ background: token.colorBgLayout, overflowY: 'auto', minHeight: 'calc(100vh - 52px)' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
