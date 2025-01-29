const {
  SubmissionInfo,
  ProblemInfo,
  setSubmission,
  getCompareResult,
  updateProblemSubmitInfo,
  updateSubmissionDetail,
  updateData,
  clearCase } = require('./judge');
const { updateProblemStat } = require('./problem');
const axios = require('axios');
axios.defaults.timeout = 12000;
const db = require('../db/index');
const { getFile, setFile, delFile } = require('../file');
const conf = require('../config.json');

let jid = 1;

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

const judgeCode = async (sid) => {
  let sinfo = await SubmissionInfo(sid);
  if (!sinfo) return;

  const pid = sinfo.pid;
  let pinfo = await ProblemInfo(pid);
  if (!pinfo) return;
  try {
    await setSubmission(sid, 1, 0, 0, 0, null, null, 'Ebola');
    const code = sinfo.code, timeLimit = pinfo.timeLimit, memoryLimit = pinfo.memoryLimit;

    await clearCase(sid);
    // compile
    // await axios.post('http://localhost:5050/run', {
    //   "cmd": [{
    //     "args": ["pylint", "--errors-only", "main.py"],
    //     "env": ["PATH=/usr/bin:/bin"],
    //     "files": [{
    //       "content": ""
    //     }, {
    //       "name": "stdout",
    //       "max": 64 * 1024 * 1024
    //     }, {
    //       "name": "stderr",
    //       "max": 64 * 1024 * 1024
    //     }],
    //     "cpuLimit": 10000000000, // 10s
    //     "memoryLimit": 536870912, // 512MB
    //     "stackLimit": 536870912, // 512MB
    //     "procLimit": 50,
    //     "copyIn": {
    //       "main.py": {
    //         "content": code,
    //       }
    //     },
    //     "copyOut": ["stdout", "stderr"],
    //     "copyOutCached": ["main.py"],
    //     "copyOutDir": "nywOJ_code_" + sid,
    //     "strictMemoryLimit": true,
    //   }]
    // }).then(res => {
    //   compileResult = res.data[0];
    // });

    // if (compileResult.exitStatus !== 0) { // Compilation Error
    //   const error = `Compilation Error, Time: ${Math.floor(compileResult.time / 1000 / 1000)} ms, Memory: ${Math.floor(compileResult.memory / 1024)} KB\n` + compileResult.files.stderr + '\n' + compileResult.files.stdout;
    //   await new Promise((resolve, reject) => {
    //     db.query('UPDATE submission SET judgeResult=3,compileResult=? WHERE sid=?', [error, sid], (err, data) => {
    //       if (err) reject(err);
    //       else resolve(data);
    //     });
    //   });
    //   await updateProblemSubmitInfo(pid);
    //   await updateProblemStat(pid);
    //   return;
    // }

    // if (!conf.JUDGE.ISSERVER) {
    //   await updateData(pid);
    // }

    // const fileId = compileResult.fileIds['main.py'];

    let SPJfileId = '';

    // spj
    if (pinfo.type === 1) {
      const spj = await getFile(`data/${pid}/checker.cpp`);
      if (!spj) {
        await new Promise((resolve, reject) => {
          db.query('UPDATE submission SET judgeResult=12,compileResult=? WHERE sid=?', ['No checker.cpp found, please contact the problem publisher.', sid], (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        await updateProblemSubmitInfo(pid);
        await updateProblemStat(pid);
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
        await new Promise((resolve, reject) => {
          db.query('UPDATE submission SET judgeResult=12,compileResult=? WHERE sid=?', [error, sid], (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        await updateProblemSubmitInfo(pid);
        await updateProblemStat(pid);
        return;
      }
      SPJfileId = SPJcompileResult.fileIds['spj'];
    }

    // run
    const config = JSON.parse((await getFile(`./data/${pid}/config.json`)));
    if (!config || !config.cases) {
      throw new Error(`CASE ERROR: config.cases is null or undefined`);
    }
    const cases = config.cases, subtasks = config.subtask;

    let runResult = {}, judgeResult = [], isSkip = new Map();

    for (sub of subtasks)
      if (sub.skip)
        isSkip[sub.index] = 1;

    for (let i in cases) {
      if (isSkip[cases[i].subtaskId] === 2) { //Skipped
        await updateSubmissionDetail(
          /*sid*/sid,
          /*caseId*/cases[i].index,
          /*input*/'',
          /*output*/'',
          /*time*/0, // ms
          /*memory*/0, // kB
          /*result*/ 14,
          /*compareRes*/'',
          /*subtaskId*/cases[i].subtaskId
        );
        judgeResult.push({
          time: 0,
          memory: 0,
          subtaskId: cases[i].subtaskId,
          judgeResult: 14
        });
        continue;
      }
      const inputFile = (await getFile(`./data/${pid}/${cases[i].input}`));
      const outputFile = (await getFile(`./data/${pid}/${cases[i].output}`));
      let usrOutput = "";

      await axios.post('http://114.55.147.117:5050/run-hello', {
        sid: sinfo.sid,
        code: code,
        timeLimit: timeLimit * 1000 * 1000 * 1000,
        memoryLimit: memoryLimit * 1024 * 1024,
        input: inputFile
      }).then(res => {
        runResult = res.data;
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
        if (runResult.status === 'Time Limit Exceeded' && isSkip[cases[i].subtaskId] == 1)
          isSkip[cases[i].subtaskId] = 2;
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
      if (subtasks[i]?.dependencies)
        subtaskInfo[subtasks[i].index]['dependencies'] = subtasks[i]?.dependencies;
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
      if (subtaskInfo[i]['dependencies']) {
        outer: for (let id of subtaskInfo[i]['dependencies']) {
          if (subtaskInfo[id]['res'] !== 4) {
            subtaskInfo[i]['res'] = subtaskInfo[id]['res'];
            subtaskInfo[i]['score'] = 0;
            break outer;
          }
        }
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
        option: subtaskInfo[i]['option'],
        dependencies: subtaskInfo[i]['dependencies'] ? subtaskInfo[i]['dependencies'] : []
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
      await new Promise((resolve, reject) => {
        db.query('UPDATE problem SET acCnt=acCnt+1 WHERE pid=?', [pid], (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
    }
    await setSubmission(sid, finalRes, totalTime, maxMemory, totalScore, null, JSON.stringify(subtaskList), 'Ebola');

    await updateProblemSubmitInfo(pid);
    await updateProblemStat(pid);

    // axios.delete(`http://localhost:5050/file/${fileId}`);
  } catch (err) {
    console.log(err);
    await setSubmission(sid, 12, 0, 0, 0, String(err), null, 'Ebola');
    await updateProblemSubmitInfo(pid);
    await updateProblemStat(pid);
  }
}

process.on('message', async (msg) => {
  if (msg.type === 'judge') {
    try {
      await judgeCode(msg.sid, msg.isreJudge);
      process.send({ type: 'done', sid: msg.sid });
    } catch (error) {
      process.send({ type: 'error', sid: msg.sid, error: error.message });
    }
  }
});