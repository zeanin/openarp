import { describe, it, expect, vi } from 'vitest';
import { ClipsService } from '../services/clips-service';
import { AnalyticsService } from '../services/analytics-service';
import { FormsService } from '../services/forms-service';

describe('@formai/plugin-agent-modules Services', () => {
  describe('ClipsService', () => {
    it('creates a clip and updates its transcript and chapters', async () => {
      const service = new ClipsService();
      const clip = await service.createClip({
        title: 'Equipment Maintenance Inspection',
        description: 'Sound abnormality detected on pump #4',
        videoUrl: 'https://cdn.example.com/clips/inspection_101.mp4',
        duration: 240,
        appId: 'app_equipment_maint',
        relatedCollection: 'maintenance_tickets',
        relatedRecordId: 'ticket_101',
      });

      expect(clip.id).toBeDefined();
      expect(clip.title).toBe('Equipment Maintenance Inspection');
      expect(clip.duration).toBe(240);

      const updated = await service.updateTranscript(clip.id, [
        { startTime: 10, endTime: 25, text: 'Pump 4 shows severe bearing vibration.', speaker: 'Technician Li' },
        { startTime: 30, endTime: 55, text: 'We must replace the bearing assembly urgently.', speaker: 'Supervisor Zhang' },
      ]);

      expect(updated.transcript?.length).toBe(2);
      expect(updated.chapters?.length).toBeGreaterThan(0);
    });

    it('extracts action items from transcript and converts them into collection records', async () => {
      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify([
            {
              title: 'Replace bearing assembly on pump 4',
              description: 'Procure replacement parts and perform swap',
              priority: 'urgent',
              suggestedAssignee: 'Technician Li',
              timestamp: 30,
            },
          ]),
        }),
      } as any;

      const service = new ClipsService(mockLLM);
      const clip = await service.createClip({
        title: 'Pump Vibration Diagnostics',
        videoUrl: 'https://cdn.example.com/clips/diag.mp4',
      });

      await service.updateTranscript(clip.id, [
        { startTime: 0, endTime: 30, text: 'Pump 4 bearing damaged. We need urgent replacement.' },
      ]);

      const actionItems = await service.extractActionItems(clip.id);
      expect(actionItems.length).toBe(1);
      expect(actionItems[0].title).toBe('Replace bearing assembly on pump 4');
      expect(actionItems[0].priority).toBe('urgent');

      const mockCreator = vi.fn().mockImplementation(async (col, data) => ({
        id: `ticket_${Date.now()}`,
        ...data,
      }));

      const converted = await service.convertActionItemsToRecords(clip.id, 'maintenance_tickets', mockCreator);
      expect(converted.length).toBe(1);
      expect(mockCreator).toHaveBeenCalledWith(
        'maintenance_tickets',
        expect.objectContaining({
          title: 'Replace bearing assembly on pump 4',
          priority: 'urgent',
          clip_id: clip.id,
        })
      );
    });
  });

  describe('AnalyticsService', () => {
    const sampleRecords = [
      { id: 1, name: 'Deal A', amount: 50000, status: 'Won', department: 'Sales' },
      { id: 2, name: 'Deal B', amount: 30000, status: 'Lost', department: 'Sales' },
      { id: 3, name: 'Deal C', amount: 80000, status: 'Won', department: 'Enterprise' },
      { id: 4, name: 'Deal D', amount: 20000, status: 'Won', department: 'Sales' },
    ];

    it('calculates metrics (count, sum, avg) accurately', () => {
      const service = new AnalyticsService();
      const metrics = service.calculateMetrics(sampleRecords, [
        { key: 'deal_count', title: 'Total Deals', aggregation: 'count' },
        { key: 'deal_amount', title: 'Total Revenue', field: 'amount', aggregation: 'sum', format: 'currency' },
        { key: 'avg_deal', title: 'Average Deal Size', field: 'amount', aggregation: 'avg', format: 'currency' },
      ]);

      expect(metrics[0].value).toBe(4);
      expect(metrics[1].value).toBe(180000);
      expect(metrics[1].formattedValue).toBe('¥180,000');
      expect(metrics[2].value).toBe(45000);
    });

    it('generates multi-dimensional chart data grouped by category', () => {
      const service = new AnalyticsService();
      const chart = service.generateChartData(sampleRecords, {
        title: 'Deals by Department',
        chartType: 'bar',
        dimensionField: 'department',
        metricField: 'amount',
        aggregation: 'sum',
      });

      expect(chart.series[0].data).toEqual([
        { label: 'Sales', value: 100000 },
        { label: 'Enterprise', value: 80000 },
      ]);
    });
  });

  describe('FormsService', () => {
    it('manages multi-step form submissions and finalizes into target collection', async () => {
      const service = new FormsService();
      service.registerForm({
        id: 'customer_lead_form',
        title: 'Customer Inquiry Form',
        targetCollection: 'leads',
        isPublic: true,
        steps: [
          {
            id: 'step_contact',
            title: 'Contact Information',
            fields: [
              { name: 'name', label: 'Full Name', type: 'string', required: true },
              { name: 'email', label: 'Email Address', type: 'string', required: true },
            ],
          },
          {
            id: 'step_needs',
            title: 'Requirements',
            fields: [
              { name: 'requirement', label: 'Your Needs', type: 'text' },
              { name: 'budget', label: 'Estimated Budget', type: 'number' },
            ],
          },
        ],
      });

      const session = service.startSubmission('customer_lead_form');
      expect(session.currentStepIndex).toBe(0);

      service.saveStep(session.id, 0, { name: 'Alice Smith', email: 'alice@example.com' });
      service.saveStep(session.id, 1, { requirement: 'Automated CRM system', budget: 150000 });

      const mockCreator = vi.fn().mockResolvedValue({ id: 'lead_999' });
      const result = await service.finalizeSubmission(session.id, mockCreator);

      expect(result.recordId).toBe('lead_999');
      expect(mockCreator).toHaveBeenCalledWith('leads', {
        name: 'Alice Smith',
        email: 'alice@example.com',
        requirement: 'Automated CRM system',
        budget: 150000,
      });
    });
  });
});
