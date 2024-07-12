const axios = require('axios');
const db = require('../db/index');
const SqlString = require('mysql/lib/protocol/SqlString');
const exec = require('child_process').exec;
const { Format, kbFormat } = require('../static');
const async = require('async');
const conf = require('../config.json');
const { fork } = require('child_process');


const judgeQueue = async.queue((submission, callback) => {
  const worker = fork('./api/judgeWorker.js');

  worker.on('message', (msg) => {
    if (msg.type === 'done' || msg.type === 'error') {
      worker.kill();
      callback();
    }
  });

  worker.on('error', (error) => {
    console.error(`Worker error for submission ${submission.sid}:`, error);
    worker.kill();
    callback(error);
  });

  worker.send({ type: 'judge', sid: submission.sid, isreJudge: submission.isreJudge });
}, 2);

const machines = [
  'localhost',
  // 'http://49.235.101.43/api/judge/receiveTask'
];


exports.receiveTask = (req, res) => {
  if (conf.JUDGE.ISSERVER)
    return res.status(202).send({ message: 'This is SERVER' });
  pushSidIntoQueue(req.body.sid, req.body.isreJudge);
  return res.status(200).send({ message: 'ok' });
}

let taskId = 0;

const pushSidIntoQueue = (sid, isreJudge) => {
  if (conf.JUDGE.ISSERVER) {
    const machine = machines[(++taskId) % machines.length];
    if (machine === 'localhost') {
      console.log('server: localJudge');
      judgeQueue.push({ sid: sid, isreJudge: isreJudge });
    }
    else {
      console.log('server: task assigned to', machine);
      axios.post(machine, { sid: sid, isreJudge: isreJudge });
    }
  } else {
    console.log('client: task received', sid, isreJudge);
    judgeQueue.push({ sid: sid, isreJudge: isreJudge });
  }
}
module.exports.pushSidIntoQueue = pushSidIntoQueue;

const judgeRes = ['Waiting',
  'Pending',
  'Rejudging',
  'Compilation Error',
  'Accepted',
  'Wrong Answer',
  'Time Limit Exceeded',
  'Memory Limit Exceeded',
  'Runtime Error',
  'Segmentation Fault',
  'Output Limit Exceeded',
  'Dangerous System Call',
  'System Error',
  'Canceled',
  'Skipped'];

const SubmissionInfo = (sid) => {
  return new Promise((resolve, reject) => {
    db.query('SELECT * FROM submission WHERE sid=?', [sid], (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data[0]);
    })
  }).catch(err => {
    console.log(err);
  });
}
module.exports.SubmissionInfo = SubmissionInfo;


const ProblemInfo = (pid) => {
  return new Promise((resolve, reject) => {
    db.query('SELECT * FROM problem WHERE pid=?', [pid], (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data[0]);
    })
  }).catch(err => {
    console.log(err);
  });
}
module.exports.ProblemInfo = ProblemInfo;

const getCompareResult = (fileSuf) => {
  return new Promise((resolve, reject) => {
    exec(`./comparer/comparer ./comparer/data.in ${fileSuf}usr.out ${fileSuf}data.out`, (err, stdout, stderr) => {
      resolve(stderr);
    });
  }).catch(err => {
    console.log(err);
  });
}
module.exports.getCompareResult = getCompareResult;

const setSubmission = (sid, judgeResult, time, memory, score, compileResult, caseResult, machine) => {
  return new Promise((resolve, reject) => {
    db.query('UPDATE submission SET judgeResult=?,time=?,memory=?,score=?,compileResult=?,caseResult=?,machine=? WHERE sid=?',
      [judgeResult, time, memory, score, compileResult, caseResult, machine, sid,], (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data.affectedRows);
      })
  }).catch(err => {
    console.log(err);
  });
}
module.exports.setSubmission = setSubmission;


const updateSubmissionDetail = (sid, caseId, input, output, time, memory, result, compareResult, subtaskId) => {
  db.query('INSERT INTO submissionDetail(sid,caseId,input,output,time,memory,result,compareResult,subtaskId) values(?,?,?,?,?,?,?,?,?)',
    [sid, caseId, input, output, time, memory, result, compareResult, subtaskId]);
}
module.exports.updateSubmissionDetail = updateSubmissionDetail;

const updateProblemSubmitInfo = (pid) => {
  db.query('SELECT COUNT(*) as cnt FROM submission WHERE pid=?', [pid], (err, data) => {
    db.query('UPDATE problem SET submitCnt=? WHERE pid=?', [data[0].cnt, pid]);
  });
  db.query('SELECT COUNT(*) as cnt FROM submission WHERE pid=? AND judgeResult=4', [pid], (err, data) => {
    db.query('UPDATE problem SET acCnt=? WHERE pid=?', [data[0].cnt, pid]);
  })
}
module.exports.updateProblemSubmitInfo = updateProblemSubmitInfo;

const clearCase = (sid) => {
  return new Promise((resolve, reject) => {
    db.query('DELETE FROM submissionDetail WHERE sid=?', [sid], (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    })
  }).catch(err => {
    console.log(err);
  });
}
module.exports.clearCase = clearCase;

const updateData = (pid) => {
  return new Promise((resolve, reject) => {
    exec(`./sync_data.sh ${pid}`, (err, stdout, stderr) => {
      resolve(stdout);
    });
  }).catch(err => {
    console.log(err);
  });
}
module.exports.updateData = updateData;

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
      message: err
    });
    if (data.affectedRows > 0) {
      db.query("UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?", [pid]);
      pushSidIntoQueue(data.insertId, false);
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
  let sql = "SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,s.cid,s.machine,u.name,p.title,p.isPublic FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid "

  pageId = SqlString.escape(pageId);

  sql += 'WHERE p.isPublic' + (req.session.gid < 2 ? '=1' : '<6');
  if (!req.body.queryAll || req.session.gid === 1)
    sql += ' AND s.cid=0';

  if (req.body.name) {
    req.body.name = SqlString.escape(req.body.name);
    sql += ' AND u.name=' + req.body.name;
  }
  if (req.body.pid) {
    req.body.pid = SqlString.escape(req.body.pid);
    sql += ' AND p.pid=' + req.body.pid;
  }
  if (req.body.judgeRes !== null) {
    req.body.judgeRes = SqlString.escape(req.body.judgeRes);
    sql += ' AND s.judgeResult=' + req.body.judgeRes;
  }
  sql += " ORDER BY sid DESC LIMIT " + (pageId - 1) * pageSize + "," + pageSize;

  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    for (let i = 0; i < list.length; i++) {
      list[i].submitTime = Format(list[i].submitTime);
      list[i].judgeResult = judgeRes[list[i].judgeResult];
      list[i].memory = kbFormat(list[i].memory);
    }
    let cntsql = "SELECT COUNT(*) as total FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ";
    cntsql += 'WHERE p.isPublic' + (req.session.gid < 2 ? '=1' : '<6');

    if (!req.body.queryAll || req.session.gid === 1)
      cntsql += ' AND s.cid=0';

    if (req.body.name) {
      cntsql += ' AND u.name=' + req.body.name;
    }
    if (req.body.pid) {
      cntsql += ' AND p.pid=' + req.body.pid;
    }
    if (req.body.judgeRes !== null) {
      cntsql += ' AND s.judgeResult=' + req.body.judgeRes;
    }
    db.query(cntsql, (err, data) => {
      if (err) return res.status(202).send({ message: err });
      return res.status(200).send({
        total: data[0].total,
        data: list
      });
    });
  });
}

const getCaseDetail = (sid) => {
  return new Promise((resolve, reject) => {
    db.query('SELECT * FROM submissionDetail WHERE sid=?', [sid], (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    })
  }).catch(err => {
    console.log(err);
  });
}

exports.getSubmissionInfo = (req, res) => {
  const sid = SqlString.escape(req.body.sid);
  let sql = 'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,s.machine,u.name,p.title,p.isPublic FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=' + sid;
  if (req.session.gid < 2) {
    sql += ' and p.isPublic=1';
  }
  sql += ' AND s.cid=0';

  db.query(sql, async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({
      message: 'error'
    });
    else {
      data[0].caseResult = JSON.parse(data[0].caseResult);
      data[0].singleCaseResult = await getCaseDetail(req.body.sid);
      data[0].singleCaseResult.sort((a, b) => a.caseId - b.caseId);
      data[0].done = false;
      if (data[0].caseResult) {
        let subtaskInfo = {};
        for (let i in data[0].caseResult) {
          data[0].caseResult[i].index = parseInt(data[0].caseResult[i].index);
          data[0].caseResult[i].res = judgeRes[data[0].caseResult[i].res];
          data[0].caseResult[i].memory = kbFormat(data[0].caseResult[i].memory);
          subtaskInfo[data[0].caseResult[i].index] = new Map();
          subtaskInfo[data[0].caseResult[i].index]['info'] = data[0].caseResult[i];
          subtaskInfo[data[0].caseResult[i].index]['cases'] = [];
        }
        for (let i in data[0].singleCaseResult) {
          data[0].singleCaseResult[i].result = judgeRes[data[0].singleCaseResult[i].result];
          data[0].singleCaseResult[i].memory = kbFormat(data[0].singleCaseResult[i].memory);
          subtaskInfo[data[0].singleCaseResult[i].subtaskId]['cases'].push(data[0].singleCaseResult[i]);
        }
        data[0].subtaskInfo = subtaskInfo;
        data[0].done = true;
        delete data[0].caseResult;
        delete data[0].singleCaseResult;
      } else {
        for (let i in data[0].singleCaseResult) {
          data[0].singleCaseResult[i].result = judgeRes[data[0].singleCaseResult[i].result];
          data[0].singleCaseResult[i].memory = kbFormat(data[0].singleCaseResult[i].memory);
        }
      }
      data[0].memory = kbFormat(data[0].memory);
      data[0].submitTime = Format(data[0].submitTime);
      data[0].judgeResult = judgeRes[data[0].judgeResult];
      return res.status(200).send({
        data: data[0]
      });
    }
  });
}

exports.reJudge = async (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');

  await setSubmission(req.body.sid, 2, 0, 0, 0, null, null);

  pushSidIntoQueue(req.body.sid, true);
  await clearCase(req.body.sid);
  res.status(200).send({
    message: 'ok'
  });
}

exports.reJudgeProblem = async (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');

  db.query('SELECT sid FROM submission WHERE pid=?', [req.body.pid], async (err, data) => {
    for (let i in data) {
      await setSubmission(data[i].sid, 2, 0, 0, 0, null, null);
      pushSidIntoQueue(data[i].sid, true)
    }
    return res.status(200).send({
      message: 'ok',
      total: data.length
    });
  });
}

exports.reJudgeContest = async (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');

  db.query('SELECT sid FROM submission WHERE cid=?', [req.body.cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    for (let i in data) {
      await setSubmission(data[i].sid, 2, 0, 0, 0, null, null);
      pushSidIntoQueue(data[i].sid, true);
    }
    return res.status(200).send({
      message: 'ok',
      total: data.length
    });
  });
}

exports.cancelSubmission = (req, res) => {
  if (req.session.gid < 3) return res.status(403).end('403 Forbidden');
  db.query('UPDATE submission SET judgeResult=13,score=0 WHERE sid=?', [req.body.sid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    else res.status(200).send({
      message: 'ok',
    });
  })
}