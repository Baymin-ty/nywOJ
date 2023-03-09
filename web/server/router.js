const express = require('express');
const router = express.Router();

const rabbit = require('./api/rabbit');

router.post('/api/rabbit/all', rabbit.all);
router.post('/api/rabbit/add', rabbit.add);
router.post('/api/rabbit/getClickCnt', rabbit.getClickCnt);
router.post('/api/rabbit/getRankInfo', rabbit.getRankInfo);
router.post('/api/rabbit/getClickData', rabbit.getClickData);

const user = require('./api/user');

router.post('/api/user/login', user.login);
router.post('/api/user/reg', user.reg);
router.post('/api/user/logout', user.logout);
router.post('/api/user/sendEmailVerifyCode', user.sendEmailVerifyCode);
router.post('/api/user/setUserEmail', user.setUserEmail);
router.post('/api/user/getUserInfo', user.getUserInfo);
router.post('/api/user/getUserPublicInfo', user.getUserPublicInfo);
router.post('/api/user/setUserMotto', user.setUserMotto);

const admin = require('./api/admin');

router.post('/api/admin/getUserInfoList', admin.getUserInfoList);
router.post('/api/admin/setBlock', admin.setBlock);
router.post('/api/admin/updateUserInfo', admin.updateUserInfo);
router.post('/api/admin/addAnnouncement', admin.addAnnouncement);
router.post('/api/admin/updateAnnouncement', admin.updateAnnouncement);

const problem = require('./api/problem');

router.post('/api/problem/createProblem', problem.createProblem);
router.post('/api/problem/getProblemList', problem.getProblemList);
router.post('/api/problem/getProblemInfo', problem.getProblemInfo);
router.post('/api/problem/updateProblem', problem.updateProblem);

const judge = require('./api/judge');

router.post('/api/judge/submit', judge.submit);
router.post('/api/judge/getSubmissionList', judge.getSubmissionList);
router.post('/api/judge/getSubmissionInfo', judge.getSubmissionInfo);

const common = require('./api/common');

router.post('/api/common/getAnnouncementList', common.getAnnouncementList);
router.post('/api/common/getAnnouncementInfo', common.getAnnouncementInfo);

module.exports = router;
