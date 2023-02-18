const express = require('express')
const session = require('express-session')
const app = express()
const cors = require('cors')
const bodyParser = require('body-parser')
const router = require('./router')

app.use(session({
    secret: '114514-nywOJ-1919810',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 600000 },
    name: 'sessionId'
}));

app.use(bodyParser.json());  //配置解析，用于解析json和urlencoded格式的数据
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors())              //配置跨域
app.use(router)              //配置路由n

app.listen(1234, () => {
    console.log('success!!!');
});

