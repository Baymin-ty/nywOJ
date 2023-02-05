const express = require('express');
const router = express.Router();

const rabbit = require('./api/rabbit');

router.get('/api/rabbit/all', rabbit.all);
router.get('/api/rabbit/add', rabbit.add);
router.get('/api/rabbit/getClickCnt', rabbit.getClickCnt);
router.get('/api/rabbit/getRankInfo', rabbit.getRankInfo);
router.get('/api/rabbit/getUserIp', rabbit.getUserIp);

const user = require('./api/user');

router.get('/api/user/login', user.login);
router.get('/api/user/reg', user.reg);
router.get('/api/user/getUserInfo', user.getUserInfo);

module.exports = router;