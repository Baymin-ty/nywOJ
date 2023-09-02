const SqlString = require('mysql/lib/protocol/SqlString');
const db = require('../db/index');
const { getFile, setFile } = require('../file');
const fs = require('fs');
const path = require('path');
const { briefFormat, Format, bFormat } = require('../static');

exports.createProblem = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  db.query('INSERT INTO problem(title,description,publisher,time,tags) VALUES (?,?,?,?,?)', ["请输入题目标题", "请输入题目描述", req.session.uid, new Date(), JSON.stringify(['请修改题目标签'])], (err, data) => {
    if (err) return res.status(202).send({
      message: err
    });
    if (data.affectedRows > 0) {
      return res.status(200).send({
        pid: data.insertId
      })
    } else {
      return res.status(202).send({
        message: 'error',
      })
    }
  });
}

exports.updateProblem = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const pid = req.body.pid, info = req.body.info;

  db.query('SELECT * FROM problem WHERE pid=?', [pid], (err, problemInfo) => {
    if (req.session.uid !== 1 && problemInfo[0].publisher !== req.session.uid) {
      return res.status(202).send({ message: '你只能修改自己的题目' });
    }
    if (!info.title || !info.description || !info.timeLimit || !info.memoryLimit || !pid) {
      return res.status(202).send({
        message: '请确认信息完善'
      });
    }
    if (info.timeLimit > 10000 || info.timeLimit < 0) {
      return res.status(202).send({
        message: '时间限制最大为10000ms'
      });
    }
    if (info.memoryLimit > 512 || info.memoryLimit < 0) {
      return res.status(202).send({
        message: '时间限制最大为512MB'
      });
    }
    if (info.isPublic !== false && info.isPublic !== true) {
      return res.status(202).send({
        message: 'isPublic格式错误'
      });
    }
    info.isPublic = info.isPublic ? 1 : 0;
    if (info.type === '传统文本比较') info.type = 0;
    else if (info.type === 'Special Judge') info.type = 1;
    db.query('UPDATE problem SET title=?,description=?,timeLimit=?,memoryLimit=?,isPublic=?,type=?,tags=? WHERE pid=?', [info.title, info.description, info.timeLimit, info.memoryLimit, info.isPublic, info.type, JSON.stringify(info.tags), pid], (err, data) => {
      if (err) return res.status(202).send({
        message: err
      });
      if (data.affectedRows > 0) {
        return res.status(200).send({
          message: 'success',
        })
      } else {
        return res.status(202).send({
          message: 'error',
        })
      }
    });
  });
}

exports.getProblemList = (req, res) => {
  let pageId = req.body.pageId,
    pageSize = 20;
  if (!pageId) pageId = 1;
  pageId = SqlString.escape(pageId);
  let sql = "SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.time,p.publisher as publisherUid,u.`name` as publisher,p.isPublic FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher" +
    (req.session.gid > 1 ? "" : " WHERE isPublic=1") + " LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    for (let i = 0; i < list.length; i++) list[i].time = briefFormat(list[i].time);
    db.query("SELECT COUNT(*) as total FROM problem" + (req.session.gid > 1 ? "" : " WHERE isPublic=1"), (err, data) => {
      if (err) return res.status(202).send({ message: err });
      return res.status(200).send({
        total: data[0].total,
        data: list
      });
    });
  });
}

const ptype = ['传统文本比较', 'Special Judge'];

exports.getProblemInfo = (req, res) => {
  const pid = req.body.pid;
  let sql = "SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.description,p.time,p.timeLimit,p.memoryLimit,p.isPublic,p.type,p.tags,p.publisher as publisherUid,u.`name` as publisher FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher WHERE pid=? "
    + (req.session.gid > 1 ? "" : "AND isPublic=1");
  db.query(sql, [pid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({
      message: 'error'
    });
    else {
      data[0].type = ptype[data[0].type];
      data[0].tags = JSON.parse(data[0].tags);
      data[0].time = briefFormat(data[0].time);
      return res.status(200).send({
        data: data[0]
      });
    }
  });
}

exports.getProblemCasePreview = async (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const pid = req.body.pid;
  const data = JSON.parse(await (getFile(`./data/${pid}/config.json`)));

  let spj = '';

  if (fs.existsSync(`./data/${pid}/checker.cpp`)) {
    spj = await getFile(`./data/${pid}/checker.cpp`);
  }
  if (!data) return res.status(202).send({ data: [], spj: spj, subtask: [] });

  const cases = data.cases;

  let previewList = [];
  for (let i in cases) {
    const inputFile = (await getFile(`./data/${pid}/${cases[i].input}`)),
      inputStat = fs.statSync(`./data/${pid}/${cases[i].input}`);
    const outputFile = (await getFile(`./data/${pid}/${cases[i].output}`)),
      outputStat = fs.statSync(`./data/${pid}/${cases[i].output}`);

    previewList[i] = {
      index: cases[i].index,
      inName: cases[i].input,
      outName: cases[i].output,
      subtaskId: cases[i].subtaskId,
      input: {
        content: inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
        size: bFormat(inputStat.size),
        create: Format(inputStat.birthtime),
        modified: Format(inputStat.mtime)
      },
      output: {
        content: outputFile.substring(0, 255) + (outputFile.length > 255 ? '......\n' : ''),
        size: bFormat(outputStat.size),
        create: Format(outputStat.birthtime),
        modified: Format(outputStat.mtime)
      },
      edit: false,
    }
  }
  return res.status(200).send({
    data: previewList,
    spj: spj,
    subtask: data.subtask
  });
}

exports.clearCase = async (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const pid = req.body.pid;
  db.query('SELECT * FROM problem WHERE pid=?', [pid], (err, data) => {
    if (req.session.uid !== 1 && data[0].publisher !== req.session.uid) {
      return res.status(202).send({ message: '你只能删除自己题目的数据' });
    }
    const dir = path.join(__dirname, `../data/${req.body.pid}`);

    if (fs.existsSync(dir))
      fs.rmSync(dir, {
        recursive: true
      });

    return res.status(200).send({ message: 'success' });
  });
}

exports.updateSubtaskId = async (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const pid = req.body.pid, cases = req.body.cases, subtask = req.body.subtask;
  db.query('SELECT * FROM problem WHERE pid=?', [pid], async (err, data) => {
    if (req.session.uid !== 1 && data[0].publisher !== req.session.uid) {
      return res.status(202).send({ message: '你只能修改自己题目的配置' });
    }
    try {
      let subtaskMap = new Map(), totalScore = 0;
      for (let i in subtask) {
        if (typeof subtask[i].index !== "number")
          return res.status(202).send({
            message: `子任务 #${subtask[i].index} 编号非法`
          });
        if (!Number.isInteger(subtask[i].score) || subtask[i].score < 1 || subtask[i].score > 100)
          return res.status(202).send({
            message: `子任务 #${subtask[i].index} 分数应为[1,100]之间的整数`
          });
        if (subtask[i].option !== 0 && subtask[i].option !== 1)
          return res.status(202).send({
            message: `子任务 #${subtask[i].index} 记分方式非法`
          });
        if (subtaskMap.has(subtask[i].index))
          return res.status(202).send({
            message: `子任务 #${subtask[i].index} 编号重复`
          });
        if (subtask[i].index < 1 || subtask[i].index > 100)
          return res.status(202).send({
            message: `子任务 #${subtask[i].index} 应在[1,100]之间`
          });
        subtaskMap.set(subtask[i].index, subtask[i].score);
        totalScore += subtask[i].score;
      }
      if (totalScore !== 100)
        return res.status(202).send({
          message: `子任务分数之和应等于100分`
        });
      let newCases = [], subtaskVis = new Map();
      for (i in cases) {
        if (fs.existsSync(`./data/${pid}/${cases[i].inName}`) && fs.existsSync(`./data/${pid}/${cases[i].outName}`)) {
          if (!subtaskMap.has(Number(cases[i].subtaskId))) {
            return res.status(202).send({
              message: `测试点 #${cases[i].index} 所属子任务 #${Number(cases[i].subtaskId)} 未定义`
            });
          }
          newCases.push({
            index: Number(i) + 1,
            input: cases[i].inName,
            output: cases[i].outName,
            subtaskId: Number(cases[i].subtaskId)
          });
          subtaskVis.set(Number(cases[i].subtaskId), true);
        } else {
          return res.status(202).send({
            message: `找不到数据点 ${cases[i].inName}/${cases[i].outName}`
          });
        }
      }
      for (let i in subtask) {
        subtaskVis[subtask[i].index];
        if (!subtaskVis.has(subtask[i].index))
          return res.status(202).send({
            message: `子任务 #${subtask[i].index} 中没有测试点`
          });
      }
      newCases.sort((a, b) => {
        return a.index - b.index;
      });
      await setFile(`./data/${pid}/config.json`, JSON.stringify({ cases: newCases, subtask: subtask }));
      return res.status(200).send({ message: 'success' });
    } catch (err) {
      return res.status(202).send({ message: String(err) });
    }
  });
}

exports.getCase = (req, res) => {
  const pid = req.body.pid, caseInfo = req.body.caseInfo;
  db.query('SELECT * FROM problem WHERE pid=?', [pid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (req.session.uid !== 1 && data[0].publisher !== req.session.uid) {
      return res.status(202).send({ message: '你只能编辑自己题目的测试点' });
    }
    if (!fs.existsSync(`./data/${pid}/${caseInfo.inName}`) ||
      !fs.existsSync(`./data/${pid}/${caseInfo.outName}`)) {
      return res.status(202).send({ message: "未找到测试点" });
    }
    const inputFile = (await getFile(`./data/${pid}/${caseInfo.inName}`)),
      inputStat = fs.statSync(`./data/${pid}/${caseInfo.inName}`);
    const outputFile = (await getFile(`./data/${pid}/${caseInfo.outName}`)),
      outputStat = fs.statSync(`./data/${pid}/${caseInfo.outName}`);
    if (inputStat.size + outputStat.size > 5 * 1024 * 1024)
      return res.status(202).send({
        message: `超过编辑大小限制 5MB`
      });
    return res.status(200).send({
      input: inputFile,
      output: outputFile
    });
  });
}

exports.updateCase = (req, res) => {
  const pid = req.body.pid, caseInfo = req.body.caseInfo;
  db.query('SELECT * FROM problem WHERE pid=?', [pid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (req.session.uid !== 1 && data[0].publisher !== req.session.uid) {
      return res.status(202).send({ message: '权限不足' });
    }
    if (!fs.existsSync(`./data/${pid}/${caseInfo.inName}`) ||
      !fs.existsSync(`./data/${pid}/${caseInfo.outName}`)) {
      return res.status(202).send({ message: "未找到测试点" });
    }
    try {
      await setFile(`./data/${pid}/${caseInfo.inName}`, caseInfo.input.content);
      await setFile(`./data/${pid}/${caseInfo.outName}`, caseInfo.output.content);
      return res.status(200).send({
        inputM: Format(fs.statSync(`./data/${pid}/${caseInfo.inName}`).mtime),
        outputM: Format(fs.statSync(`./data/${pid}/${caseInfo.outName}`).mtime),
        message: 'ok'
      });
    } catch (err) {
      return res.status(202).send({ message: String(err) });
    }
  });
}