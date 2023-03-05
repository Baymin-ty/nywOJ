const db = require('../db/index')
const rabbitData = require('../store/rabbitData.json')

const fill = (x) => {
    x = x.toString();
    return x.length > 1 ? x : '0' + x;
}

const Format = (now) => {
    return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate()) + ' ' + fill(now.getHours()) + ':' + fill(now.getMinutes()) + ':' + fill(now.getSeconds());
}

exports.all = (req, res) => {
    let sql = 'SELECT clickList.id,clickList.time,clickList.uid,userInfo.name,clickList.ip,userInfo.clickCnt,userInfo.gid FROM clickList INNER JOIN userInfo ON userInfo.uid = clickList.uid ORDER BY clickList.id DESC LIMIT 20';
    db.query(sql, (err, data) => {
        if (err) return res.status(202).send({
            message: err.message
        });
        for (let i = 0; i < data.length; i++) data[i].time = Format(data[i].time);
        return res.status(200).send({
            data: data
        });
    })
}

exports.add = (req, res) => {
    const ip = req.session.ip, uid = req.session.uid;
    if (!uid) {
        return res.status(202).send({ message: "请先登录" })
    }
    db.query('INSERT INTO clickList(uid,time,ip) values (?,?,?)', [uid, new Date(), ip], (err, data) => {
        if (err) return res.status(202).send({
            message: err.message
        });
        if (data.affectedRows > 0) {
            db.query("UPDATE userInfo SET clickCnt=clickCnt+1 WHERE uid=?", [uid]);
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

exports.getClickCnt = (req, res) => {
    let uid = req.session.uid;
    if (req.body.uid) uid = req.body.uid;
    let sql = 'SELECT clickCnt FROM userInfo WHERE uid=?';
    db.query(sql, [uid], (err, data) => {
        if (err) return res.status(202).send({
            message: err.message
        });
        return res.status(200).send({ clickCnt: data[0].clickCnt });
    })
}

exports.getRankInfo = (req, res) => {
    let sql = 'SELECT uid,name,clickCnt,motto,gid FROM userInfo GROUP BY uid ORDER BY clickCnt DESC LIMIT 20';
    db.query(sql, (err, data) => {
        if (err) return res.status(202).send({
            message: err.message
        });
        return res.status(200).send({
            data: data
        });
    })
}

const updateClickData = () => {
    rabbitData.updateTime = new Date().getTime();
    let sql = 'SELECT DATE(time) AS date,COUNT(*) AS clickCnt,COUNT(DISTINCT uid) AS userCnt FROM clickList WHERE DATEDIFF(NOW(),time)<7 GROUP BY date';
    db.query(sql, (err, data) => {
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
        rabbitData.data = result;
    });
}

exports.getClickData = (req, res) => {
    if (!rabbitData.data) {
        updateClickData();
        return res.status(202).send({
            message: "请稍后再试"
        });
    }
    res.status(200).send({
        data: rabbitData.data,
        updateTime: Format(new Date(rabbitData.updateTime))
    });
    if (new Date().getTime() - rabbitData.updateTime > 900000) {
        updateClickData();
    }
}
