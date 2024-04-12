const db = require('../db/index');
const { Format, ip2loc } = require('../static');
let dayClick = {};
const SqlString = require('mysql/lib/protocol/SqlString');

exports.all = (req, res) => {
  let sql = 'SELECT clickList.id,clickList.time,clickList.uid,userInfo.name,clickList.ip,clickList.iploc,userInfo.clickCnt,userInfo.gid FROM clickList INNER JOIN userInfo ON userInfo.uid = clickList.uid ORDER BY clickList.id DESC LIMIT 20';
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({
      message: err
    });
    for (let i = 0; i < data.length; i++) data[i].time = Format(data[i].time);
    return res.status(200).send({
      data: data
    });
  })
}

exports.add = (req, res) => {
  const ip = req.session.ip, uid = req.session.uid;

  if (!dayClick.lastClick || new Date().getDate() !== dayClick.lastClick.getDate()) {
    dayClick = {};
  }
  if (!dayClick[uid]) dayClick[uid] = 0;
  const cnt = dayClick[uid];

  if (cnt >= 1000000) {
    return res.status(202).send({
      message: "请明天再试"
    })
  }

  const iploc = ip2loc(ip);
  db.query('INSERT INTO clickList(uid,time,ip,iploc) values (?,?,?,?)', [uid, new Date(), ip, iploc], (err, data) => {
    if (err) return res.status(202).send({
      message: err
    });
    if (data.affectedRows > 0) {
      let sql = "INSERT INTO rabbitstat (uid, click, date) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE click = click + 1";
      db.query(sql, [uid, new Date()], (err2, data2) => {
        if (err2) return res.status(202).send({
          message: err2
        });
        dayClick[uid]++;
        dayClick.lastClick = new Date();
        db.query("UPDATE userInfo SET clickCnt=clickCnt+1 WHERE uid=?", [uid]);
        return res.status(200).send({
          message: 'success',
        });
      });
    } else {
      return res.status(202).send({
        message: 'error',
      })
    }
  });
}

exports.getClickCnt = (req, res) => {
  let uid = req.session.uid;
  if (req.body.uid) uid = req.body.uid;
  let sql = 'SELECT clickCnt FROM userInfo WHERE uid=?';
  db.query(sql, [uid], (err, data) => {
    if (err) return res.status(202).send({
      message: err
    });
    return res.status(200).send({ clickCnt: data[0].clickCnt });
  })
}

exports.getRankInfo = (req, res) => {
  let sql = 'SELECT uid,name,clickCnt,motto,gid FROM userInfo GROUP BY uid ORDER BY clickCnt DESC LIMIT 20';
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({
      message: err
    });
    for (let i = 0; i < data.length; i++) {
      if (String(data[i].motto).length > 50)
        data[i].motto = data[i].motto.substring(0, 50) + '...';
    }
    return res.status(200).send({
      data: data
    });
  })
}

exports.getClickData = (req, res) => {
  const quid = req.body.uid;
  const sql = `
  SELECT 
    date,
    SUM(click) AS clickCnt,
    COUNT(DISTINCT uid) AS userCnt
  FROM rabbitstat
  WHERE date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) ` +
    (typeof quid !== 'undefined' ? `AND uid = ${SqlString.escape(quid)} ` : "") +
    `GROUP BY date
  ORDER BY date;
  `;
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({
      message: err
    });
    let mp = [], now = new Date();
    for (let i = 6; i >= 0; i--)
      mp[Format(new Date(now.getTime() - 1000 * 3600 * 24 * i)).substring(5, 10)] = [0, 0];
    for (let i = 0; i < data.length; i++)
      mp[Format(data[i].date).substring(5, 10)] = [data[i].clickCnt, data[i].userCnt];
    let result = []
    for (let key in mp) {
      result.push({
        date: key,
        clickCnt: mp[key][0],
        userCnt: mp[key][1]
      })
    }
    return res.status(200).send({
      data: result
    });
  })
}
