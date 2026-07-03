# 02 · 命名空间与文件系统隔离

代码：[`exec.rs`](../crates/sandbox-core/src/exec.rs)（unshare）· [`fsroot.rs`](../crates/sandbox-core/src/fsroot.rs)（rootfs/pivot_root）

## 六种命名空间

| 命名空间 | CLONE 标志 | 隔离了什么 | 本项目效果 |
|---|---|---|---|
| PID | `CLONE_NEWPID` | 进程号空间 | 被测程序是 PID 1，`ps` 只见自己 |
| Mount | `CLONE_NEWNS` | 挂载点/文件系统视图 | 配合 pivot_root 换根 |
| Network | `CLONE_NEWNET` | 网卡/路由/端口 | 只剩 loopback = 断网 |
| IPC | `CLONE_NEWIPC` | SysV/POSIX IPC | 独立消息队列/共享内存 |
| UTS | `CLONE_NEWUTS` | 主机名/域名 | `hostname` = sandbox |
| User | `CLONE_NEWUSER` | UID/GID 映射 | 勾选「user ns (rootless)」后开启，见下 |

### user namespace（rootless）—— 不靠宿主 root 也能造沙箱

勾选「user ns (rootless)」后，进程模型会变成"再 fork 一层"（见 [`exec.rs`](../crates/sandbox-core/src/exec.rs) 的 `child_userns`）：

1. child 先把自己**降权到宿主非特权 uid**（如 60000），再 `unshare(CLONE_NEWUSER | CLONE_NEWPID | …)`；
   此刻它在**新 user namespace 里拥有全部 capability**，但 uid 还没映射。
2. supervisor 从宿主侧写 `/proc/<pid>/uid_map = "0 60000 1"`、`gid_map = "0 60000 1"`
   （写 gid_map 前必须先 `setgroups=deny`）。于是：**沙箱内是 root(0)，宿主看只是普通用户 60000**。
3. child `fork` 出 grandchild 作为新 pidns 的 PID 1（pidns 归该 userns 所有，rootless 下才能挂私有 /proc），
   由它搭建 rootfs 并 `execve`。

这正是 Docker rootless、Podman、`unshare -Ur` 背后的机制：**用映射换取"沙箱内 root"，而不需要真正的宿主 root**。
验证：userns 模式跑 `printf("uid=%d", getuid())` 会打印 `0`（沙箱内 root），但它在宿主上其实是 60000。

> **踩坑记录**：某些内核（Docker Desktop 的 linuxkit 5.15）在 user namespace 内对 **tmpfs** 创建文件会回
> `EOVERFLOW`。本项目在 userns 模式下改用"对真实目录 bind-to-self 当新根"绕过（见 `fsroot.rs` 的 `use_tmpfs` 分支）。
> 在原生 Linux 上 tmpfs 路径也能正常工作。

### 为什么 NEWPID 要在 fork **之前** unshare？

`unshare(CLONE_NEWPID)` 不会把**调用者**移进新 PID 命名空间，而是让它**之后 fork 的孩子**
成为新命名空间的 PID 1。所以 supervisor 先 `unshare(NEWPID)` 再 `fork`，孩子才是 PID 1；
supervisor 自己留在宿主 PID ns，才能用宿主 pid 读 `/proc/<pid>`、写 `cgroup.procs`。

其余命名空间（NEWNS/NEWNET/NEWIPC/NEWUTS）可以由 child `unshare` 后立即对自己生效。

## 用 pivot_root 造最小根文件系统

只 `unshare(NEWNS)` 还看得到宿主文件系统，得**换根**。步骤（见 `fsroot::setup`）：

```
1. mount --make-rprivate /        # 挂载传播设私有，改动不外泄宿主
2. mount -t tmpfs … /newroot      # 新根（必须是挂载点，pivot_root 才接受）
3. bind /usr /bin /lib …（只读）   # 编译器/库可用但改不动
   bind 工作目录 → /newroot/box（读写）
   mount -t tmpfs … /tmp /dev/shm /dev   # 临时区 + 极简设备
4. pivot_root(/newroot, /newroot/.oldroot)   # 换根
5. mount -t proc proc /proc       # 新 /proc 反映新 PID ns
   umount2(/.oldroot, MNT_DETACH) # 卸掉旧根 → 彻底看不到宿主
```

`pivot_root` 要求：新根是挂载点、旧根放在新根之下、根不是 `MS_SHARED`（所以第 1 步设私有）。

## 隔离效果怎么验证

- **escape 演示**：读 `/etc/shadow` —— 换根后是最小根里被 bind 的只读副本，且降权后 uid 60000
  无权读，`Permission denied`（RE）。拿不到宿主真实密码哈希。
- **netcall 演示**：连外网失败 —— net ns 里只有 loopback。
- 沙箱内 `ps aux` 只见自己一两个进程 —— PID ns + 私有 /proc 的效果。

## 顺序很重要

`pivot_root` / `mount` / `sethostname` 需要 `CAP_SYS_ADMIN`，所以**先搭建、后降权**：
所有挂载和换根做完，才 `setgroups([]) → setgid → setuid` 切到非特权用户，最后 `execve`。

## 进阶

- 开 `CLONE_NEWUSER` + 写 `/proc/<pid>/uid_map`，实现**无 root**（rootless）沙箱。
- 用 `mount_setattr` 做递归只读、或 OverlayFS 给每次运行一个可写覆盖层。
