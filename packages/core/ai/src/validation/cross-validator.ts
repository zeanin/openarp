export interface ValidationError {
  type: 'missing_collection' | 'missing_field' | 'invalid_foreign_key' | 'workflow_target_mismatch' | 'ui_binding_error';
  severity: 'error' | 'warning';
  location: string; // e.g. "ui.menus[0].childItem[1]" or "workflows[2]"
  message: string;
  fixable: boolean;
  suggestedFix?: string;
}

export interface BlueprintValidationResult {
  valid: boolean;
  errorsCount: number;
  warningsCount: number;
  issues: ValidationError[];
}

/**
 * Cross-validates relational integrity across Database Schema, UI Pages, and Workflow Automation.
 */
export function validateBlueprintIntegrity(blueprint: {
  collections?: any[];
  menus?: any[];
  pages?: any[];
  workflows?: any[];
}): BlueprintValidationResult {
  const issues: ValidationError[] = [];

  const collections = blueprint.collections || [];
  const colMap = new Map<string, any>();
  const colFieldsMap = new Map<string, Set<string>>();

  // 1. Build index of collections and fields
  for (const c of collections) {
    const rawName = c.name.toLowerCase();
    colMap.set(rawName, c);

    const fSet = new Set<string>();
    fSet.add('id');
    fSet.add('createdat');
    fSet.add('updatedat');

    for (const f of c.fields || []) {
      fSet.add(f.name.toLowerCase());
    }
    colFieldsMap.set(rawName, fSet);
  }

  // 2. Validate Foreign Keys & Relationships in Collections
  for (const c of collections) {
    const rawName = c.name.toLowerCase();
    for (const f of c.fields || []) {
      if (f.type === 'belongsTo' || f.type === 'hasMany' || f.target) {
        const targetCol = (f.target || '').toLowerCase();
        if (targetCol && !colMap.has(targetCol)) {
          issues.push({
            type: 'invalid_foreign_key',
            severity: 'error',
            location: `collections[${c.name}].fields[${f.name}]`,
            message: `Field "${f.name}" points to non-existent target collection "${f.target}".`,
            fixable: true,
            suggestedFix: `Create placeholder collection "${f.target}" or remove relationship.`,
          });
        }
      }
    }
  }

  // 3. Validate UI Menus & Pages against Database Collections
  const menus = blueprint.menus || blueprint.pages || [];
  const checkMenuItem = (item: any, path: string) => {
    if (item.type === 'page' && item.collection) {
      const colName = item.collection.toLowerCase();
      if (!colMap.has(colName)) {
        issues.push({
          type: 'missing_collection',
          severity: 'warning',
          location: `${path} ("${item.title}")`,
          message: `Page "${item.title}" references unmapped collection "${item.collection}".`,
          fixable: true,
          suggestedFix: `Link to default collection or create "${item.collection}".`,
        });
      }
    }
  };

  menus.forEach((m, idx) => {
    checkMenuItem(m, `menus[${idx}]`);
    if (m.children && Array.isArray(m.children)) {
      m.children.forEach((child: any, cIdx: number) => {
        checkMenuItem(child, `menus[${idx}].children[${cIdx}]`);
      });
    }
  });

  // 4. Validate Workflows against Collections & Fields
  const workflows = blueprint.workflows || [];
  for (let wIdx = 0; wIdx < workflows.length; wIdx++) {
    const w = workflows[wIdx];
    const triggerCol = w.trigger?.collection?.toLowerCase();

    if (triggerCol && !colMap.has(triggerCol)) {
      issues.push({
        type: 'workflow_target_mismatch',
        severity: 'warning',
        location: `workflows[${wIdx}] ("${w.title}")`,
        message: `Workflow "${w.title}" triggers on missing collection "${w.trigger.collection}".`,
        fixable: true,
        suggestedFix: `Map workflow trigger to available collection "${collections[0]?.name || 'default'}".`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return {
    valid: errors.length === 0,
    errorsCount: errors.length,
    warningsCount: warnings.length,
    issues,
  };
}

/**
 * Auto-repairs blueprint inconsistencies detected by validateBlueprintIntegrity.
 */
export function autoRepairBlueprint(blueprint: {
  collections?: any[];
  menus?: any[];
  pages?: any[];
  workflows?: any[];
}): { repairedBlueprint: any; repairedCount: number } {
  const validation = validateBlueprintIntegrity(blueprint);
  if (validation.valid && validation.warningsCount === 0) {
    return { repairedBlueprint: blueprint, repairedCount: 0 };
  }

  const repaired = JSON.parse(JSON.stringify(blueprint));
  let repairedCount = 0;

  const colNames = new Set((repaired.collections || []).map((c: any) => c.name.toLowerCase()));
  const defaultCol = repaired.collections?.[0]?.name || 'records';

  // 1. Repair missing target collections for foreign keys
  for (const c of repaired.collections || []) {
    for (const f of c.fields || []) {
      if ((f.type === 'belongsTo' || f.type === 'hasMany' || f.target) && f.target) {
        const targetCol = f.target.toLowerCase();
        if (!colNames.has(targetCol)) {
          // Create dummy target collection to satisfy FK constraint
          repaired.collections.push({
            name: f.target,
            title: `${f.target} (Auto-provisioned)`,
            fields: [
              { name: 'name', type: 'string', title: '名称', allowNull: false },
            ],
          });
          colNames.add(targetCol);
          repairedCount++;
        }
      }
    }
  }

  // 2. Repair menus referencing missing collections
  const repairMenu = (item: any) => {
    if (item.type === 'page' && item.collection) {
      if (!colNames.has(item.collection.toLowerCase())) {
        item.collection = defaultCol;
        repairedCount++;
      }
    }
  };

  (repaired.menus || repaired.pages || []).forEach((m: any) => {
    repairMenu(m);
    if (m.children) {
      m.children.forEach(repairMenu);
    }
  });

  // 3. Repair workflows referencing missing collections
  for (const w of repaired.workflows || []) {
    if (w.trigger?.collection && !colNames.has(w.trigger.collection.toLowerCase())) {
      w.trigger.collection = defaultCol;
      repairedCount++;
    }
  }

  return { repairedBlueprint: repaired, repairedCount };
}
