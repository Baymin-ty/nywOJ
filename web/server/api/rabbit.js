const db = require('../db/index')

const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
}

const fill = (x) => {
    x = x.toString();
    return x.length > 1 ? x : '0' + x;
}

const Format = (now) => {
    return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate()) + ' ' + fill(now.getHours()) + ':' + fill(now.getMinutes()) + ':' + fill(now.getSeconds());
}

exports.all = (req, res) => {
    let sql = 'SELECT * FROM clickList ORDER BY id desc limit 20';
    db.query(sql, (err, data) => {
        if (err) return res.send({
            status: 202, message: err.message
        });
        for (let i = 0; i < data.length; i++) data[i].time = Format(data[i].time);
        res.send({
            status: 200, data: data
        });
    })
}

exports.add = (req, res) => {
    const ip = getClientIp(req), uid = req.session.uid, name = req.session.name;
    if (!uid) {
        return res.status(202).send({ message: "请先登录" })
    }
    db.query('INSERT INTO clickList(uid,name,time,ip) values (?,?,?,?)', [uid, name, new Date(), ip], (err, data) => {
        if (err) return res.send({
            status: 202, message: err.message
        });
        if (data.affectedRows > 0) {
            db.query("UPDATE userInfo SET clickCnt=clickCnt+1 WHERE uid=?", [uid]);
            res.send({
                status: 200, message: 'success',
            })
        } else {
            res.send({
                status: 202, message: 'error',
            })
        }
    });
}

exports.getClickCnt = (req, res) => {
    let sql = 'SELECT clickCnt FROM userInfo WHERE uid=?';
    db.query(sql, [req.session.uid], (err, data) => {
        if (err) return res.send({
            status: 202, message: err.message
        });
        res.send({
            status: 200, data: data
        });
    })
}

exports.getUserIp = (req, res) => {
    res.send([{
        status: 200,
        ip: getClientIp(req)
    }]);
}

exports.getRankInfo = (req, res) => {
    let sql = 'SELECT uid,name,clickCnt FROM userInfo GROUP BY uid ORDER BY clickCnt DESC LIMIT 20';
    if (req.query.today === "true") sql = 'SELECT uid,name,COUNT(*) as clickCnt FROM clickList WHERE !DATEDIFF(NOW(),time) GROUP BY uid ORDER BY clickCnt DESC LIMIT 20';
    db.query(sql, (err, data) => {
        if (err) return res.send({
            status: 202, message: err.message
        });
        res.send({
            status: 200, data: data
        });
    })
}

exports.getClickData = (req, res) => {
    let sql = 'SELECT DATE(time) AS date,COUNT(*) AS clickCnt,COUNT(DISTINCT uid) AS userCnt FROM clickList WHERE DATEDIFF(NOW(),time)<7 GROUP BY date';
    db.query(sql, (err, data) => {
        if (err) return res.send({
            status: 202, message: err.message
        });
        let mp = [];
        const now = new Date();
        for (let i = 6; i >= 0; i--)
            mp[Format(new Date(now.getTime() - 1000 * 3600 * 24 * i)).substring(0, 10)] = [0, 0];
        for (let i = 0; i < data.length; i++)
            mp[Format(data[i].date).substring(0, 10)] = [data[i].clickCnt, data[i].userCnt];
        let result = []
        for (let key in mp) {
            result.push({
                date: key,
                clickCnt: mp[key][0],
                userCnt: mp[key][1]
            })
        }
        res.send({
            status: 200, data: result
        });
    })
}