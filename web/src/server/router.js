const express = require('express');
const router = express.Router();

const rabbit = require('./api/rabbit');

router.get('/rabbit/all', rabbit.all);
router.get('/rabbit/add', rabbit.add);
router.get('/rabbit/getClickCnt', rabbit.getClickCnt);
router.get('/rabbit/getRankInfo', rabbit.getRankInfo);
router.get('/rabbit/getUserIp', rabbit.getUserIp);

const user = require('./api/user');

router.get('/user/login', user.login);
router.get('/user/reg', user.reg);
router.get('/user/getUserInfo', user.getUserInfo);

module.exports = router;
