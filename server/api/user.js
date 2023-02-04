let db = require('../db/index')
let bcrypt = require('bcryptjs')

exports.reg = (req, res) => {
    const name = req.query.name;
    const pwd = req.query.pwd;
    const rePwd = req.query.rePwd;
    if (!name || !pwd || !rePwd) {
        res.send({
            status: 403, message: "请确认信息完善"
        });
        return;
    }
    if (name.length < 6 || name.length > 15) {
        res.send({
            status: 202, message: "用户名长度应在6～15之间"
        });
        return;
    }
    for (let i = 0; i < name.length; i++) {
        if (!((name[i] >= 'A' && name[i] <= 'Z') || (name[i] >= 'a' && name[i] <= 'z') || (name[i] >= '0' && name[i] <= '9'))) {
            res.send({
                status: 202, message: "用户名应只包含字母或数字"
            });
            return;
        }
    }
    if (pwd.length > 31 || pwd.length < 8) {
        res.send({
            status: 202, message: "密码长度应在8～31之间"
        });
        return;
    }
    for (let i = 0; i < pwd.length; i++) {
        if (!((pwd[i] >= 'A' && pwd[i] <= 'Z') || (pwd[i] >= 'a' && pwd[i] <= 'z') || (pwd[i] >= '0' && pwd[i] <= '9'))) {
            res.send({
                status: 202, message: "密码应只包含字母或数字"
            });
            return;
        }
    }
    if (pwd !== rePwd) {
        res.send({
            status: 202, message: "两次输入的密码不一致"
        });
        return;
    }
    const time = new Date();
    const password = bcrypt.hashSync(pwd, 12);
    db.query("INSERT INTO userInfo(name,pwd,reg_time) values (?,?,?)", [name, password, time], (err, data) => {
        if (err) return res.send({
            status: 250, message: err.message,
        });
        if (data.affectedRows > 0) {
            res.send({
                status: 200, message: 'success',
            });
        } else {
            res.send({
                status: 202, message: 'sql error',
            });
        }
    });
}

exports.login = (req, res) => {
    const name = req.query.name;
    const pwd = req.query.pwd;
    if (!name || !pwd) {
        res.send({
            status: 403, message: "请确认信息完善"
        });
        return;
    }
    db.query("SELECT uid,pwd FROM userInfo WHERE name=?", [name], (err, data) => {
        if (!data.length) return res.send({
            status: 202, message: "请先注册后再登录"
        });
        if (err) return res.send({
            status: 202, message: err.message
        });
        const uid = data[0].uid, password = data[0].pwd;
        if (bcrypt.compareSync(pwd, password)) {
            const time = new Date();
            const token = bcrypt.hashSync(time.getTime().toString() + name, 10) + uid
            db.query("INSERT INTO tokenList(token,uid,name,time) values (?,?,?,?)", [token, uid, name, time]);
            res.send({
                status: 200, token: token,
            })
        } else {
            res.send({
                status: 202, message: "密码错误",
            })
        }
    });
}

exports.getUserInfo = (req, res) => {
    const token = req.query.token;
    if (!token) {
        res.send({
            status: 403, message: "请确认信息完善"
        });
        return;
    }
    db.query("SELECT uid,name,time FROM tokenList WHERE token=?", [token], (err, data) => {
        if (err) return res.send({
            status: 202, message: err.message
        });
        if (!data.length) return res.send({
            status: 202, message: "请先登录"
        });
        const tim = data[0].time;
        const curTime = new Date();
        if (curTime - tim > 600000) {
            res.send({
                status: 114514, message: "登录超时请重新登录"
            });
        } else {
            res.send({
                status: 200, uid: data[0].uid, name: data[0].name
            });
        }
    });
}