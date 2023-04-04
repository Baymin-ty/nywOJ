const db = require('../db/index');

exports.getUserInfoList = (req, res) => {
  let pageId = req.body.pageId, filter = req.body.filter, pageSize = 20;
  if (!pageId) pageId = 1;
  let sql = "SELECT uid,name,email,gid,inUse FROM userInfo WHERE uid > 0 ";
  if (filter.uid)
    sql += `AND uid=${filter.uid} `;
  if (filter.name)
    sql += `AND name like \'%${filter.name}%\' `;
  if (filter.email)
    sql += `AND email like \'%${filter.email}%\' `;
  if (filter.gid)
    sql += `AND gid=${filter.gid} `;
  if (filter.inUse)
    sql += `AND inUse=${2 - filter.inUse} `; // fit for front-end
  sql += " LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data, csql = "SELECT COUNT(*) as total FROM userInfo WHERE uid > 0 ";
    if (filter.uid)
      csql += `AND uid=${filter.uid} `;
    if (filter.name)
      csql += `AND name like \'%${filter.name}%\' `;
    if (filter.email)
      csql += `AND email like \'%${filter.email}%\' `;
    if (filter.gid)
      csql += `AND gid=${filter.gid} `;
    if (filter.inUse)
      csql += `AND inUse=${2 - filter.inUse} `; // fit for front-end
    db.query(csql, (err, data) => {
      if (err) return res.status(202).send({ message: err });
      return res.status(200).send({
        total: data[0].total,
        userList: list
      });
    });
  });
}

exports.setBlock = (req, res) => {
  const uid = req.body.uid, status = req.body.status;
  if (uid === null || status === null) {
    return res.status(202).send({
      message: '请确认信息完善'
    });
  }
  let sql = "UPDATE userInfo SET inUse=? WHERE uid=?";
  db.query(sql, [status, uid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (data.affectedRows > 0) {
      return res.status(200).send({
        message: 'sueecss'
      });
    } else {
      return res.status(202).send({
        message: 'failed'
      });
    }
  })
}

exports.updateUserInfo = (req, res) => {
  const newInfo = req.body.info;
  const uid = newInfo.uid, name = newInfo.name, email = newInfo.email, gid = newInfo.gid;
  if (!uid || !name || !gid) {
    return res.status(202).send({
      message: '请确认信息完善'
    });
  }
  db.query("UPDATE userInfo SET name=?,email=?,gid=? WHERE uid=?", [name, email, gid, uid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (data.affectedRows > 0) {
      return res.status(200).send({
        message: 'sueecss'
      });
    } else {
      return res.status(202).send({
        message: 'failed'
      });
    }
  })
}

exports.addAnnouncement = (req, res) => {
  db.query('INSERT INTO announcement(title,description,weight,time) VALUES (?,?,?,?)', ["请输入公告标题", "请输入公告描述", 10, new Date()], (err, data) => {
    if (err) return res.status(202).send({
      message: err.message
    });
    if (data.affectedRows > 0) {
      return res.status(200).send({
        aid: data.insertId
      })
    } else {
      return res.status(202).send({
        message: 'error',
      })
    }
  });
}

exports.updateAnnouncement = (req, res) => {
  const info = req.body.info;
  const aid = info.aid, title = info.title, description = info.description, weight = info.weight;
  db.query("UPDATE announcement SET title=?,description=?,weight=? WHERE aid=?", [title, description, weight, aid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (data.affectedRows > 0) {
      return res.status(200).send({
        message: 'sueecss'
      });
    } else {
      return res.status(202).send({
        message: 'failed'
      });
    }
  })
}
