const axios = require('axios');
const db = require('../db/index');
const { getFile, setFile, delFile } = require('../file');
const SqlString = require('mysql/lib/protocol/SqlString');
const exec = require('child_process').exec;
const { Format } = require('../static');
const async = require('async');


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

const updateSubmissionDetail = (sid, caseId, input, output, time, memory, result, compareResult, subtaskId) => {
  db.query('INSERT INTO submissionDetail(sid,caseId,input,output,time,memory,result,compareResult,subtaskId) values(?,?,?,?,?,?,?,?,?)',
    [sid, caseId, input, output, time, memory, result, compareResult, subtaskId]);
}

const updateProblemSubmitInfo = (pid) => {
  db.query('SELECT COUNT(*) as cnt FROM submission WHERE pid=?', [pid], (err, data) => {
    db.query('UPDATE problem SET submitCnt=? WHERE pid=?', [data[0].cnt, pid]);
  });
  db.query('SELECT COUNT(*) as cnt FROM submission WHERE pid=? AND judgeResult=4', [pid], (err, data) => {
    db.query('UPDATE problem SET acCnt=? WHERE pid=?', [data[0].cnt, pid]);
  })
}

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

let jid = 1;

const judgeCode = async (sid, isreJudge) => {
  try {
    let sinfo = await SubmissionInfo(sid);
    if (!sinfo) return;

    const pid = sinfo.pid;
    let pinfo = await ProblemInfo(pid);
    if (!pinfo) return;

    await setSubmission(sid, 1, 0, 0, 0, null, null);
    const code = sinfo.code, timeLimit = pinfo.timeLimit, memoryLimit = pinfo.memoryLimit;

    await clearCase(sid);
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
    const config = JSON.parse((await getFile(`./data/${pid}/config.json`)));
    const cases = config.cases, subtasks = config.subtask;

    let runResult = {}, judgeResult = [];

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

      runResult.time = runResult.time / 1000 / 1000; // ms
      runResult.time = Math.max(1, Math.floor(runResult.time));
      runResult.memory /= 1024; // KB
      runResult.memory = Math.max(1, Math.floor(runResult.memory));

      if (runResult.status !== 'Accepted') {
        updateSubmissionDetail(
          /*sid*/sid,
          /*caseId*/cases[i].index,
          /*input*/inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
          /*output*/runResult.files.stderr,
          /*time*/runResult.time, // ms
          /*memory*/runResult.memory, // kB
          /*result*/ resToIndex[runResult.status],
          /*compareRes*/'',
          /*subtaskId*/cases[i].subtaskId
        );
        judgeResult.push({
          time: runResult.time,
          memory: runResult.memory,
          subtaskId: cases[i].subtaskId,
          judgeResult: resToIndex[runResult.status]
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
        updateSubmissionDetail(
          /*sid*/sid,
          /*caseId*/cases[i].index,
          /*input*/inputFile.substring(0, 255) + (inputFile.length > 255 ? '......\n' : ''),
          /*output*/usrOutput.substring(0, 255) + (usrOutput.length > 255 ? '......\n' : ''),
          /*time*/runResult.time, // ms
          /*memory*/runResult.memory, // kB
          /*result*/(compareRes.substring(0, 2) === 'ok' ? 4 : 5),
          /*compareRes*/compareRes,
          /*subtaskId*/cases[i].subtaskId
        );
        judgeResult.push({
          time: runResult.time,
          memory: runResult.memory,
          subtaskId: cases[i].subtaskId,
          judgeResult: (compareRes.substring(0, 2) === 'ok' ? 4 : 5),
        });
      }
    }

    let subtaskInfo = new Map();
    for (i in subtasks) {
      subtaskInfo[subtasks[i].index] = new Map();
      subtaskInfo[subtasks[i].index]['subtaskStatus'] = [];
      subtaskInfo[subtasks[i].index]['time'] = subtaskInfo[subtasks[i].index].memory = 0;
      subtaskInfo[subtasks[i].index]['res'] = 12;
      subtaskInfo[subtasks[i].index]['score'] = 0;
      subtaskInfo[subtasks[i].index]['fullScore'] = subtasks[i].score;
      subtaskInfo[subtasks[i].index]['option'] = subtasks[i].option;
    }
    for (i in judgeResult)
      subtaskInfo[judgeResult[i].subtaskId]['subtaskStatus'].push(judgeResult[i]);

    for (i in subtaskInfo) {
      let acNum = 0, totalNum = 0;
      for (j in subtaskInfo[i]['subtaskStatus']) {
        totalNum++;
        subtaskInfo[i]['time'] += subtaskInfo[i]['subtaskStatus'][j].time;
        subtaskInfo[i]['memory'] = Math.max(subtaskInfo[i]['memory'], subtaskInfo[i]['subtaskStatus'][j].memory);
        if (subtaskInfo[i]['subtaskStatus'][j].judgeResult === 4) {
          acNum++;
          continue;
        }
        subtaskInfo[i]['res'] = Math.min(subtaskInfo[i]['res'], subtaskInfo[i]['subtaskStatus'][j].judgeResult);
      }
      if (!subtaskInfo[i]['option']) { // 测试点等分 
        subtaskInfo[i]['score'] = Math.ceil(subtaskInfo[i]['fullScore'] * 1.0 * acNum / totalNum);
      }
      if (acNum === totalNum) {
        subtaskInfo[i]['res'] = 4;
        subtaskInfo[i]['score'] = subtaskInfo[i]['fullScore'];
      }
    }

    let finalRes = 12, totalTime = 0, maxMemory = 0, totalScore = 0, acSub = 0, totalSub = 0, subtaskList = [];
    for (i in subtaskInfo) {
      totalSub++;
      totalTime += subtaskInfo[i]['time'];
      maxMemory = Math.max(maxMemory, subtaskInfo[i]['memory']);
      totalScore += subtaskInfo[i]['score'];
      subtaskList.push({
        index: i,
        time: subtaskInfo[i]['time'],
        memory: subtaskInfo[i]['memory'],
        res: subtaskInfo[i]['res'],
        score: subtaskInfo[i]['score'],
        fullScore: subtaskInfo[i]['fullScore'],
        option: subtaskInfo[i]['option']
      });
      if (subtaskInfo[i]['res'] === 4) {
        acSub++;
        continue;
      }
      finalRes = Math.min(finalRes, subtaskInfo[i]['res']);
    }
    if (acSub === totalSub) {
      finalRes = 4;
      totalScore = 100;
    }
    await setSubmission(sid, finalRes, totalTime, maxMemory, totalScore, null, JSON.stringify(subtaskList));

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
  let sql = 'SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=' + sid;
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
      data[0].done = false;
      if (data[0].caseResult) {
        let subtaskInfo = {};
        for (let i in data[0].caseResult) {
          data[0].caseResult[i].index = parseInt(data[0].caseResult[i].index);
          data[0].caseResult[i].res = judgeRes[data[0].caseResult[i].res];
          data[0].caseResult[i].memory = toHuman(data[0].caseResult[i].memory);
          subtaskInfo[data[0].caseResult[i].index] = new Map();
          subtaskInfo[data[0].caseResult[i].index]['info'] = data[0].caseResult[i];
          subtaskInfo[data[0].caseResult[i].index]['cases'] = [];
        }
        for (let i in data[0].singleCaseResult) {
          data[0].singleCaseResult[i].result = judgeRes[data[0].singleCaseResult[i].result];
          data[0].singleCaseResult[i].memory = toHuman(data[0].singleCaseResult[i].memory);
          subtaskInfo[data[0].singleCaseResult[i].subtaskId]['cases'].push(data[0].singleCaseResult[i]);
        }
        data[0].subtaskInfo = subtaskInfo;
        data[0].done = true;
        delete data[0].caseResult;
        delete data[0].singleCaseResult;
      } else {
        for (let i in data[0].singleCaseResult) {
          data[0].singleCaseResult[i].result = judgeRes[data[0].singleCaseResult[i].result];
          data[0].singleCaseResult[i].memory = toHuman(data[0].singleCaseResult[i].memory);
        }
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

exports.reJudgeContest = async (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');

  db.query('SELECT sid FROM submission WHERE cid=?', [req.body.cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
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