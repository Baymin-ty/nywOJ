const express = require('express')
const session = require('express-session')
const app = express()
const cors = require('cors')
const router = require('./router')
const config = require('./config.json')
const MySQLStore = require('express-mysql-session')(session);
const options = {
  host: config.DB.host,
  port: config.DB.port,
  user: config.DB.username,
  password: config.DB.password,
  database: config.DB.databasename
};

const refererCheck = require('./refererCheck');
const whiteList = ['localhost', 'https://ty.szsyzx.cn/', 'https://www.niyiwei.com'];
app.use(refererCheck(whiteList, { allowEmpty: true }));

const sessionStore = new MySQLStore(options);

app.use(session({
  store: sessionStore,
  secret: '114514-nywOJ-1919810',
  resave: true,
  saveUninitialized: true,
  cookie: { maxAge: parseInt(config.SESSION.expire) },
  name: 'token'
}));
const parser = require('ua-parser-js');
const db = require('./db/index');

app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    null;
  if (ip === null)
    res.status(403).end('403 Forbidden');
  else {
    req.session.ip = ip;
    next();
  }
});

app.use((req, res, next) => {
  req.useragent = parser(req.headers['user-agent']);
  if (req.session.uid) {
    db.query('UPDATE userSession SET lastact=? WHERE token=? AND uid=?', [new Date(), req.sessionID, req.session.uid]);
    if (req.url.match('^\/api\/admin') && req.session.gid !== 3)
      return res.status(403).end('403 Forbidden');
    next();
  } else {
    req.session.gid = 1;
    if (req.url === '/api/user/login' ||
      req.url === '/api/user/reg' ||
      req.url === '/api/user/setUserEmail' ||
      req.url === '/api/user/sendEmailVerifyCode' ||
      req.url === '/api/user/getUserInfo' ||
      req.url === '/api/common/getAnnouncementList' ||
      req.url === '/api/common/getHitokoto' ||
      req.url === '/api/rabbit/getRankInfo' ||
      req.url === '/api/rabbit/getClickData' ||
      // grant new access
      req.url === '/api/problem/getProblemList' ||
      req.url === '/api/rabbit/all' ||
      req.url === '/api/contest/getContestList' ||
      req.url === '/api/judge/getSubmissionList' ||
      req.url === '/api/common/getAnnouncementInfo' ||
      req.url === '/api/problem/getProblemTags' ||
      req.url === '/api/problem/getProblemPublishers' ||
      req.url === '/api/judge/receiveTask'
    )
      next();
    else return res.status(404).end('404 Not Found');
  }
});

app.use(express.json({ extended: true, limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors())              //配置跨域
app.use(router)              //配置路由

process.on('uncaughtException', (err) => {
  console.log(err)
});

app.listen(1234, () => {
  console.log('success!!!');
});

