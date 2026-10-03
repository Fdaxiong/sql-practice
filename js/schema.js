// ====================================================================
// schema.js — 内置示例数据初始化
// ====================================================================
// 导出 initSchema(db) 函数，由 main.js 在数据库创建后调用。
// 包含 3 张示例表的 CREATE TABLE + INSERT 语句。
// 设计要点：orders.student_id 关联 students.id，可练 JOIN 和 GROUP BY。

/**
 * 向已创建的 sql.js Database 实例写入三张表示例数据
 * @param {SQL.Database} db  sql.js 的 Database 实例
 */
function initSchema(db) {
  // ---------- 建表 ----------
  // 学生表
  db.run(`CREATE TABLE students (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    class TEXT,
    score REAL
  );`);

  // 商品表
  db.run(`CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT
  );`);

  // 订单表：student_id 关联 students.id，可做 JOIN / GROUP BY
  db.run(`CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL,
    product_id INTEGER,
    amount REAL NOT NULL,
    quantity INTEGER DEFAULT 1,
    created_at TEXT,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );`);

  // ---------- 插入学生（8 条，分 3 个班，分数有差异） ----------
  db.run(`INSERT INTO students (id, name, class, score) VALUES
    (1, '张三', '一班', 88.5),
    (2, '李四', '一班', 92.0),
    (3, '王五', '二班', 76.0),
    (4, '赵六', '二班', 85.5),
    (5, '钱七', '三班', 91.0),
    (6, '孙八', '三班', 68.0),
    (7, '周九', '一班', 95.5),
    (8, '吴十', '二班', 82.0);`);

  // ---------- 插入商品（8 条，分 3 个品类） ----------
  db.run(`INSERT INTO products (id, name, price, category) VALUES
    (1, '笔记本电脑', 3500.00, '电子产品'),
    (2, '无线鼠标', 89.00, '电子产品'),
    (3, '机械键盘', 299.00, '电子产品'),
    (4, '保温杯', 25.00, '日用品'),
    (5, 'SQL 必知必会', 45.00, '图书'),
    (6, '护眼台灯', 129.00, '日用品'),
    (7, '降噪耳机', 599.00, '电子产品'),
    (8, '笔记本包', 199.00, '配件');`);

  // ---------- 插入订单（12 条，多个学生有多笔订单，金额不同） ----------
  db.run(`INSERT INTO orders (id, student_id, product_id, amount, quantity, created_at) VALUES
    (1, 1, 1,   3500.00, 1, '2026-09-01'),
    (2, 2, 2,     89.00, 2, '2026-09-02'),
    (3, 3, 3,    299.00, 1, '2026-09-03'),
    (4, 1, 4,     25.00, 3, '2026-09-05'),
    (5, 4, 5,     45.00, 1, '2026-09-06'),
    (6, 5, 7,    599.00, 1, '2026-09-08'),
    (7, 6, 6,    129.00, 1, '2026-09-10'),
    (8, 7, 1,   3500.00, 1, '2026-09-12'),
    (9, 2, 8,    199.00, 1, '2026-09-15'),
    (10, 8, 3,   299.00, 2, '2026-09-18'),
    (11, 1, 5,    45.00, 2, '2026-09-20'),
    (12, 5, 2,     89.00, 1, '2026-09-22');`);
}
