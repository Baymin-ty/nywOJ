const db = require('../db/index');

const fill = (x) => {
  x = x.toString();
  return x.length > 1 ? x : '0' + x;
}

const Format = (now) => {
  return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate()) + ' ' + fill(now.getHours()) + ':' + fill(now.getMinutes()) + ':' + fill(now.getSeconds());
}

const judgeRes = ['Waiting', 'Pending', 'Rejudging', 'Accepted', 'Wrong Answer'];

exports.submit = (req, res) => {
  const code = req.body.code, pid = req.body.pid;
  if (!pid) {
    return res.status(202).send({
      message: '请确认信息完善'
    });
  }
  if (code.length < 10) {
    return res.status(202).send({
      message: '代码太短'
    });
  }
  if (code.length > 1024 * 100) {
    return res.status(202).send({
      message: '选手提交的程序源文件必须不大于 100KB。'
    });
  }
  db.query('INSERT INTO submission(pid,uid,code,codelength,submitTime) VALUES (?,?,?,?,?)', [pid, req.session.uid, code, code.length, new Date()], (err, data) => {
    if (err) return res.status(202).send({
      message: err.message
    });
    if (data.affectedRows > 0) {
      db.query("UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?", [pid]);
      return res.status(200).send({
        sid: data.insertId
      })
    } else {
      return res.status(202).send({
        message: 'error',
      })
    }
  });
}

exports.getSubmissionList = (req, res) => {
  let pageId = req.body.pageId,
    pageSize = 20;
  if (!pageId) pageId = 1;
  let sql = "SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ORDER BY sid DESC LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    for (let i = 0; i < list.length; i++) {
      list[i].submitTime = Format(list[i].submitTime);
      list[i].judgeResult = judgeRes[list[i].judgeResult];
    }
    db.query("SELECT COUNT(*) as total FROM submission", (err, data) => {
      if (err) return res.status(202).send({ message: err });
      return res.status(200).send({
        total: data[0].total,
        data: list
      });
    });
  });
}

exports.getSubmissionInfo = (req, res) => {
  const sid = req.body.sid;
  let sql = "SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=?";
  db.query(sql, [sid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({
      message: 'error'
    });
    else {
      data[0].submitTime = Format(data[0].submitTime);
      data[0].judgeResult = judgeRes[data[0].judgeResult];
      return res.status(200).send({
        data: data[0]
      });
    }
  });
}
