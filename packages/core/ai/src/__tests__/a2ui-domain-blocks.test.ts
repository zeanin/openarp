import { describe, it, expect, vi } from 'vitest';
import { A2UIEngine } from '../a2ui/engine';

describe('A2UIEngine Domain Blocks & Blueprint Inference', () => {
  it('compiles ClipsBlock, MetricGridBlock, and SmartChartBlock into flat component list', async () => {
    const mockExecutor = vi.fn().mockImplementation(async (schema, prompt, sysPrompt) => {
      // Return a blueprint that contains ClipsBlock and MetricGridBlock
      return {
        title: 'Equipment Maintenance Center',
        collection: 'maintenance_tickets',
        description: 'Manage equipment inspection videos and maintenance work orders',
        blocks: [
          {
            id: 'inspectionClips',
            type: 'ClipsBlock',
            title: 'Field Inspection Videos',
            collection: 'app_clips',
            fields: ['title', 'duration', 'status'],
          },
          {
            id: 'metricsSummary',
            type: 'MetricGridBlock',
            title: 'Equipment Metrics',
            collection: 'maintenance_tickets',
            fields: ['status', 'priority'],
          },
          {
            id: 'ticketsTable',
            type: 'TableBlock',
            title: 'Work Orders',
            collection: 'maintenance_tickets',
            fields: ['title', 'status', 'priority'],
            actions: [{ name: 'add', title: 'New Ticket', type: 'openDrawer' }],
          },
        ],
      };
    });

    const engine = new A2UIEngine({} as any);
    (engine as any).executePrompt = mockExecutor;

    const components = await engine.generatePage({
      prompt: '新能源设备现场录像与故障检修工单系统',
      collection: 'maintenance_tickets',
      fields: ['title', 'status', 'priority'],
      mode: 'create',
    });

    expect(components).toBeDefined();
    expect(components.length).toBeGreaterThan(0);

    const clipsComp = components.find((c) => c.type === 'ClipsBlock');
    expect(clipsComp).toBeDefined();
    expect(clipsComp?.id).toBe('inspectionClips');
    expect(clipsComp?.props.collection).toBe('app_clips');

    const metricsComp = components.find((c) => c.type === 'MetricGridBlock');
    expect(metricsComp).toBeDefined();
    expect(metricsComp?.id).toBe('metricsSummary');

    const tableComp = components.find((c) => c.type === 'Table');
    expect(tableComp).toBeDefined();
  });

  it('triggers inspection/clips domain inference when prompt mentions video recording', async () => {
    let capturedSystemPrompt = '';
    const mockExecutor = vi.fn().mockImplementation(async (schema, prompt, sysPrompt) => {
      capturedSystemPrompt = sysPrompt;
      return {
        title: 'Video Inspection',
        collection: 'inspection_records',
        description: 'Video recordings',
        blocks: [],
      };
    });

    const engine = new A2UIEngine({} as any);
    (engine as any).executePrompt = mockExecutor;

    await engine.generatePage({
      prompt: '厂区巡检现场录像与故障排障记录',
      collection: 'inspection_records',
      mode: 'create',
    });

    expect(capturedSystemPrompt).toContain('Video Inspection / Training blueprint');
    expect(capturedSystemPrompt).toContain('ClipsBlock');
  });
});
