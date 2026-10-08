export interface FieldDiff {
  name: string;
  type: string;
  action: 'add' | 'modify' | 'delete';
  oldField?: any;
  newField?: any;
}

export interface CollectionDiff {
  name: string;
  action: 'add' | 'modify' | 'delete';
  addedFields: any[];
  modifiedFields: FieldDiff[];
  deletedFields: string[];
}

export interface PageDiff {
  title: string;
  action: 'add' | 'modify' | 'delete';
  collection?: string;
  changeSummary?: string;
}

export interface WorkflowDiff {
  title: string;
  action: 'add' | 'modify' | 'delete';
  triggerType?: string;
}

export interface BlueprintDiff {
  timestamp: Date;
  hasChanges: boolean;
  hasBreakingChanges: boolean;
  breakingReasons: string[];
  collections: {
    added: any[];
    modified: CollectionDiff[];
    deleted: string[];
  };
  pages: {
    added: any[];
    modified: PageDiff[];
    deleted: string[];
  };
  workflows: {
    added: any[];
    modified: WorkflowDiff[];
    deleted: string[];
  };
}

export function computeBlueprintDiff(oldBlueprint: any, newBlueprint: any): BlueprintDiff {
  const breakingReasons: string[] = [];

  const oldCols: any[] = oldBlueprint?.collections || [];
  const newCols: any[] = newBlueprint?.collections || [];

  const oldColMap = new Map<string, any>(oldCols.map((c) => [c.name, c]));
  const newColMap = new Map<string, any>(newCols.map((c) => [c.name, c]));

  // 1. Collections Diff
  const addedCols: any[] = [];
  const modifiedCols: CollectionDiff[] = [];
  const deletedCols: string[] = [];

  for (const [name, newCol] of newColMap) {
    if (!oldColMap.has(name)) {
      addedCols.push(newCol);
    } else {
      const oldCol = oldColMap.get(name);
      const colDiff = diffCollectionFields(oldCol, newCol);
      if (colDiff.addedFields.length > 0 || colDiff.modifiedFields.length > 0 || colDiff.deletedFields.length > 0) {
        modifiedCols.push(colDiff);
        if (colDiff.deletedFields.length > 0) {
          breakingReasons.push(`Collection "${name}" dropped fields: ${colDiff.deletedFields.join(', ')}`);
        }
      }
    }
  }

  for (const [name] of oldColMap) {
    if (!newColMap.has(name)) {
      deletedCols.push(name);
      breakingReasons.push(`Collection "${name}" was removed completely.`);
    }
  }

  // 2. Pages / Menus Diff
  const oldPages: any[] = oldBlueprint?.menus || oldBlueprint?.pages || [];
  const newPages: any[] = newBlueprint?.menus || newBlueprint?.pages || [];
  const oldPageMap = new Map<string, any>(oldPages.map((p) => [p.title, p]));
  const newPageMap = new Map<string, any>(newPages.map((p) => [p.title, p]));

  const addedPages: any[] = [];
  const modifiedPages: PageDiff[] = [];
  const deletedPages: string[] = [];

  for (const [title, newP] of newPageMap) {
    if (!oldPageMap.has(title)) {
      addedPages.push(newP);
    } else {
      const oldP = oldPageMap.get(title);
      if (oldP.collection !== newP.collection || oldP.type !== newP.type) {
        modifiedPages.push({
          title,
          action: 'modify',
          collection: newP.collection,
          changeSummary: `Type/Collection changed from ${oldP.collection} to ${newP.collection}`,
        });
      }
    }
  }

  for (const [title] of oldPageMap) {
    if (!newPageMap.has(title)) {
      deletedPages.push(title);
    }
  }

  // 3. Workflows Diff
  const oldFlows: any[] = oldBlueprint?.workflows || [];
  const newFlows: any[] = newBlueprint?.workflows || [];
  const oldFlowMap = new Map<string, any>(oldFlows.map((w) => [w.title, w]));
  const newFlowMap = new Map<string, any>(newFlows.map((w) => [w.title, w]));

  const addedFlows: any[] = [];
  const modifiedFlows: WorkflowDiff[] = [];
  const deletedFlows: string[] = [];

  for (const [title, newW] of newFlowMap) {
    if (!oldFlowMap.has(title)) {
      addedFlows.push(newW);
    } else {
      const oldW = oldFlowMap.get(title);
      if (oldW.trigger?.type !== newW.trigger?.type || oldW.trigger?.condition !== newW.trigger?.condition) {
        modifiedFlows.push({
          title,
          action: 'modify',
          triggerType: newW.trigger?.type,
        });
      }
    }
  }

  for (const [title] of oldFlowMap) {
    if (!newFlowMap.has(title)) {
      deletedFlows.push(title);
    }
  }

  const hasChanges =
    addedCols.length > 0 ||
    modifiedCols.length > 0 ||
    deletedCols.length > 0 ||
    addedPages.length > 0 ||
    modifiedPages.length > 0 ||
    deletedPages.length > 0 ||
    addedFlows.length > 0 ||
    modifiedFlows.length > 0 ||
    deletedFlows.length > 0;

  return {
    timestamp: new Date(),
    hasChanges,
    hasBreakingChanges: breakingReasons.length > 0,
    breakingReasons,
    collections: {
      added: addedCols,
      modified: modifiedCols,
      deleted: deletedCols,
    },
    pages: {
      added: addedPages,
      modified: modifiedPages,
      deleted: deletedPages,
    },
    workflows: {
      added: addedFlows,
      modified: modifiedFlows,
      deleted: deletedFlows,
    },
  };
}

function diffCollectionFields(oldCol: any, newCol: any): CollectionDiff {
  const oldFields: any[] = oldCol.fields || [];
  const newFields: any[] = newCol.fields || [];

  const oldFMap = new Map<string, any>(oldFields.map((f) => [f.name, f]));
  const newFMap = new Map<string, any>(newFields.map((f) => [f.name, f]));

  const addedFields: any[] = [];
  const modifiedFields: FieldDiff[] = [];
  const deletedFields: string[] = [];

  for (const [fname, newF] of newFMap) {
    if (!oldFMap.has(fname)) {
      addedFields.push(newF);
    } else {
      const oldF = oldFMap.get(fname);
      if (oldF.type !== newF.type || oldF.title !== newF.title || oldF.allowNull !== newF.allowNull) {
        modifiedFields.push({
          name: fname,
          type: newF.type,
          action: 'modify',
          oldField: oldF,
          newField: newF,
        });
      }
    }
  }

  for (const [fname] of oldFMap) {
    if (!newFMap.has(fname)) {
      deletedFields.push(fname);
    }
  }

  return {
    name: newCol.name,
    action: 'modify',
    addedFields,
    modifiedFields,
    deletedFields,
  };
}
