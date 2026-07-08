import { describe, it, expect, beforeEach } from 'vitest';
import { A2UIEngine } from '../a2ui/engine';
import type { GeneratePageOptions } from '../a2ui/engine';
import { LLMManager } from '../llm/manager';
import { MockLLMProvider } from '../llm/providers/mock';

// ---- Helpers ----

/** A valid CRUD page components list the mock LLM can return */
const MOCK_PAGE_COMPONENTS = [
  {
    id: 'page-root',
    type: 'Page',
    props: { title: 'Users Management' },
    sort: 1
  },
  {
    id: 'layout-grid',
    type: 'Grid',
    parentId: 'page-root',
    sort: 2
  },
  {
    id: 'ab1',
    type: 'Space',
    parentId: 'layout-grid',
    sort: 10
  },
  {
    id: 'ac1',
    type: 'Action',
    parentId: 'ab1',
    props: { title: 'Add New', type: 'primary' },
    sort: 1
  },
  {
    id: 'tbl1',
    type: 'Table',
    parentId: 'layout-grid',
    decorator: 'CardItem',
    props: {
      columns: [
        { title: 'Username', dataIndex: 'username', key: 'username' },
        { title: 'Email', dataIndex: 'email', key: 'email' },
      ],
      pagination: { pageSize: 20 },
    },
    sort: 20
  }
];

const MOCK_TABLE_BLOCK = [
  {
    id: 'blkTbl1',
    type: 'Table',
    decorator: 'CardItem',
    props: {
      columns: [
        { title: 'Name', dataIndex: 'name', key: 'name' },
        { title: 'Value', dataIndex: 'value', key: 'value' },
      ],
      pagination: { pageSize: 10 },
    },
  }
];

const MOCK_FORM_BLOCK = [
  {
    id: 'blkForm1',
    type: 'Form',
  },
  {
    id: 'fName1',
    type: 'Input',
    parentId: 'blkForm1',
    decorator: 'FormItem',
    props: { name: 'name', title: 'Name' }
  },
  {
    id: 'fSubmit1',
    type: 'Action',
    parentId: 'blkForm1',
    props: { title: 'Submit', type: 'primary' }
  }
];

const MOCK_SUGGESTIONS = {
  suggestions: [
    [
      {
        id: 'sugTbl1',
        type: 'Table',
        props: {
          columns: [{ title: 'Name', dataIndex: 'name', key: 'name' }],
        },
      }
    ],
    [
      {
        id: 'sugForm1',
        type: 'Form',
      }
    ],
    [
      {
        id: 'sugDetail1',
        type: 'Descriptions',
        props: { title: 'Detail' }
      }
    ]
  ],
};

describe('A2UIEngine', () => {
  let manager: LLMManager;
  let mock: MockLLMProvider;
  let engine: A2UIEngine;

  beforeEach(() => {
    manager = new LLMManager();
    mock = new MockLLMProvider();
    manager.registerProvider(mock);
    engine = new A2UIEngine(manager);
  });

  // ---- generatePage ----

  describe('generatePage', () => {
    it('generates a valid A2UI components list from a prompt', async () => {
      mock.setResponses([
        { role: 'assistant', content: JSON.stringify(MOCK_PAGE_COMPONENTS) },
      ]);

      const result = await engine.generatePage({
        prompt: 'A user management page',
        collection: 'users',
        mode: 'create',
      });

      expect(Array.isArray(result)).toBe(true);
      const pageNode = result.find((c: any) => c.type === 'Page');
      expect(pageNode).toBeDefined();
      expect(pageNode.props?.title).toBe('Users Management');
    });

    it('passes collection and context in the prompt', async () => {
      let capturedMessages: any[] = [];
      mock.chat = async (messages: any[]) => {
        capturedMessages = messages;
        return { role: 'assistant' as const, content: JSON.stringify(MOCK_PAGE_COMPONENTS) };
      };

      await engine.generatePage({
        prompt: 'A product list page',
        collection: 'products',
        fields: ['name', 'price'],
        context: {
          existingPages: ['Home'],
          collections: ['users', 'products'],
        },
        mode: 'create',
      });

      const userMessage = capturedMessages.find((m: any) => m.role === 'user');
      expect(userMessage?.content).toContain('products');
      expect(userMessage?.content).toContain('name');
    });
  });

  // ---- generateBlock ----

  describe('generateBlock', () => {
    it('generates a table block components list', async () => {
      mock.setResponses([
        { role: 'assistant', content: JSON.stringify(MOCK_TABLE_BLOCK) },
      ]);

      const result = await engine.generateBlock({
        prompt: 'A table showing product data',
        collection: 'products',
        blockType: 'Table',
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result[0].type).toBe('Table');
    });

    it('generates a form block components list', async () => {
      mock.setResponses([
        { role: 'assistant', content: JSON.stringify(MOCK_FORM_BLOCK) },
      ]);

      const result = await engine.generateBlock({
        prompt: 'A form for creating users',
        collection: 'users',
        blockType: 'Form',
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.some((c: any) => c.type === 'Form')).toBe(true);
    });
  });

  // ---- modifySchema ----

  describe('modifySchema', () => {
    it('modifies a schema and returns flat components list', async () => {
      const currentSchema = [
        {
          id: 'origPage1',
          type: 'Page',
          sort: 1
        }
      ];

      const modifiedSchema = [
        {
          id: 'origPage1',
          type: 'Page',
          sort: 1
        },
        {
          id: 'modTbl1',
          type: 'Table',
          parentId: 'origPage1',
          sort: 2
        }
      ];

      mock.setResponses([
        { role: 'assistant', content: JSON.stringify(modifiedSchema) },
      ]);

      const result = await engine.modifySchema(currentSchema, 'Add a table block');

      expect(Array.isArray(result)).toBe(true);
      expect(result.some((c: any) => c.id === 'modTbl1')).toBe(true);
    });
  });

  // ---- suggestUI ----

  describe('suggestUI', () => {
    it('returns multiple suggested layouts', async () => {
      mock.setResponses([
        { role: 'assistant', content: JSON.stringify(MOCK_SUGGESTIONS) },
      ]);

      const results = await engine.suggestUI('products', [
        { name: 'name', type: 'string' },
        { name: 'price', type: 'number' },
      ]);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(3);
      expect(Array.isArray(results[0])).toBe(true);
    });
  });
});
