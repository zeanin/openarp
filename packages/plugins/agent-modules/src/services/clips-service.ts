import { LLMManager } from '@formai/ai';

export interface ClipChapter {
  title: string;
  startTime: number; // in seconds
  endTime: number;
  summary?: string;
}

export interface ClipTranscriptSegment {
  speaker?: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface ClipActionItem {
  id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  suggestedAssignee?: string;
  timestamp?: number;
  convertedRecordId?: string | number;
}

export interface ClipRecord {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration: number; // in seconds
  appId?: string;
  relatedCollection?: string;
  relatedRecordId?: string | number;
  transcript?: ClipTranscriptSegment[];
  chapters?: ClipChapter[];
  actionItems?: ClipActionItem[];
  status: 'processing' | 'ready' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface CreateClipInput {
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  appId?: string;
  relatedCollection?: string;
  relatedRecordId?: string | number;
}

export class ClipsService {
  private clips: Map<string, ClipRecord> = new Map();

  constructor(private llmManager?: LLMManager) {}

  /**
   * Register a new clip recording
   */
  async createClip(input: CreateClipInput): Promise<ClipRecord> {
    const id = `clip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const clip: ClipRecord = {
      id,
      title: input.title,
      description: input.description,
      videoUrl: input.videoUrl,
      thumbnailUrl: input.thumbnailUrl || '',
      duration: input.duration || 0,
      appId: input.appId,
      relatedCollection: input.relatedCollection,
      relatedRecordId: input.relatedRecordId,
      status: 'ready',
      transcript: [],
      chapters: [],
      actionItems: [],
      createdAt: now,
      updatedAt: now,
    };
    this.clips.set(id, clip);
    return clip;
  }

  /**
   * Get a clip by ID
   */
  async getClip(id: string): Promise<ClipRecord | null> {
    return this.clips.get(id) || null;
  }

  /**
   * List clips with optional filter
   */
  async listClips(filter?: { appId?: string; relatedCollection?: string; relatedRecordId?: string | number }): Promise<ClipRecord[]> {
    let list = Array.from(this.clips.values());
    if (filter?.appId) {
      list = list.filter((c) => c.appId === filter.appId);
    }
    if (filter?.relatedCollection) {
      list = list.filter((c) => c.relatedCollection === filter.relatedCollection);
    }
    if (filter?.relatedRecordId !== undefined) {
      list = list.filter((c) => c.relatedRecordId === filter.relatedRecordId);
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Update transcription and auto-generate chapters
   */
  async updateTranscript(
    id: string,
    transcript: ClipTranscriptSegment[],
    chapters?: ClipChapter[]
  ): Promise<ClipRecord> {
    const clip = this.clips.get(id);
    if (!clip) throw new Error(`Clip with id ${id} not found`);

    clip.transcript = transcript;
    if (chapters && chapters.length > 0) {
      clip.chapters = chapters;
    } else {
      // Generate default chapters based on time intervals if none provided
      clip.chapters = this.buildDefaultChapters(transcript);
    }
    clip.updatedAt = new Date().toISOString();
    this.clips.set(id, clip);
    return clip;
  }

  /**
   * Extract Action Items from the transcript using LLM or structured rules
   */
  async extractActionItems(id: string, options?: { prompt?: string }): Promise<ClipActionItem[]> {
    const clip = this.clips.get(id);
    if (!clip) throw new Error(`Clip with id ${id} not found`);

    const fullText = (clip.transcript || []).map((t) => `${t.speaker || 'Speaker'}: ${t.text}`).join('\n');

    let actionItems: ClipActionItem[] = [];

    if (this.llmManager && fullText.trim().length > 0) {
      try {
        const prompt = `Analyze the following meeting / inspection recording transcript and extract concrete action items.
Transcript:
${fullText}

Return a valid JSON array of objects with fields:
- "title": concise task title
- "description": details of what needs to be done
- "priority": one of "low", "medium", "high", "urgent"
- "suggestedAssignee": name or role if mentioned
- "timestamp": seconds into the video where this was discussed (or 0)
Do NOT include markdown formatting, return pure JSON only.`;

        const res = await this.llmManager.chat(prompt, { temperature: 0.1 });
        const cleanContent = res.content.replace(/^```json/m, '').replace(/```$/m, '').trim();
        const parsed = JSON.parse(cleanContent);
        if (Array.isArray(parsed)) {
          actionItems = parsed.map((item, idx) => ({
            id: `action_${id}_${idx + 1}`,
            title: item.title || `Action Item ${idx + 1}`,
            description: item.description,
            priority: ['low', 'medium', 'high', 'urgent'].includes(item.priority) ? item.priority : 'medium',
            suggestedAssignee: item.suggestedAssignee,
            timestamp: typeof item.timestamp === 'number' ? item.timestamp : 0,
          }));
        }
      } catch {
        // Fallback to heuristic extraction if LLM parse fails
        actionItems = this.heuristicExtractActionItems(id, clip.transcript || []);
      }
    } else {
      actionItems = this.heuristicExtractActionItems(id, clip.transcript || []);
    }

    clip.actionItems = actionItems;
    clip.updatedAt = new Date().toISOString();
    this.clips.set(id, clip);
    return actionItems;
  }

  /**
   * Convert extracted action items directly into FormAI collection records (e.g. maintenance_tickets)
   */
  async convertActionItemsToRecords(
    clipId: string,
    targetCollection: string,
    recordCreator: (collection: string, data: Record<string, any>) => Promise<any>
  ): Promise<Array<{ actionItemId: string; recordId: any }>> {
    const clip = this.clips.get(clipId);
    if (!clip) throw new Error(`Clip with id ${clipId} not found`);

    const results: Array<{ actionItemId: string; recordId: any }> = [];

    for (const item of clip.actionItems || []) {
      if (item.convertedRecordId) continue; // Already converted

      const recordData: Record<string, any> = {
        title: item.title,
        description: `${item.description || ''}\n\n[Originated from Video Clip: ${clip.title} (at ${Math.floor((item.timestamp || 0) / 60)}m${(item.timestamp || 0) % 60}s)]`,
        priority: item.priority,
        status: 'pending',
        clip_id: clip.id,
      };

      if (item.suggestedAssignee) {
        recordData.assignee = item.suggestedAssignee;
      }

      const created = await recordCreator(targetCollection, recordData);
      item.convertedRecordId = created.id || created._id || `rec_${Date.now()}`;
      results.push({ actionItemId: item.id, recordId: item.convertedRecordId });
    }

    clip.updatedAt = new Date().toISOString();
    this.clips.set(clipId, clip);
    return results;
  }

  private buildDefaultChapters(transcript: ClipTranscriptSegment[]): ClipChapter[] {
    if (!transcript || transcript.length === 0) return [];
    const chapters: ClipChapter[] = [];
    const interval = 120; // 2 minutes chunks
    let currentChapter: ClipChapter | null = null;

    for (const seg of transcript) {
      const chapterIdx = Math.floor(seg.startTime / interval);
      const chapterStart = chapterIdx * interval;
      if (!currentChapter || currentChapter.startTime !== chapterStart) {
        currentChapter = {
          title: `Chapter ${chapterIdx + 1} (${Math.floor(chapterStart / 60)}:00)`,
          startTime: chapterStart,
          endTime: chapterStart + interval,
          summary: seg.text.slice(0, 80),
        };
        chapters.push(currentChapter);
      }
    }
    return chapters;
  }

  private heuristicExtractActionItems(clipId: string, transcript: ClipTranscriptSegment[]): ClipActionItem[] {
    const items: ClipActionItem[] = [];
    const actionKeywords = ['需', '需要', '安排', '待办', '排查', '处理', '修复', 'need', 'must', 'should', 'fix', 'assign', 'action item'];

    let count = 1;
    for (const seg of transcript) {
      const lower = seg.text.toLowerCase();
      if (actionKeywords.some((kw) => lower.includes(kw))) {
        items.push({
          id: `action_${clipId}_${count++}`,
          title: seg.text.slice(0, 60),
          description: seg.text,
          priority: lower.includes('urgent') || lower.includes('紧急') ? 'urgent' : 'medium',
          timestamp: seg.startTime,
        });
      }
    }

    if (items.length === 0 && transcript.length > 0) {
      items.push({
        id: `action_${clipId}_1`,
        title: `Review Recording: ${transcript[0]?.text.slice(0, 40) || 'Session notes'}`,
        description: 'Complete video review and follow up with stakeholders.',
        priority: 'medium',
        timestamp: 0,
      });
    }

    return items;
  }
}
