const express = require('express');
const router = express.Router();

const rabbit = require('./api/rabbit');

router.get('/api/rabbit/all', rabbit.all);
router.get('/api/rabbit/add', rabbit.add);
router.get('/api/rabbit/getClickCnt', rabbit.getClickCnt);
router.get('/api/rabbit/getRankInfo', rabbit.getRankInfo);
router.get('/api/rabbit/getUserIp', rabbit.getUserIp);
router.get('/api/rabbit/getClickData', rabbit.getClickData);


const user = require('./api/user');

router.post('/api/user/login', user.login);
router.post('/api/user/reg', user.reg);
router.post('/api/user/logout', user.logout);
router.post('/api/user/sendEmailVertifyCode', user.sendEmailVertifyCode);
router.post('/api/user/setUserEmail', user.setUserEmail);
router.get('/api/user/getUserInfo', user.getUserInfo);

module.exports = router;
