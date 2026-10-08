import type { DomainTemplate } from './types';

export interface SeedResult {
  collection: string;
  count: number;
  error?: string;
}

const SAMPLE_NAMES = ['李明', '王悦', '张强', '刘洋', '陈静', '赵云', '孙权', '周瑜', '诸葛亮', '关羽'];
const SAMPLE_COMPANIES = [
  '未来智联科技有限公司',
  '华东先进智能制造集团',
  '汇通全球供应链管理有限公司',
  '新天地数字零售商业连锁',
  '蓝海云原生信息技术中心',
  '深蓝数据创新实验室',
];
const SAMPLE_CITIES = ['北京市朝阳区酒仙桥路', '上海市浦东新区张江高科', '深圳市南山区科技园', '杭州市滨江区网商路', '广州市天河区珠江新城'];
const SAMPLE_TITLES = [
  '关于推进核心业务敏捷迭代的提案',
  '季度数字化交付验收与技术复盘',
  '企业级安全合规治理实施方案',
  '全渠道客户服务体验升级项目',
  '高可用分布式集群优化与性能排查',
];

/**
 * Intelligent Mock Data Generator
 * Seeds realistic, relational mock data for newly synchronized application tables.
 */
export async function seedAppMockData(
  db: any,
  collections: Array<{ name: string; title?: string; fields?: any[] }>,
  template?: DomainTemplate | null
): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  const createdIdsMap = new Map<string, Array<number | string>>();

  // Order collections: core entities first, then transactions/logs with foreign keys
  const sortedCollections = [...collections].sort((a, b) => {
    const aHasFk = (a.fields || []).some((f) => f.type === 'belongsTo' || f.foreignKey);
    const bHasFk = (b.fields || []).some((f) => f.type === 'belongsTo' || f.foreignKey);
    if (!aHasFk && bHasFk) return -1;
    if (aHasFk && !bHasFk) return 1;
    return 0;
  });

  for (const col of sortedCollections) {
    const rawColName = col.name.replace(/^app_[^_]+_/, '');
    const repo = db.getRepository(col.name);
    if (!repo) continue;

    // Check if records already exist
    try {
      const existingCount = await repo.count();
      if (existingCount > 0) {
        // Collect existing IDs for FK resolution
        const existingRecords = await repo.find({ limit: 50 });
        createdIdsMap.set(col.name, existingRecords.map((r: any) => r.id));
        createdIdsMap.set(rawColName, existingRecords.map((r: any) => r.id));
        results.push({ collection: col.name, count: 0 });
        continue;
      }
    } catch {
      // Ignore count error, proceed to seed
    }

    const colFields = col.fields || [];
    const seedRecords: Array<Record<string, any>> = [];

    // 1. Check if domain template provides presets for this collection
    const templatePreset = template?.mockData?.[rawColName] || template?.mockData?.[col.name];
    if (templatePreset?.presets && templatePreset.presets.length > 0) {
      for (const preset of templatePreset.presets) {
        const record = { ...preset };
        // Fill FK references if missing
        colFields.forEach((f) => {
          if (f.type === 'belongsTo' && f.target && !record[f.name]) {
            const parentIds = createdIdsMap.get(f.target) || createdIdsMap.get(`app_${f.target}`);
            if (parentIds && parentIds.length > 0) {
              record[f.name] = parentIds[Math.floor(Math.random() * parentIds.length)];
            }
          }
        });
        seedRecords.push(record);
      }
    }

    // 2. Generate remaining realistic records up to target count (between 6 and 15)
    const targetCount = Math.max(templatePreset?.count || 8, seedRecords.length);
    const needGenerate = targetCount - seedRecords.length;

    for (let i = 0; i < needGenerate; i++) {
      const record: Record<string, any> = {};

      for (const f of colFields) {
        if (f.name === 'id' || f.name === 'createdAt' || f.name === 'updatedAt') continue;
        const nameLower = f.name.toLowerCase();

        // Foreign Key
        if (f.type === 'belongsTo') {
          const parentTarget = f.target || f.name.replace(/_id$/, '') + 's';
          const parentIds = createdIdsMap.get(parentTarget) || createdIdsMap.get(`app_${parentTarget}`);
          if (parentIds && parentIds.length > 0) {
            record[f.name] = parentIds[Math.floor(Math.random() * parentIds.length)];
          } else {
            record[f.name] = null;
          }
          continue;
        }

        // Enum options
        if (f.enumOptions && f.enumOptions.length > 0) {
          const randomOpt = f.enumOptions[Math.floor(Math.random() * f.enumOptions.length)];
          record[f.name] = randomOpt.value;
          continue;
        }

        // Semantics by field name
        if (nameLower.includes('phone') || nameLower.includes('mobile')) {
          record[f.name] = `1380013${Math.floor(1000 + Math.random() * 9000)}`;
        } else if (nameLower.includes('email')) {
          record[f.name] = `contact_${Math.random().toString(36).slice(2, 6)}@formai-corp.com`;
        } else if (nameLower.includes('address') || nameLower.includes('location')) {
          record[f.name] = `${SAMPLE_CITIES[i % SAMPLE_CITIES.length]} ${Math.floor(10 + Math.random() * 90)} 号`;
        } else if (nameLower.includes('company') || (nameLower.includes('name') && rawColName.includes('customer'))) {
          record[f.name] = `${SAMPLE_COMPANIES[(i + seedRecords.length) % SAMPLE_COMPANIES.length]} (${i + 1}部)`;
        } else if (nameLower.includes('name') && (rawColName.includes('contact') || rawColName.includes('user') || rawColName.includes('employee'))) {
          record[f.name] = `${SAMPLE_NAMES[(i + seedRecords.length) % SAMPLE_NAMES.length]}`;
        } else if (nameLower.includes('owner') || nameLower.includes('manager') || nameLower.includes('assignee')) {
          record[f.name] = SAMPLE_NAMES[(i + 2) % SAMPLE_NAMES.length];
        } else if (nameLower.includes('title') || nameLower.includes('summary')) {
          record[f.name] = `${SAMPLE_TITLES[i % SAMPLE_TITLES.length]} - #${i + 1}`;
        } else if (nameLower.includes('code') || nameLower.includes('no') || nameLower.includes('sku')) {
          record[f.name] = `${rawColName.slice(0, 3).toUpperCase()}-2026-${String(i + 1).padStart(4, '0')}`;
        } else if (nameLower.includes('status') || nameLower.includes('state')) {
          record[f.name] = ['active', 'in_progress', 'completed', 'pending'][i % 4];
        } else if (f.type === 'decimal' || f.type === 'float' || nameLower.includes('amount') || nameLower.includes('price')) {
          record[f.name] = parseFloat((Math.floor(500 + Math.random() * 9500) * 10).toFixed(2));
        } else if (f.type === 'integer' || nameLower.includes('quantity') || nameLower.includes('count')) {
          record[f.name] = Math.floor(10 + Math.random() * 200);
        } else if (f.type === 'boolean') {
          record[f.name] = Math.random() > 0.5;
        } else if (f.type === 'date') {
          const d = new Date();
          d.setDate(d.getDate() - Math.floor(Math.random() * 30));
          record[f.name] = d.toISOString().split('T')[0];
        } else if (f.type === 'datetime') {
          const d = new Date();
          d.setDate(d.getDate() - Math.floor(Math.random() * 30));
          record[f.name] = d.toISOString();
        } else if (f.type === 'text') {
          record[f.name] = `自动生成的业务实体档案说明信息，包含该记录的关键属性与执行记录。生成批次：#${i + 1}。`;
        } else {
          record[f.name] = `${f.title || f.name} ${i + 1}`;
        }
      }

      seedRecords.push(record);
    }

    // Persist records
    let createdCount = 0;
    const insertedIds: Array<number | string> = [];
    for (const data of seedRecords) {
      try {
        const item = await repo.create({ values: data });
        if (item && item.id) {
          insertedIds.push(item.id);
        }
        createdCount++;
      } catch (err: any) {
        // Continue if single record fails constraint
      }
    }

    createdIdsMap.set(col.name, insertedIds);
    createdIdsMap.set(rawColName, insertedIds);
    results.push({ collection: col.name, count: createdCount });
  }

  return results;
}
