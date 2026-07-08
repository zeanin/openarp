import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Spin, Empty, Alert, theme, Typography } from 'antd';
import { SchemaRenderer, treeToFlat, A2UIComponent } from '@formai/client';
import { useDesignMode, PageDesignPanel } from '@formai/client';
import { PageAIContextProvider } from '../providers/PageAIContextProvider';
import { PageAIAssistant, PageAIAssistantTrigger } from '../components/PageAIAssistant';
import { AGUIProvider, useAGUI } from '../providers/AGUIProvider';

const { Title } = Typography;
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

interface SchemaPageProps {
  /** Override appId (default from URL param) */
  appId?: string;
  /** Override schemaUid (default resolved from appMenus via menuPath) */
  schemaUid?: string;
  /** Permissions for the current user */
  userPermissions?: string[];
}

export function SchemaPage(props: SchemaPageProps) {
  return (
    <AGUIProvider>
      <SchemaPageContent {...props} />
    </AGUIProvider>
  );
}

function SchemaPageContent({ userPermissions = [] }: SchemaPageProps) {
  const { token } = theme.useToken();
  const { appId, menuPath } = useParams<{ appId: string; menuPath: string }>();
  const { mode } = useDesignMode();
  const designable = mode === 'design';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuItem, setMenuItem] = useState<any>(null);
  const [schemaUid, setSchemaUid] = useState<string>('');
  const [schema, setSchema] = useState<A2UIComponent[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ status: string; message: string } | null>(null);

  // Design panel state
  const [designPanelOpen, setDesignPanelOpen] = useState(false);
  const [selectedBlockUid, setSelectedBlockUid] = useState<string | undefined>();
  const [selectedBlockSchema, setSelectedBlockSchema] = useState<any>(undefined);

  const { registerUpdateHandler, sendUserAction, sessionId, syncSession, connected } = useAGUI();

  // Auto-sync session when schemaUid resolves or WS connects
  useEffect(() => {
    if (connected && schemaUid) {
      syncSession(schemaUid);
    }
  }, [connected, schemaUid, syncSession]);

  // Listen to AG-UI server UI stream pushes
  useEffect(() => {
    const unsubscribe = registerUpdateHandler((payload: any) => {
      if (payload.operation === 'updateComponents') {
        setSchema((prev) => {
          const next = [...prev];
          payload.components.forEach((newComp: any) => {
            const index = next.findIndex((c) => c.id === newComp.id);
            if (index > -1) {
              next[index] = { ...next[index], ...newComp };
            } else {
              next.push(newComp);
            }
          });
          return next;
        });
      } else if (payload.operation === 'setSchema') {
        console.log('[AG-UI Client] Received setSchema. Replacing local schema.');
        setSchema(payload.schema);
      } else if (payload.operation === 'generationStatus') {
        console.log('[AG-UI Client] Generation Status:', payload);
        setAiStatus({ status: payload.status, message: payload.message });
        if (payload.status === 'completed' || payload.status === 'failed') {
          setTimeout(() => setAiStatus(null), 4000);
        }
      }
    });
    return unsubscribe;
  }, [registerUpdateHandler]);

  // Auto-open design panel when entering design mode
  useEffect(() => {
    if (designable) {
      setDesignPanelOpen(true);
    } else {
      setDesignPanelOpen(false);
      setSelectedBlockUid(undefined);
      setSelectedBlockSchema(undefined);
    }
  }, [designable]);

  // Debounced persistence
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSchema = useCallback(
    (uid: string, updatedSchema: any) => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(async () => {
        try {
          await apiFetch(`/api/uiSchemas/${uid}`, {
            method: 'PUT',
            body: JSON.stringify({ values: { schema: updatedSchema } }),
          });
        } catch (err: any) {
          console.error('[SchemaPage] Failed to persist schema:', err.message);
        }
      }, 600);
    },
    [],
  );

  // ─── Design callbacks ────────────────────────────────────────────────────

  const handlePatch = useCallback(
    (uid: string, patch: any) => {
      setSchema((prev) => {
        const next = prev.map((item) => {
          if (item.id === uid) {
            const mergedProps = {
              ...item.props,
              ...(patch.props || patch['x-component-props'] || {})
            };
            return {
              ...item,
              ...patch,
              props: mergedProps
            };
          }
          return item;
        });
        persistSchema(schemaUid, next);
        return next;
      });
      sendUserAction(uid, 'patch', patch);
    },
    [schemaUid, persistSchema, sendUserAction],
  );

  const handleRemove = useCallback(
    (uid: string) => {
      setSchema((prev) => {
        const toDelete = new Set<string>([uid]);
        let sizeBefore: number;
        do {
          sizeBefore = toDelete.size;
          for (const item of prev) {
            if (item.parentId && toDelete.has(item.parentId)) {
              toDelete.add(item.id);
            }
          }
        } while (toDelete.size > sizeBefore);

        const next = prev.filter((item) => !toDelete.has(item.id));
        persistSchema(schemaUid, next);
        return next;
      });
      sendUserAction(uid, 'remove');
    },
    [schemaUid, persistSchema, sendUserAction],
  );

  const handleMove = useCallback(
    (uid: string, direction: 'up' | 'down') => {
      setSchema((prev) => {
        const targetIndex = prev.findIndex((item) => item.id === uid);
        if (targetIndex === -1) return prev;
        const target = prev[targetIndex];
        const siblings = prev
          .filter((item) => item.parentId === target.parentId)
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        const siblingIndex = siblings.findIndex((item) => item.id === uid);

        siblings.forEach((sib, sIdx) => {
          if (sib.sort === undefined) {
            sib.sort = sIdx * 10;
          }
        });

        if (direction === 'up' && siblingIndex > 0) {
          const prevSibling = siblings[siblingIndex - 1];
          const temp = target.sort ?? 0;
          target.sort = prevSibling.sort ?? 0;
          prevSibling.sort = temp;
        } else if (direction === 'down' && siblingIndex < siblings.length - 1) {
          const nextSibling = siblings[siblingIndex + 1];
          const temp = target.sort ?? 0;
          target.sort = nextSibling.sort ?? 0;
          nextSibling.sort = temp;
        }

        const next = [...prev];
        persistSchema(schemaUid, next);
        return next;
      });
      sendUserAction(uid, `move_${direction}`);
    },
    [schemaUid, persistSchema, sendUserAction],
  );

  const handleInsert = useCallback(
    (uid: string, position: 'before' | 'after' | 'child', newBlock: any) => {
      setSchema((prev) => {
        const newComponents = treeToFlat(newBlock);
        if (newComponents.length === 0) return prev;

        const newRoot = newComponents[0];
        const target = prev.find((item) => item.id === uid);

        if (position === 'child') {
          newRoot.parentId = uid;
          newRoot.sort = (prev.filter(item => item.parentId === uid).length + 1) * 10;
        } else if (target) {
          newRoot.parentId = target.parentId;
          newRoot.sort = position === 'before' ? (target.sort ?? 0) - 5 : (target.sort ?? 0) + 5;
        }

        const next = [...prev, ...newComponents];
        persistSchema(schemaUid, next);
        return next;
      });
      sendUserAction(uid, 'insert', { position, newBlock });
    },
    [schemaUid, persistSchema, sendUserAction],
  );

  const handleSelectBlock = useCallback((uid: string, blockSchema: any) => {
    setSelectedBlockUid(uid);
    setSelectedBlockSchema(blockSchema);
    setDesignPanelOpen(true);
  }, []);

  // AI generation callback
  const handleAIGenerate = useCallback(
    async (prompt: string, context: any) => {
      const res = await apiFetch<any>('/api/ai/a2ui', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          mode: 'modify',
          context: { ...context, sessionId }
        }),
      });
      return {
        data: res?.data,
        message: res?.message
      };
    },
    [sessionId],
  );

  // ─── Load schema ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!appId || !menuPath) return;

    setLoading(true);
    setError(null);

    // 1. Load all menus for the app to find the one matching menuPath
    apiFetch<any>(`/api/apps/${appId}/menus`)
      .then(async (menusRes) => {
        const menus: any[] = menusRes?.data ?? [];
        const menu = menus.find((m: any) => m.path === menuPath || String(m.id) === menuPath);

        if (!menu) {
          setError(`Page not found: "${menuPath}"`);
          return;
        }

        setMenuItem(menu);

        // 2. Load the UI schema if we have a schemaUid
        if (menu.schemaUid) {
          setSchemaUid(menu.schemaUid);
          const schemaRes = await apiFetch<any>(`/api/uiSchemas/${menu.schemaUid}`);
          const rawSchema = schemaRes?.data?.schema ?? null;
          if (rawSchema) {
            setSchema(treeToFlat(rawSchema));
          } else {
            setSchema([]);
          }
        } else if (menu.type === 'group') {
          setError('This is a menu group, not a page.');
        } else {
          setSchema([]);
        }
      })
      .catch((err: any) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [appId, menuPath]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <Alert
          type="error"
          message="Page Error"
          description={error}
          showIcon
        />
      </div>
    );
  }

  const pageTitle = menuItem?.title || menuPath || 'Page';
  const isRootPage = schema && schema.some((c) => c.type === 'Page' && !c.parentId);
  const collectionName = menuItem?.collectionName || '';

  return (
    <PageAIContextProvider
      initialContext={{
        appId: appId || '',
        pageSchemaUid: menuItem?.schemaUid || '',
        collectionName,
        currentFilters: {},
        selectedRecordIds: [],
        visibleFields: [],
        userPermissions,
      }}
    >
      {/* Design mode banner */}
      {designable && (
        <div
          style={{
            background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
            color: '#fff',
            padding: '6px 16px',
            fontSize: 12,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            letterSpacing: '0.02em',
          }}
        >
          <span style={{ fontSize: 14 }}>✦</span>
          <span>Design Mode — hover over blocks to edit, or use the AI assistant →</span>
          <button
            onClick={() => setDesignPanelOpen((v) => !v)}
            style={{
              marginLeft: 'auto',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              padding: '2px 10px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {designPanelOpen ? 'Close AI Panel' : 'Open AI Panel'}
          </button>
        </div>
      )}

      {/* Page container — shift left when design panel is open */}
      <div
        className="formai-page-container"
        style={{
          padding: isRootPage ? 0 : undefined,
          minHeight: '100%',
          marginRight: designable && designPanelOpen ? 380 : 0,
          transition: 'margin-right 0.25s ease',
        }}
      >
        {/* Dynamic AI Generation/Modification Progress Alert */}
        {aiStatus && (
          <div style={{ padding: isRootPage ? '16px 24px 0 24px' : '0 0 16px 0' }}>
            <Alert
              message={
                <span style={{ fontWeight: 500 }}>
                  {aiStatus.status === 'completed' && '✦ '}
                  {aiStatus.status === 'failed' && '⚠ '}
                  {aiStatus.message}
                </span>
              }
              type={
                aiStatus.status === 'completed'
                  ? 'success'
                  : aiStatus.status === 'failed'
                  ? 'error'
                  : 'info'
              }
              showIcon
              action={
                (aiStatus.status === 'generating_blueprint' || aiStatus.status === 'generating_components') && (
                  <Spin size="small" style={{ marginLeft: 8 }} />
                )
              }
            />
          </div>
        )}

        {/* Page title */}
        {!isRootPage && (
          <div style={{ marginBottom: 20 }}>
            <Title level={3} style={{ margin: 0 }}>
              {pageTitle}
            </Title>
          </div>
        )}

        {/* Schema-rendered content */}
        {schema && schema.length > 0 ? (
          <SchemaRenderer
            schema={schema}
            designable={designable}
            onPatch={handlePatch}
            onRemove={handleRemove}
            onInsert={handleInsert}
            onSelectBlock={handleSelectBlock}
            onMove={handleMove}
          />
        ) : (
          <Empty
            description={
              <div>
                <div style={{ marginBottom: 8 }}>This page has no schema configured yet.</div>
                <div style={{ fontSize: 13, color: token.colorTextSecondary }}>
                  {designable
                    ? 'Use the AI Design Assistant (right panel) to generate a UI for this page.'
                    : 'Use the AI Assistant to generate a UI for this page, or configure it in the admin panel.'}
                </div>
              </div>
            }
          />
        )}
      </div>

      {/* AI Design Panel (right drawer, only in design mode) */}
      {designable && (
        <PageDesignPanel
          open={designPanelOpen}
          onClose={() => setDesignPanelOpen(false)}
          schemaUid={schemaUid}
          pageSchema={schema}
          selectedBlockUid={selectedBlockUid}
          selectedBlockSchema={selectedBlockSchema}
          onAIGenerate={handleAIGenerate}
          onPatch={handlePatch}
          onInsert={handleInsert}
        />
      )}

      {/* Floating AI assistant trigger (runtime assistant, hidden in design mode) */}
      {!designable && (
        <>
          <PageAIAssistantTrigger onClick={() => setAiOpen((v) => !v)} isOpen={aiOpen} />
          <PageAIAssistant open={aiOpen} onClose={() => setAiOpen(false)} />
        </>
      )}
    </PageAIContextProvider>
  );
}
