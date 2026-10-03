// ====================================================================
// storage.js — IndexedDB 极简封装
// ====================================================================
// 用于持久化 sql.js 的数据库快照（Uint8Array）和 hiddenTables 列表。
// 数据库：sql-practice，store：kv，版本：1
// 对外暴露三个 async 函数：get(key) / set(key, value) / del(key)
// 找不到 key 时 get() 返回 null，不报错。

'use strict';

const IDB_NAME = 'sql-practice';
const IDB_STORE = 'kv';
const IDB_VERSION = 1;

// 内部：打开（或首次创建）IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      // 首次打开：建立 key-value store（无 keyPath，key 用 put 的第二个参数）
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 异步读取指定 key 的值
 * @param {string} key
 * @returns {Promise<any>}  存储的值；key 不存在时返回 null
 */
async function get(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 异步写入 key-value
 * @param {string} key
 * @param {*} value  可以是 Uint8Array / Array / Object / 基本类型
 */
async function set(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 异步删除指定 key
 * @param {string} key
 */
async function del(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
