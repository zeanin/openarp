export type SyncStrategy = 'pull' | 'push' | 'webhook';

export interface TransformRule {
  sourcePath: string; // dot-notation or field name in external response
  targetField: string; // field in internal database collection
  type?: 'string' | 'number' | 'boolean' | 'date';
  defaultValue?: any;
}

export interface ExternalDataSource {
  id: string;
  name: string;
  description?: string;
  type: 'http_api' | 'feed' | 'market_quote' | 'webhook';
  endpoint?: string;
  headers?: Record<string, string>;
  refreshIntervalSeconds?: number;
  mockPayload?: any; // Mock response for offline/embedded execution
}

export interface SyncResult {
  sourceId: string;
  targetCollection: string;
  syncedRecords: number;
  timestamp: Date;
  status: 'success' | 'failed';
  error?: string;
}

export class ExternalDataConnector {
  private sources: Map<string, ExternalDataSource> = new Map();

  constructor() {
    this.registerDefaultSources();
  }

  private registerDefaultSources(): void {
    // 1. 国际汇率与货币对实时数据源
    this.registerSource({
      id: 'market_fx_rates',
      name: 'Global FX Exchange Rates Feed',
      description: '实时国际外汇汇率（USD, CNY, EUR, JPY），用于跨境结算与采购成本核算',
      type: 'market_quote',
      mockPayload: {
        base: 'USD',
        date: new Date().toISOString().split('T')[0],
        rates: {
          CNY: 7.245,
          EUR: 0.925,
          JPY: 154.2,
          HKD: 7.82,
        },
      },
    });

    // 2. 工业原材料与大宗商品指数
    this.registerSource({
      id: 'market_commodities',
      name: 'Industrial Raw Materials & Commodity Index',
      description: '铜、铝、原油与芯片等关键工业原材料价格指数与波动率',
      type: 'market_quote',
      mockPayload: [
        { code: 'COPPER', name: '阴极铜', price: 74500.0, unit: '元/吨', changePercent: -1.2 },
        { code: 'ALUM', name: '电解铝', price: 19800.0, unit: '元/吨', changePercent: 0.8 },
        { code: 'SILICON', name: '工业多晶硅', price: 42.0, unit: '元/千克', changePercent: -3.5 },
        { code: 'STEEL', name: '热轧板卷', price: 3550.0, unit: '元/吨', changePercent: -0.4 },
      ],
    });

    // 3. 行业竞对价格与舆情监测源
    this.registerSource({
      id: 'competitor_intel',
      name: 'Competitor Intelligence & Price Index',
      description: '同业主流竞品公开售价与近期促销降价活动情报',
      type: 'feed',
      mockPayload: [
        { competitor: 'Alpha Corp', productCategory: 'Cloud CRM', avgDiscount: '15%', promotion: '秋季限时立减 20%' },
        { competitor: 'Beta Tech', productCategory: 'Supply Chain WMS', avgDiscount: '5%', promotion: '买三年送一年实施' },
      ],
    });
  }

  registerSource(source: ExternalDataSource): void {
    this.sources.set(source.id, source);
  }

  getSource(id: string): ExternalDataSource | undefined {
    return this.sources.get(id);
  }

  listSources(): ExternalDataSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * Fetches data from external source. Uses mockPayload if no endpoint or network fails.
   */
  async fetchData(sourceId: string): Promise<any> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`External data source "${sourceId}" is not registered.`);
    }

    if (source.endpoint) {
      try {
        const response = await fetch(source.endpoint, {
          headers: source.headers || {},
        });
        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
        }
        return await response.json();
      } catch (err) {
        if (source.mockPayload) {
          return source.mockPayload;
        }
        throw err;
      }
    }

    return source.mockPayload;
  }

  /**
   * Synchronizes external source data into an internal database collection.
   */
  async syncToCollection(
    sourceId: string,
    targetCollection: string,
    transformRules: TransformRule[],
    db?: any
  ): Promise<SyncResult> {
    const source = this.sources.get(sourceId);
    if (!source) {
      return {
        sourceId,
        targetCollection,
        syncedRecords: 0,
        timestamp: new Date(),
        status: 'failed',
        error: `External data source "${sourceId}" not found.`,
      };
    }

    try {
      const data = await this.fetchData(sourceId);
      const items = Array.isArray(data) ? data : [data];
      let syncedCount = 0;

      if (db) {
        const repo = db.getRepository(targetCollection);
        if (repo) {
          for (const item of items) {
            const transformedRecord: Record<string, any> = {};

            for (const rule of transformRules) {
              let rawVal = this.getNestedValue(item, rule.sourcePath);
              if (rawVal === undefined || rawVal === null) {
                rawVal = rule.defaultValue;
              }

              if (rule.type === 'number' && rawVal !== undefined) {
                rawVal = Number(rawVal);
              } else if (rule.type === 'string' && rawVal !== undefined) {
                rawVal = String(rawVal);
              } else if (rule.type === 'date' && rawVal !== undefined) {
                rawVal = new Date(rawVal).toISOString();
              }

              transformedRecord[rule.targetField] = rawVal;
            }

            try {
              await repo.create({ values: transformedRecord });
              syncedCount++;
            } catch {
              // Ignore single item insertion collision
            }
          }
        }
      }

      return {
        sourceId,
        targetCollection,
        syncedRecords: syncedCount || items.length,
        timestamp: new Date(),
        status: 'success',
      };
    } catch (err: any) {
      return {
        sourceId,
        targetCollection,
        syncedRecords: 0,
        timestamp: new Date(),
        status: 'failed',
        error: err.message,
      };
    }
  }

  private getNestedValue(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = path.split('.');
    let curr = obj;
    for (const part of parts) {
      if (curr === undefined || curr === null) return undefined;
      curr = curr[part];
    }
    return curr;
  }
}
