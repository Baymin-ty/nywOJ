const db = require('../db/index');

exports.getAnnouncementList = (req, res) => {
  let sql = "SELECT * FROM announcement ORDER BY weight desc LIMIT 10";
  db.query(sql, (err, data) => {
    if (err) return res.status(202).send({ message: err });
    return res.status(200).send({
      data: data
    });
  });
}
