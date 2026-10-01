/* =========================================================
 * db.js — IndexedDB persistence for infinite project slots.
 * Slots store: metadata, blueprint JSON, adjustment history,
 * and compiled GLB bytes (so downloads work after reload).
 * ======================================================= */
(function () {
  'use strict';

  const DB_NAME = 'forge3d_db';
  const DB_VER = 1;
  const STORE = 'slots';

  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('created', 'created');
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function run(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const req = fn(store);
      t.oncomplete = () => resolve(req && req.result !== undefined ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  window.DB = {
    init: open,

    /** create a brand-new empty slot (unlimited slots supported) */
    createSlot(name) {
      const now = Date.now();
      const slot = {
        id: 'slot_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        name: name || 'Untitled Model',
        created: now,
        updated: now,
        prompt: '',
        style: 'auto',
        detail: 'standard',
        archetype: null,
        blueprint: null,        // parametric blueprint JSON
        adjustments: [],         // [{text, ops, ts}] — unlimited per slot
        glb: null,               // ArrayBuffer of last compile
        stats: null,             // {tris, verts, parts, joints}
        benchmark: null,         // {semantic, overall}
      };
      return run('readwrite', (s) => s.add(slot)).then(() => slot);
    },

    getAll() { return run('readonly', (s) => s.getAll()); },
    get(id) { return run('readonly', (s) => s.get(id)); },
    put(slot) {
      slot.updated = Date.now();
      return run('readwrite', (s) => s.put(slot));
    },
    remove(id) { return run('readwrite', (s) => s.delete(id)); },
    clearAll() { return run('readwrite', (s) => s.clear()); },
  };
})();
