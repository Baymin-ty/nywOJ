const db = require('./db/index');

const fill = (x) => {
  x = x.toString();
  return x.length > 1 ? x : '0' + x;
}

exports.briefFormat = (now) => {
  return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate());
}

exports.Format = (now) => {
  return now.getFullYear() + '-' + fill(now.getMonth() + 1) + '-' + fill(now.getDate()) + ' ' + fill(now.getHours()) + ':' + fill(now.getMinutes()) + ':' + fill(now.getSeconds());
}

const IP2Region = require('ip2region').default;
const query = new IP2Region();
exports.ip2loc = (ip) => {
  const res = query.search(ip);
  for (const i in res) {
    if (res[i] === "0") res[i] = "";
  }
  if (res.country === "中国") res.country = "";
  else if (res.country) res.country += " ";
  if (res.province === res.city || `${res.province}市` === res.city) res.province = "";
  const cityResult = res.country + res.province + res.city;
  if (!cityResult) return null;
  if (res.isp && cityResult !== res.isp) return `${cityResult} ${res.isp}`;
  return cityResult;
}

exports.msFormat = (ms) => {
  let second = ms / 1000;
  if (second > 86400)  // > 1 day
    return `${Math.floor(second / 86400)} 天前`;
  else if (second > 3600)
    return `${Math.floor(second / 3600)} 小时前`;
  else if (second > 60)
    return `${Math.floor(second / 60)} 分钟前`;
  else
    return `${Math.floor(second)} 秒前`;
}

exports.kbFormat = (memory) => {
  if (memory >= 1024)
    memory = Math.round(memory / 1024 * 100) / 100 + ' MB';
  else memory += ' KB';
  return memory;
}

exports.bFormat = (memory) => {
  if (memory >= 1024 * 1024)
    memory = Math.round(memory / 1024 / 1024 * 100) / 100 + ' MB';
  else if (memory >= 1024)
    memory = Math.round(memory / 1024 * 100) / 100 + ' KB';
  else memory += ' B';
  return memory;
}

exports.eventList = [
  'user.login',
  'user.loginFail.wrongPassword',
  'user.loginFail.userBlocked',
  'user.logout',
  'user.updateProfile',
  'auth.changePassword',
  'auth.changeEmail',
  'auth.revokeSession',
  'auth.revokeAllSessions',
  'auth.sendEmailVerifyCode'
];

exports.eventExp = [
  '用户登录',
  '登录失败 - 密码错误',
  '登录失败 - 用户封禁',
  '退出登录',
  '更新个人信息',
  '修改密码',
  '修改邮箱',
  '下线会话',
  '下线除当前对话外所有对话',
  '发送邮箱验证码'
]


exports.recordEvent = (req, reason, detail, uid) => {
  const eventId = this.eventList.indexOf(reason);
  if (eventId === -1) {
    console.log('record Event error, unexpected reason: ' + reason);
    return;
  }
  db.query('INSERT INTO userAudit(uid,event,ip,iploc,time,browser,os,detail) values(?,?,?,?,?,?,?,?)', [
    req.session.uid || uid, eventId, req.session.ip, this.ip2loc(req.session.ip), new Date(),
    `${req.useragent.browser.name} ${req.useragent.browser.version}`, `${req.useragent.os.name} ${req.useragent.os.version}`, detail ? JSON.stringify(detail, null, 2) : null
  ], (err, data) => {
    if (err)
      console.log(err);
  });
}
