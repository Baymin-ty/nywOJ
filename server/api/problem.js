require('express-zip');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { handler, fail, ok, paginate, buildWhere } = require('../db/util');
const { requirePermission } = require('../auth/middleware');
const { getFile, setFile } = require('../file');
const { briefFormat, Format, bFormat, recordEvent, kbFormat } = require('../static');
const { judgeRes, ptype } = require('../db/format');

// ---- shared helpers ----
const problemAuth = async (req, pid) => {
  const row = await db.one('SELECT isPublic,publisher FROM problem WHERE pid=?', [pid]);
  if (!row) return { view: false, manage: false };
  const scope = { type: 'problem', id: Number(pid) };
  const isOwner = row.publisher === req.session.uid;
  return {
    view: !!row.isPublic || isOwner || req.can('problem.view.private'),
    manage: isOwner || req.can('problem.edit.any', scope) || req.can('problem.case.manage', scope),
  };
};
exports.problemAuth = problemAuth;

const getProblemLang = async (pid) => {
  const row = await db.one('SELECT lang FROM problem WHERE pid=?', [pid]);
  return row ? row.lang : null;
};
exports.getProblemLang = getProblemLang;

const updateProblemStat = async (pid) => {
  const stat = await db.query(
    'SELECT score,judgeResult,COUNT(*) as cnt FROM submission WHERE pid=? GROUP BY score,judgeResult ORDER BY score,judgeResult',
    [pid]
  );
  for (const i of stat) i.judgeResult = judgeRes[i.judgeResult];
  await db.query('UPDATE problem SET stat=? WHERE pid=?', [JSON.stringify(stat), pid]);
  return stat;
};
exports.updateProblemStat = updateProblemStat;

// ---- handlers ----
exports.createProblem = [
  requirePermission('problem.create'),
  handler(async (req, res) => {
    const r = await db.query(
      'INSERT INTO problem(title,description,publisher,time,tags) VALUES (?,?,?,?,?)',
      ['请输入题目标题', '请输入题目描述', req.session.uid, new Date(), JSON.stringify(['请修改题目标签'])]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res, { pid: r.insertId });
  }),
];

exports.updateProblem = [
  handler(async (req, res) => {
    const { pid } = req.body;
    const info = req.body.info || {};
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    if (!info.title || !info.description || !info.timeLimit || !info.memoryLimit || !pid)
      return fail(res, '请确认信息完善');

    // Holders of global problem.edit.any (e.g. moderator+) bypass per-problem limits.
    if (!req.can('problem.edit.any')) {
      if (info.timeLimit > 10000 || info.timeLimit < 0) return fail(res, '时间限制最大为10000ms');
      if (info.memoryLimit > 512 || info.memoryLimit < 0) return fail(res, '空间限制最大为512MB');
      if (info.tags?.length > 5) return fail(res, '题目标签最多设置5个');
      for (const t of info.tags) {
        if (t.length > 10) return fail(res, '单个标签长度不能大于10');
      }
    }
    if (info.isPublic !== false && info.isPublic !== true) return fail(res, 'isPublic格式错误');
    if (info.level < 0 || info.level > 5) return fail(res, '难度评级格式错误');

    info.isPublic = info.isPublic ? 1 : 0;
    if (info.type === '传统文本比较') info.type = 0;
    else if (info.type === 'Special Judge') info.type = 1;

    const r = await db.query(
      'UPDATE problem SET title=?,description=?,timeLimit=?,memoryLimit=?,isPublic=?,type=?,tags=?,level=?,lang=? WHERE pid=?',
      [info.title, info.description, info.timeLimit, info.memoryLimit, info.isPublic, info.type, JSON.stringify(info.tags), info.level, info.lang, pid]
    );
    if (!r.affectedRows) return fail(res, 'error');
    return ok(res);
  }),
];

exports.getProblemList = handler(async (req, res) => {
  const { offset, limit } = paginate(req);
  const filter = req.body.filter || {};
  if (filter.level === 6) filter.level = null;

  const visibility = req.can('problem.view.private') ? '1=1' : 'isPublic=1';
  const tagsParam = filter.tags?.length ? JSON.stringify(filter.tags) : null;

  // 注意：原实现里 list 用 (title LIKE ? OR description LIKE ?)，而 count 只看 title — 这里统一用同一份条件以避免漂移
  const cond = [
    ['publisher=?', filter.publisherUid],
    ['level=?', filter.level],
    filter.name ? ['(title LIKE ? OR description LIKE ?)', `%${filter.name}%`, `%${filter.name}%`] : null,
    ['JSON_CONTAINS(tags, ?)', tagsParam],
  ];
  const { where, params } = buildWhere(cond, visibility);

  const list = await db.query(
    'SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.time,p.level,p.tags,p.publisher as publisherUid,u.name as publisher,p.isPublic ' +
      'FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher' +
      `${where} LIMIT ?,?`,
    [...params, offset, limit]
  );
  for (const r of list) {
    r.time = briefFormat(r.time);
    r.tags = JSON.parse(r.tags);
  }

  const cnt = await db.one(`SELECT COUNT(*) as total FROM problem${where}`, params);
  return ok(res, { total: cnt.total, data: list });
});

exports.getProblemInfo = handler(async (req, res) => {
  const { pid } = req.body;
  const visibility = req.can('problem.view.private') ? '' : ' AND isPublic=1';
  const row = await db.one(
    'SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.description,p.time,p.timeLimit,p.memoryLimit,p.isPublic,p.type,p.tags,p.level,p.lang,p.publisher as publisherUid,u.`name` as publisher ' +
      'FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher WHERE pid=?' + visibility,
    [pid]
  );
  if (!row) return fail(res, '无权限查看或未找到此题目');
  row.type = ptype[row.type];
  row.tags = JSON.parse(row.tags);
  row.time = briefFormat(row.time);
  return ok(res, { data: row });
});

exports.getProblemCasePreview = [
  handler(async (req, res) => {
    const { pid } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    const cfgRaw = await getFile(`./data/${pid}/config.json`);
    const data = cfgRaw ? JSON.parse(cfgRaw) : null;

    let spj = '';
    if (fs.existsSync(`./data/${pid}/checker.cpp`)) {
      spj = await getFile(`./data/${pid}/checker.cpp`);
    }
    if (!data) return res.status(202).send({ data: [], spj, subtask: [] });

    const cases = data.cases;
    let previewList = [];
    if (fs.existsSync(`./data/${pid}/preview.json`)) {
      previewList = JSON.parse(await getFile(`./data/${pid}/preview.json`));
    } else {
      for (const i in cases) {
        const inputFile = await getFile(`./data/${pid}/${cases[i].input}`);
        const inputStat = fs.statSync(`./data/${pid}/${cases[i].input}`);
        const outputFile = await getFile(`./data/${pid}/${cases[i].output}`);
        const outputStat = fs.statSync(`./data/${pid}/${cases[i].output}`);
        previewList[i] = {
          index: cases[i].index,
          inName: cases[i].input,
          outName: cases[i].output,
          subtaskId: cases[i].subtaskId,
          input: {
            content: inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
            size: bFormat(inputStat.size),
            create: Format(inputStat.birthtime),
            modified: Format(inputStat.mtime),
          },
          output: {
            content: outputFile.substring(0, 255) + (outputFile.length > 255 ? '......\n' : ''),
            size: bFormat(outputStat.size),
            create: Format(outputStat.birthtime),
            modified: Format(outputStat.mtime),
          },
          edit: 0,
        };
      }
      await setFile(`./data/${pid}/preview.json`, JSON.stringify(previewList));
    }
    return ok(res, { data: previewList, spj, subtask: data.subtask });
  }),
];

exports.clearCase = [
  handler(async (req, res) => {
    const { pid } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    const dir = path.join(__dirname, `../data/${pid}`);
    recordEvent(req, 'problem.delAllCases', { pid });
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    return ok(res);
  }),
];

exports.updateSubtaskId = [
  handler(async (req, res) => {
    const { pid, cases, subtask } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');

    const subtaskMap = new Map();
    let totalScore = 0;
    for (let i = 0; i < subtask.length; i++) {
      const s = subtask[i];
      if (typeof s.index !== 'number' || s.index !== i + 1)
        return fail(res, `子任务 #${s.index} 编号非法或不连续`);
      if (!Number.isInteger(s.score) || s.score < 1 || s.score > 100)
        return fail(res, `子任务 #${s.index} 分数应为[1,100]之间的整数`);
      if (s.option !== 0 && s.option !== 1) return fail(res, `子任务 #${s.index} 记分方式非法`);
      if (subtaskMap.has(s.index)) return fail(res, `子任务 #${s.index} 编号重复`);
      if (s.index < 1 || s.index > 100) return fail(res, `子任务 #${s.index} 应在[1,100]之间`);
      if (!s.option && s.skip) return fail(res, `测试点等分的子任务 #${s.index} 无法设置遇TLE止测`);
      if (!s.option && s.dependencies?.length)
        return fail(res, `测试点等分的子任务 #${s.index} 无法设置子任务依赖`);
      for (const id of s.dependencies) {
        if (id >= s.index) return fail(res, `子任务 #${s.index} 依赖了 id>=${s.index} 的子任务`);
      }
      subtaskMap.set(s.index, s.score);
      totalScore += s.score;
    }
    if (totalScore !== 100) return fail(res, '子任务分数之和应等于100分');

    const newCases = [];
    const subtaskVis = new Map();
    for (const i in cases) {
      const c = cases[i];
      if (!fs.existsSync(`./data/${pid}/${c.inName}`) || !fs.existsSync(`./data/${pid}/${c.outName}`))
        return fail(res, `找不到数据点 ${c.inName}/${c.outName}`);
      if (!subtaskMap.has(Number(c.subtaskId)))
        return fail(res, `测试点 #${c.index} 所属子任务 #${Number(c.subtaskId)} 未定义`);
      newCases.push({
        index: Number(i) + 1,
        input: c.inName,
        output: c.outName,
        subtaskId: Number(c.subtaskId),
      });
      subtaskVis.set(Number(c.subtaskId), true);
    }
    for (const s of subtask) {
      if (!subtaskVis.has(s.index)) return fail(res, `子任务 #${s.index} 中没有测试点`);
    }
    newCases.sort((a, b) => a.index - b.index);

    await setFile(`./data/${pid}/config.json`, JSON.stringify({ cases: newCases, subtask }));
    recordEvent(req, 'problem.updateConfig', { pid });
    if (fs.existsSync(`./data/${pid}/preview.json`)) {
      fs.rmSync(`./data/${pid}/preview.json`);
    }
    return ok(res);
  }),
];

exports.getCase = [
  handler(async (req, res) => {
    const { pid, caseInfo } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    if (!fs.existsSync(`./data/${pid}/${caseInfo.inName}`) || !fs.existsSync(`./data/${pid}/${caseInfo.outName}`))
      return fail(res, '未找到测试点');

    const inputFile = await getFile(`./data/${pid}/${caseInfo.inName}`);
    const inputStat = fs.statSync(`./data/${pid}/${caseInfo.inName}`);
    const outputFile = await getFile(`./data/${pid}/${caseInfo.outName}`);
    const outputStat = fs.statSync(`./data/${pid}/${caseInfo.outName}`);
    if (inputStat.size + outputStat.size > 5 * 1024 * 1024) return fail(res, '超过编辑大小限制 5MB');
    return ok(res, { input: inputFile, output: outputFile });
  }),
];

exports.updateCase = [
  handler(async (req, res) => {
    const { pid, caseInfo } = req.body;
    if (!(await problemAuth(req, pid)).manage) return res.status(403).end('403 Forbidden');
    if (!fs.existsSync(`./data/${pid}/${caseInfo.inName}`) || !fs.existsSync(`./data/${pid}/${caseInfo.outName}`))
      return fail(res, '未找到测试点');

    await setFile(`./data/${pid}/${caseInfo.inName}`, caseInfo.input.content);
    await setFile(`./data/${pid}/${caseInfo.outName}`, caseInfo.output.content);
    recordEvent(req, 'problem.updateCase', { pid, index: caseInfo.index });
    if (fs.existsSync(`./data/${pid}/preview.json`)) {
      fs.rmSync(`./data/${pid}/preview.json`);
    }
    return ok(res, {
      inputM: Format(fs.statSync(`./data/${pid}/${caseInfo.inName}`).mtime),
      outputM: Format(fs.statSync(`./data/${pid}/${caseInfo.outName}`).mtime),
      message: 'ok',
    });
  }),
];

exports.downloadCase = [
  handler(async (req, res) => {
    const { pid, index } = req.query;
    const problem = await db.one('SELECT publisher FROM problem WHERE pid=?', [pid]);
    if (!problem || !fs.existsSync(`./data/${pid}/config.json`)) return fail(res, 'Not Found Error');
    const scope = { type: 'problem', id: Number(pid) };
    const allowed = problem.publisher === req.session.uid
      || req.can('problem.case.manage', scope)
      || req.can('problem.edit.any', scope);
    if (!allowed) return fail(res, '你只能下载自己题目的测试点');

    const { cases } = JSON.parse(await getFile(`./data/${pid}/config.json`));
    const files = [];
    for (const i in cases) {
      if (typeof index === 'undefined' || cases[i].index === parseInt(index, 10)) {
        files.push({ path: `./data/${pid}/${cases[i].input}`, name: cases[i].input });
        files.push({ path: `./data/${pid}/${cases[i].output}`, name: cases[i].output });
      }
    }
    if (typeof index === 'undefined') {
      files.push({ path: `./data/${pid}/config.json`, name: 'config.json' });
      if (fs.existsSync(`./data/${pid}/checker.cpp`))
        files.push({ path: `./data/${pid}/checker.cpp`, name: 'checker.cpp' });
      recordEvent(req, 'problem.downloadCase', { pid });
    } else {
      recordEvent(req, 'problem.downloadCase', { pid, index });
    }
    const fileName = (index ? `nywoj_Testdata_#${pid}_case#${index}` : `nywoj_Testdata_#${pid}`) + '.zip';
    return res.zip(files, fileName);
  }),
];

exports.getProblemTags = handler(async (req, res) => {
  const data = await db.query(
    `SELECT DISTINCT JSON_UNQUOTE(value) AS tag
       FROM problem,
       JSON_TABLE(tags, '$[*]' COLUMNS (value JSON PATH '$')) AS jt
      WHERE JSON_VALID(tags)`
  );
  return res.status(200).send(data.map((r) => r.tag));
});

exports.getProblemPublishers = handler(async (req, res) => {
  const data = await db.query(
    'SELECT DISTINCT(p.publisher),u.name FROM problem p INNER JOIN userInfo u WHERE p.publisher=u.uid'
  );
  return res.status(200).send(data);
});

exports.getProblemStat = handler(async (req, res) => {
  const { pid } = req.body;
  if (!pid) return fail(res, 'expect pid');
  if (!(await problemAuth(req, pid)).view) return fail(res, '权限不足');

  const row = await db.one('SELECT stat FROM problem WHERE pid=?', [pid]);
  if (!row || !row.stat) return ok(res, { stat: await updateProblemStat(pid) });
  return ok(res, { stat: JSON.parse(row.stat) });
});

exports.getProblemFastestSubmission = handler(async (req, res) => {
  const { pid } = req.body;
  if (!pid) return fail(res, 'expect pid');
  if (!(await problemAuth(req, pid)).view) return fail(res, '权限不足');

  const data = await db.query(
    'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.cid,s.machine,s.lang,u.name,p.title,p.isPublic ' +
      'FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ' +
      'WHERE p.pid=? AND score=100 ORDER BY s.time LIMIT 10',
    [pid]
  );
  for (const r of data) r.memory = kbFormat(r.memory);
  return ok(res, { data });
});

exports.bindPaste2Problem = handler(async (req, res) => {
  const { pid, mark } = req.body;
  if (!pid || !mark) return fail(res, 'expect pid && mark');
  if (!(await problemAuth(req, pid)).manage) return fail(res, '权限不足');

  const exists = await db.exists('SELECT 1 FROM pastes WHERE mark=?', [mark]);
  if (!exists) return fail(res, `未找到mark为${mark}的剪贴板`);
  await db.query('INSERT INTO problemSolution(pid,mark) VALUES (?,?)', [pid, mark]);
  return ok(res);
});

exports.getProblemSol = handler(async (req, res) => {
  const { pid } = req.body;
  if (!pid) return fail(res, 'expect pid');
  if (!(await problemAuth(req, pid)).view) return fail(res, '权限不足');

  const data = await db.query(
    'SELECT s.id,s.mark,p.uid,p.title,u.name,p.time,p.isPublic ' +
      'FROM problemSolution s INNER JOIN pastes p ON s.mark=p.mark INNER JOIN userInfo u ON p.uid=u.uid ' +
      'WHERE s.show=1 AND s.pid=? ORDER BY p.time',
    [pid]
  );
  for (const r of data) r.time = briefFormat(r.time);
  return ok(res, { data });
});

exports.unbindSol = handler(async (req, res) => {
  const { id } = req.body;
  const sol = await db.one('SELECT pid FROM problemSolution WHERE id=?', [id]);
  if (!sol) return fail(res, '记录不存在');
  if (!(await problemAuth(req, sol.pid)).manage) return fail(res, '权限不足');
  await db.query('UPDATE problemSolution SET `show`=0 WHERE id=?', [id]);
  return ok(res);
});

exports.getProblemAuth = handler(async (req, res) => {
  return ok(res, { data: await problemAuth(req, req.body.pid) });
});
