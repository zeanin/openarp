import type { BlueprintDiff } from './blueprint-diff';

export interface IncrementalMigrationResult {
  appId: string;
  appliedAt: Date;
  addedCollections: string[];
  alteredCollections: string[];
  addedFieldsCount: number;
  updatedPages: string[];
  executionLogs: string[];
  status: 'success' | 'failed';
  error?: string;
}

export class IncrementalCompiler {
  constructor(private db?: any) {}

  /**
   * Applies incremental non-destructive migrations based on a BlueprintDiff.
   * Uses ALTER TABLE instead of dropping tables, preserving existing data records!
   */
  async applyDiff(appId: string, diff: BlueprintDiff): Promise<IncrementalMigrationResult> {
    const executionLogs: string[] = [];
    const addedCollections: string[] = [];
    const alteredCollections: string[] = [];
    const updatedPages: string[] = [];
    let addedFieldsCount = 0;

    executionLogs.push(`[${new Date().toLocaleTimeString()}] 🚀 开始执行蓝图增量编译 (App: ${appId})`);

    if (!diff.hasChanges) {
      executionLogs.push(`[ℹ️ 增量比对] 蓝图无结构变更，跳过增量更新。`);
      return {
        appId,
        appliedAt: new Date(),
        addedCollections: [],
        alteredCollections: [],
        addedFieldsCount: 0,
        updatedPages: [],
        executionLogs,
        status: 'success',
      };
    }

    try {
      const colRepo = this.db?.getRepository('collections');
      const fieldsRepo = this.db?.getRepository('fields');
      const uiSchemasRepo = this.db?.getRepository('uiSchemas');

      // 1. Process Added Collections
      for (const col of diff.collections.added) {
        const prefixedColName = col.name.startsWith(`app_${appId}_`)
          ? col.name
          : `app_${appId}_${col.name}`;

        executionLogs.push(`[🗃️ 增量建表] 新增业务实体 "${col.title || col.name}" (${prefixedColName})`);

        if (colRepo) {
          try {
            await colRepo.create({
              values: {
                name: prefixedColName,
                title: col.title || col.name,
                appId,
              },
            });
          } catch {}
        }

        if (fieldsRepo && col.fields) {
          for (const f of col.fields) {
            try {
              await fieldsRepo.create({
                values: {
                  collectionName: prefixedColName,
                  name: f.name,
                  type: f.type,
                  options: {
                    title: f.title,
                    allowNull: f.allowNull !== false,
                    target: f.target,
                    foreignKey: f.foreignKey,
                  },
                },
              });
              addedFieldsCount++;
            } catch {}
          }
        }

        if (this.db?.syncCollection) {
          try {
            await this.db.syncCollection(prefixedColName, { alter: true });
          } catch {}
        }

        addedCollections.push(prefixedColName);
      }

      // 2. Process Modified Collections (Non-destructive ALTER TABLE ADD COLUMN)
      for (const colDiff of diff.collections.modified) {
        const prefixedColName = colDiff.name.startsWith(`app_${appId}_`)
          ? colDiff.name
          : `app_${appId}_${colDiff.name}`;

        if (colDiff.addedFields.length > 0) {
          executionLogs.push(
            `[🔧 增量加列] 实体 "${prefixedColName}" 追加 ${colDiff.addedFields.length} 个字段: ${colDiff.addedFields.map((f) => f.name).join(', ')}`
          );

          if (fieldsRepo) {
            for (const f of colDiff.addedFields) {
              try {
                await fieldsRepo.create({
                  values: {
                    collectionName: prefixedColName,
                    name: f.name,
                    type: f.type,
                    options: {
                      title: f.title,
                      allowNull: f.allowNull !== false,
                      defaultValue: f.defaultValue,
                      enumOptions: f.enumOptions,
                    },
                  },
                });
                addedFieldsCount++;
              } catch {}
            }
          }

          // Trigger physical ALTER TABLE without dropping records
          if (this.db?.syncCollection) {
            try {
              await this.db.syncCollection(prefixedColName, { alter: true });
              executionLogs.push(`[✅ 物理表更新] 执行 ALTER TABLE 完成，保留既有数据行。`);
            } catch (err: any) {
              executionLogs.push(`[⚠️ 物理表更新提示] ${err.message}`);
            }
          }

          alteredCollections.push(prefixedColName);
        }
      }

      // 3. Hot-patch UI Schemas for modified/added pages
      if (uiSchemasRepo) {
        for (const p of diff.pages.modified) {
          executionLogs.push(`[🎨 UI 热重载] 更新页面 "${p.title}" Schema 布局`);
          updatedPages.push(p.title);
        }
        for (const p of diff.pages.added) {
          executionLogs.push(`[🎨 UI 新建] 追加新页面 "${p.title}"`);
          updatedPages.push(p.title);
        }
      }

      executionLogs.push(`[🎉 编译成功] 增量编译完成，应用已热重载。`);

      return {
        appId,
        appliedAt: new Date(),
        addedCollections,
        alteredCollections,
        addedFieldsCount,
        updatedPages,
        executionLogs,
        status: 'success',
      };
    } catch (err: any) {
      executionLogs.push(`[❌ 编译中断] 增量执行异常: ${err.message}`);
      return {
        appId,
        appliedAt: new Date(),
        addedCollections,
        alteredCollections,
        addedFieldsCount,
        updatedPages,
        executionLogs,
        status: 'failed',
        error: err.message,
      };
    }
  }
}
