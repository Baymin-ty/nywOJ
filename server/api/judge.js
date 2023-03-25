const axios = require('axios');
const db = require('../db/index');
const { getFile, setFile, delFile } = require('../file');
const exec = require('child_process').exec;


const fill = (x) => {
  x = x.toString();
  return x.length > 1 ? x : '0' + x;
}

const Format = (now) => {
  return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate()) + ' ' + fill(now.getHours()) + ':' + fill(now.getMinutes()) + ':' + fill(now.getSeconds());
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

const getCompareResult = (sid) => {
  return new Promise((resolve, reject) => {
    exec(`./comparer/comparer ./comparer/data.in ./comparer/tmp/${sid}usr.out ./comparer/tmp/${sid}data.out`, (err, stdout, stderr) => {
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

const judgeCode = async (sid) => {
  let sinfo = await SubmissionInfo(sid);
  if (!sinfo) return;

  const pid = sinfo.pid;

  await setSubmission(sid, 1, 0, 0, 0, null, null);

  let pinfo = await ProblemInfo(pid);

  if (!pinfo) return;

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
        "max": 10240
      }, {
        "name": "stderr",
        "max": 10240
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
    return;
  }

  const fileId = compileResult.fileIds['main'];

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
          "max": 10240
        }, {
          "name": "stderr",
          "max": 10240
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
      await setFile(`./comparer/tmp/${sid}usr.out`, usrOutput);
      await setFile(`./comparer/tmp/${sid}data.out`, outputFile);
      const compareRes = await getCompareResult(sid);
      await delFile(`./comparer/tmp/${sid}usr.out`);
      await delFile(`./comparer/tmp/${sid}data.out`);
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

  if (acCase === totalCase) finalRes = 4, score = 100;

  await setSubmission(sid, finalRes, totalTime, maxMemory, score, null, JSON.stringify(judgeResult));

  axios.delete(`http://localhost:5050/file/${fileId}`);
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
      message: err.message
    });
    if (data.affectedRows > 0) {
      db.query("UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?", [pid]);
      judgeCode(data.insertId);
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
  sql += 'WHERE p.isPublic' + (req.session.gid < 2 ? '=1' : '<6');
  sql += " ORDER BY sid DESC LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    for (let i = 0; i < list.length; i++) {
      list[i].submitTime = Format(list[i].submitTime);
      list[i].judgeResult = judgeRes[list[i].judgeResult];
      list[i].memory = toHuman(list[i].memory);
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

const toHuman = (memory) => {
  if (memory >= 1024)
    memory = Math.round(memory / 1024 * 100) / 100 + ' MB';
  else memory += ' KB';
  return memory;
}

exports.getSubmissionInfo = (req, res) => {
  const sid = req.body.sid;
  let sql = "SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=" + sid;
  if (req.session.gid < 2) {
    sql += ' and p.isPublic=1';
  }
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

exports.reJudge = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  judgeCode(req.body.sid);
  res.status(200).send({
    message: 'ok'
  });
}