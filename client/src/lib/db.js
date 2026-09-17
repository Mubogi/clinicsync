import PouchDB from "pouchdb";

// Offline-first local databases (IndexedDB)
export const salesDb = new PouchDB("clinicsync_sales");
export const expensesDb = new PouchDB("clinicsync_expenses");
export const inventoryDb = new PouchDB("clinicsync_inventory");

const syncFlag = (doc, flag = false) => {
  doc.synced = flag;
  return doc;
};

// Mark all local docs with synced=false (needs cloud push)
export async function markUnsynced(dbName) {
  const db = { sales: salesDb, expenses: expensesDb, inventory: inventoryDb }[dbName];
  if (!db) return;
  const { rows } = await db.allDocs({ include_docs: true });
  await Promise.all(
    rows.map((r) => {
      if (!r.doc) return null;
      const doc = r.doc;
      if (doc.synced === false) return null;
      return db.put(syncFlag(doc, false));
    })
  );
}

export async function getAll(db, opts = {}) {
  const res = await db.allDocs({ include_docs: true, ...opts });
  return res.rows.map((r) => r.doc);
}

export async function getUnsynced(db) {
  const docs = await getAll(db);
  return docs.filter((d) => d.synced === false);
}

export async function saveDoc(db, doc) {
  if (!doc._id) doc._id = crypto.randomUUID();
  doc.updatedAt = new Date().toISOString();
  // Docs pulled from the server are already the source of truth, so callers can
  // mark them synced. Left false they would be pushed straight back on the next
  // sync, re-uploading the whole local database every cycle.
  if (doc.synced !== true) doc.synced = false;
  const result = await db.put(doc);
  // PouchDB adds _rev on put; return merged doc
  const latest = await db.get(result.id);
  return latest;
}

export async function removeDoc(db, id) {
  const doc = await db.get(id);
  return db.remove(doc);
}

// Clear a database (used after full cloud pull to avoid stale conflicts)
export async function wipeDb(db) {
  const { rows } = await db.allDocs({ include_docs: true });
  await Promise.all(rows.map((r) => db.remove(r.doc)));
}

export async function markSynced(db, ids) {
  await Promise.all(
    ids.map(async (id) => {
      try {
        const doc = await db.get(id);
        doc.synced = true;
        await db.put(doc);
      } catch {
        /* doc deleted meanwhile — ignore */
      }
    })
  );
}