import { Context, Next } from 'koa';

/**
 * List UI schemas (flat list)
 * Supports ?appId=crm to filter by app
 */
export async function list(ctx: Context, next: Next): Promise<void> {
  const repo = (ctx as any).app.db.getRepository('uiSchemas');
  const { filter, fields, sort, page = 1, pageSize = 50, appId } = (ctx as any).action.params;

  // Build filter with appId scoping
  const filterObj: any = { ...(filter || {}) };
  if (appId) {
    filterObj.appId = appId;
  }

  const { rows, count } = await repo.findAndCount({
    filter: filterObj,
    fields,
    sort: sort || ['parentUid', 'sort'],
    page: Number(page),
    pageSize: Number(pageSize),
  });

  ctx.body = {
    data: rows,
    meta: { count, page: Number(page), pageSize: Number(pageSize), totalPages: Math.ceil(count / Number(pageSize)) },
  };
  await next();
}

/**
 * Get a single schema by uid
 */
export async function get(ctx: Context, next: Next): Promise<void> {
  const repo = (ctx as any).app.db.getRepository('uiSchemas');
  const { filterByTk } = (ctx as any).action.params;

  const row = await repo.findOne({ filter: { uid: filterByTk } });
  if (!row) {
    const byId = await repo.findById(filterByTk);
    if (!byId) {
      ctx.status = 404;
      ctx.body = { errors: [{ message: 'Schema not found', code: 'NOT_FOUND' }] };
      return;
    }
    ctx.body = { data: byId };
    await next();
    return;
  }
  ctx.body = { data: row };
  await next();
}

/**
 * Create a new UI schema node
 */
export async function create(ctx: Context, next: Next): Promise<void> {
  const repo = (ctx as any).app.db.getRepository('uiSchemas');
  const { values } = (ctx as any).action.params;

  if (!values?.uid) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'uid is required', code: 'VALIDATION_ERROR' }] };
    return;
  }

  if (!values?.appId) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'appId is required — every schema must belong to an app', code: 'VALIDATION_ERROR' }] };
    return;
  }

  const record = await repo.create({
    values: {
      uid: values.uid,
      title: values.title || '',
      appId: values.appId,
      schema: values.schema || {},
      parentUid: values.parentUid || null,
      sort: values.sort || 0,
    },
  });

  // Save initial version
  await saveVersion((ctx as any).app.db, values.uid, values.schema || {}, 1);

  ctx.status = 201;
  ctx.body = { data: record };
  await next();
}

/**
 * Update a schema node
 */
export async function update(ctx: Context, next: Next): Promise<void> {
  const repo = (ctx as any).app.db.getRepository('uiSchemas');
  const { filterByTk, values } = (ctx as any).action.params;

  const existing = await repo.findOne({ filter: { uid: filterByTk } });
  if (!existing) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'Schema not found', code: 'NOT_FOUND' }] };
    return;
  }

  const updated = await repo.update({
    filter: { uid: filterByTk },
    values: {
      ...(values?.title !== undefined ? { title: values.title } : {}),
      ...(values?.schema !== undefined ? { schema: values.schema } : {}),
      ...(values?.parentUid !== undefined ? { parentUid: values.parentUid } : {}),
      ...(values?.sort !== undefined ? { sort: values.sort } : {}),
    },
  });

  // Save new version
  if (values?.schema !== undefined) {
    const versionRepo = (ctx as any).app.db.getRepository('uiSchemaVersions');
    const versions = await versionRepo.find({
      filter: { uid: filterByTk },
      sort: ['-version'],
      pageSize: 1,
    });
    const nextVersion = versions.length > 0 ? versions[0].version + 1 : 1;
    await saveVersion((ctx as any).app.db, filterByTk, values.schema, nextVersion);
  }

  // Broadcast updated schema via AG-UI WebSocket Gateway to other sessions editing this schema
  const gateway = (ctx as any).app.a2uiGateway;
  if (gateway && values?.schema !== undefined) {
    gateway.broadcastToSchema(filterByTk, null, {
      operation: 'setSchema',
      schema: values.schema,
    });
  }

  ctx.body = { data: updated };
  await next();
}

/**
 * Delete a schema node and all its children
 */
export async function destroy(ctx: Context, next: Next): Promise<void> {
  const repo = (ctx as any).app.db.getRepository('uiSchemas');
  const { filterByTk } = (ctx as any).action.params;

  // Recursively find all children to delete
  const uidsToDelete = await collectChildUids(repo, filterByTk);
  uidsToDelete.push(filterByTk);

  let totalDeleted = 0;
  for (const uid of uidsToDelete) {
    const count = await repo.destroy({ filter: { uid } });
    totalDeleted += count;
  }

  ctx.body = { data: totalDeleted };
  await next();
}

/**
 * Get the full schema tree starting from a root uid.
 * Returns a nested ISchema structure by assembling all descendant nodes.
 */
export async function getTree(ctx: Context, next: Next): Promise<void> {
  const repo = (ctx as any).app.db.getRepository('uiSchemas');
  const { filterByTk } = (ctx as any).action.params;

  if (!filterByTk) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'uid (filterByTk) is required', code: 'VALIDATION_ERROR' }] };
    return;
  }

  // Get root node
  const root = await repo.findOne({ filter: { uid: filterByTk } });
  if (!root) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'Schema not found', code: 'NOT_FOUND' }] };
    return;
  }

  // Get all nodes in the tree
  const allNodes = await repo.find({ sort: ['sort'] });

  // Build the tree
  const tree = buildTree(root, allNodes);
  ctx.body = { data: tree };
  await next();
}

/**
 * Insert a schema node after a specific sibling
 */
export async function insertAfter(ctx: Context, next: Next): Promise<void> {
  const repo = (ctx as any).app.db.getRepository('uiSchemas');
  const { values } = (ctx as any).action.params;

  if (!values?.uid || !values?.siblingUid) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'uid and siblingUid are required', code: 'VALIDATION_ERROR' }] };
    return;
  }

  // Find the sibling
  const sibling = await repo.findOne({ filter: { uid: values.siblingUid } });
  if (!sibling) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'Sibling schema not found', code: 'NOT_FOUND' }] };
    return;
  }

  const record = await repo.create({
    values: {
      uid: values.uid,
      title: values.title || '',
      schema: values.schema || {},
      parentUid: sibling.parentUid,
      sort: (sibling.sort || 0) + 1,
    },
  });

  ctx.status = 201;
  ctx.body = { data: record };
  await next();
}

/**
 * Patch a schema node (partial update)
 */
export async function patch(ctx: Context, next: Next): Promise<void> {
  const repo = (ctx as any).app.db.getRepository('uiSchemas');
  const { filterByTk, values } = (ctx as any).action.params;

  if (!filterByTk || !values?.schema) {
    ctx.status = 400;
    ctx.body = { errors: [{ message: 'uid and schema are required', code: 'VALIDATION_ERROR' }] };
    return;
  }

  const existing = await repo.findOne({ filter: { uid: filterByTk } });
  if (!existing) {
    ctx.status = 404;
    ctx.body = { errors: [{ message: 'Schema not found', code: 'NOT_FOUND' }] };
    return;
  }

  // Deep merge the schema
  const mergedSchema = deepMerge(existing.schema || {}, values.schema);

  const updated = await repo.update({
    filter: { uid: filterByTk },
    values: { schema: mergedSchema },
  });

  ctx.body = { data: updated };
  await next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveVersion(db: any, uid: string, schema: any, version: number): Promise<void> {
  try {
    const versionRepo = db.getRepository('uiSchemaVersions');
    await versionRepo.create({
      values: { uid, version, schema },
    });
  } catch {
    // Ignore version save errors
  }
}

async function collectChildUids(repo: any, parentUid: string): Promise<string[]> {
  const children = await repo.find({ filter: { parentUid } });
  const uids: string[] = [];
  for (const child of children) {
    uids.push(child.uid);
    const childUids = await collectChildUids(repo, child.uid);
    uids.push(...childUids);
  }
  return uids;
}

function buildTree(root: any, allNodes: any[]): any {
  const schema = { ...root.schema, 'x-uid': root.uid, title: root.title || root.schema?.title };

  // Find children of root
  const children = allNodes.filter((n: any) => n.parentUid === root.uid);

  if (children.length > 0) {
    schema.properties = schema.properties || {};
    for (const child of children) {
      const childTree = buildTree(child, allNodes);
      schema.properties[child.uid] = childTree;
    }
  }

  return schema;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
