const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../../db');
const storage = require('../../storage');

const {
  FULL_ARCHIVE_FORMAT,
  PROBLEM_JSON_FILE,
  PROFILE_YAML_FILE,
  buildFullProblemManifest,
  dumpProfileYaml,
  isUnsafeRelPath,
  normalizeFullProblemManifest,
} = require('../../api/problem/archive');
const { buildPreset } = require('../../api/problem/judgeProfile');
const { _test } = require('../../api/problem/package');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nywoj-problem-package-'));
let importedPid = null;

const writeSpjPackage = (target, title = 'SPJ 往返测试') => {
  fs.mkdirSync(target, { recursive: true });
  const manifest = buildFullProblemManifest({
    title,
    description: '完整题目包测试',
    samples: [{ input: '1\n', output: '2\n' }],
    tags: ['测试', 'SPJ'],
    difficulty: 3,
    timeLimit: 2000,
    memoryLimit: 256,
    langMask: 6,
  }, { sourcePid: 42 });
  fs.writeFileSync(path.join(target, PROBLEM_JSON_FILE), JSON.stringify(manifest));
  fs.writeFileSync(path.join(target, PROFILE_YAML_FILE), dumpProfileYaml(buildPreset('spj')));
  fs.writeFileSync(path.join(target, 'checker.cpp'), '// checker');
  fs.writeFileSync(path.join(target, '1.in'), '1\n');
  fs.writeFileSync(path.join(target, '1.out'), '2\n');
  fs.writeFileSync(path.join(target, 'config.json'), JSON.stringify({
    cases: [{ index: 1, input: '1.in', output: '1.out', subtaskId: 1 }],
    subtask: [{ index: 1, score: 100, option: 0, skip: false, dependencies: [] }],
  }));
  return manifest;
};

const closePool = () => new Promise((resolve) => db.pool.end(resolve));

(async () => {
  try {
    const manifest = writeSpjPackage(root);
    assert.strictEqual(manifest.format, FULL_ARCHIVE_FORMAT);
    assert.strictEqual(manifest.statement.samples[0].input, '1\n');
    assert.strictEqual(normalizeFullProblemManifest(manifest).statement.title, 'SPJ 往返测试');
    assert.throws(() => normalizeFullProblemManifest({
      ...manifest,
      statement: { ...manifest.statement, timeLimit: -1 },
    }), /时间限制/);

    const inspected = await _test.inspectImportPayload(root);
    assert.strictEqual(inspected.manifest.statement.samples.length, 1);
    assert.strictEqual(inspected.config.cases.length, 1);
    assert.deepStrictEqual(inspected.assets, ['checker.cpp']);
    assert.strictEqual(inspected.profileImport.type, 1);
    assert.strictEqual(inspected.health.ok, true);
    assert.strictEqual(_test.previewDto(inspected).cases, 1);

    assert.strictEqual(isUnsafeRelPath('../escape'), true);
    assert.strictEqual(isUnsafeRelPath('/absolute'), true);
    assert.strictEqual(isUnsafeRelPath('assets/checker.cpp'), false);

    const owner = await db.one('SELECT uid FROM userInfo ORDER BY uid LIMIT 1');
    assert(owner && owner.uid, '测试库中需要至少一个用户');
    const importId = crypto.randomUUID();
    const sessionDir = path.resolve(__dirname, '..', '..', 'tmp', 'problemPackage', importId);
    const payloadDir = path.join(sessionDir, 'payload');
    const uniqueTitle = `__problem_archive_v2_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    writeSpjPackage(payloadDir, uniqueTitle);

    const response = {
      statusCode: 0,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      send(payload) { this.payload = payload; return payload; },
    };
    await _test.performProblemImport({
      session: { uid: owner.uid, ip: '127.0.0.1' },
      useragent: { browser: { name: 'test', version: '1' }, os: { name: 'test', version: '1' } },
    }, response, {
      importId,
      payloadDir,
      meta: { originalName: 'round-trip.zip' },
    });
    assert.strictEqual(response.statusCode, 200);
    importedPid = Number(response.payload.pid);
    const imported = await db.one(
      'SELECT title,description,isPublic,timeLimit,memoryLimit,type,tags,level,lang,judgeProfile FROM problem WHERE pid=?',
      [importedPid]
    );
    assert.strictEqual(imported.title, uniqueTitle);
    assert.strictEqual(imported.description, '完整题目包测试');
    assert.strictEqual(Number(imported.isPublic), 0);
    assert.strictEqual(Number(imported.timeLimit), 2000);
    assert.strictEqual(Number(imported.memoryLimit), 256);
    assert.strictEqual(Number(imported.type), 1);
    assert.deepStrictEqual(JSON.parse(imported.tags), ['测试', 'SPJ']);
    assert.strictEqual(Number(imported.level), 3);
    assert.strictEqual(Number(imported.lang), 6);
    assert.strictEqual(JSON.parse(imported.judgeProfile).preset, 'spj');
    const sampleRow = await db.one('SELECT samples FROM problemSample WHERE pid=?', [importedPid]);
    assert.deepStrictEqual(JSON.parse(sampleRow.samples), [{ inputData: '1\n', outputData: '2\n' }]);
    assert.strictEqual(fs.readFileSync(path.resolve(__dirname, '..', '..', 'data', String(importedPid), '1.in'), 'utf-8'), '1\n');
    console.log('problem archive v2 round-trip helpers: ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (importedPid) {
      await db.query('DELETE FROM problemSample WHERE pid=?', [importedPid]).catch(() => {});
      await db.query('DELETE FROM problem WHERE pid=?', [importedPid]).catch(() => {});
      fs.rmSync(path.resolve(__dirname, '..', '..', 'data', String(importedPid)), { recursive: true, force: true });
      await storage.deleteProblemDataArchive(importedPid).catch(() => {});
    }
    await closePool();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
