const mysql = require('mysql');
const config = require('../config.json');

const pool = mysql.createPool({
  host: config.DB.host,
  port: config.DB.port,
  user: config.DB.username,
  password: config.DB.password,
  database: config.DB.databasename,
  charset: 'utf8mb4',
  collation: 'utf8mb4_unicode_ci',
});

const wrap = (runner) => {
  const query = (sql, params) =>
    new Promise((resolve, reject) => {
      runner.query(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  const one = async (sql, params) => {
    const rows = await query(sql, params);
    return rows && rows.length ? rows[0] : null;
  };
  const exists = async (sql, params) => {
    const rows = await query(sql, params);
    return !!(rows && rows.length);
  };
  const column = async (sql, params, key) => {
    const rows = await query(sql, params);
    return rows.map((r) => (key ? r[key] : Object.values(r)[0]));
  };
  return { query, one, exists, column };
};

const base = wrap(pool);

const tx = (work) =>
  new Promise((resolve, reject) => {
    pool.getConnection((err, conn) => {
      if (err) return reject(err);
      conn.beginTransaction(async (beginErr) => {
        if (beginErr) {
          conn.release();
          return reject(beginErr);
        }
        try {
          const result = await work(wrap(conn));
          conn.commit((commitErr) => {
            conn.release();
            if (commitErr) reject(commitErr);
            else resolve(result);
          });
        } catch (workErr) {
          conn.rollback(() => {
            conn.release();
            reject(workErr);
          });
        }
      });
    });
  });

module.exports = {
  pool,
  query: base.query,
  one: base.one,
  exists: base.exists,
  column: base.column,
  tx,
};
