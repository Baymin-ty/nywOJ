// Permission catalog & builtin roles.
// Edit here, restart server, and `syncPermissionCatalog()` will reconcile the DB.
// `scopable: true` means a permission can be granted with a (resource_type, resource_id) scope.

const PERMISSIONS = {
  'problem.create':       { group: 'problem', name: '创建题目', description: '创建新题目' },
  'problem.edit.any':     { group: 'problem', name: '编辑任意题目', description: '编辑非自己创建的题目', scopable: true },
  'problem.delete.any':   { group: 'problem', name: '删除任意题目', description: '删除非自己创建的题目', scopable: true },
  'problem.case.manage':  { group: 'problem', name: '管理题目数据', description: '上传/修改/下载测试数据', scopable: true },
  'problem.view.private': { group: 'problem', name: '查看非公开题目', description: '查看 isPublic=0 的题目' },

  'contest.create':                { group: 'contest', name: '创建比赛' },
  'contest.edit.any':              { group: 'contest', name: '编辑任意比赛', scopable: true },
  'contest.player.manage':         { group: 'contest', name: '管理比赛选手', scopable: true },
  'contest.submission.view.cross': { group: 'contest', name: '跨比赛查看提交' },

  'submission.view.any': { group: 'judge', name: '查看任意提交', description: '查看所有提交详情/代码' },
  'submission.rejudge':  { group: 'judge', name: '重测提交', scopable: true },

  'user.list':             { group: 'user', name: '查看用户列表' },
  'user.edit':             { group: 'user', name: '编辑用户资料' },
  'user.ban':              { group: 'user', name: '封禁/解封用户' },
  'user.role.assign':      { group: 'user', name: '分配角色' },
  'user.permission.grant': { group: 'user', name: '单点授权' },

  'announcement.manage': { group: 'system', name: '管理公告' },
  'paste.edit.any':      { group: 'system', name: '编辑他人 paste' },
  'audit.view':          { group: 'system', name: '查看审计日志' },
};

const PROBLEM_SETTER_PERMS = [
  'problem.create',
  'problem.edit.any',
  'problem.case.manage',
  'problem.view.private',
  'submission.view.any',
];

const CONTEST_MANAGER_PERMS = [
  'contest.create',
  'contest.edit.any',
  'contest.player.manage',
  'contest.submission.view.cross',
];

const JUDGE_ADMIN_PERMS = [
  'submission.view.any',
  'submission.rejudge',
];

const MODERATOR_PERMS = Array.from(new Set([
  ...PROBLEM_SETTER_PERMS,
  ...CONTEST_MANAGER_PERMS,
  ...JUDGE_ADMIN_PERMS,
]));

const SUPER_ADMIN_PERMS = Object.keys(PERMISSIONS);

const BUILTIN_ROLES = {
  user:            { name: '普通用户',     legacy_gid: 1, description: '默认角色，无额外权限', permissions: [] },
  problem_setter:  { name: '出题人',       legacy_gid: null, description: '可创建/编辑题目并管理数据', permissions: PROBLEM_SETTER_PERMS },
  contest_manager: { name: '比赛管理员',   legacy_gid: null, description: '可创建并管理比赛', permissions: CONTEST_MANAGER_PERMS },
  judge_admin:     { name: '判题管理员',   legacy_gid: null, description: '可重测并查看所有提交', permissions: JUDGE_ADMIN_PERMS },
  moderator:       { name: '管理员',       legacy_gid: 2, description: '出题/办赛/判题三合一（兼容 gid=2）', permissions: MODERATOR_PERMS },
  super_admin:     { name: '超级管理员',   legacy_gid: 3, description: '拥有全部权限（兼容 gid=3）', permissions: SUPER_ADMIN_PERMS },
};

const RESOURCE_TYPES = ['problem', 'contest'];

// Permissions that can be granted by a resource owner (via the resource collaborator UI),
// without needing the global `user.permission.grant` permission.
const RESOURCE_GRANTABLE = {
  problem: ['problem.edit.any', 'problem.case.manage', 'problem.delete.any'],
  contest: ['contest.edit.any', 'contest.player.manage', 'submission.rejudge'],
};

module.exports = {
  PERMISSIONS,
  BUILTIN_ROLES,
  RESOURCE_TYPES,
  RESOURCE_GRANTABLE,
};
