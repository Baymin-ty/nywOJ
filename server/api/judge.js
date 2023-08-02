const axios = require('axios');
const db = require('../db/index');
const { getFile, setFile, delFile } = require('../file');
const SqlString = require('mysql/lib/protocol/SqlString');
const exec = require('child_process').exec;
const { Format } = require('../static');
const async = require('async');
const { randomInt } = require('crypto');

const judgeQueue = async.queue(async (submission, completed) => {
  await judgeCode(submission.sid, submission.isreJudge);
  completed();
}, 2);

exports.pushSidIntoQueue = (sid) => {
  judgeQueue.push({ sid: sid, isreJudge: false });
}

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
  'System Error'];

const resToIndex = {
  'Waiting': 0,
  'Pending': 1,
  'Rejudging': 2,
  'Compilation Error': 3,
  'Accepted': 4,
  'Wrong Answer': 5,
  'Time Limit Exceeded': 6,
  'Memory Limit Exceeded': 7,
  'Nonzero Exit Status': 8,
  'Signalled': 9,
  'Output Limit Exceeded': 10,
  'Dangerous Syscall': 11,
  'Internal Error': 12
};

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

const getCompareResult = (fileSuf) => {
  return new Promise((resolve, reject) => {
    exec(`./comparer/comparer ./comparer/data.in ${fileSuf}usr.out ${fileSuf}data.out`, (err, stdout, stderr) => {
      resolve(stderr);
    });
  }).catch(err => {
    console.log(err);
  });
}

const setSubmission = (sid, judgeResult, time, memory, score, compileResult, caseResult) => {
  return new Promise((resolve, reject) => {
    db.query('UPDATE submission SET judgeResult=?,time=?,memory=?,score=?,compileResult=?,caseResult=? WHERE sid=?',
      [judgeResult, time, memory, score, compileResult, caseResult, sid], (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data.affectedRows);
      })
  }).catch(err => {
    console.log(err);
  });
}

const updateProblemSubmitInfo = (pid) => {
  db.query('SELECT COUNT(*) as cnt FROM submission WHERE pid=?', [pid], (err, data) => {
    db.query('UPDATE problem SET submitCnt=? WHERE pid=?', [data[0].cnt, pid]);
  });
  db.query('SELECT COUNT(*) as cnt FROM submission WHERE pid=? AND judgeResult=4', [pid], (err, data) => {
    db.query('UPDATE problem SET acCnt=? WHERE pid=?', [data[0].cnt, pid]);
  })
}

let jid = 1;

const judgeCode = async (sid, isreJudge) => {
  try {
    let sinfo = await SubmissionInfo(sid);
    if (!sinfo) return;

    if (isreJudge) {
      db.query("SELECT bonus,uid FROM submission WHERE sid=?", [sid], (err, data) => {
        if (!err && data[0].bonus) {
          db.query("UPDATE userInfo SET clickCnt=clickCnt-? WHERE uid=?", [data[0].bonus, data[0].uid]);
          db.query("UPDATE submission SET bonus=0 WHERE sid=?", [sid]);
        }
      });
    }

    const pid = sinfo.pid;
    let pinfo = await ProblemInfo(pid);
    if (!pinfo) return;

    await setSubmission(sid, 1, 0, 0, 0, null, null);
    const code = sinfo.code, timeLimit = pinfo.timeLimit, memoryLimit = pinfo.memoryLimit;

    // compile
    await axios.post('http://localhost:5050/run', {
      "cmd": [{
        "args": ["/usr/bin/g++-9", "-O2", "-std=c++14", "-DONLINE_JUDGE", "main.cpp", "-o", "main"],
        "env": ["PATH=/usr/bin:/bin"],
        "files": [{
          "content": ""
        }, {
          "name": "stdout",
          "max": 64 * 1024 * 1024
        }, {
          "name": "stderr",
          "max": 64 * 1024 * 1024
        }],
        "cpuLimit": 10000000000, // 10s
        "memoryLimit": 536870912, // 512MB
        "stackLimit": 536870912, // 512MB
        "procLimit": 50,
        "copyIn": {
          "main.cpp": {
            "content": code,
          }
        },
        "copyOut": ["stdout", "stderr"],
        "copyOutCached": ["main"],
        "copyOutDir": "nywOJ_code_" + sid,
        "strictMemoryLimit": true,
      }]
    }).then(res => {
      compileResult = res.data[0];
    });

    if (compileResult.exitStatus !== 0) { // Compilation Error
      const error = `Compilation Error, Time: ${Math.floor(compileResult.time / 1000 / 1000)} ms, Memory: ${Math.floor(compileResult.memory / 1024)} KB\n` + compileResult.files.stderr;
      db.query('UPDATE submission SET judgeResult=3,compileResult=? WHERE sid=?', [error, sid]);
      if (isreJudge) {
        updateProblemSubmitInfo(pid);
      }
      return;
    }

    const fileId = compileResult.fileIds['main'];

    let SPJfileId = '';

    // spj
    if (pinfo.type === 1) {
      const spj = await getFile(`data/${pid}/checker.cpp`);
      if (!spj) {
        db.query('UPDATE submission SET judgeResult=12,compileResult=? WHERE sid=?', ['No checker.cpp found, please contact the problem publisher.', sid]);
        return;
      }
      const testlib = await getFile('./comparer/testlib.h');
      // compile spj
      await axios.post('http://localhost:5050/run', {
        "cmd": [{
          "args": ["/usr/bin/g++-9", "-O2", "-std=c++14", "-DONLINE_JUDGE", "spj.cpp", "-o", "spj"],
          "env": ["PATH=/usr/bin:/bin"],
          "files": [{
            "content": ""
          }, {
            "name": "stdout",
            "max": 64 * 1024 * 1024
          }, {
            "name": "stderr",
            "max": 64 * 1024 * 1024
          }],
          "cpuLimit": 10000000000, // 10s
          "memoryLimit": 536870912, // 512MB
          "stackLimit": 536870912, // 512MB
          "procLimit": 50,
          "copyIn": {
            "spj.cpp": {
              "content": spj,
            },
            "testlib.h": {
              "content": testlib,
            }
          },
          "copyOut": ["stdout", "stderr"],
          "copyOutCached": ["spj"],
          "copyOutDir": "nywOJ_code_" + sid,
          "strictMemoryLimit": true,
        }]
      }).then(res => {
        SPJcompileResult = res.data[0];
      });
      if (SPJcompileResult.exitStatus !== 0) {
        const error = 'SPJ Error\n' + SPJcompileResult.files.stderr;
        db.query('UPDATE submission SET judgeResult=12,compileResult=? WHERE sid=?', [error, sid]);
        if (isreJudge) {
          updateProblemSubmitInfo(pid);
        }
        return;
      }
      SPJfileId = SPJcompileResult.fileIds['spj'];
    }

    // run
    const cases = JSON.parse((await getFile(`./data/${pid}/config.json`))).cases;

    let runResult = {}, judgeResult = [], totalCase = cases.length, acCase = 0;

    for (let i in cases) {
      const inputFile = (await getFile(`./data/${pid}/${cases[i].input}`));
      const outputFile = (await getFile(`./data/${pid}/${cases[i].output}`));
      let usrOutput = "";
      await axios.post('http://localhost:5050/run', {
        "cmd": [{
          "args": ["main"],
          "env": ["PATH=/usr/bin:/bin"],
          "files": [{
            "content": inputFile
          }, {
            "name": "stdout",
            "max": 64 * 1024 * 1024
          }, {
            "name": "stderr",
            "max": 64 * 1024 * 1024
          }],
          "cpuLimit": timeLimit * 1000 * 1000, // ms -> ns
          "clockLimit": timeLimit * 1000 * 1000 * 2,
          "memoryLimit": memoryLimit * 1024 * 1024, // MB -> B
          "stackLimit": memoryLimit * 1024 * 1024,
          "procLimit": 50,
          "strictMemoryLimit": true,
          "copyIn": {
            "main": {
              "fileId": fileId,
            }
          },
        }]
      }).then(res => {
        runResult = res.data[0];
      });

      if (runResult.status !== 'Accepted') {
        judgeResult.push({
          input: inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
          output: runResult.files.stderr,
          time: runResult.time / 1000 / 1000, // ms
          memory: runResult.memory / 1024, // kB
          judgeResult: resToIndex[runResult.status],
          compareResult: '',
        });
      }
      else {
        usrOutput = runResult.files.stdout;
        let compareRes = '';
        const fileSuf = `./comparer/tmp/${sid}-${++jid}_`;
        if (pinfo.type === 0) {
          await setFile(`${fileSuf}usr.out`, usrOutput);
          await setFile(`${fileSuf}data.out`, outputFile);
          compareRes = await getCompareResult(fileSuf);
          await delFile(`${fileSuf}usr.out`);
          await delFile(`${fileSuf}data.out`);
        }
        else if (pinfo.type === 1) { // spj
          await axios.post('http://localhost:5050/run', {
            "cmd": [{
              "args": ["spj", "data.in", "usr.out", "data.out"],
              "env": ["PATH=/usr/bin:/bin"],
              "files": [{
                "content": ""
              }, {
                "name": "stdout",
                "max": 64 * 1024 * 1024
              }, {
                "name": "stderr",
                "max": 64 * 1024 * 1024
              }],
              "cpuLimit": 5000 * 1000 * 1000, // ms -> ns, 5s
              "clockLimit": 5000 * 1000 * 1000 * 2,
              "memoryLimit": 512 * 1024 * 1024, // MB -> B, 512MB
              "stackLimit": 512 * 1024 * 1024,
              "procLimit": 50,
              "strictMemoryLimit": true,
              "copyIn": {
                "spj": {
                  "fileId": SPJfileId,
                },
                "data.in": {
                  "content": inputFile,
                },
                "usr.out": {
                  "content": usrOutput,
                },
                "data.out": {
                  "content": outputFile,
                }
              },
            }]
          }).then(res => {
            compareRes = res.data[0].files.stderr;
          });
        }

        judgeResult.push({
          input: inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
          output: usrOutput.substring(0, 255) + (usrOutput.length > 255 ? '......\n' : ''),
          time: runResult.time / 1000 / 1000, // ms
          memory: runResult.memory / 1024, // kB
          judgeResult: (compareRes.substring(0, 2) === 'ok' ? 4 : 5),
          compareResult: compareRes
        });

        acCase += (judgeResult[i].judgeResult === 4);
      }
      await setSubmission(sid, 1, 0, 0, 100 * acCase / totalCase, null, JSON.stringify(judgeResult));
    }

    let finalRes = 12, totalTime = 0, maxMemory = 0;
    for (i in judgeResult) {
      totalTime += judgeResult[i].time;
      maxMemory = Math.max(maxMemory, judgeResult[i].memory);
      if (judgeResult[i].judgeResult === 4) continue;
      finalRes = Math.min(finalRes, judgeResult[i].judgeResult);
    }

    let score = Math.ceil(100 * acCase / totalCase);

    if (acCase === totalCase) {
      finalRes = 4, score = 100;
      if (!sinfo.cid) {
        db.query("UPDATE problem SET acCnt=acCnt+1 WHERE pid=?", [pid]);
        db.query("SELECT COUNT(*) as cnt FROM submission WHERE uid=? AND judgeResult=4 AND sid!=? AND pid=? LIMIT 1", [sinfo.uid, sinfo.sid, sinfo.pid], (err, data) => {
          if (!err && data[0].cnt === 0) {
            let bonus = randomInt(10000, 100000);
            db.query("UPDATE userInfo SET clickCnt=clickCnt+? WHERE uid=?", [bonus, sinfo.uid]);
            db.query("UPDATE submission SET bonus=? WHERE sid=?", [bonus, sinfo.sid]);
          }
        })
      }
    }
    await setSubmission(sid, finalRes, totalTime, maxMemory, score, null, JSON.stringify(judgeResult));

    if (isreJudge) {
      updateProblemSubmitInfo(pid);
    }

    axios.delete(`http://localhost:5050/file/${fileId}`);
  } catch (err) {
    console.log(err);
    await setSubmission(sid, 12, 0, 0, 0, String(err), null);
  }
}


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
      judgeQueue.push({ sid: data.insertId, isreJudge: false });
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
  let sql = "SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid "

  pageId = SqlString.escape(pageId);

  sql += 'WHERE p.isPublic' + (req.session.gid < 2 ? '=1' : '<6');
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
      list[i].memory = toHuman(list[i].memory);
    }
    let cntsql = "SELECT COUNT(*) as total FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid ";
    cntsql += 'WHERE p.isPublic' + (req.session.gid < 2 ? '=1' : '<6');
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

const toHuman = (memory) => {
  if (memory >= 1024)
    memory = Math.round(memory / 1024 * 100) / 100 + ' MB';
  else memory += ' KB';
  return memory;
}

exports.getSubmissionInfo = (req, res) => {
  const sid = SqlString.escape(req.body.sid);
  let sql = 'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=' + sid;
  if (req.session.gid < 2) {
    sql += ' and p.isPublic=1';
  }
  sql += ' AND s.cid=0';

  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({
      message: 'error'
    });
    else {
      data[0].caseResult = JSON.parse(data[0].caseResult);
      for (let i in data[0].caseResult) {
        data[0].caseResult[i].judgeResult = judgeRes[data[0].caseResult[i].judgeResult];
        data[0].caseResult[i].memory = toHuman(data[0].caseResult[i].memory);
      }
      data[0].memory = toHuman(data[0].memory);
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

  judgeQueue.push({ sid: req.body.sid, isreJudge: true });

  res.status(200).send({
    message: 'ok'
  });
}

exports.reJudgeProblem = async (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');

  db.query('SELECT sid FROM submission WHERE pid=?', [req.body.pid], async (err, data) => {
    for (let i in data) {
      await setSubmission(data[i].sid, 2, 0, 0, 0, null, null);
      judgeQueue.push({ sid: data[i].sid, isreJudge: true });
    }
    return res.status(200).send({
      message: 'ok',
      total: data.length
    });
  });
}