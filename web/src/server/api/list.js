let db = require('../db/index')
const bcrypt = require('bcryptjs')

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
}

const dateFormat = (x) => {
    x = x.toString();
    return x.length > 1 ? x : '0' + x;
}
const getCurTime = () => {
    const now = new Date();
    return now.getFullYear() + '-' + dateFormat(now.getMonth() + 1) + '-' + dateFormat(now.getDate()) + ' ' + dateFormat(now.getHours()) + ':' + dateFormat(now.getMinutes()) + ':' + dateFormat(now.getSeconds());
}

exports.all = (req, res) => {
    let sql = 'SELECT * FROM clickList ORDER BY id desc limit 20';
    db.query(sql, (err, data) => {
        if (err) return res.send('Error: ' + err.message);
        res.send(data);
    })
}

exports.add = (req, res) => {
    const key1 = Math.floor(new Date().getTime() / 1000).toString() + "114514" + req.query.ip_loc;
    const key2 = (Math.floor(new Date().getTime() / 1000) - 1).toString() + "114514" + req.query.ip_loc;
    const ip = getClientIp(req);
    if (!req.query.key || (!bcrypt.compareSync(key1, req.query.key) && !bcrypt.compareSync(key2, req.query.key))) {
        res.send({
            status: 403, message: '114514',
        });
        return;
    }
    let sql = 'INSERT INTO clickList(uid,time,ip,ip_loc) values (?,?,?,?)';
    db.query(sql, [1, getCurTime(), ip, req.query.ip_loc], (err, data) => {
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

exports.getUserIp = (req, res) => {
    res.send([{
            ip: getClientIp(req)
        }]
    );
}

exports.getRankInfo = (req, res) => {
    let sql = 'SELECT ip,ip_loc,COUNT(*) as cnt FROM clickList GROUP BY ip ORDER BY cnt DESC LIMIT 20';
    db.query(sql, (err, data) => {
        if (err) return res.send('Error: ' + err.message);
        res.send(data);
    })
}