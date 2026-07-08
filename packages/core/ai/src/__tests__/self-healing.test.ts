import { describe, it, expect, beforeEach } from 'vitest';
import { A2UIEngine } from '../a2ui/engine';
import { LLMManager } from '../llm/manager';
import { MockLLMProvider } from '../llm/providers/mock';

describe('Codex Self-Healing & Blueprint Compilation', () => {
  let manager: LLMManager;
  let mock: MockLLMProvider;
  let engine: A2UIEngine;

  beforeEach(() => {
    manager = new LLMManager();
    mock = new MockLLMProvider();
    manager.registerProvider(mock);
    engine = new A2UIEngine(manager);
  });

  it('runs the multi-agent blueprint-driven page generation pipeline', async () => {
    // 1. First response: A2Architect PageBlueprint
    const mockBlueprint = {
      title: 'Contract Directory',
      collection: 'contracts',
      description: 'Manage company contracts',
      blocks: [
        {
          id: 'contractsFilter',
          type: 'FilterBlock',
          title: 'Search Contracts',
          fields: ['name', 'status'],
        },
        {
          id: 'contractsTable',
          type: 'TableBlock',
          title: 'Contracts Grid',
          fields: ['name', 'status', 'amount'],
          actions: [
            { name: 'add', title: 'Create Contract', type: 'openDrawer' },
            { name: 'import', title: 'Import Contracts', type: 'import' },
            { name: 'export', title: 'Export Contracts', type: 'export' },
            { name: 'destroy', title: 'Delete Selected', type: 'destroy' },
          ],
        },
      ],
    };

    // 2. Second response: A2UI Generator Form Block
    const mockFormBlock = [
      {
        id: 'contractsForm',
        type: 'Form',
      }
    ];

    mock.setResponses([
      { role: 'assistant', content: JSON.stringify(mockBlueprint) },
      { role: 'assistant', content: JSON.stringify(mockFormBlock) },
    ]);

    const result = await engine.generatePage({
      prompt: 'Build a standard premium contract directory with search, batch delete, csv import and export.',
      collection: 'contracts',
      fields: ['name', 'status', 'amount'],
      mode: 'create',
    });

    // Verify A2Integration stitched properties correctly in flat list
    expect(Array.isArray(result)).toBe(true);
    
    const rootPage = result.find((c: any) => c.id === 'page-root');
    expect(rootPage).toBeDefined();
    expect(rootPage.type).toBe('Page');
    expect(rootPage.props?.title).toBe('Contract Directory');

    // Verify FilterBlock is placed
    const filterBlock = result.find((c: any) => c.type === 'FilterBlock');
    expect(filterBlock).toBeDefined();
    expect(filterBlock.props?.collection).toBe('contracts');

    // Verify Space (actions bar) is placed
    const actionsSpace = result.find((c: any) => c.type === 'Space');
    expect(actionsSpace).toBeDefined();

    // Verify Table is placed
    const tableBlock = result.find((c: any) => c.type === 'Table');
    expect(tableBlock).toBeDefined();
    expect(tableBlock.props?.collection).toBe('contracts');
  });

  it('triggers Codex self-healing compiler loop when schema has validation errors', async () => {
    const correctedSchema = [
      {
        id: 'page-root',
        type: 'Page',
        props: { title: 'Corrected' }
      }
    ];

    mock.setResponses([
      { role: 'assistant', content: JSON.stringify(correctedSchema) },
    ]);

    const invalidSchema = [
      {
        id: 'page-root',
        type: 'Page',
        props: { title: 'Invalid' },
        parentId: 'non-existent' // Connectivity issue
      }
    ];

    const healed = await (engine as any).selfHealSchema(invalidSchema, ['Invalid parentId dependency "non-existent"']);

    expect(Array.isArray(healed)).toBe(true);
    expect(healed[0].props?.title).toBe('Corrected');
  });
});
