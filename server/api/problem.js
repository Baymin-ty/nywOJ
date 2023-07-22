const SqlString = require('mysql/lib/protocol/SqlString');
const db = require('../db/index');
const { getFile } = require('../file');
const fs = require('fs');
const path = require('path');
const { briefFormat } = require('../static');

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
  let sql = "SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.time,p.publisher as publisherUid,u.`name` as publisher FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher" +
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
  if (!data) return res.status(202).send({ data: [] });

  let spj = '';

  if (fs.existsSync(`./data/${pid}/checker.cpp`)) {
    spj = await getFile(`./data/${pid}/checker.cpp`);
  }
  const cases = data.cases;

  let previewList = [];
  for (let i in cases) {
    const inputFile = (await getFile(`./data/${pid}/${cases[i].input}`));
    const outputFile = (await getFile(`./data/${pid}/${cases[i].output}`));
    previewList[i] = {
      index: cases[i].index,
      input: inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
      output: outputFile.substring(0, 255) + (outputFile.length > 255 ? '......\n' : '')
    }
  }
  return res.status(200).send({ data: previewList, spj: spj });
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