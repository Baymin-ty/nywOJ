const db = require('../db/index');

exports.createProblem = (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');
  db.query('INSERT INTO problem(publisher) VALUES (?)', [req.session.uid], (err, data) => {
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
}
