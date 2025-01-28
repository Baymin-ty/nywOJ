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
router.post('/api/user/listSessions', user.listSessions);
router.post('/api/user/revokeSession', user.revokeSession);
router.post('/api/user/updateUserPublicInfo', user.updateUserPublicInfo);
router.post('/api/user/modifyPassword', user.modifyPassword);
router.post('/api/user/listAudits', user.listAudits);

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
router.post('/api/problem/getProblemCasePreview', problem.getProblemCasePreview);
router.post('/api/problem/clearCase', problem.clearCase);
router.post('/api/problem/updateSubtaskId', problem.updateSubtaskId);
router.post('/api/problem/getCase', problem.getCase);
router.post('/api/problem/updateCase', problem.updateCase);
router.get('/api/problem/downloadCase', problem.downloadCase);
router.post('/api/problem/getProblemTags', problem.getProblemTags);
router.post('/api/problem/getProblemPublishers', problem.getProblemPublishers);
router.post('/api/problem/getProblemStat', problem.getProblemStat);
router.post('/api/problem/getProblemFastestSubmission', problem.getProblemFastestSubmission);
router.post('/api/problem/getProblemSol', problem.getProblemSol);
router.post('/api/problem/bindPaste2Problem', problem.bindPaste2Problem);
router.post('/api/problem/unbindSol', problem.unbindSol);
router.post('/api/problem/getProblemAuth', problem.getProblemAuth);


const fileUpload = require('./api/fileUpload');
router.post('/api/problem/uploadData', fileUpload.caseUpload.single('file'), fileUpload.handleCaseUpload);

const judge = require('./api/judge');

router.post('/api/judge/submit', judge.submit);
router.post('/api/judge/getSubmissionList', judge.getSubmissionList);
router.post('/api/judge/getSubmissionInfo', judge.getSubmissionInfo);
router.post('/api/judge/reJudge', judge.reJudge);
router.post('/api/judge/reJudgeProblem', judge.reJudgeProblem);
router.post('/api/judge/reJudgeContest', judge.reJudgeContest);
router.post('/api/judge/cancelSubmission', judge.cancelSubmission);
router.post('/api/judge/receiveTask', judge.receiveTask);
router.post('/api/judge/getLangs', judge.getLangs);

const common = require('./api/common');

router.post('/api/common/getAnnouncementList', common.getAnnouncementList);
router.post('/api/common/getAnnouncementInfo', common.getAnnouncementInfo);
router.post('/api/common/addPaste', common.addPaste);
router.post('/api/common/getPaste', common.getPaste);
router.post('/api/common/updatePaste', common.updatePaste);
router.post('/api/common/delPaste', common.delPaste);
router.post('/api/common/getPasteList', common.getPasteList);
router.post('/api/common/getHitokoto', common.getHitokoto);

const contest = require('./api/contest');
router.post('/api/contest/createContest', contest.createContest);
router.post('/api/contest/getContestList', contest.getContestList);
router.post('/api/contest/getContestInfo', contest.getContestInfo);
router.post('/api/contest/updateContestInfo', contest.updateContestInfo);
router.post('/api/contest/getPlayerList', contest.getPlayerList);
router.post('/api/contest/addPlayer', contest.addPlayer);
router.post('/api/contest/removePlayer', contest.removePlayer);
router.post('/api/contest/contestReg', contest.contestReg);
router.post('/api/contest/closeContest', contest.closeContest);
router.post('/api/contest/updateProblemList', contest.updateProblemList);
router.post('/api/contest/getProblemList', contest.getProblemList);
router.post('/api/contest/getPlayerProblemList', contest.getPlayerProblemList);
router.post('/api/contest/getProblemInfo', contest.getProblemInfo);
router.post('/api/contest/submit', contest.submit);
router.post('/api/contest/getSubmissionList', contest.getSubmissionList);
router.post('/api/contest/getLastSubmissionList', contest.getLastSubmissionList);
router.post('/api/contest/getSubmissionInfo', contest.getSubmissionInfo);
router.post('/api/contest/getRank', contest.getRank);
router.post('/api/contest/getSingleUserLastSubmission', contest.getSingleUserLastSubmission);
router.post('/api/contest/getSingleUserProblemSubmission', contest.getSingleUserProblemSubmission);

module.exports = router;
