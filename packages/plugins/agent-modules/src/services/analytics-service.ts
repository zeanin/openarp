import { LLMManager } from '@formai/ai';

export interface MetricCardConfig {
  key: string;
  title: string;
  field?: string;
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
  format?: 'number' | 'currency' | 'percent';
  comparisonPeriod?: 'day' | 'week' | 'month' | 'year';
}

export interface MetricCardResult {
  key: string;
  title: string;
  value: number;
  formattedValue: string;
  changeRate?: number; // e.g. +12.5%
  trend?: 'up' | 'down' | 'flat';
}

export interface ChartDataConfig {
  title: string;
  chartType: 'line' | 'bar' | 'pie' | 'donut' | 'area';
  dimensionField: string; // X-axis / group by
  metricField?: string;   // Y-axis
  aggregation?: 'count' | 'sum' | 'avg';
  timeGranularity?: 'day' | 'week' | 'month';
}

export interface ChartDataResult {
  title: string;
  chartType: string;
  series: Array<{
    name: string;
    data: Array<{ label: string; value: number }>;
  }>;
}

export class AnalyticsService {
  constructor(private llmManager?: LLMManager) {}

  /**
   * Compute KPI metrics from a set of collection records
   */
  calculateMetrics(records: Record<string, any>[], configs: MetricCardConfig[]): MetricCardResult[] {
    return configs.map((cfg) => {
      const field = cfg.field;
      let val = 0;

      if (cfg.aggregation === 'count') {
        val = records.length;
      } else if (field && records.length > 0) {
        const numbers = records
          .map((r) => Number(r[field]))
          .filter((n) => !isNaN(n));

        if (numbers.length > 0) {
          if (cfg.aggregation === 'sum') {
            val = numbers.reduce((a, b) => a + b, 0);
          } else if (cfg.aggregation === 'avg') {
            val = numbers.reduce((a, b) => a + b, 0) / numbers.length;
          } else if (cfg.aggregation === 'max') {
            val = Math.max(...numbers);
          } else if (cfg.aggregation === 'min') {
            val = Math.min(...numbers);
          }
        }
      }

      let formatted = `${Math.round(val * 100) / 100}`;
      if (cfg.format === 'currency') {
        formatted = `¥${val.toLocaleString()}`;
      } else if (cfg.format === 'percent') {
        formatted = `${(val * 100).toFixed(1)}%`;
      }

      return {
        key: cfg.key,
        title: cfg.title,
        value: val,
        formattedValue: formatted,
        changeRate: 8.5, // placeholder baseline trend
        trend: 'up',
      };
    });
  }

  /**
   * Generate aggregated chart series from records
   */
  generateChartData(records: Record<string, any>[], config: ChartDataConfig): ChartDataResult {
    const dim = config.dimensionField;
    const metric = config.metricField;
    const agg = config.aggregation || 'count';

    const groupMap = new Map<string, number[]>();

    for (const r of records) {
      const key = String(r[dim] ?? 'Unknown');
      const val = metric ? Number(r[metric]) || 0 : 1;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(val);
    }

    const dataPoints: Array<{ label: string; value: number }> = [];
    for (const [key, vals] of groupMap.entries()) {
      let finalVal = 0;
      if (agg === 'count') {
        finalVal = vals.length;
      } else if (agg === 'sum') {
        finalVal = vals.reduce((a, b) => a + b, 0);
      } else if (agg === 'avg') {
        finalVal = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      }
      dataPoints.push({ label: key, value: Math.round(finalVal * 100) / 100 });
    }

    return {
      title: config.title,
      chartType: config.chartType,
      series: [
        {
          name: config.title,
          data: dataPoints,
        },
      ],
    };
  }

  /**
   * Translate natural language prompt to chart and metric configs
   */
  async askAnalytics(query: string, availableFields: Array<{ name: string; type: string }>): Promise<{
    recommendedCharts: ChartDataConfig[];
    recommendedMetrics: MetricCardConfig[];
  }> {
    if (this.llmManager) {
      try {
        const prompt = `Given the user query "${query}" and available fields: ${JSON.stringify(availableFields)},
recommend analytics configuration. Return valid JSON only with keys:
- "recommendedMetrics": array of { key, title, field, aggregation (count|sum|avg|max|min), format (number|currency|percent) }
- "recommendedCharts": array of { title, chartType (line|bar|pie|donut|area), dimensionField, metricField, aggregation }`;

        const res = await this.llmManager.chat(prompt, { temperature: 0.1 });
        const clean = res.content.replace(/^```json/m, '').replace(/```$/m, '').trim();
        return JSON.parse(clean);
      } catch {
        // Fallback to default
      }
    }

    // Default heuristic recommendations
    const numField = availableFields.find((f) => ['number', 'integer', 'float', 'decimal'].includes(f.type))?.name;
    const catField = availableFields.find((f) => ['string', 'enum', 'status'].includes(f.type))?.name || 'status';

    return {
      recommendedMetrics: [
        { key: 'total_count', title: 'Total Records', aggregation: 'count', format: 'number' },
        ...(numField
          ? [{ key: `total_${numField}`, title: `Total ${numField}`, field: numField, aggregation: 'sum' as const, format: 'currency' as const }]
          : []),
      ],
      recommendedCharts: [
        {
          title: `Distribution by ${catField}`,
          chartType: 'bar',
          dimensionField: catField,
          metricField: numField,
          aggregation: numField ? 'sum' : 'count',
        },
      ],
    };
  }
}
