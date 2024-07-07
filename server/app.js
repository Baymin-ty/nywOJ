const express = require('express')
const session = require('express-session')
const app = express()
const cors = require('cors')
const bodyParser = require('body-parser')
const router = require('./router')
const config = require('./config.json')
const MySQLStore = require('express-mysql-session')(session);
const { IpFilter } = require('express-ipfilter');
const options = {
  host: config.DB.host,
  port: config.DB.port,
  user: config.DB.username,
  password: config.DB.password,
  database: config.DB.databasename
};

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

const trustedProxies = ['127.0.0.1', '::1'];
app.set('trust proxy', trustedProxies);

const ipFilter = IpFilter(['0.0.0.0/0', '::/0'], { mode: 'allow', log: false });
app.use(ipFilter);
app.use((req, res, next) => {
  const ip = req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for'].split(',')[0] ||
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
  // if (!req.headers.referer || !req.headers.referer.match('^https:\/\/ty.szsyzx.cn\/')) {
  //     return res.status(403).end('403 Forbidden');
  // }
  req.useragent = parser(req.headers['user-agent']);
  if (req.session.uid) {
    db.query('UPDATE userSession SET lastact=? WHERE token=? AND uid=?', [new Date(), req.sessionID, req.session.uid]);
    if (req.url.match('^\/api\/admin') && req.session.gid !== 3)
      res.status(403).end('403 Forbidden');
    next();
  } else {
    req.session.gid = 1;
    if (req.url === '/api/user/login' ||
      req.url === '/api/user/reg' ||
      req.url === '/api/user/setUserEmail' ||
      req.url === '/api/user/sendEmailVerifyCode' ||
      req.url === '/api/user/getUserInfo' ||
      req.url === '/api/common/getAnnouncementList' ||
      req.url === '/api/rabbit/getRankInfo' ||
      req.url === '/api/rabbit/getClickData' ||
      // grant new access
      req.url === '/api/problem/getProblemList' ||
      req.url === '/api/rabbit/all' ||
      req.url === '/api/contest/getContestList' ||
      req.url === '/api/judge/getSubmissionList' ||
      req.url === '/api/common/getAnnouncementInfo'
    )
      next();
    else res.status(404).end('404 Not Found');
  }
});

app.use(bodyParser.json({ limit: "10mb" }));  //配置解析，用于解析json和urlencoded格式的数据
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors())              //配置跨域
app.use(router)              //配置路由

process.on('uncaughtException', (err) => {
  console.log(err)
});

app.listen(1234, () => {
  console.log('success!!!');
});

