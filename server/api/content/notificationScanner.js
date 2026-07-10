// 定时扫描生成通知（开赛提醒 / 作业截止提醒），每 60s 一轮。
// 全部经 dedupeKey 幂等，重复扫描不会重复发。绝不抛错影响进程。
const db = require('../../db');
const { push } = require('./notification');

const SCAN_INTERVAL_MS = 60 * 1000;

// 报名者：contestPlayer 里该 cid 的全部 uid（组队场成员同样在其中）
const enrolledUids = async (cid) => {
  const rows = await db.query('SELECT DISTINCT uid FROM contestPlayer WHERE cid=?', [cid]);
  return rows.map((r) => r.uid);
};

// 开赛提醒：start 落在 [now, now+30min] 且未结束的比赛，对报名者发一次。
const scanContestReminders = async () => {
  const rows = await db.query(
    `SELECT cid,title,start FROM contest
      WHERE done=0 AND start > NOW() AND start <= DATE_ADD(NOW(), INTERVAL 30 MINUTE)`
  );
  for (const c of rows) {
    const uids = await enrolledUids(c.cid);
    if (!uids.length) continue;
    await push(uids, {
      type: 'contest_start', refType: 'contest', refId: c.cid,
      dedupeKey: `contest_start:${c.cid}`,
      title: `比赛「${c.title}」即将开始`,
      content: '比赛将在 30 分钟内开始，做好准备。',
      link: `/contest/${c.cid}`,
    });
  }
};

// 作业截止提醒：homework 且 deadline(start+length 分钟) 在未来 24h 内，对报名者发一次。
const scanHomeworkDue = async () => {
  const rows = await db.query(
    `SELECT cid,title FROM contest
      WHERE done=0 AND format='homework'
        AND DATE_ADD(start, INTERVAL length MINUTE) > NOW()
        AND DATE_ADD(start, INTERVAL length MINUTE) <= DATE_ADD(NOW(), INTERVAL 24 HOUR)`
  );
  for (const c of rows) {
    const uids = await enrolledUids(c.cid);
    if (!uids.length) continue;
    await push(uids, {
      type: 'homework_due', refType: 'contest', refId: c.cid,
      dedupeKey: `homework_due:${c.cid}`,
      title: `作业「${c.title}」即将截止`,
      content: '作业将在 24 小时内截止，注意按时提交。',
      link: `/homework/${c.cid}`,
    });
  }
};

// 清理 90 天前已读通知，防表膨胀。
const pruneOld = async () => {
  await db.query('DELETE FROM notification WHERE isRead=1 AND createdAt < DATE_SUB(NOW(), INTERVAL 90 DAY)');
};

const tick = async () => {
  try { await scanContestReminders(); } catch (e) { console.log('reminder scan(contest) error:', e && e.message); }
  try { await scanHomeworkDue(); } catch (e) { console.log('reminder scan(homework) error:', e && e.message); }
  try { await pruneOld(); } catch (e) { /* best effort */ }
};

let timer = null;
const start = () => {
  if (timer) return;
  timer = setInterval(tick, SCAN_INTERVAL_MS);
  if (timer.unref) timer.unref();
  setTimeout(tick, 5000); // 启动后 5s 先跑一轮
};

module.exports = { start, tick, scanContestReminders, scanHomeworkDue };
