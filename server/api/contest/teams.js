const crypto = require('crypto');
const db = require('../../db');
const { handler, fail, ok } = require('../../db/util');
const { Format } = require('../../static');
const { ensureContestV2Schema } = require('./schema');
const { getContest } = require('./store');
const { canManageContest, contestStatus } = require('./policy');
const { resolveConfig } = require('./formats');
const { invalidateStandings } = require('./standings');

// ============================================================================
// 组队参赛（全赛制）。队伍是比赛级实体：contestTeam + contestTeamMember，
// 队员同时写入 contestPlayer（带 teamId），因此提交/报名/鉴权全部复用个人路径，
// 只有榜单在 standings 层按 participantKey='t<teamId>' 聚合。
//
// 报名流程（team.enabled 且 allowSelfForm）：
//   队长 createTeam → 得邀请码 → 队员 joinTeam(邀请码)。管理员可直接建队/编队。
// ============================================================================

const genInviteCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const teamConfig = (contest) => {
  const cfg = resolveConfig(contest);
  return cfg.team || { enabled: false, maxSize: 3, allowSelfForm: true };
};

const teamMembers = (teamId) =>
  db.query(
    `SELECT m.uid,m.isCaptain,u.name FROM contestTeamMember m
      INNER JOIN userInfo u ON u.uid=m.uid WHERE m.teamId=? ORDER BY m.isCaptain DESC,m.uid`,
    [teamId]
  );

const teamOfUser = async (cid, uid) => {
  const player = await db.one('SELECT teamId FROM contestPlayer WHERE cid=? AND uid=? LIMIT 1', [cid, uid]);
  if (!player || !player.teamId) return null;
  const team = await db.one('SELECT teamId,name,inviteCode FROM contestTeam WHERE teamId=? LIMIT 1', [player.teamId]);
  if (!team) return null;
  team.members = await teamMembers(team.teamId);
  return team;
};
exports.teamOfUser = teamOfUser;

const resolveRequestedUsers = async (body) => {
  const users = [];
  if (Array.isArray(body.memberUids)) {
    for (const raw of body.memberUids) {
      const uid = Number(raw);
      if (!Number.isInteger(uid) || uid <= 0) return { error: `非法用户 ID：${raw}` };
      const u = await db.one('SELECT uid,name FROM userInfo WHERE uid=? LIMIT 1', [uid]);
      if (!u) return { error: `无此用户：${uid}` };
      users.push(u);
    }
  } else {
    const memberNames = Array.isArray(body.members) ? body.members : [];
    for (const n of memberNames) {
      const username = String(n).trim();
      const u = await db.one('SELECT uid,name FROM userInfo WHERE name=? LIMIT 1', [username]);
      if (!u) return { error: `无此用户：${username}` };
      users.push(u);
    }
  }
  if (new Set(users.map((u) => Number(u.uid))).size !== users.length) return { error: '成员重复' };
  return { users };
};

// ---- 选手侧 ----

exports.createTeam = handler(async (req, res) => {
  await ensureContestV2Schema();
  const { cid } = req.body;
  const name = String(req.body.name || '').trim();
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const cfg = teamConfig(contest);
  if (!cfg.enabled) return fail(res, '本场比赛未开启组队');
  if (!cfg.allowSelfForm) return fail(res, '本场比赛不允许自由组队，请联系管理员建队');
  if (contestStatus(contest) >= 2) return fail(res, '比赛已截止，无法组队');
  if (!contest.isPublic) return fail(res, '私有比赛请联系管理员');
  if (!name || name.length > 40) return fail(res, '队名需为 1-40 字符');

  const uid = req.session.uid;
  const existing = await db.exists('SELECT 1 FROM contestPlayer WHERE cid=? AND uid=?', [cid, uid]);
  if (existing) return fail(res, '你已在本场比赛中（或已在某队）');
  const dupName = await db.exists('SELECT 1 FROM contestTeam WHERE cid=? AND name=?', [cid, name]);
  if (dupName) return fail(res, '队名已被占用');

  const inviteCode = genInviteCode();
  const teamId = await db.tx(async (tx) => {
    const r = await tx.query(
      'INSERT INTO contestTeam(cid,name,inviteCode,createTime) VALUES (?,?,?,?)',
      [cid, name, inviteCode, new Date()]
    );
    const tid = r.insertId;
    await tx.query('INSERT INTO contestTeamMember(teamId,uid,isCaptain) VALUES (?,?,1)', [tid, uid]);
    await tx.query('INSERT INTO contestPlayer(cid,uid,teamId) VALUES (?,?,?)', [cid, uid, tid]);
    return tid;
  });
  invalidateStandings(cid);
  return ok(res, { teamId, inviteCode });
});

exports.joinTeam = handler(async (req, res) => {
  await ensureContestV2Schema();
  const { cid } = req.body;
  const inviteCode = String(req.body.inviteCode || '').trim().toUpperCase();
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const cfg = teamConfig(contest);
  if (!cfg.enabled) return fail(res, '本场比赛未开启组队');
  if (!cfg.allowSelfForm) return fail(res, '本场比赛不允许自由组队，请联系管理员入队');
  if (contestStatus(contest) >= 2) return fail(res, '比赛已截止，无法加入队伍');

  const uid = req.session.uid;
  const existing = await db.exists('SELECT 1 FROM contestPlayer WHERE cid=? AND uid=?', [cid, uid]);
  if (existing) return fail(res, '你已在本场比赛中');
  const team = await db.one('SELECT teamId,name FROM contestTeam WHERE cid=? AND inviteCode=? LIMIT 1', [cid, inviteCode]);
  if (!team) return fail(res, '邀请码无效');
  const count = await db.one('SELECT COUNT(*) AS cnt FROM contestTeamMember WHERE teamId=?', [team.teamId]);
  if (Number(count.cnt) >= cfg.maxSize) return fail(res, `队伍已满（上限 ${cfg.maxSize} 人）`);

  await db.tx(async (tx) => {
    await tx.query('INSERT INTO contestTeamMember(teamId,uid,isCaptain) VALUES (?,?,0)', [team.teamId, uid]);
    await tx.query('INSERT INTO contestPlayer(cid,uid,teamId) VALUES (?,?,?)', [cid, uid, team.teamId]);
  });
  invalidateStandings(cid);
  return ok(res, { teamId: team.teamId, name: team.name });
});

exports.leaveTeam = handler(async (req, res) => {
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const cfg = teamConfig(contest);
  if (!cfg.allowSelfForm) return fail(res, '本场比赛由管理员统一组队，无法自行退队');
  if (contestStatus(contest) >= 2) return fail(res, '比赛已截止，无法退队');
  const uid = req.session.uid;
  const player = await db.one('SELECT teamId FROM contestPlayer WHERE cid=? AND uid=?', [cid, uid]);
  if (!player || !player.teamId) return fail(res, '你不在任何队伍中');
  const teamId = player.teamId;

  const members = await teamMembers(teamId);
  const me = members.find((m) => Number(m.uid) === Number(uid));
  await db.tx(async (tx) => {
    await tx.query('DELETE FROM contestTeamMember WHERE teamId=? AND uid=?', [teamId, uid]);
    await tx.query('DELETE FROM contestPlayer WHERE cid=? AND uid=?', [cid, uid]);
    const rest = members.filter((m) => Number(m.uid) !== Number(uid));
    if (!rest.length) {
      // 最后一人离开 → 解散队伍
      await tx.query('DELETE FROM contestTeam WHERE teamId=?', [teamId]);
    } else if (me && me.isCaptain) {
      // 队长离开 → 移交给资历最老的成员
      await tx.query('UPDATE contestTeamMember SET isCaptain=1 WHERE teamId=? AND uid=?', [teamId, rest[0].uid]);
    }
  });
  invalidateStandings(cid);
  return ok(res);
});

exports.getMyTeam = handler(async (req, res) => {
  await ensureContestV2Schema();
  const { cid } = req.body;
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const cfg = teamConfig(contest);
  const team = await teamOfUser(cid, req.session.uid);
  return ok(res, {
    teamMode: !!cfg.enabled,
    maxSize: cfg.maxSize,
    allowSelfForm: cfg.allowSelfForm,
    team: team ? {
      teamId: team.teamId,
      name: team.name,
      inviteCode: team.inviteCode,
      members: team.members,
      isCaptain: team.members.some((m) => Number(m.uid) === Number(req.session.uid) && m.isCaptain),
    } : null,
  });
});

// ---- 管理员侧 ----

exports.getTeamList = handler(async (req, res) => {
  const { cid } = req.body;
  const allowed = await canManageContest(req, cid);
  if (allowed === null) return fail(res, '无此比赛');
  if (!allowed) return res.status(403).end('403 Forbidden');
  const teams = await db.query(
    'SELECT teamId,name,inviteCode,createTime FROM contestTeam WHERE cid=? ORDER BY teamId',
    [cid]
  );
  for (const t of teams) {
    t.members = await teamMembers(t.teamId);
    t.createTime = Format(t.createTime);
  }
  return ok(res, { data: teams });
});

exports.adminCreateTeam = handler(async (req, res) => {
  await ensureContestV2Schema();
  const { cid } = req.body;
  const name = String(req.body.name || '').trim();
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const cfg = teamConfig(contest);
  const allowed = await canManageContest(req, cid);
  if (allowed === null) return fail(res, '无此比赛');
  if (!allowed) return res.status(403).end('403 Forbidden');
  if (!name || name.length > 40) return fail(res, '队名需为 1-40 字符');
  const dup = await db.exists('SELECT 1 FROM contestTeam WHERE cid=? AND name=?', [cid, name]);
  if (dup) return fail(res, '队名已被占用');

  const resolved = await resolveRequestedUsers(req.body);
  if (resolved.error) return fail(res, resolved.error);
  const users = resolved.users;
  for (const u of users) {
    const player = await db.one('SELECT teamId FROM contestPlayer WHERE cid=? AND uid=? LIMIT 1', [cid, u.uid]);
    if (player && player.teamId) return fail(res, `用户 ${u.name} 已在其他队伍中`);
  }
  if (cfg.enabled && users.length > Number(cfg.maxSize)) return fail(res, `队伍已超过人数上限（${cfg.maxSize} 人）`);

  const inviteCode = genInviteCode();
  const teamId = await db.tx(async (tx) => {
    const r = await tx.query('INSERT INTO contestTeam(cid,name,inviteCode,createTime) VALUES (?,?,?,?)',
      [cid, name, inviteCode, new Date()]);
    const tid = r.insertId;
    for (let i = 0; i < users.length; i++) {
      await tx.query('INSERT INTO contestTeamMember(teamId,uid,isCaptain) VALUES (?,?,?)', [tid, users[i].uid, i === 0 ? 1 : 0]);
      const updated = await tx.query('UPDATE contestPlayer SET teamId=? WHERE cid=? AND uid=?', [tid, cid, users[i].uid]);
      if (!updated.affectedRows) {
        await tx.query('INSERT INTO contestPlayer(cid,uid,teamId) VALUES (?,?,?)', [cid, users[i].uid, tid]);
      }
    }
    return tid;
  });
  invalidateStandings(cid);
  return ok(res, { teamId, inviteCode });
});

exports.adminUpdateTeam = handler(async (req, res) => {
  await ensureContestV2Schema();
  const { cid, teamId } = req.body;
  const name = String(req.body.name || '').trim();
  const contest = await getContest(cid);
  if (!contest) return fail(res, '无此比赛');
  const cfg = teamConfig(contest);
  const allowed = await canManageContest(req, cid);
  if (allowed === null) return fail(res, '无此比赛');
  if (!allowed) return res.status(403).end('403 Forbidden');
  const team = await db.one('SELECT teamId FROM contestTeam WHERE teamId=? AND cid=?', [teamId, cid]);
  if (!team) return fail(res, '无此队伍');
  if (!name || name.length > 40) return fail(res, '队名需为 1-40 字符');
  const dup = await db.exists('SELECT 1 FROM contestTeam WHERE cid=? AND name=? AND teamId<>?', [cid, name, teamId]);
  if (dup) return fail(res, '队名已被占用');

  const resolved = await resolveRequestedUsers(req.body);
  if (resolved.error) return fail(res, resolved.error);
  const users = resolved.users;
  for (const u of users) {
    const player = await db.one('SELECT teamId FROM contestPlayer WHERE cid=? AND uid=? LIMIT 1', [cid, u.uid]);
    if (player && player.teamId && Number(player.teamId) !== Number(teamId)) return fail(res, `用户 ${u.name} 已在其他队伍中`);
  }
  if (cfg.enabled && users.length > Number(cfg.maxSize)) return fail(res, `队伍已超过人数上限（${cfg.maxSize} 人）`);

  await db.tx(async (tx) => {
    await tx.query('UPDATE contestTeam SET name=? WHERE teamId=? AND cid=?', [name, teamId, cid]);
    await tx.query('DELETE FROM contestTeamMember WHERE teamId=?', [teamId]);
    await tx.query('DELETE FROM contestPlayer WHERE cid=? AND teamId=?', [cid, teamId]);
    for (let i = 0; i < users.length; i++) {
      await tx.query('INSERT INTO contestTeamMember(teamId,uid,isCaptain) VALUES (?,?,?)', [teamId, users[i].uid, i === 0 ? 1 : 0]);
      const updated = await tx.query('UPDATE contestPlayer SET teamId=? WHERE cid=? AND uid=?', [teamId, cid, users[i].uid]);
      if (!updated.affectedRows) {
        await tx.query('INSERT INTO contestPlayer(cid,uid,teamId) VALUES (?,?,?)', [cid, users[i].uid, teamId]);
      }
    }
  });
  invalidateStandings(cid);
  return ok(res);
});

exports.adminRemoveTeam = handler(async (req, res) => {
  const { cid, teamId } = req.body;
  const allowed = await canManageContest(req, cid);
  if (allowed === null) return fail(res, '无此比赛');
  if (!allowed) return res.status(403).end('403 Forbidden');
  const team = await db.one('SELECT teamId FROM contestTeam WHERE teamId=? AND cid=?', [teamId, cid]);
  if (!team) return fail(res, '无此队伍');
  await db.tx(async (tx) => {
    await tx.query('DELETE FROM contestPlayer WHERE cid=? AND teamId=?', [cid, teamId]);
    await tx.query('DELETE FROM contestTeamMember WHERE teamId=?', [teamId]);
    await tx.query('DELETE FROM contestTeam WHERE teamId=?', [teamId]);
  });
  invalidateStandings(cid);
  return ok(res);
});
