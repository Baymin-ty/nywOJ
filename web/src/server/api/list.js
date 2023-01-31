let db = require('../db/index')
const bcrypt = require("bcryptjs");

exports.all = (req, res) => {
    let sql = 'SELECT * FROM clickList ORDER BY id desc limit 20';
    db.query(sql, (err, data) => {
        if (err) return res.send('Error: ' + err.message);
        res.send(data);
    })
}

exports.add = (req, res) => {
    const key = Math.round(new Date().getTime() / 1000).toString() + "114514" + req.query.ip;
    if (!req.query.key || !bcrypt.compareSync(key, req.query.key)) {
        res.send({
            req: req.ip, status: 403, message: '114514',
        });
        return;
    }
    let sql = 'INSERT INTO clickList(userid,time,ip,ip_loc) values (?,?,?,?)';
    db.query(sql, [req.query.userid, req.query.time, req.query.ip, req.query.ip_loc], (err, data) => {
        if (err) return res.send('Error：' + err.message);
        if (data.affectedRows > 0) {
            res.send({
                status: 200, message: 'success',
            })
        } else {
            res.send({
                status: 202, message: 'error',
            })
        }
    })
}

exports.getClickCnt = (req, res) => {
    let sql = 'SELECT COUNT(*) as cnt FROM clickList WHERE ip=?';
    db.query(sql, [req.query.ip], (err, data) => {
        if (err) return res.send('Error: ' + err.message);
        res.send(data);
    })
}

exports.getRankInfo = (req, res) => {
    let sql = 'SELECT ip,ip_loc,COUNT(*) as cnt FROM clickList GROUP BY ip ORDER BY cnt DESC LIMIT 20';
    db.query(sql, (err, data) => {
        if (err) return res.send('Error: ' + err.message);
        res.send(data);
    })
}