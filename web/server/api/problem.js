const db = require('../db/index');

const fill = (x) => {
  x = x.toString();
  return x.length > 1 ? x : '0' + x;
}

const Format = (now) => {
  return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate());
}

exports.createProblem = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  db.query('INSERT INTO problem(title,description,publisher,time) VALUES (?,?,?,?)', ["请输入题目标题", "请输入题目描述", req.session.uid, new Date()], (err, data) => {
    if (err) return res.status(202).send({
      message: err.message
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
  db.query('UPDATE problem SET title=?,description=?,timeLimit=?,memoryLimit=?,isPublic=? WHERE pid=?', [info.title, info.description, info.timeLimit, info.memoryLimit, info.isPublic, pid], (err, data) => {
    if (err) return res.status(202).send({
      message: err.message
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
}

exports.getProblemList = (req, res) => {
  let pageId = req.body.pageId,
    pageSize = 20;
  if (!pageId) pageId = 1;
  let sql = "SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.time,p.publisher as publisherUid,u.`name` as publisher FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher " +
    (req.session.gid > 1 ? "" : "WHERE isPublic=1") + " LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    for (let i = 0; i < list.length; i++) list[i].time = Format(list[i].time);
    db.query("SELECT COUNT(*) as total FROM problem", (err, data) => {
      if (err) return res.status(202).send({ message: err });
      return res.status(200).send({
        total: data[0].total,
        data: list
      });
    });
  });
}

exports.getProblemInfo = (req, res) => {
  const pid = req.body.pid;
  let sql = "SELECT p.pid,p.title,p.acCnt,p.submitCnt,p.description,p.time,p.timeLimit,p.memoryLimit,p.isPublic,p.publisher as publisherUid,u.`name` as publisher FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher WHERE pid=? "
    + (req.session.gid > 1 ? "" : "AND isPublic=1");
  db.query(sql, [pid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({
      message: 'error'
    });
    else {
      data[0].time = Format(data[0].time);
      return res.status(200).send({
        data: data[0]
      });
    }
  });
}