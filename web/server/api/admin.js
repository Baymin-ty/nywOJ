const db = require('../db/index');

exports.getUserInfoList = (req, res) => {
  const pageId = req.body.pageId,
    pageSize = 20;
  if (!pageId) pageId = 1;
  let sql = "SELECT * FROM userInfo LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    db.query("SELECT COUNT(*) as total FROM userInfo", (err, data) => {
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
  if (!uid || !name || !email || !gid) {
    return res.status(202).send({
      message: '请确认信息完善'
    });
  }
  if (name.length < 3 || name.length > 15) {
    return res.status(202).send({
      message: "用户名长度应在3~15之间"
    });
  }
  const emailExp = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
  if (!emailExp.test(email)) {
    return res.status(202).send({
      message: "请检查邮箱是否合法"
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
