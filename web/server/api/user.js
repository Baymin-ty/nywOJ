const db = require('../db/index');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const mail = require('nodemailer');

const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
}

exports.reg = async (req, res) => {
    const name = req.body.name;
    const pwd = req.body.pwd;
    const rePwd = req.body.rePwd;
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
    db.query("SELECT * FROM userInfo WHERE name=?", [name], (err, data) => {
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
            req.session.uid = uid;
            req.session.name = data[0].name;
            req.session.email = data[0].email;
            db.query("UPDATE userInfo SET login_time=? WHERE uid=?", [new Date(), uid]);
            db.query("INSERT INTO loginLog(uid,time,ip) values (?,?,?) ", [uid, new Date(), req.session.ip]);
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
    if (req.session.uid) return res.status(200).send({ uid: req.session.uid, name: req.session.name, email: req.session.email });
    else return res.status(202).send({ message: "请先登录" });
}

exports.logout = (req, res) => {
    req.session.destroy();
    return res.status(200).send({ message: "success" });
}

exports.sendEmailVertifyCode = async (req, res) => {
    const email = req.body.email;
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
    const emailExp = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
    if (!emailExp.test(email)) {
        return res.status(202).send({
            message: "请检查邮箱是否合法"
        })
    }
    let vertifyCode = "";
    const mp = 'abcdefghijklmnpqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ1234567890';
    for (let i = 0; i < 6; i++) vertifyCode += mp.charAt(Math.floor(Math.random() * 60));

    const tim = new Date();
    req.session.vertifyCode = {
        code: vertifyCode,
        expire: tim.getTime() + 3 * 60 * 1000,
        email: email
    }

    let transporter = mail.createTransport({
        host: 'smtp.163.com',
        port: 465,
        secureConnection: true,
        auth: {
            user: 'nywojservice@163.com',
            pass: 'OJCFMGSMMFNBEOOA'
        }
    })

    let mailOptions = {
        from: 'nywojservice@163.com',
        to: email,
        subject: 'nywOJ绑定邮箱验证码',
        text: "你正在nywOJ进行绑定邮箱操作，验证码为 " + vertifyCode + " 。该验证码3分钟内有效。"
    }

    transporter.sendMail(mailOptions, (err) => {
        if (!err) {
            return res.status(200).send({ message: "success" });
        } else {
            return res.status(202).send({ message: err.message });
        }
    })
}

exports.setUserEmail = (req, res) => {
    const uid = req.session.uid;
    const userCode = req.body.code;
    const vertifycode = req.session.vertifyCode.code;
    const expire = req.session.vertifyCode.expire;
    const email = req.session.vertifyCode.email;
    if (!userCode || !vertifycode || !email) {
        return res.status(202).send({ message: "请确认信息完整且操作正确" });
    }
    if (userCode !== vertifycode) {
        return res.status(202).send({ message: "验证码错误" });
    }
    const time = new Date().getTime();
    if (time > expire) {
        return res.status(202).send({ message: "验证码超时" });
    }
    db.query("UPDATE userInfo SET email=? WHERE uid=?", [email, uid], (err, data) => {
        if (err) {
            return res.status(202).send({ message: err.message });
        }
        if (data.affectedRows > 0) {
            req.session.email = email;
            return res.status(200).send({ message: "success" });
        } else return res.status(202).send({ message: "sql error" });
    });
}