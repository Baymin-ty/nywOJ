const express = require('express');
const router = express.Router();
const multer = require("multer");
const fs = require('fs');
const { setFile } = require('./file');
const path = require('path');
const compressing = require('compressing');


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

const upload = multer({
  fileFilter: (req, file, cb) => {
    cb(null, (req.session.gid >= 2));
  },
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = "./data/" + req.body.pid;
      if (fs.existsSync(dir))
        fs.rmSync(dir, {
          recursive: true
        });
      fs.mkdirSync(dir, {
        recursive: true
      });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, 'data.zip');
    }
  })
});


const process = (str) => {
  let res = str;
  while (!(res[0] >= '0' && res[0] <= '9'))
    res = res.substring(1);
  return Number(res);
}

router.post('/api/problem/uploadData', upload.single('file'), (req, res) => {
  if (req.session.gid < 2) return res.status(403).end('403 Forbidden');

  compressing.zip.uncompress(req.file.path, req.file.destination).then(() => {
    fs.readdir(req.file.destination, async (err, file) => {
      if (err) return res.status(202).send({
        err: err
      });
      let cases = [];
      for (i in file) {
        if (file[i].substring(file[i].length - 3) === '.in') {
          const name = file[i].substring(0, file[i].length - 3);
          if (fs.existsSync(path.join(__dirname, `./data/${req.body.pid}/${name}.out`))) {
            cases.push({
              index: process(name),
              input: name + '.in',
              output: name + '.out',
            });
          }
        }
      }
      cases.sort((a, b) => {
        return a.index - b.index;
      });
      await setFile(`${req.file.destination}/config.json`, JSON.stringify({ cases: cases }));
    });
  });

  res.json({
    file: req.file
  })
})


const judge = require('./api/judge');

router.post('/api/judge/submit', judge.submit);
router.post('/api/judge/getSubmissionList', judge.getSubmissionList);
router.post('/api/judge/getSubmissionInfo', judge.getSubmissionInfo);
router.post('/api/judge/reJudge', judge.reJudge);
router.post('/api/judge/reJudgeProblem', judge.reJudgeProblem);

const common = require('./api/common');

router.post('/api/common/getAnnouncementList', common.getAnnouncementList);
router.post('/api/common/getAnnouncementInfo', common.getAnnouncementInfo);

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
