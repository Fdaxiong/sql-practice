// ====================================================================
// main.js — SQL 练习工具主逻辑（第 2 轮）
// ====================================================================
// 相比第 1 轮新增：
//   - Monaco Editor 替换 textarea（SQL 语法高亮 + 行号）
//   - 左侧 Schema 面板（sqlite_master + PRAGMA table_info 驱动）
//   - 新建表模态框 → 生成 CREATE TABLE 走现有 runSQL 通道
//   - 假删除：hiddenTables 数组 + 折叠的"已删除"区（恢复 / 彻底删除）
//   - 重置按钮：重建示例库 + 清空 hiddenTables
// ====================================================================

'use strict';

// sql.js 的 jsdelivr 版本，WASM 文件与 js 主包同目录
const SQLJS_VERSION = '1.10.3';
const SQLJS_CDN = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/`;

// Monaco Editor 版本（index.html 中的 loader 路径要与此一致）
const MONACO_VERSION = '0.52.2';

// 全局变量
let SQLModule = null;          // initSqlJs 返回的模块对象（含 Database 构造函数）
let db = null;                 // sql.js Database 实例
let editor = null;             // Monaco Editor 实例
let hiddenTables = [];         // 被"假删除"的表名列表

// IndexedDB 的 key 常量（storage.js 里定义了 db 名和 store 名）
const IDB_KEY_DB = 'db-blob';
const IDB_KEY_HIDDEN = 'hidden-tables';

// ---------- DOM 元素 ----------
const $statusBar = document.getElementById('status-bar');
const $statusText = document.getElementById('status-text');
const $btnRun = document.getElementById('btn-run');
const $resultBody = document.getElementById('result-body');
const $schemaTree = document.getElementById('schema-tree');
const $btnNewTable = document.getElementById('btn-new-table');
const $btnReset = document.getElementById('btn-reset');

// 已删除区
const $deletedSection = document.getElementById('deleted-section');
const $deletedToggle = document.getElementById('deleted-toggle');
const $deletedList = document.getElementById('deleted-list');
const $deletedCount = document.getElementById('deleted-count');

// 新建表模态框
const $modalMask = document.getElementById('modal-mask');
const $modalClose = document.getElementById('modal-close');
const $modalCancel = document.getElementById('modal-cancel');
const $modalConfirm = document.getElementById('modal-confirm');
const $newTableName = document.getElementById('new-table-name');
const $newTableFields = document.getElementById('new-table-fields');
const $addFieldRow = document.getElementById('add-field-row');

// ====================================================================
// 状态提示条工具
// ====================================================================

function setStatus(text, type) {
  $statusBar.classList.remove('loading', 'error', 'hidden');
  if (type) $statusBar.classList.add(type);
  $statusText.textContent = text;
}
function hideStatus() { $statusBar.classList.add('hidden'); }

// ====================================================================
// 持久化：把数据库快照 + hiddenTables 写入 IndexedDB
// 每次操作成功后必须 await persistAll()，不能 fire-and-forget
// ====================================================================

async function persistAll() {
  try {
    const blob = db.export();       // Uint8Array，IndexedDB 原生支持
    await set(IDB_KEY_DB, blob);
    await set(IDB_KEY_HIDDEN, hiddenTables);
  } catch (e) {
    console.warn('[storage] 持久化失败:', e);
  }
}

// ====================================================================
// 启动流程：加载 sql.js → 从存档恢复 / 初始化 → 加载 Monaco → 渲染 Schema
// ====================================================================

async function bootstrap() {
  try {
    // 1) 加载 sql.js WASM
    setStatus('加载 sql.js WASM...', 'loading');
    SQLModule = await window.initSqlJs({
      locateFile: file => SQLJS_CDN + file
    });

    // 2) 尝试从 IndexedDB 读取存档
    setStatus('读取存档...', 'loading');
    const savedBlob = await get(IDB_KEY_DB);          // Uint8Array 或 null
    const savedHidden = await get(IDB_KEY_HIDDEN);    // Array 或 null

    if (savedBlob instanceof Uint8Array && savedBlob.length > 0) {
      // 有存档 → 恢复数据库 + 恢复 hiddenTables
      db = new SQLModule.Database(savedBlob);
      hiddenTables = Array.isArray(savedHidden) ? savedHidden : [];
      console.log('[SQL] 已从 IndexedDB 恢复数据库');
    } else {
      // 无存档 → 创建空库 + 跑示例数据 + 立刻存一份
      db = new SQLModule.Database();
      setStatus('初始化示例数据...', 'loading');
      initSchema(db);
      hiddenTables = [];
      await persistAll();
      console.log('[SQL] 已用示例数据初始化并存档');
    }

    // 3) 加载 Monaco Editor（AMD loader）
    setStatus('加载 Monaco Editor...', 'loading');
    await new Promise((resolve, reject) => {
      window.require(['vs/editor/editor.main'], () => resolve(), reject);
    });

    // 4) 创建 Monaco 实例（挂载到 #editor-container）
    editor = window.monaco.editor.create(
      document.getElementById('editor-container'),
      {
        value: `-- 试试这些：
SELECT * FROM students;

-- JOIN 查询：每个学生的订单总额
SELECT s.name, SUM(o.amount) AS total
FROM students s
JOIN orders o ON o.student_id = s.id
GROUP BY s.id
ORDER BY total DESC;

-- 按班级分组
SELECT class, AVG(score) AS avg_score FROM students GROUP BY class;`,
        language: 'sql',
        theme: 'vs-dark',
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: '"SF Mono", Menlo, Consolas, monospace',
        automaticLayout: true,
        wordWrap: 'on',
        tabSize: 2,
        scrollBeyondLastLine: false
      }
    );

    // 5) Ctrl / Cmd + Enter 在编辑器焦点范围内触发 runSQL
    editor.addCommand(
      window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.Enter,
      runSQL
    );

    // 6) 窗口 resize 时让 Monaco 重新测量布局
    window.addEventListener('resize', () => editor && editor.layout());

    // 7) 启用运行按钮 + 渲染 Schema
    hideStatus();
    $btnRun.disabled = false;
    renderSchema();
    bindEvents();

  } catch (err) {
    console.error('[SQL] 启动失败:', err);
    setStatus(
      `启动失败: ${err.message || err}  —  请检查网络是否可访问 jsdelivr CDN`,
      'error'
    );
  }
}

// ====================================================================
// SQL 执行 + 结果渲染
// ====================================================================

/**
 * 判断一段 SQL 是否为查询类（会返回结果集）
 * 规则：去掉注释和前导空白后，第一个关键字是 SELECT / PRAGMA / EXPLAIN / WITH
 */
function isQuerySQL(sql) {
  let cleaned = sql.replace(/--.*$/gm, '');                     // -- 单行注释
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');           // /* */ 块注释
  cleaned = cleaned.trim().toUpperCase();
  if (!cleaned) return false;
  const firstWord = cleaned.split(/\s+/)[0];
  return ['SELECT', 'PRAGMA', 'EXPLAIN', 'WITH'].includes(firstWord);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 渲染查询结果为表格
 * db.exec 返回 [{columns:[], values:[[...]]}, ...]
 */
function renderQueryResults(results) {
  if (!results || results.length === 0) {
    $resultBody.innerHTML = '<div class="empty-hint">查询返回 0 行</div>';
    return;
  }
  let html = '';
  for (let i = 0; i < results.length; i++) {
    const rs = results[i];
    const cols = rs.columns || [];
    const rows = rs.values || [];

    html += '<table class="result-table"><thead><tr>';
    for (const col of cols) html += `<th>${escapeHTML(col)}</th>`;
    html += '</tr></thead><tbody>';
    for (const row of rows) {
      html += '<tr>';
      for (const cell of row) {
        const text = cell === null
          ? '<em>NULL</em>'
          : escapeHTML(String(cell));
        html += `<td>${text}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';

    if (results.length > 1 && i < results.length - 1) {
      html += '<hr style="border:none;border-top:1px solid #313244;margin:12px 0">';
    }
  }
  $resultBody.innerHTML = html;
}

/**
 * 执行 SQL 总入口
 * 成功后刷新 Schema 面板 + 持久化到 IndexedDB
 */
async function runSQL() {
  const sql = editor.getValue();   // Monaco 取当前内容
  if (!sql.trim()) return;

  try {
    if (isQuerySQL(sql)) {
      const results = db.exec(sql);
      renderQueryResults(results);
    } else {
      db.run(sql);
      $resultBody.innerHTML = '<div class="msg-success">✓ 执行成功</div>';
    }
    // 成功 → 刷新 Schema（新表 / DROP / 改名 都可能影响）
    renderSchema();
    // 成功 → 立即持久化
    await persistAll();
  } catch (err) {
    // SQLite 报错原文直接红色显示（不吞掉、不翻译）
    $resultBody.innerHTML =
      `<div class="msg-error">✗ ${escapeHTML(err.message || String(err))}</div>`;
  }
}

// ====================================================================
// Schema 面板：读取 sqlite_master + PRAGMA table_info
// ====================================================================

/**
 * 获取所有用户表（排除 sqlite_ 前缀的系统表，排除 hiddenTables）
 * 返回 [{ name, fields: [{name, type, pk}] }]
 */
function getUserTables() {
  // sqlite_master 查所有表
  const master = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  if (!master[0]) return [];

  const tables = [];
  for (const row of master[0].values) {
    const name = row[0];
    if (hiddenTables.includes(name)) continue;   // 跳过被假删除的

    // PRAGMA table_info 拿字段信息
    const info = db.exec(`PRAGMA table_info("${name}")`);
    const fields = [];
    if (info[0]) {
      // 列：cid, name, type, notnull, dflt_value, pk
      for (const r of info[0].values) {
        fields.push({
          name: r[1],
          type: r[2] || '',
          pk: r[5] > 0
        });
      }
    }
    tables.push({ name, fields });
  }
  return tables;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 渲染左侧 Schema 树
 */
function renderSchema() {
  const tables = getUserTables();

  if (!tables.length) {
    $schemaTree.innerHTML = '<div class="no-tables">没有表</div>';
  } else {
    let html = '';
    for (const t of tables) {
      html += `<div class="table-wrapper">`;
      html += `  <div class="table-node" data-action="insert-select" data-table="${escapeAttr(t.name)}">`;
      html += `    <span><span class="table-icon">🗄</span>${escapeHTML(t.name)}</span>`;
      html += `    <button class="table-del" data-action="soft-delete" data-table="${escapeAttr(t.name)}" title="删除（假删除）">✕</button>`;
      html += `  </div>`;
      for (const f of t.fields) {
        const pkMark = f.pk ? '<span class="pk">PK</span>' : '';
        html += `  <div class="field-node">${pkMark}<span>${escapeHTML(f.name)}</span><span class="type">${escapeHTML(f.type)}</span></div>`;
      }
      html += `</div>`;
    }
    $schemaTree.innerHTML = html;
  }

  // 同步渲染已删除区
  renderDeletedSection();
}

/**
 * 渲染"已删除(N)"折叠区
 */
function renderDeletedSection() {
  $deletedCount.textContent = hiddenTables.length;

  if (hiddenTables.length === 0) {
    $deletedSection.hidden = true;
    return;
  }

  $deletedSection.hidden = false;

  let html = '';
  for (const name of hiddenTables) {
    html += `<div class="deleted-item">`;
    html += `  <span class="name">${escapeHTML(name)}</span>`;
    html += `  <button class="restore" data-action="restore" data-table="${escapeAttr(name)}" title="恢复">↶</button>`;
    html += `  <button class="drop" data-action="hard-delete" data-table="${escapeAttr(name)}" title="彻底删除（DROP TABLE）">🗑</button>`;
    html += `</div>`;
  }
  $deletedList.innerHTML = html;
}

/**
 * 点表名 → 插入 SELECT * FROM "表名" LIMIT 10; 到 Monaco
 */
function insertSelectIntoEditor(tableName) {
  const sql = `SELECT * FROM "${tableName}" LIMIT 10;`;
  // Monaco：从当前光标位置插入
  const pos = editor.getPosition();
  editor.executeEdits('schema-click', [
    { range: new window.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: sql }
  ]);
  editor.focus();
}

// ====================================================================
// 假删除 / 恢复 / 彻底删除
// ====================================================================

async function softDeleteTable(name) {
  if (!hiddenTables.includes(name)) {
    hiddenTables.push(name);
    renderSchema();
    await persistAll();
  }
}

async function restoreTable(name) {
  hiddenTables = hiddenTables.filter(n => n !== name);
  renderSchema();
  await persistAll();
}

async function hardDeleteTable(name) {
  // 真执行 DROP TABLE（可能之前没被假删除过也可能被隐藏了）
  hiddenTables = hiddenTables.filter(n => n !== name);
  try {
    db.run(`DROP TABLE IF EXISTS "${name}"`);
    renderSchema();
    $resultBody.innerHTML = `<div class="msg-success">✓ 已彻底删除表 ${escapeHTML(name)}</div>`;
    await persistAll();
  } catch (err) {
    $resultBody.innerHTML = `<div class="msg-error">✗ ${escapeHTML(err.message)}</div>`;
  }
}

// ====================================================================
// 新建表模态框
// ====================================================================

const FIELD_TYPES = ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'];

/**
 * 给新建表弹窗加一行字段
 */
function addFieldRow(name = '', type = 'TEXT', pk = false) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `
    <input type="text" placeholder="字段名" value="${escapeAttr(name)}">
    <select>${FIELD_TYPES.map(t =>
      `<option ${t === type ? 'selected' : ''}>${t}</option>`
    ).join('')}</select>
    <input type="checkbox" ${pk ? 'checked' : ''}>
    <button class="row-del" title="删除此行">✕</button>
  `;
  row.querySelector('.row-del').addEventListener('click', () => row.remove());
  $newTableFields.appendChild(row);
}

/**
 * 从弹窗收集字段 → 拼 CREATE TABLE SQL
 * 返回 SQL 字符串，不合法时返回 null 并通过 showErrorDom 提示
 */
function buildCreateTableSQL() {
  const tableName = $newTableName.value.trim();
  if (!tableName) {
    alertInline('请输入表名');
    return null;
  }
  if (/[^\w]/.test(tableName)) {
    alertInline('表名只能包含字母、数字、下划线');
    return null;
  }

  const rows = $newTableFields.querySelectorAll('.field-row');
  if (rows.length === 0) {
    alertInline('请至少添加一个字段');
    return null;
  }

  const colDefs = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll('input');
    const name = inputs[0].value.trim();
    const type = row.querySelector('select').value;
    const pk = inputs[2].checked;
    if (!name) { alertInline('字段名不能为空'); return null; }
    let def = `"${name}" ${type}`;
    if (pk) def += ' PRIMARY KEY';
    colDefs.push(def);
  }

  return `CREATE TABLE "${tableName}" (\n  ${colDefs.join(',\n  ')}\n);`;
}

function alertInline(msg) {
  $resultBody.innerHTML = `<div class="msg-error">✗ ${escapeHTML(msg)}</div>`;
}

function openNewTableModal() {
  $newTableName.value = '';
  $newTableFields.innerHTML = '';
  // 默认给两行（id + name）
  addFieldRow('id', 'INTEGER', true);
  addFieldRow('name', 'TEXT', false);
  $modalMask.hidden = false;
}

function closeNewTableModal() { $modalMask.hidden = true; }

// ====================================================================
// 重置按钮：清空存档 → 重建示例库 + 清空 hiddenTables → 立即存档新状态
// ====================================================================

async function resetAll() {
  // 1) 先清 IndexedDB（防止写了新的又被清掉）
  try {
    await del(IDB_KEY_DB);
    await del(IDB_KEY_HIDDEN);
  } catch (e) {
    console.warn('[storage] 清存档失败:', e);
  }
  // 2) 关旧库
  if (db) db.close();
  // 3) 重建空库 + 重跑示例数据
  db = new SQLModule.Database();
  initSchema(db);
  hiddenTables = [];
  // 4) 渲染 + 立刻存一份干净的
  renderSchema();
  $resultBody.innerHTML = '<div class="msg-success">✓ 已重置为示例数据</div>';
  await persistAll();
}

// ====================================================================
// 事件绑定
// ====================================================================

function bindEvents() {
  // 运行按钮
  $btnRun.addEventListener('click', runSQL);

  // Schema 面板事件委托（点击表名 → 插 SELECT / ✕ 假删除）
  $schemaTree.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const table = target.dataset.table;
    if (action === 'insert-select') insertSelectIntoEditor(table);
    else if (action === 'soft-delete') softDeleteTable(table);
  });

  // 已删除区事件委托（恢复 / 彻底删除）
  $deletedList.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const table = target.dataset.table;
    if (action === 'restore') restoreTable(table);
    else if (action === 'hard-delete') hardDeleteTable(table);
  });

  // 已删除区折叠/展开
  $deletedToggle.addEventListener('click', () => {
    $deletedToggle.classList.toggle('open');
    $deletedList.classList.toggle('show');
  });

  // 新建表
  $btnNewTable.addEventListener('click', openNewTableModal);
  $modalClose.addEventListener('click', closeNewTableModal);
  $modalCancel.addEventListener('click', closeNewTableModal);
  $modalMask.addEventListener('click', (e) => {
    if (e.target === $modalMask) closeNewTableModal();
  });
  $addFieldRow.addEventListener('click', () => addFieldRow());
  $modalConfirm.addEventListener('click', () => {
    const sql = buildCreateTableSQL();
    if (!sql) return;
    closeNewTableModal();
    // 把生成的 CREATE TABLE SQL 放入编辑器并执行
    editor.setValue(sql);
    runSQL();
  });

  // 重置
  $btnReset.addEventListener('click', resetAll);
}

// ====================================================================
// 启动
// ====================================================================

bootstrap();
