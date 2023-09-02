const db = require('../db/index');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const mail = require('nodemailer');
const { Format, ip2loc, msFormat, recordEvent, eventList, eventExp, briefFormat } = require('../static');
const config = require('../config.json');

exports.reg = async (req, res) => {
  const name = req.body.name;
  const pwd = req.body.pwd;
  const rePwd = req.body.rePwd;
  const email = req.session.verifiedEmail.email;
  if (!email) {
    return res.status(202).send({
      message: "请先验证邮箱"
    })
  }
  const time = new Date().getTime();
  if (time > req.session.verifiedEmail.expire) {
    return res.status(202).send({ message: "操作超时，请重新绑定邮箱" });
  }
  if (!name || !pwd || !rePwd) {
    return res.status(202).send({
      message: "请确认信息完善"
    })
  }
  if (name.length < 3 || name.length > 15) {
    return res.status(202).send({
      message: "用户名长度应在3~15之间"
    })
  }
  for (let i = 0; i < name.length; i++) {
    if (!((name[i] >= 'A' && name[i] <= 'Z') || (name[i] >= 'a' && name[i] <= 'z') || (name[i] >= '0' && name[i] <= '9'))) {
      return res.status(202).send({
        message: "用户名应只包含字母或数字"
      })
    }
  }
  if (pwd.length > 31 || pwd.length < 6) {
    return res.status(202).send({
      message: "密码长度应在6~31之间"
    })
  }
  if (pwd !== rePwd) {
    return res.status(202).send({
      message: "两次输入的密码不一致"
    })
  }
  // let ok = true;
  // await axios.get('https://v.api.aa1.cn/api/api-mgc/index.php', {
  //     params: {
  //         msg: name,
  //     }
  // }).then(res => {
  //     if (res.data.num === '1')
  //         ok = false;
  // });
  // if (!ok) return res.status(202).send({
  //     message: "用户名中存在敏感词"
  // });
  db.query("SELECT uid FROM userInfo WHERE name=?", [name], (err, data) => {
    if (err) return res.status(202).send({
      message: err
    });
    if (data.length) return res.status(202).send({
      message: "此用户名已被注册"
    });
    else {
      const time = new Date();
      const password = bcrypt.hashSync(pwd, 12);
      db.query("INSERT INTO userInfo(name,pwd,reg_time,email) values (?,?,?,?)", [name, password, time, email], (err, data) => {
        if (err) return res.status(202).send({
          message: err
        });
        if (data.affectedRows > 0) {
          req.session.verifyCode = null;
          return res.status(200).send({
            message: 'success'
          });
        } else {
          return res.status(202).send({
            message: "sql error"
          });
        }
      });
    }
  })
}

exports.login = async (req, res) => {
  const name = req.body.name;
  const pwd = req.body.pwd;

  if (!name || !pwd) {
    return res.status(202).send({
      message: "请确认信息完善"
    });
  }
  db.query("SELECT * FROM userInfo WHERE name=?", [name], (err, data) => {
    if (!data.length) return res.status(202).send({
      message: "请先注册后再登录"
    });
    if (err) return res.status(202).send({
      message: err
    });
    const uid = data[0].uid, password = data[0].pwd, inUse = data[0].inUse;
    if (!inUse) {
      recordEvent(req, 'user.loginFail.userBlocked', null, uid);
      return res.status(202).send({
        message: '你号没了'
      });
    }
    if (bcrypt.compareSync(pwd, password)) {
      req.session.uid = uid;
      req.session.name = data[0].name;
      req.session.email = data[0].email;
      req.session.gid = data[0].gid;
      recordEvent(req, 'user.login');
      db.query("UPDATE userInfo SET login_time=? WHERE uid=?", [new Date(), uid]);
      db.query("INSERT INTO userSession(uid,token,browser,os,loginIp,loginLoc,time,lastact) values (?,?,?,?,?,?,?,?)",
        [uid, req.sessionID, `${req.useragent.browser.name} ${req.useragent.browser.version}`, `${req.useragent.os.name} ${req.useragent.os.version}`, req.session.ip, ip2loc(req.session.ip), new Date(), new Date()]);
      return res.status(200).send({ message: 'success' })
    } else {
      recordEvent(req, 'user.loginFail.wrongPassword', null, uid);
      return res.status(202).send({ message: "密码错误" })
    }
  });
}

exports.getUserInfo = (req, res) => {
  if (req.session.uid) return res.status(200).send({
    uid: req.session.uid,
    name: req.session.name,
    email: req.session.email,
    ip: req.session.ip,
    gid: req.session.gid,
  });
  else return res.status(202).send({ message: "请先登录" });
}

exports.logout = (req, res) => {
  recordEvent(req, 'user.logout');
  db.query("UPDATE userSession SET time=? WHERE token=?", [new Date(0), req.sessionID]);
  req.session.destroy();
  return res.status(200).send({ message: "success" });
}

exports.sendEmailVerifyCode = async (req, res) => {
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
      message: "请先进行人机验证"
    })
  }
  const emailExp = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/;
  if (!emailExp.test(email)) {
    return res.status(202).send({
      message: "请检查邮箱是否合法"
    })
  }
  let verifyCode = "";
  const mp = 'abcdefghijklmnpqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ1234567890';
  for (let i = 0; i < 6; i++) verifyCode += mp.charAt(Math.floor(Math.random() * 60));

  const tim = new Date();
  req.session.verifyCode = {
    code: verifyCode,
    expire: tim.getTime() + 3 * 60 * 1000,
    email: email
  }

  let transporter = mail.createTransport({
    host: 'smtp.163.com',
    port: 465,
    secureConnection: true,
    auth: {
      user: config.EMAIL.username,
      pass: config.EMAIL.password
    }
  })

  let mailOptions = {
    from: 'nywojservice@163.com',
    to: email,
    subject: 'nywOJ绑定邮箱验证码',
    text: "你正在nywOJ进行绑定邮箱操作,验证码为 " + verifyCode + "\n该验证码3分钟内有效。"
  }

  if (req.body.update) {
    mailOptions.subject = 'nywOJ修改邮箱验证码';
    mailOptions.text = "你正在nywOJ进行修改邮箱操作(用户名: " + req.session.name + "), 验证码为 " + verifyCode + "\n该验证码3分钟内有效。"
  }

  transporter.sendMail(mailOptions, (err) => {
    if (!err) {
      return res.status(200).send({ message: "success" });
    } else {
      return res.status(202).send({ message: err });
    }
  })
}

exports.setUserEmail = async (req, res) => {
  const userCode = req.body.code;
  if (!req.session.verifyCode || !userCode) {
    return res.status(202).send({ message: "请确认信息完善且操作正确" });
  }
  const verifycode = req.session.verifyCode.code;
  const expire = req.session.verifyCode.expire;
  if (userCode !== verifycode) {
    return res.status(202).send({ message: "验证码错误" });
  }
  const time = new Date().getTime();
  if (time > expire) {
    return res.status(202).send({ message: "验证码超时" });
  }
  db.query("SELECT email FROM userInfo WHERE email=?", [req.session.verifyCode.email], (err, data) => {
    if (err) return res.status(202).send({
      message: err
    });
    if (data.length) return res.status(202).send({
      message: "此邮箱已绑定过其他账号"
    });
    else {
      if (req.body.update) {
        db.query("SELECT email FROM userInfo WHERE uid=?", [req.session.uid], (err2, data2) => {
          if (err2) {
            return res.status(202).send({ message: err2 });
          }
          const detail = {};
          detail.email = {
            'old': data2[0].email,
            'new': req.session.verifyCode.email,
          }
          db.query("UPDATE userInfo SET email=? WHERE uid=?",
            [req.session.verifyCode.email, req.session.uid], (err3, data3) => {
              if (err3) return res.status(202).send({
                message: err3
              });
              req.session.email = req.session.verifyCode.email;
              revokeAllSessions(req.session.uid, req.sessionID);
              recordEvent(req, 'auth.changeEmail', detail);
              req.session.verifyCode = null;
              return res.status(200).send({ message: "更新邮箱成功" });
            });
        })
      }
      else {
        req.session.verifiedEmail = {
          email: req.session.verifyCode.email,
          expire: new Date().getTime() + 10 * 60 * 1000,
        }
        req.session.verifyCode = null;
        return res.status(200).send({ message: "验证成功,请在10分钟内完成注册操作" });
      }
    }
  })
}

exports.getUserPublicInfo = (req, res) => {
  const uid = req.body.uid;
  db.query("SELECT uid,name,email,reg_time,login_time,clickCnt,inUse,gid,motto,qq FROM userInfo WHERE uid=?", [uid], (err, data) => {
    if (err) {
      return res.status(202).send({ message: err });
    }
    if (!data.length) {
      return res.status(202).send({ message: '无此用户' });
    }
    if (data[0].reg_time)
      data[0].reg_time = briefFormat(data[0].reg_time);
    if (data[0].login_time)
      data[0].login_time = briefFormat(data[0].login_time);
    if (req.session.gid !== 3 && req.session.uid !== data[0].uid) {
      delete data[0].login_time;
      delete data[0].email;
    }
    return res.status(200).send({ info: data[0] });
  });
}

exports.setUserMotto = async (req, res) => {
  const motto = req.body.data;
  if (motto.length > 1000) {
    return res.status(202).send({ message: "个人主页长度应在1000以内" });
  }
  db.query("UPDATE userInfo SET motto=? WHERE uid=?", [motto, req.session.uid], (err, data) => {
    if (err) {
      return res.status(202).send({ message: err });
    }
    return res.status(200).send({ message: 'success' });
  });
}

exports.listSessions = (req, res) => {
  db.query("SELECT * FROM userSession WHERE uid=? AND TIMESTAMPDIFF(SECOND,lastact,NOW()) < ? AND time != ? ORDER BY lastact DESC", [req.session.uid, config.SESSION.expire / 1000, new Date(0)], (err, data) => {
    if (err) {
      return res.status(202).send({ message: err });
    }
    const now = new Date().getTime();
    for (let i = 0; i < data.length; i++) {
      delete data[i].id;
      if (data[i].token === req.sessionID)
        data[i].lastact = '当前会话';
      else data[i].lastact = msFormat(now - new Date(data[i].lastact).getTime());
      data[i].time = Format(data[i].time);
    }
    return res.status(200).send({ data: data });
  })
}

exports.revokeSession = (req, res) => {
  if (req.body.revokeAll) {
    revokeAllSessions(req.session.uid, req.sessionID);
    recordEvent(req, 'auth.revokeAllSessions');
    return res.status(200).send({ message: "ok" });
  }
  const token = req.body.token;
  db.query("SELECT * FROM userSession WHERE uid=? AND token=?", [req.session.uid, token], (err, data) => {
    if (err) {
      return res.status(202).send({ message: err });
    }
    if (!data.length) {
      return res.status(202).send({ message: '无效token' });
    }
    recordEvent(req, 'auth.revokeSession');
    db.query("UPDATE sessions SET expires=? WHERE session_id=?", [0, token]);
    db.query("UPDATE userSession SET time=? WHERE uid=? AND token=?", [new Date(0), req.session.uid, token]);
    return res.status(200).send({ message: "ok" });
  })
}

const revokeAllSessions = async (uid, curToken) => {
  db.query("SELECT * FROM userSession WHERE uid=? AND TIMESTAMPDIFF(SECOND,time,NOW()) < ?", [uid, config.SESSION.expire / 1000], (err, data) => {
    if (err) {
      console.log(err);
      return;
    }
    let sessionList = [];
    for (i in data) {
      if (data[i].token !== curToken)
        sessionList.push(data[i].token);
    }
    db.query("UPDATE sessions SET expires=? WHERE session_id in(?)", [0, sessionList], (err, data) => {
      if (err)
        console.log(err);
    });
    db.query("UPDATE userSession SET time=? WHERE token in(?)", [new Date(0), sessionList], (err, data) => {
      if (err)
        console.log(err);
    });
  })
  return;
}

exports.updateUserPublicInfo = (req, res) => {
  const info = req.body.userInfo;
  db.query("SELECT * FROM userInfo WHERE uid=?", [req.session.uid], (err, data) => {
    if (err) {
      return res.status(202).send({ message: err });
    }
    db.query("UPDATE userInfo SET qq=?,motto=? WHERE uid=?", [info.qq, info.motto, req.session.uid], (err2, data2) => {
      if (err2) {
        return res.status(202).send({ message: err2 });
      }
      const detail = {};
      if (data[0].qq !== info.qq)
        detail.qq = {
          'old': data[0].qq,
          'new': info.qq,
        }
      if (data[0].motto !== info.motto)
        detail.motto = {
          'old': data[0].motto,
          'new': info.motto,
        }
      recordEvent(req, 'user.updateProfile', detail)
      return res.status(200).send({ message: "ok" });
    });
  })
}

exports.listAudits = (req, res) => {
  const pageId = req.body.pageId, pageSize = 10;
  db.query("SELECT * FROM userAudit WHERE uid=? ORDER BY id DESC LIMIT ?,?",
    [req.session.uid, (pageId - 1) * pageSize, pageSize], (err, data) => {
      if (err) {
        return res.status(202).send({ message: err });
      }
      for (let i = 0; i < data.length; i++) {
        delete data[i].id;
        data[i].eventExp = eventExp[data[i].event];
        data[i].event = eventList[data[i].event];
        data[i].time = Format(data[i].time);
      }
      db.query("SELECT COUNT(*) as cnt FROM userAudit WHERE uid=?", [req.session.uid], (err2, data2) => {
        if (err2) {
          return res.status(202).send({ message: err2 });
        }
        return res.status(200).send({ data: data, total: data2[0].cnt });
      })
    })
}

exports.modifyPassword = (req, res) => {
  const newPwd = req.body.newPwd;
  if (newPwd.new !== newPwd.rep) {
    return res.status(202).send({ message: "两次密码不一致" });
  }
  if (newPwd.new.length > 31 || newPwd.new.length < 6) {
    return res.status(202).send({
      message: "密码长度应在6~31之间"
    })
  }
  db.query("SELECT pwd FROM userInfo WHERE uid=?", [req.session.uid], (err, data) => {
    if (err) {
      return res.status(202).send({ message: err });
    }
    if (bcrypt.compareSync(newPwd.old, data[0].pwd)) {
      const updPwd = bcrypt.hashSync(newPwd.new, 12);
      db.query('UPDATE userInfo SET pwd=? WHERE uid=?', [updPwd, req.session.uid], (err2, data2) => {
        if (err2) {
          return res.status(202).send({ message: err2 });
        }
        recordEvent(req, 'auth.changePassword');
        revokeAllSessions(req.session.uid, req.sessionID);
        return res.status(200).send({ message: "ok" });
      })
    } else {
      return res.status(202).send({ message: "旧密码错误" });
    }
  });
}