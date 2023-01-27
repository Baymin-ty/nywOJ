let db = require('../db/index')

exports.all = (req, res) => {
    let sql = 'SELECT * FROM clickList ORDER BY id desc limit 20'
    db.query(sql, (err, data) => {
        if (err)
            return res.send('error: ' + err.message);
        res.send(data);
    })
}

exports.add = (req, res) => {
    let sql = 'insert into clickList(userid,time,ip,ip_loc) values (?,?,?,?)'
    db.query(sql, [req.query.userid, req.query.time, req.query.ip, req.query.ip_loc], (err, data) => {
        if (err)
            return res.send('Error：' + err.message);
        if (data.affectedRows > 0) {
            res.send({
                status: 200,
                message: 'success',
            })
        } else {
            res.send({
                status: 202,
                message: 'error',
            })
        }
    })
}
