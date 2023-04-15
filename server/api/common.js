const db = require('../db/index');
const { briefFormat } = require('../static');

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
