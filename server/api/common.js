const db = require('../db/index');
const { briefFormat, Format } = require('../static');
const SqlString = require('mysql/lib/protocol/SqlString');

const getMark = () => {
  const time = Date.now().toString(36);
  const str = Math.random().toString(36).slice(2, 7);
  return `${time}-${str}`;
}

exports.getAnnouncementList = (req, res) => {
  let sql = "SELECT aid,time,title FROM announcement ORDER BY weight desc LIMIT 5";
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    for (let i = 0; i < data.length; i++) data[i].time = briefFormat(data[i].time);
    return res.status(200).send({
      data: data
    });
  });
}

exports.getAnnouncementInfo = (req, res) => {
  const aid = req.body.aid;
  let sql = "SELECT * FROM announcement WHERE aid=?";
  db.query(sql, [aid], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({
      message: 'error'
    });
    else {
      data[0].time = briefFormat(data[0].time);
      return res.status(200).send({
        data: data[0]
      });
    }
  });
}

exports.getPaste = (req, res) => {
  db.query('SELECT title,mark,content,uid,time,isPublic FROM pastes WHERE mark=?', [req.body.mark], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (!data.length) return res.status(202).send({ message: '未找到' });
    if (req.session.gid < 3 && (!data[0].isPublic && data[0].uid !== req.session.uid))
      return res.status(202).send({ message: '无权限查看' });
    data[0].time = Format(data[0].time);
    db.query('SELECT name FROM userInfo WHERE uid=?', [data[0].uid], (err2, data2) => {
      if (err) return res.status(202).send({ message: err2 });
      data[0].paster = data2[0].name;
      return res.status(200).send({
        data: data[0]
      });
    })
  });
}

exports.addPaste = (req, res) => {
  const mark = getMark();
  db.query('INSERT INTO pastes(mark,title,content,uid,time,isPublic) VALUES (?,?,?,?,?,?)', [mark, '请输入标题', '请输入内容', req.session.uid, new Date(), 0], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (data.affectedRows > 0)
      return res.status(200).send({ mark: mark });
    else
      return res.status(202).send({ message: 'error' });
  });
}

exports.updatePaste = (req, res) => {
  const paste = req.body.paste, content = paste.content, title = paste.title;
  if (title.length > 20) {
    return res.status(202).send({
      message: '标题长度不可大于20'
    });
  }
  if (paste.length > 10000) {
    return res.status(202).send({
      message: '内容长度不可大于10000'
    });
  }
  db.query("SELECT uid FROM pastes WHERE mark=?", [paste.mark], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (req.session.gid < 3 && req.session.uid !== data[0].uid) return res.status(202).send({ message: '你只能修改自己的paste' });
    db.query("UPDATE pastes SET title=?,content=?,isPublic=?,time=? WHERE mark=?", [title, content, paste.isPublic, new Date(), paste.mark], (err, data) => {
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
  })
}

exports.delPaste = (req, res) => {
  const mark = req.body.mark;
  db.query("SELECT uid FROM pastes WHERE mark=?", [mark], (err, data) => {
    if (err) return res.status(202).send({ message: err });
    if (req.session.gid < 3 && req.session.uid !== data[0].uid) return res.status(202).send({ message: '你只能删除自己的paste' });
    db.query("DELETE FROM pastes WHERE mark=?", [mark], (err, data) => {
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
  })
}

exports.getPasteList = (req, res) => {
  let pageId = req.body.pageId,
    pageSize = 20, uid = null;
  if (req.body.uid) uid = req.body.uid;
  if (!pageId) pageId = 1;
  if (req.session.gid < 3) uid = req.session.uid;
  let sql = "SELECT p.id,p.mark,p.title,p.uid,p.time,p.isPublic,u.name as publisher FROM pastes p INNER JOIN userInfo u ON u.uid = p.uid";
  if (uid) sql += ` WHERE p.uid=${uid}`;
  sql += " ORDER BY p.id DESC LIMIT " + (pageId - 1) * pageSize + "," + pageSize;
  db.query(sql, async (err, data) => {
    if (err) return res.status(202).send({ message: err });
    let list = data;
    for (let i = 0; i < list.length; i++)
      list[i].time = Format(list[i].time);
    sql = 'SELECT COUNT(*) as total FROM pastes';
    if (uid) sql += ` WHERE uid=${uid}`;
    db.query(sql, (err, data) => {
      if (err) return res.status(202).send({ message: err });
      return res.status(200).send({
        total: data[0].total,
        data: list
      });
    });
  });
}