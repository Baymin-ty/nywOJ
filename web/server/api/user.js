let db = require('../db/index')
let bcrypt = require('bcryptjs')
let axios = require('axios');

exports.reg = async (req, res) => {
    const name = req.body.name;
    const pwd = req.body.pwd;
    const rePwd = req.body.rePwd;
    if (!name || !pwd || !rePwd) {
        res.send({
            status: 403, message: "请确认信息完善"
        });
        return;
    }
    if (name.length < 3 || name.length > 15) {
        res.send({
            status: 202, message: "用户名长度应在3~15之间"
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
    if (pwd.length > 31 || pwd.length < 6) {
        res.send({
            status: 202, message: "密码长度应在6~31之间"
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
    let ok = true;
    await axios.get('https://v.api.aa1.cn/api/api-mgc/index.php', {
        params: {
            msg: name,
        }
    }).then(res => {
        if (res.data.num === '1')
            ok = false;
    });
    if (!ok) return res.send({
        status: 202, message: "用户名中存在敏感词"
    });
    db.query("SELECT uid FROM userInfo WHERE name=?", [name], (err, data) => {
        if (err) return res.send({
            status: 202, message: err.message,
        });
        if (data.length) return res.send({
            status: 202, message: "该用户名已被注册"
        });
        else {
            const time = new Date();
            const password = bcrypt.hashSync(pwd, 12);
            db.query("INSERT INTO userInfo(name,pwd,reg_time) values (?,?,?)", [name, password, time], (err, data) => {
                if (err) return res.send({
                    status: 202, message: err.message,
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
    })
}

exports.login = async (req, res) => {
    const name = req.body.name;
    const pwd = req.body.pwd;
    const retoken = req.body.retoken;
    let recapt = await axios.get("https://www.recaptcha.net/recaptcha/api/siteverify", {
        params: {
            secret: "6LcEKJIkAAAAACAlGysXJJowd7Vrcbc08Ghtd58C",
            response: retoken
        }
    });
    if (!recapt.data.success) {
        return res.status(202).send({
            message: "人机验证失败,请刷新网页重试"
        })
    }
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
            db.query("UPDATE userInfo SET login_time=? WHERE uid=?", [new Date(), uid]);
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