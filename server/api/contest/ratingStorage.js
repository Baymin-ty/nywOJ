const db = require('../../db');

let contestRatingStorageSchemaReady = null;
const CONTEST_RATING_PAIR_UNIQUE_KEY = 'uniq_contest_rating_cid_uid';

const columnExists = async (table, column) => {
  const row = await db.one(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, column]
  );
  return !!(row && row.cnt);
};

const columnIsNullable = async (table, column) => {
  const row = await db.one(
    `SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, column]
  );
  return row && row.nullable === 'YES';
};

const indexExists = async (table, indexName) => {
  const row = await db.one(
    `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`,
    [table, indexName]
  );
  return !!(row && row.cnt);
};

const indexColumns = async (table, indexName) => {
  const rows = await db.query(
    `SELECT COLUMN_NAME AS columnName
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?
      ORDER BY SEQ_IN_INDEX ASC`,
    [table, indexName]
  );
  return rows.map((row) => row.columnName);
};

const sameColumnSet = (actual, expected) =>
  actual.length === expected.length &&
  [...actual].sort().join(',') === [...expected].sort().join(',');

const uniqueIndexOnColumnsExists = async (table, columns) => {
  const columnSet = [...columns].sort().join(',');
  const row = await db.one(
    `SELECT COUNT(*) AS cnt
       FROM (
         SELECT INDEX_NAME,
                GROUP_CONCAT(COLUMN_NAME ORDER BY COLUMN_NAME SEPARATOR ',') AS columnSetCsv,
                COUNT(*) AS columnCount,
                MAX(NON_UNIQUE) AS nonUnique
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
          GROUP BY INDEX_NAME
         HAVING nonUnique=0 AND columnSetCsv=? AND columnCount=?
       ) matched`,
    [table, columnSet, columns.length]
  );
  return !!(row && row.cnt);
};

const indexesWithColumnPrefix = async (table, columns) => {
  const rows = await db.query(
    `SELECT INDEX_NAME AS indexName
       FROM (
         SELECT INDEX_NAME,
                GROUP_CONCAT(IF(SEQ_IN_INDEX <= ?, COLUMN_NAME, NULL) ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columnPrefixCsv,
                SUM(IF(SEQ_IN_INDEX <= ?, 1, 0)) AS prefixCount
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
          GROUP BY INDEX_NAME
         HAVING columnPrefixCsv=? AND prefixCount=?
       ) matched
      ORDER BY indexName ASC`,
    [columns.length, columns.length, table, columns.join(','), columns.length]
  );
  return rows.map((row) => row.indexName);
};

const indexWithColumnPrefixExists = async (table, columns) =>
  (await indexesWithColumnPrefix(table, columns)).length > 0;

const addColumnIfMissing = async (table, column, ddl) => {
  if (!(await columnExists(table, column))) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
};

const addIndexOnColumnPrefixIfMissing = async (table, preferredName, columns) => {
  if (await indexWithColumnPrefixExists(table, columns)) {
    return {
      indexAdded: false,
      indexName: null,
    };
  }
  let indexName;
  try {
    indexName = await availableIndexName(table, preferredName);
  } catch (err) {
    if (await indexWithColumnPrefixExists(table, columns)) {
      return {
        indexAdded: false,
        indexName: null,
      };
    }
    return {
      indexAdded: false,
      indexName: null,
      indexError: err && err.message || String(err),
    };
  }
  try {
    await db.query(`ALTER TABLE ${table} ADD KEY ${indexName} (${columns.join(', ')})`);
  } catch (err) {
    if (await indexWithColumnPrefixExists(table, columns)) {
      return {
        indexAdded: false,
        indexName: null,
      };
    }
    throw err;
  }
  return {
    indexAdded: true,
    indexName,
  };
};

const availableIndexName = async (table, preferredName) => {
  if (!(await indexExists(table, preferredName))) return preferredName;
  for (let i = 2; i <= 20; i++) {
    const candidate = `${preferredName}_${i}`;
    if (!(await indexExists(table, candidate))) return candidate;
  }
  throw new Error(`No available index name for ${table}.${preferredName}`);
};

const normalizeColumnNulls = async (table, column, defaultSql, ddl) => {
  await db.query(`UPDATE ${table} SET ${column}=${defaultSql} WHERE ${column} IS NULL`);
  if (await columnIsNullable(table, column)) {
    await db.query(`ALTER TABLE ${table} MODIFY ${column} ${ddl}`);
  }
};

const contestRatingDuplicatePairCount = async () => {
  const row = await db.one(
    `SELECT COUNT(*) AS cnt
       FROM (
         SELECT cid,uid
           FROM contestRating
          GROUP BY cid,uid
         HAVING COUNT(*)>1
       ) duplicated`
  );
  return Number(row && row.cnt || 0);
};

const contestRatingNullKeyRowCount = async () => {
  const row = await db.one('SELECT COUNT(*) AS cnt FROM contestRating WHERE cid IS NULL OR uid IS NULL');
  return Number(row && row.cnt || 0);
};

const ensureContestRatingPrimaryKey = async () => {
  const primaryColumns = await indexColumns('contestRating', 'PRIMARY');
  const primaryKeyReady = sameColumnSet(primaryColumns, ['cid', 'uid']);
  if (primaryKeyReady) {
    return {
      primaryKeyAdded: false,
      uniqueKeyAdded: false,
      primaryKeySkippedWrongPrimary: false,
      uniqueConstraintReady: true,
      primaryKeySkippedDuplicatePairCount: 0,
      primaryKeySkippedNullKeyRowCount: 0,
    };
  }
  const duplicatePairCount = await contestRatingDuplicatePairCount();
  const nullKeyRowCount = await contestRatingNullKeyRowCount();
  if (duplicatePairCount > 0 || nullKeyRowCount > 0) {
    return {
      primaryKeyAdded: false,
      uniqueKeyAdded: false,
      primaryKeySkippedWrongPrimary: primaryColumns.length > 0,
      uniqueConstraintReady: false,
      primaryKeySkippedDuplicatePairCount: duplicatePairCount,
      primaryKeySkippedNullKeyRowCount: nullKeyRowCount,
    };
  }
  if (await columnIsNullable('contestRating', 'cid')) {
    await db.query('ALTER TABLE contestRating MODIFY cid INT NOT NULL');
  }
  if (await columnIsNullable('contestRating', 'uid')) {
    await db.query('ALTER TABLE contestRating MODIFY uid INT NOT NULL');
  }
  if (await uniqueIndexOnColumnsExists('contestRating', ['cid', 'uid'])) {
    return {
      primaryKeyAdded: false,
      uniqueKeyAdded: false,
      primaryKeySkippedWrongPrimary: primaryColumns.length > 0,
      uniqueConstraintReady: true,
      primaryKeySkippedDuplicatePairCount: 0,
      primaryKeySkippedNullKeyRowCount: 0,
    };
  }
  if (!primaryColumns.length) {
    await db.query('ALTER TABLE contestRating ADD PRIMARY KEY (cid, uid)');
    return {
      primaryKeyAdded: true,
      uniqueKeyAdded: false,
      primaryKeySkippedWrongPrimary: false,
      uniqueConstraintReady: true,
      primaryKeySkippedDuplicatePairCount: 0,
      primaryKeySkippedNullKeyRowCount: 0,
    };
  }
  const uniqueKeyName = await availableIndexName('contestRating', CONTEST_RATING_PAIR_UNIQUE_KEY);
  await db.query(`ALTER TABLE contestRating ADD UNIQUE KEY ${uniqueKeyName} (cid, uid)`);
  return {
    primaryKeyAdded: false,
    uniqueKeyAdded: true,
    uniqueKeyName,
    primaryKeySkippedWrongPrimary: true,
    uniqueConstraintReady: true,
    primaryKeySkippedDuplicatePairCount: 0,
    primaryKeySkippedNullKeyRowCount: 0,
  };
};

const contestRatingUniqueConstraintStatus = async () => {
  const primaryColumns = await indexColumns('contestRating', 'PRIMARY');
  const primaryKeyCoversPair = sameColumnSet(primaryColumns, ['cid', 'uid']);
  const pairUniqueConstraintExists = await uniqueIndexOnColumnsExists('contestRating', ['cid', 'uid']);
  const [duplicatePairCount, nullKeyRowCount] = await Promise.all([
    contestRatingDuplicatePairCount(),
    contestRatingNullKeyRowCount(),
  ]);
  return {
    uniqueConstraintReady: primaryKeyCoversPair || pairUniqueConstraintExists,
    primaryKeyCoversPair,
    pairUniqueConstraintExists,
    primaryKeyWrongColumns: primaryColumns.length > 0 && !primaryKeyCoversPair,
    primaryKeyColumns: primaryColumns,
    primaryKeySkippedDuplicatePairCount: duplicatePairCount,
    primaryKeySkippedNullKeyRowCount: nullKeyRowCount,
  };
};

const contestRatingAuxiliaryIndexStatus = async () => {
  const [uidIndexNames, cidRankIndexNames] = await Promise.all([
    indexesWithColumnPrefix('contestRating', ['uid']),
    indexesWithColumnPrefix('contestRating', ['cid', 'rank']),
  ]);
  return {
    auxiliaryIndexesReady: uidIndexNames.length > 0 && cidRankIndexNames.length > 0,
    uidIndexReady: uidIndexNames.length > 0,
    cidRankIndexReady: cidRankIndexNames.length > 0,
    uidIndexNames,
    cidRankIndexNames,
  };
};

const ensureContestRatingAuxiliaryIndexes = async () => {
  const uidIndex = await addIndexOnColumnPrefixIfMissing('contestRating', 'idx_uid', ['uid']);
  const cidRankIndex = await addIndexOnColumnPrefixIfMissing('contestRating', 'idx_cid_rank', ['cid', 'rank']);
  return {
    uidIndexAdded: uidIndex.indexAdded,
    uidIndexName: uidIndex.indexName,
    uidIndexError: uidIndex.indexError || null,
    cidRankIndexAdded: cidRankIndex.indexAdded,
    cidRankIndexName: cidRankIndex.indexName,
    cidRankIndexError: cidRankIndex.indexError || null,
  };
};

const ensureContestRatingStorageSchema = () => {
  if (!contestRatingStorageSchemaReady) {
    contestRatingStorageSchemaReady = (async () => {
      await addColumnIfMissing('userInfo', 'rating', 'INT NOT NULL DEFAULT 0');
      await addColumnIfMissing('contest', 'ratingEnabled', 'TINYINT NOT NULL DEFAULT 1');
      await normalizeColumnNulls('userInfo', 'rating', '0', 'INT NOT NULL DEFAULT 0');
      await normalizeColumnNulls('contest', 'ratingEnabled', '1', 'TINYINT NOT NULL DEFAULT 1');
      await db.query(`
        CREATE TABLE IF NOT EXISTS contestRating (
          cid INT NOT NULL,
          uid INT NOT NULL,
          rank INT NOT NULL,
          totalScore INT NOT NULL,
          usedTime INT NOT NULL,
          oldRating INT NOT NULL,
          newRating INT NOT NULL,
          delta INT NOT NULL,
          algorithm VARCHAR(40) NOT NULL DEFAULT 'elo-rank-v1',
          updateTime DATETIME NOT NULL,
          PRIMARY KEY (cid, uid),
          KEY idx_uid (uid),
          KEY idx_cid_rank (cid, rank)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await addColumnIfMissing('contestRating', 'cid', 'INT NULL FIRST');
      await addColumnIfMissing('contestRating', 'uid', 'INT NULL AFTER cid');
      await addColumnIfMissing('contestRating', 'rank', 'INT NOT NULL DEFAULT 0');
      await addColumnIfMissing('contestRating', 'totalScore', 'INT NOT NULL DEFAULT 0');
      await addColumnIfMissing('contestRating', 'usedTime', 'INT NOT NULL DEFAULT 0');
      await addColumnIfMissing('contestRating', 'oldRating', 'INT NOT NULL DEFAULT 0');
      await addColumnIfMissing('contestRating', 'newRating', 'INT NOT NULL DEFAULT 0');
      await addColumnIfMissing('contestRating', 'delta', 'INT NOT NULL DEFAULT 0');
      await addColumnIfMissing('contestRating', 'algorithm', "VARCHAR(40) NOT NULL DEFAULT 'elo-rank-v1'");
      await normalizeColumnNulls('contestRating', 'rank', '0', 'INT NOT NULL DEFAULT 0');
      await normalizeColumnNulls('contestRating', 'totalScore', '0', 'INT NOT NULL DEFAULT 0');
      await normalizeColumnNulls('contestRating', 'usedTime', '0', 'INT NOT NULL DEFAULT 0');
      await normalizeColumnNulls('contestRating', 'oldRating', '0', 'INT NOT NULL DEFAULT 0');
      await normalizeColumnNulls('contestRating', 'newRating', '0', 'INT NOT NULL DEFAULT 0');
      await normalizeColumnNulls('contestRating', 'delta', '0', 'INT NOT NULL DEFAULT 0');
      if (!(await columnExists('contestRating', 'updateTime'))) {
        await db.query('ALTER TABLE contestRating ADD COLUMN updateTime DATETIME NULL');
      }
      await db.query("UPDATE contestRating SET algorithm='elo-rank-v1' WHERE algorithm IS NULL OR algorithm=''");
      if (await columnIsNullable('contestRating', 'algorithm')) {
        await db.query("ALTER TABLE contestRating MODIFY algorithm VARCHAR(40) NOT NULL DEFAULT 'elo-rank-v1'");
      }
      await db.query('UPDATE contestRating SET updateTime=NOW() WHERE updateTime IS NULL');
      if (await columnIsNullable('contestRating', 'updateTime')) {
        await db.query('ALTER TABLE contestRating MODIFY updateTime DATETIME NOT NULL');
      }
      await ensureContestRatingPrimaryKey();
      await ensureContestRatingAuxiliaryIndexes();
    })().catch((err) => {
      contestRatingStorageSchemaReady = null;
      throw err;
    });
  }
  return contestRatingStorageSchemaReady;
};

const ratingRowPickOrder =
  'cr.updateTime DESC,cr.rank ASC,cr.totalScore DESC,cr.usedTime ASC,cr.newRating DESC,cr.delta DESC,cr.oldRating DESC,cr.algorithm DESC';

const latestActiveRatingRowsSql = `
  SELECT cr.uid,
         CAST(SUBSTRING_INDEX(
           GROUP_CONCAT(cr.newRating ORDER BY ${ratingRowPickOrder} SEPARATOR ','),
           ',',
           1
         ) AS SIGNED) AS newRating
    FROM contestRating cr
    INNER JOIN contest c ON c.cid=cr.cid
    INNER JOIN userInfo ur ON ur.uid=cr.uid
   WHERE c.done=1 AND c.ratingEnabled=1
     AND NOT EXISTS (
       SELECT 1
        FROM contestRating cr2 INNER JOIN contest c2 ON c2.cid=cr2.cid
       WHERE cr2.uid=cr.uid AND c2.done=1 AND c2.ratingEnabled=1
         AND (c2.start>c.start OR (c2.start=c.start AND cr2.cid>cr.cid))
     )
   GROUP BY cr.uid`;

const latestRatingJoin = (alias = 'u', latestAlias = 'latestRating') =>
  `LEFT JOIN (${latestActiveRatingRowsSql}) ${latestAlias} ON ${latestAlias}.uid=${alias}.uid`;

const effectiveRatingExpr = (alias = 'u', latestAlias = 'latestRating') =>
  `COALESCE(${latestAlias}.newRating,${alias}.rating,0)`;

module.exports = {
  ensureContestRatingStorageSchema,
  ensureContestRatingPrimaryKey,
  ensureContestRatingAuxiliaryIndexes,
  contestRatingUniqueConstraintStatus,
  contestRatingAuxiliaryIndexStatus,
  latestActiveRatingRowsSql,
  latestRatingJoin,
  effectiveRatingExpr,
};
