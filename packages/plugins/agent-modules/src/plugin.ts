import { Plugin } from '@formai/plugin';
import { ClipsService } from './services/clips-service';
import { AnalyticsService } from './services/analytics-service';
import { FormsService } from './services/forms-service';

export default class AgentModulesPlugin extends Plugin {
  public clipsService: ClipsService = new ClipsService();
  public analyticsService: AnalyticsService = new AnalyticsService();
  public formsService: FormsService = new FormsService();

  async load(): Promise<void> {
    // 1. Register collections for high-order domain modules
    this.defineCollection({
      name: 'app_clips',
      title: 'Video & Audio Clips',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'description', type: 'text' },
        { name: 'video_url', type: 'string', required: true },
        { name: 'thumbnail_url', type: 'string' },
        { name: 'duration', type: 'integer', defaultValue: 0 },
        { name: 'app_id', type: 'string' },
        { name: 'related_collection', type: 'string' },
        { name: 'related_record_id', type: 'string' },
        { name: 'status', type: 'string', defaultValue: 'ready' },
      ],
    });

    this.defineCollection({
      name: 'app_clip_action_items',
      title: 'Clip Action Items',
      fields: [
        { name: 'clip_id', type: 'string', required: true },
        { name: 'title', type: 'string', required: true },
        { name: 'description', type: 'text' },
        { name: 'priority', type: 'string', defaultValue: 'medium' },
        { name: 'suggested_assignee', type: 'string' },
        { name: 'timestamp', type: 'integer', defaultValue: 0 },
        { name: 'converted_record_id', type: 'string' },
      ],
    });

    // 2. Register REST resources
    this.registerResource({
      name: 'agent_modules_clips',
      actions: {
        list: async (ctx: any) => {
          const filter = ctx.query;
          const clips = await this.clipsService.listClips(filter);
          ctx.body = { data: clips };
        },
        create: async (ctx: any) => {
          const clip = await this.clipsService.createClip(ctx.request.body);
          ctx.body = { data: clip };
        },
        get: async (ctx: any) => {
          const clip = await this.clipsService.getClip(ctx.params.id);
          ctx.body = { data: clip };
        },
      },
    });

    this.registerResource({
      name: 'agent_modules_analytics',
      actions: {
        calculate: async (ctx: any) => {
          const { records, configs } = ctx.request.body || {};
          const results = this.analyticsService.calculateMetrics(records || [], configs || []);
          ctx.body = { data: results };
        },
        chart: async (ctx: any) => {
          const { records, config } = ctx.request.body || {};
          const result = this.analyticsService.generateChartData(records || [], config);
          ctx.body = { data: result };
        },
      },
    });
  }

  async install(): Promise<void> {
    // Install initial seed or schema setup if needed
  }
}
