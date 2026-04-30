const { Format, briefFormat, kbFormat } = require('../static');

const judgeRes = [
  'Waiting',
  'Pending',
  'Rejudging',
  'Compilation Error',
  'Accepted',
  'Wrong Answer',
  'Time Limit Exceeded',
  'Memory Limit Exceeded',
  'Runtime Error',
  'Segmentation Fault',
  'Output Limit Exceeded',
  'Dangerous System Call',
  'System Error',
  'Canceled',
  'Skipped',
];

const ptype = ['传统文本比较', 'Special Judge'];
const ctype = ['OI', 'IOI'];
const cstatus = ['未开始', '正在进行', '等待测评', '已结束'];

const formatSubmissionRow = (row) => {
  if (!row) return row;
  if (row.submitTime) row.submitTime = Format(row.submitTime);
  if (typeof row.judgeResult === 'number') row.judgeResult = judgeRes[row.judgeResult];
  if (typeof row.memory === 'number') row.memory = kbFormat(row.memory);
  return row;
};

const formatCaseRow = (row) => {
  if (!row) return row;
  if (typeof row.result === 'number') row.result = judgeRes[row.result];
  if (typeof row.memory === 'number') row.memory = kbFormat(row.memory);
  return row;
};

module.exports = {
  judgeRes,
  ptype,
  ctype,
  cstatus,
  formatSubmissionRow,
  formatCaseRow,
  Format,
  briefFormat,
  kbFormat,
};
