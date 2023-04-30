const db = require('../db/index');
const { briefFormat, Format } = require('../static');
const SqlString = require('mysql/lib/protocol/SqlString');
const { pushSidIntoQueue } = require('./judge');
const ctype = ['OI', 'IOI'];
const cstatus = ['未开始', '正在进行', '等待测评', '已结束'];
const ctypeToIndex = {
  'OI': 0,
  'IOI': 1
}
const contestStatus = (info) => {
  if (info.done) return 3;
  if (new Date().getTime() > info.start.getTime() + info.length * 1000 * 60)
    return 2;
  return (new Date().getTime() >= info.start.getTime() ? 1 : 0);
}

const isReg = (uid, cid) => {
  return new Promise((resolve, reject) => {
    return db.query('SELECT * FROM contestPlayer WHERE uid=? AND cid=? LIMIT 1', [uid, cid], (err, data) => {
      if (err) reject(err);
      resolve(data.length);
    })
  }).catch(err => {
    console.log(err);
  });
}

const getPinfo = (cid, idx) => {
  return new Promise((resolve, reject) => {
    return db.query('SELECT * FROM contestProblem WHERE cid=? AND idx=? LIMIT 1', [cid, idx], (err, data) => {
      if (err) reject(err);
      if (!data.length) resolve(false);
      else resolve({
        pid: data[0].pid,
        id: data[0].id
      });
    })
  }).catch(err => {
    console.log(err);
  });
}

const getIdx = (cid, pid) => {
  return new Promise((resolve, reject) => {
    return db.query('SELECT * FROM contestProblem WHERE cid=? AND pid=? LIMIT 1', [cid, pid], (err, data) => {
      if (err) reject(err);
      if (!data.length) resolve(false);
      else resolve(data[0].idx);
    })
  }).catch(err => {
    console.log(err);
  });
}

exports.createContest = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  db.query('INSERT INTO contest(title,host,start,length,type,isPublic) VALUES (?,?,?,?,?,?)', [
    '请输入比赛标题', req.session.uid, new Date(2121, 10, 22), 180, 0, 0], (err, data) => {
      if (err) return res.status(202).send({
        message: err.message
      });
      if (data.affectedRows > 0) {
        return res.status(200).send({
          cid: data.insertId
        })
      } else {
        return res.status(202).send({
          message: 'error',
        })
      }
    });
}

exports.updateContestInfo = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const cid = req.body.cid, info = req.body.info;

  db.query('SELECT * FROM contest WHERE cid=?', [cid], (err, contestInfo) => {
    if (err) return res.status(202).send({ message: err });
    if (!contestInfo.length) {
      return res.status(202).send({ message: '无此比赛' });
    }
    if (req.session.uid !== 1 && contestInfo[0].host !== req.session.uid) {
      return res.status(202).send({ message: '你只能修改自己的比赛' });
    }
    if (contestInfo[0].done) {
      return res.status(202).send({ message: '比赛已经结束' });
    }
    if (!info.title || !info.start || !info.length || !info.type) {
      return res.status(202).send({
        message: '请确认信息完善'
      });
    }
    if (info.title.length > 30) {
      return res.status(202).send({
        message: '比赛名称最长30个字符'
      });
    }
    if (info.type > 1) {
      return res.status(202).send({
        message: '非法比赛类型'
      });
    }
    info.type = ctypeToIndex[info.type];
    if (info.isPublic !== true && info.isPublic !== false) {
      return res.status(202).send({
        message: '非法isPublic参数'
      });
    }
    db.query('UPDATE contest SET title=?,description=?,start=?,length=?,type=?,isPublic=? WHERE cid=?',
      [info.title, info.description, new Date(info.start), info.length, info.type, info.isPublic, cid], (err, data) => {
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
  });
}

const getContestPlayerCnt = (cid) => {
  return new Promise((resolve, reject) => {
    db.query('SELECT COUNT(*) as cnt FROM contestPlayer WHERE cid=?', [cid], (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data[0].cnt);
    })
  }).catch(err => {
    console.log(err);
  });
}

exports.getContestList = (req, res) => {
  let pageId = req.body.pageId,
    pageSize = 20;
  if (!pageId) pageId = 1;
  pageId = SqlString.escape(pageId);
  let sql = "SELECT c.cid,c.title,c.start,c.length,c.isPublic,c.type,c.host,c.done,u.name as hostName FROM contest c INNER JOIN userInfo u ON u.uid = c.host" +
    " ORDER BY c.start DESC LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    for (let i = 0; i < list.length; i++) {
      list[i].type = ctype[list[i].type];
      list[i].status = cstatus[contestStatus(list[i])];
      list[i].start = Format(list[i].start);
      list[i].playerCnt = await getContestPlayerCnt(list[i].cid);
    }
    db.query("SELECT COUNT(*) as total FROM contest", (err, data) => {
      if (err) return res.status(202).send({ message: err });
      return res.status(200).send({
        total: data[0].total,
        data: list
      });
    });
  });
}

exports.getContestInfo = (req, res) => {
  const cid = req.body.cid;
  let sql = "SELECT c.cid,c.title,c.start,c.length,c.isPublic,c.type,c.host,c.description,c.done,u.name as hostName FROM contest c INNER JOIN userInfo u ON u.uid = c.host WHERE cid=?";
  db.query(sql, [cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({
      message: '无此比赛'
    });
    else {
      data[0].isReg = await isReg(req.session.uid, data[0].cid);
      if (!data[0].isPublic && !data[0].isReg && req.session.gid === 1)
        return res.status(202).send({ message: '比赛私有，请联系管理员报名' });
      data[0].playerCnt = await getContestPlayerCnt(data[0].cid);
      data[0].status = contestStatus(data[0]);
      data[0].end = Format(new Date(
        new Date(data[0].start).getTime() + data[0].length * 1000 * 60
      ));
      data[0].regAble = (data[0].status < 2 && data[0].isPublic && !data[0].isReg);
      data[0].auth = {
        join: ((data[0].isReg && data[0].status > 0) || req.session.gid >= 2),
        view: (data[0].status === 3 // 确认结束
          || (data[0].isReg && data[0].type === 1 && data[0].status > 0) // IOI赛制 且 用户已报名
          || req.session.gid >= 2)
      }
      // 一定要放在下面，因为在其之前会用到原始值
      data[0].type = ctype[data[0].type];
      data[0].start = Format(data[0].start);
      data[0].status = cstatus[data[0].status];

      return res.status(200).send({
        data: data[0]
      });
    }
  });
}

exports.addPlayer = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const cid = req.body.cid, name = req.body.name;
  db.query('SELECT uid FROM userInfo WHERE name=? LIMIT 1', [name], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({
      message: '无此用户'
    });
    else {
      db.query('SELECT * FROM contestPlayer WHERE cid=? AND uid=?', [cid, data[0].uid], (error, redata) => {
        if (redata.length) return res.status(202).send({ message: '此用户已被添加入比赛' });
        db.query('INSERT INTO contestPlayer(cid,uid) VALUES (?,?)', [cid, data[0].uid], (erro) => {
          if (erro) return res.status(202).send({ message: erro });
          return res.status(200).send({ message: 'success' });
        });
      })
    }
  });
}

exports.removePlayer = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  let rmIds = [];
  for (let i = 0; i < req.body.list.length; i++) {
    rmIds.push(req.body.list[i].id);
  }
  db.query('DELETE FROM contestPlayer WHERE id in(?)', [rmIds], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (data.affectedRows > 0)
      res.status(200).send({ message: 'success' });
    else res.status(202).send({ message: 'error' });
  });
}

exports.getPlayerList = (req, res) => {
  let pageId = req.body.pageId,
    pageSize = 20;
  if (!pageId) pageId = 1;
  pageId = SqlString.escape(pageId);
  const cid = req.body.cid;
  let sql = "SELECT pl.id,pl.uid,u.name FROM contestPlayer pl INNER JOIN userInfo u ON u.uid = pl.uid WHERE pl.cid=?" +
    " LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, [cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    db.query("SELECT COUNT(*) as total FROM contestPlayer WHERE cid=?", [cid], (err, data) => {
      if (err) return res.status(202).send({ message: err });
      return res.status(200).send({
        total: data[0].total,
        data: list
      });
    });
  });
}

exports.closeContest = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const cid = req.body.cid;

  db.query('SELECT * FROM contest WHERE cid=?', [cid], (err, contestInfo) => {
    if (err) return res.status(202).send({ message: err });
    if (!contestInfo.length) {
      return res.status(202).send({ message: '无此比赛' });
    }
    if (req.session.uid !== 1 && contestInfo[0].host !== req.session.uid) {
      return res.status(202).send({ message: '你只能修改自己的比赛' });
    }
    if (contestStatus(contestInfo[0]) < 2) {
      return res.status(202).send({ message: '还未至比赛截止时间' });
    }
    if (contestStatus(contestInfo[0]) === 3) {
      return res.status(202).send({ message: '比赛已结束' });
    }
    db.query('UPDATE contest SET done=1 WHERE cid=?', [cid], (err, data) => {
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
  });
}

exports.contestReg = (req, res) => {
  const cid = req.body.cid;
  db.query('SELECT * FROM contest WHERE cid=?', [cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '无此比赛' });
    if (!data[0].isPublic // 非公开
      || contestStatus(data[0]) >= 2 // 正式结束
      || (await isReg(req.session.uid, data[0].cid))) { // 已经报名
      return res.status(202).send({ message: '比赛已结束或私有，请联系管理员' });
    }
    db.query('INSERT INTO contestPlayer(cid,uid) VALUES (?,?)', [cid, req.session.uid], (err2, data2) => {
      if (err2) return res.status(202).send({ message: err2 });
      return res.status(200).send({ message: 'success' });
    });
  });
}

exports.getPlayerProblemList = (req, res) => {
  const cid = req.body.cid;
  db.query('SELECT * FROM contest WHERE cid=?', [cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '无此比赛' });
    const isReged = await isReg(req.session.uid, data[0].cid);
    if ((isReged && contestStatus(data[0]) > 0) || req.session.gid >= 2 || ((data[0].isPublic || isReged) && data[0].done)) {
      db.query('SELECT cp.idx,p.title,cp.weight,p.publisher as publisherUid,u.name as publisher FROM contestProblem cp INNER JOIN problem p ON cp.pid = p.pid INNER JOIN userInfo u ON p.publisher = u.uid WHERE cp.cid=?', [cid], (err2, data2) => {
        if (err2) return res.status(202).send({ message: err2 });
        return res.status(200).send({
          data: data2
        });
      })
    }
    else return res.status(403).end('403 Forbidden');
  });
}

const ptype = ['传统文本比较', 'Special Judge'];

exports.getProblemInfo = (req, res) => {
  const cid = req.body.cid, idx = req.body.idx;
  db.query('SELECT * FROM contest WHERE cid=?', [cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '无此比赛' });
    const isReged = await isReg(req.session.uid, data[0].cid);
    if ((isReged && contestStatus(data[0]) > 0) || req.session.gid >= 2 || ((data[0].isPublic || isReged) && data[0].done)) {
      const pinfo = await getPinfo(cid, idx), pid = pinfo.pid;
      if (!pid) return res.status(202).send({
        message: '无此题目'
      });
      let sql = "SELECT p.title,p.description,p.time,p.timeLimit,p.memoryLimit,p.type,p.publisher as publisherUid,u.name as publisher FROM problem p INNER JOIN userInfo u ON u.uid = p.publisher WHERE pid=?"
      db.query(sql, [pid], (err2, data2) => {
        if (err2) return res.status(202).send({ message: err2 });
        if (!data2.length) return res.status(202).send({
          message: '无此题目'
        });
        else {
          data2[0].type = ptype[data2[0].type];
          data2[0].time = briefFormat(data2[0].time);
          data2[0].idx = idx;
          data2[0].id = pinfo.id;
          return res.status(200).send({
            data: data2[0]
          });
        }
      });
    }
    else return res.status(403).end('403 Forbidden');
  });
}

exports.getProblemList = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const cid = req.body.cid;
  db.query('SELECT * FROM contest WHERE cid=?', [cid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '无此比赛' });
    db.query('SELECT cp.idx,cp.pid,p.title,p.time,cp.weight,p.publisher as publisherUid,u.name as publisher FROM contestProblem cp INNER JOIN problem p ON cp.pid = p.pid INNER JOIN userInfo u ON p.publisher = u.uid WHERE cp.cid=?', [cid], (err2, data2) => {
      if (err2) return res.status(202).send({ message: err2 });
      for (let i = 0; i < data2.length; i++) {
        data2[i].time = briefFormat(data2[i].time);
      }
      return res.status(200).send({
        data: data2
      });
    });
  });
}


const addProblem = (problem, cid) => {
  return new Promise((resolve, reject) => {
    return db.query('INSERT INTO contestProblem(cid,pid,idx,weight) VALUES (?,?,?,?)', [cid, problem.pid, problem.idx, problem.weight], (err, data) => {
      if (err) reject(err);
      resolve(true);
    })
  }).catch(err => {
    console.log(err);
  });
}


exports.updateProblemList = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  const cid = req.body.cid, list = req.body.list;
  let unilist = [], vis = [];
  for (let i = 0; i < list.length; i++) {
    if (!list[i].pid || !list[i].weight) {
      return res.status(202).send({ message: '请确认信息完善' });
    }
    if (!vis[list[i].pid]) {
      vis[list[i].pid] = true;
      list[i].weight = parseInt(list[i].weight);
      if (list[i].weight < 10 || list[i].weight > 10000) {
        return res.status(202).send({ message: `题目#${list[i].pid}的满分应为[10,10000]之间的整数` });
      }
      unilist.push({
        pid: list[i].pid,
        weight: list[i].weight,
        idx: i + 1
      });
    }
  }
  db.query('SELECT * FROM contest WHERE cid=?', [cid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '无此比赛' });
    if (req.session.uid !== 1 && data[0].host !== req.session.uid) {
      return res.status(202).send({ message: '你只能修改自己的比赛' });
    }
    if (contestStatus(data[0]) === 3) {
      return res.status(202).send({ message: '比赛已结束' });
    }
    db.query('DELETE FROM contestProblem WHERE cid=?', [cid], async () => {
      for (let i = 0; i < unilist.length; i++) {
        await addProblem(unilist[i], cid);
      }
      res.status(200).send({ message: 'success' });
    });
  })
}

exports.submit = async (req, res) => {
  const code = req.body.code, cid = req.body.cid, idx = req.body.idx, uid = req.session.uid;
  if (!cid || !idx) {
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
  if (!(await isReg(uid, cid))) return res.status(202).send({
    message: '请先报名比赛'
  });
  db.query('SELECT * FROM contest WHERE cid=?', [cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '无此比赛' });
    if (contestStatus(data[0]) !== 1) {
      return res.status(202).send({ message: '非比赛时间' });
    }
    const pinfo = await getPinfo(cid, idx), pid = pinfo.pid;
    if (req.body.id !== pinfo.id)
      return res.status(202).send({
        refresh: true,
        message: '题目列表已更新，请重新查看题目列表提交'
      });
    db.query('INSERT INTO submission(pid,uid,code,codelength,submitTime,cid) VALUES (?,?,?,?,?,?)', [pid, req.session.uid, code, code.length, new Date(), cid], (err2, data2) => {
      if (err2) return res.status(202).send({ message: err2.message });
      if (data2.affectedRows > 0) {
        db.query('UPDATE problem SET submitCnt=submitCnt+1 WHERE pid=?', [pid]);
        db.query('DELETE FROM contestLastSubmission WHERE cid=? AND uid=? AND idx=?', [cid, uid, idx], () => {
          db.query('INSERT INTO contestLastSubmission (cid,uid,idx,sid) VALUES (?,?,?,?)', [cid, uid, idx, data2.insertId]);
        });
        pushSidIntoQueue(data2.insertId);
        return res.status(200).send({
          message: 'success'
        })
      } else {
        return res.status(202).send({
          message: 'error',
        })
      }
    });
  });
}

const toHuman = (memory) => {
  if (memory >= 1024)
    memory = Math.round(memory / 1024 * 100) / 100 + ' MB';
  else memory += ' KB';
  return memory;
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

exports.getSubmissionList = (req, res) => {
  const cid = req.body.cid;
  db.query('SELECT * FROM contest WHERE cid=?', [cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '无此比赛' });
    data[0].status = contestStatus(data[0]);
    const isReged = await isReg(req.session.uid, cid);
    if (((data[0].status === 3 && (data[0].isPublic || isReged)) // 确认结束
      || (isReged && data[0].status > 0) // IOI赛制 且 用户已报名
      || req.session.gid >= 2)) {
      db.query('SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE cid=?',
        [cid], async (err2, data2) => {
          if (err2) return res.status(202).send({ message: err2.message });
          for (let i = 0; i < data2.length; i++) {
            data2[i].idx = await getIdx(cid, data2[i].pid);
            data2[i].pid = null;
            data2[i].submitTime = Format(data2[i].submitTime);
            if (!data[0].type && !data[0].done && req.session.gid === 1)
              data2[i].score = data2[i].judgeResult = data2[i].time = data2[i].memory = 0;
            data2[i].judgeResult = judgeRes[data2[i].judgeResult];
            data2[i].memory = toHuman(data2[i].memory);
          }
          db.query('SELECT COUNT(*) as cnt FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE cid=?',
            [cid], async (err3, data3) => {
              if (err3) return res.status(202).send({ message: err3.message });
              return res.status(200).send({ data: data2, total: data3[0].cnt });
            })
        })
    } else return res.status(403).end('403 Forbidden');
  });
}

exports.getLastSubmissionList = (req, res) => {
  const cid = req.body.cid;
  db.query('SELECT * FROM contest WHERE cid=?', [cid], async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '无此比赛' });
    data[0].status = contestStatus(data[0]);
    const isReged = await isReg(req.session.uid, cid);
    if (((data[0].status === 3 && (data[0].isPublic || isReged)) // 确认结束
      || (isReged && data[0].status > 0) // IOI赛制 且 用户已报名
      || req.session.gid >= 2)) {
      lastSubmission = await getAllSubmissions(cid);
      let lastSubmissions = [];
      for (let i in lastSubmission) {
        lastSubmissions.push(lastSubmission[i].sid);
      }
      if (!lastSubmissions.length) {
        return res.status(200).send({ data: [], total: 0 });
      }
      db.query('SELECT s.sid,s.uid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.codeLength,s.submitTime,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE s.sid in (?)',
        [lastSubmissions], async (err2, data2) => {
          if (err2) return res.status(202).send({ message: err2.message });
          for (let i = 0; i < data2.length; i++) {
            data2[i].idx = await getIdx(cid, data2[i].pid);
            data2[i].pid = null;
            data2[i].submitTime = Format(data2[i].submitTime);
            if (!data[0].type && !data[0].done && req.session.gid === 1)
              data2[i].score = data2[i].judgeResult = data2[i].time = data2[i].memory = 0;
            data2[i].judgeResult = judgeRes[data2[i].judgeResult];
            data2[i].memory = toHuman(data2[i].memory);
          }
          db.query('SELECT COUNT(*) as cnt FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE s.sid in (?)',
            [lastSubmissions], async (err3, data3) => {
              if (err3) return res.status(202).send({ message: err3.message });
              return res.status(200).send({ data: data2, total: data3[0].cnt });
            })
        })
    } else return res.status(403).end('403 Forbidden');
  });
}

exports.getSubmissionInfo = (req, res) => {
  const sid = req.body.sid;
  db.query('SELECT s.sid,s.uid,s.cid,s.pid,s.judgeResult,s.time,s.memory,s.score,s.code,s.codeLength,s.submitTime,s.compileResult,s.caseResult,u.name,p.title FROM submission s INNER JOIN userInfo u ON u.uid = s.uid INNER JOIN problem p ON p.pid=s.pid WHERE sid=?',
    [sid], (err, data) => {
      if (err) return res.status(202).send({ message: err });
      if (!data.length) return res.status(202).send({
        message: 'error'
      });
      else {
        db.query('SELECT * FROM contest WHERE cid=?', [data[0].cid], async (err2, data2) => {
          if (err2) return res.status(202).send({ message: err2 });
          if (!data2.length) return res.status(202).send({ message: '无此比赛' });
          data2[0].status = contestStatus(data2[0]);
          if ((data2[0].status === 3 && (data2[0].isPublic || (await isReg(req.session.uid, data[0].cid)))) || req.session.uid === data[0].uid || req.session.gid > 1) {
            data[0].caseResult = JSON.parse(data[0].caseResult);
            if (!data2[0].type && !data2[0].done && req.session.gid === 1) {
              data[0].caseResult = null;
              data[0].score = data[0].judgeResult = data[0].time = data[0].memory = 0;
              data[0].unShown = true;
            }
            for (let i in data[0].caseResult) {
              if (!(req.session.gid > 1 || data2[0].status === 3))
                data[0].caseResult[i].input = data[0].caseResult[i].output = data[0].caseResult[i].compareResult = '比赛进行中...\n';
              data[0].caseResult[i].judgeResult = judgeRes[data[0].caseResult[i].judgeResult];
              data[0].caseResult[i].memory = toHuman(data[0].caseResult[i].memory);
            }
            data[0].pid = null;
            data[0].memory = toHuman(data[0].memory);
            data[0].submitTime = Format(data[0].submitTime);
            data[0].judgeResult = judgeRes[data[0].judgeResult];
            return res.status(200).send({
              data: data[0]
            });
          } else return res.status(403).end('403 Forbidden');
        })
      }
    });
}

const getAllSubmissions = (cid) => {
  return new Promise((resolve, reject) => {
    return db.query('SELECT sid FROM contestLastSubmission WHERE cid=?', [cid], (err, data) => {
      if (err) reject(err);
      resolve(data);
    })
  }).catch(err => {
    console.log(err);
  });
}

const getAllProblems = (cid) => {
  return new Promise((resolve, reject) => {
    return db.query('SELECT pid,idx,weight FROM contestProblem WHERE cid=?', [cid], (err, data) => {
      if (err) reject(err);
      resolve(data);
    })
  }).catch(err => {
    console.log(err);
  });
}

const getAllPlayers = (cid) => {
  return new Promise((resolve, reject) => {
    return db.query('SELECT uid FROM contestPlayer WHERE cid=?', [cid], (err, data) => {
      if (err) reject(err);
      resolve(data);
    })
  }).catch(err => {
    console.log(err);
  });
}

const getSubmissionDetail = (sid) => {
  return new Promise((resolve, reject) => {
    return db.query('SELECT uid,pid,time,score FROM submission WHERE sid=?', [sid], (err, data) => {
      if (err) reject(err);
      resolve(data[0]);
    })
  }).catch(err => {
    console.log(err);
  });
}

const getContestInfo = (cid) => {
  return new Promise((resolve, reject) => {
    return db.query('SELECT * FROM contest WHERE cid=?', [cid], (err, data) => {
      if (err) reject(err);
      resolve(data[0]);
    })
  }).catch(err => {
    console.log(err);
  });
}

exports.getRank = async (req, res) => {
  const cid = req.body.cid,
    submissions = await getAllSubmissions(cid),
    problems = await getAllProblems(cid),
    players = await getAllPlayers(cid),
    contestInfo = await getContestInfo(cid),
    isReged = await isReg(req.session.uid, cid),
    status = contestStatus(contestInfo);

  if (!(((status === 3 && (contestInfo.isPublic || isReged)) // 确认结束
    || (isReged && contestInfo.type === 1 && status > 0) // IOI赛制 且 用户已报名
    || req.session.gid >= 2))) {
    return res.status(403).end('403 Forbidden');
  }

  let uVis = [], pidToIdx = [], pweight = [], rank = [], table = new Map(), pinfo = new Map();
  for (let i = 0; i < problems.length; i++)
    pidToIdx[problems[i].pid] = problems[i].idx, pweight[problems[i].pid] = problems[i].weight, pinfo[problems[i].idx] = problems[i].weight;
  for (let i = 0; i < players.length; i++)
    uVis[players[i].uid] = true, table[players[i].uid] = new Map(), table[players[i].uid]['uid'] = players[i].uid,
      table[players[i].uid]['totalScore'] = table[players[i].uid]['usedTime'] = 0,
      table[players[i].uid]['detail'] = new Map(), table[players[i].uid]['submitted'] = false;
  for (let i = 0; i < submissions.length; i++) {
    submissions[i].detail = await getSubmissionDetail(submissions[i].sid);
    if (pidToIdx[submissions[i].detail.pid] && uVis[submissions[i].detail.uid]) {
      table[submissions[i].detail.uid]['detail'][pidToIdx[submissions[i].detail.pid]] = {
        score: Math.round(submissions[i].detail.score * pweight[submissions[i].detail.pid] / 100),
        time: submissions[i].detail.time
      };
      table[submissions[i].detail.uid]['totalScore'] += Math.round(submissions[i].detail.score * pweight[submissions[i].detail.pid] / 100);
      if (submissions[i].detail.score)
        table[submissions[i].detail.uid]['usedTime'] += submissions[i].detail.time;
      table[submissions[i].detail.uid]['submitted'] = true;
    }
  }
  for (let i in table) {
    rank.push(table[i]);
  }
  rank.sort((a, b) => {
    if (a.totalScore === b.totalScore) {
      if (a.usedTime === b.usedTime) {
        if (a.submitted === b.submitted) {
          return a.uid - b.uid;
        } else return b.submitted - a.submitted;
      } else return a.usedTime - b.usedTime; //升序
    } else return b.totalScore - a.totalScore; //降序
  });
  return res.status(200).send({ data: rank, problem: pinfo });
}