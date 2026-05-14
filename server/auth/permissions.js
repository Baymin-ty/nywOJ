// Permission catalog & builtin roles.
// Edit here, restart server, and `syncPermissionCatalog()` will reconcile the DB.
// `scopable: true` means a permission can be granted with a (resource_type, resource_id) scope.

const PERMISSIONS = {
  'problem.create':       { group: 'problem', name: '创建题目', description: '创建新题目' },
  'problem.manage.any':   { group: 'problem', name: '管理任意题目', description: '编辑/删除/管理测试数据 任意题目', scopable: true },
  'problem.manage.self':  { group: 'problem', name: '管理自己的题目', description: '编辑/删除/管理自己创建题目的测试数据' },
  // problem.view.any is scopable: a manager can grant it on a single pid so
  // the grantee becomes a "view-only collaborator" who can read the problem,
  // its submission list, and submission details — but NOT manage it.
  // Granted globally (e.g. problem_setter role), it covers every problem.
  'problem.view.any':     { group: 'problem', name: '查看所有题目', description: '查看题目（含非公开）及其非比赛提交。可被全局或单题授予', scopable: true },
  'problem.solmanage':    { group: 'problem', name: '管理题解绑定', description: '绑定/解绑自己可查看题目的题解，不包含编辑他人 paste' },

  'contest.create':                { group: 'contest', name: '创建比赛' },
  'contest.manage.any':            { group: 'contest', name: '管理任意比赛', description: '编辑/管理选手/查看提交/重测提交 任意比赛', scopable: true },
  'contest.manage.self':           { group: 'contest', name: '管理自己的比赛', description: '编辑/管理选手/查看提交/重测提交 自己创建的比赛' },

  // Submission visibility:
  //   .any        — every submission (contest & non-contest)
  //   .notcontest — every non-contest submission
  // Contest-internal viewing is governed by contest.manage.* and contest
  // join/visibility rules — there is no longer a "cross-contest viewer"
  // permission separate from submission.view.any.
  'submission.view.any':        { group: 'judge', name: '查看任意提交', description: '查看所有提交详情/代码（含比赛与非比赛）' },
  'submission.view.notcontest': { group: 'judge', name: '查看非比赛提交', description: '查看所有非比赛提交详情/代码' },
  // Rejudge:
  //   .any  — rejudge any submission (contest & non-contest)
  //   .self — rejudge own non-contest submissions
  // Contest/problem managers automatically rejudge inside their scope; that is
  // resolved at runtime, not via a scopable submission.rejudge permission.
  'submission.rejudge.any':  { group: 'judge', name: '重测任意提交', description: '重测任意提交（含比赛与非比赛）' },
  'submission.rejudge.self': { group: 'judge', name: '重测自己的提交', description: '重测自己提交的非比赛代码' },

  // User admin:
  //   user.manage      — user list/edit/ban (merged from user.{list,edit,ban})
  //   user.role.admin  — role assign + direct grants (merged from
  //                      user.role.assign + user.permission.grant)
  'user.manage':     { group: 'user', name: '用户管理', description: '查看用户列表 / 编辑用户资料 / 封禁与解封用户' },
  'user.role.admin': { group: 'user', name: '角色与授权管理', description: '分配角色 / 单点授权（角色权限管理）' },

  'announcement.manage': { group: 'system', name: '管理公告' },
  'paste.edit.any':      { group: 'system', name: '编辑他人 paste' },
  'audit.view':          { group: 'system', name: '查看审计日志' },
};

const PROBLEM_SETTER_PERMS = [
  'problem.create',
  'problem.manage.self',
  'problem.view.any',
];

const CONTEST_MANAGER_PERMS = [
  'contest.create',
  'contest.manage.self',
];

const JUDGE_ADMIN_PERMS = [
  'submission.view.any',
  'submission.rejudge.any',
];

const SOLUTION_ADMIN_PERMS = [
  'problem.solmanage',
];

const MODERATOR_PERMS = Array.from(new Set([
  ...PROBLEM_SETTER_PERMS,
  ...CONTEST_MANAGER_PERMS,
  ...JUDGE_ADMIN_PERMS,
  'user.manage',
  'user.role.admin',
  // Moderators escalate to *.manage.any over every problem/contest
  // (the *_setter / *_manager roles only get manage.self).
  'problem.manage.any',
  'contest.manage.any',
]));

const SUPER_ADMIN_PERMS = Object.keys(PERMISSIONS);

const BUILTIN_ROLES = {
  user:            { name: '普通用户',     legacy_gid: 1, description: '默认角色，无额外权限', permissions: [] },
  problem_setter:  { name: '出题人',       legacy_gid: null, description: '可创建/编辑题目并管理数据', permissions: PROBLEM_SETTER_PERMS },
  contest_manager: { name: '比赛管理员',   legacy_gid: null, description: '可创建并管理比赛', permissions: CONTEST_MANAGER_PERMS },
  judge_admin:     { name: '判题管理员',   legacy_gid: null, description: '可重测并查看所有提交', permissions: JUDGE_ADMIN_PERMS },
  solution_admin:  { name: '题解管理员',   legacy_gid: null, description: '可管理自己可查看题目的题解绑定', permissions: SOLUTION_ADMIN_PERMS },
  moderator:       { name: '管理员',       legacy_gid: 2, description: '出题/办赛/判题三合一（兼容 gid=2）', permissions: MODERATOR_PERMS },
  super_admin:     { name: '超级管理员',   legacy_gid: 3, description: '拥有全部权限（兼容 gid=3）', permissions: SUPER_ADMIN_PERMS },
};

const RESOURCE_TYPES = ['problem', 'contest'];

// Permissions that can be granted by a resource owner (via the resource collaborator UI),
// without needing the global `user.permission.grant` permission.
// Permissions a resource OWNER may grant to collaborators on that resource
// (without holding the global user.permission.grant). The owner-as-grantor
// path also ignores collaborator-derived manage.any: a collaborator who got
// manage.any scoped to one problem/contest cannot then add or remove other
// collaborators — only the actual owner can. See canManageResourceCollab in
// api/auth.js for the runtime check.
// On problems, owners may add either a "manage" collaborator (problem.manage.any)
// or a "view" collaborator (problem.view.any). The view scope is read-only and
// also unlocks submission viewing for that pid; see problemAuth + the submission
// list/info handlers.
const RESOURCE_GRANTABLE = {
  problem: ['problem.manage.any', 'problem.view.any'],
  contest: ['contest.manage.any'],
};

module.exports = {
  PERMISSIONS,
  BUILTIN_ROLES,
  RESOURCE_TYPES,
  RESOURCE_GRANTABLE,
};
