/*
 * Seccomp blacklist probe. Each operation is expected to fail with EPERM in the
 * default sandbox policy. It does not try to bypass the filter; it only checks
 * that the kernel refused the requested syscall.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/bpf.h>
#include <sched.h>
#include <stdio.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/ptrace.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <unistd.h>

static int failures = 0;

static void expect_eperm(const char *name, long rc) {
    int e = errno;
    if (rc == -1 && e == EPERM) {
        printf("PASS %s blocked with EPERM\n", name);
        return;
    }
    printf("FAIL %s rc=%ld errno=%d %s\n", name, rc, e, strerror(e));
    failures++;
}

static void probe(const char *name) {
    errno = 0;
    if (!strcmp(name, "socket")) {
        expect_eperm(name, syscall(SYS_socket, AF_INET, SOCK_STREAM, 0));
    } else if (!strcmp(name, "ptrace")) {
        expect_eperm(name, syscall(SYS_ptrace, PTRACE_TRACEME, 0, 0, 0));
    } else if (!strcmp(name, "unshare")) {
        expect_eperm(name, syscall(SYS_unshare, CLONE_NEWUSER));
    } else if (!strcmp(name, "mount")) {
        expect_eperm(name, syscall(SYS_mount, "tmpfs", "/tmp/nywoj_mount_probe", "tmpfs", 0, ""));
#ifdef SYS_umount2
    } else if (!strcmp(name, "umount2")) {
        expect_eperm(name, syscall(SYS_umount2, "/tmp/nywoj_mount_probe", 0));
#endif
#ifdef SYS_pivot_root
    } else if (!strcmp(name, "pivot_root")) {
        expect_eperm(name, syscall(SYS_pivot_root, "/", "/"));
#endif
#ifdef SYS_bpf
    } else if (!strcmp(name, "bpf")) {
        expect_eperm(name, syscall(SYS_bpf, BPF_MAP_CREATE, 0, 0));
#endif
#ifdef SYS_io_uring_setup
    } else if (!strcmp(name, "io_uring_setup")) {
        expect_eperm(name, syscall(SYS_io_uring_setup, 1, 0));
#endif
#ifdef SYS_pidfd_getfd
    } else if (!strcmp(name, "pidfd_getfd")) {
        expect_eperm(name, syscall(SYS_pidfd_getfd, -1, 0, 0));
#endif
#ifdef SYS_process_vm_readv
    } else if (!strcmp(name, "process_vm_readv")) {
        char c = 0;
        struct iovec iov = {&c, 1};
        expect_eperm(name, syscall(SYS_process_vm_readv, getpid(), &iov, 1, &iov, 1, 0));
#endif
#ifdef SYS_process_vm_writev
    } else if (!strcmp(name, "process_vm_writev")) {
        char c = 0;
        struct iovec iov = {&c, 1};
        expect_eperm(name, syscall(SYS_process_vm_writev, getpid(), &iov, 1, &iov, 1, 0));
#endif
#ifdef SYS_chroot
    } else if (!strcmp(name, "chroot")) {
        expect_eperm(name, syscall(SYS_chroot, "/"));
#endif
#ifdef SYS_setns
    } else if (!strcmp(name, "setns")) {
        expect_eperm(name, syscall(SYS_setns, -1, 0));
#endif
#ifdef SYS_name_to_handle_at
    } else if (!strcmp(name, "name_to_handle_at")) {
        expect_eperm(name, syscall(SYS_name_to_handle_at, AT_FDCWD, "/", 0, 0, 0));
#endif
#ifdef SYS_open_by_handle_at
    } else if (!strcmp(name, "open_by_handle_at")) {
        expect_eperm(name, syscall(SYS_open_by_handle_at, AT_FDCWD, 0, 0));
#endif
#ifdef SYS_fanotify_init
    } else if (!strcmp(name, "fanotify_init")) {
        expect_eperm(name, syscall(SYS_fanotify_init, 0, 0));
#endif
#ifdef SYS_perf_event_open
    } else if (!strcmp(name, "perf_event_open")) {
        expect_eperm(name, syscall(SYS_perf_event_open, 0, 0, -1, -1, 0));
#endif
#ifdef SYS_userfaultfd
    } else if (!strcmp(name, "userfaultfd")) {
        expect_eperm(name, syscall(SYS_userfaultfd, 0));
#endif
#ifdef SYS_keyctl
    } else if (!strcmp(name, "keyctl")) {
        expect_eperm(name, syscall(SYS_keyctl, 0, 0, 0, 0, 0));
#endif
#ifdef SYS_add_key
    } else if (!strcmp(name, "add_key")) {
        expect_eperm(name, syscall(SYS_add_key, "user", "nywoj", "x", 1, 0));
#endif
#ifdef SYS_init_module
    } else if (!strcmp(name, "init_module")) {
        expect_eperm(name, syscall(SYS_init_module, 0, 0, ""));
#endif
#ifdef SYS_finit_module
    } else if (!strcmp(name, "finit_module")) {
        expect_eperm(name, syscall(SYS_finit_module, -1, "", 0));
#endif
#ifdef SYS_delete_module
    } else if (!strcmp(name, "delete_module")) {
        expect_eperm(name, syscall(SYS_delete_module, "nywoj_probe", 0));
#endif
#ifdef SYS_kexec_load
    } else if (!strcmp(name, "kexec_load")) {
        expect_eperm(name, syscall(SYS_kexec_load, 0, 0, 0, 0));
#endif
#ifdef SYS_swapon
    } else if (!strcmp(name, "swapon")) {
        expect_eperm(name, syscall(SYS_swapon, "/tmp/nywoj_swap_probe", 0));
#endif
#ifdef SYS_swapoff
    } else if (!strcmp(name, "swapoff")) {
        expect_eperm(name, syscall(SYS_swapoff, "/tmp/nywoj_swap_probe"));
#endif
#ifdef SYS_acct
    } else if (!strcmp(name, "acct")) {
        expect_eperm(name, syscall(SYS_acct, "/tmp/nywoj_acct_probe"));
#endif
#ifdef SYS_reboot
    } else if (!strcmp(name, "reboot")) {
        expect_eperm(name, syscall(SYS_reboot, 0, 0, 0, 0));
#endif
    } else {
        printf("SKIP unknown probe %s\n", name);
    }
}

int main(int argc, char **argv) {
    static const char *all[] = {
        "socket",
        "ptrace",
        "unshare",
        "mount",
        "umount2",
        "pivot_root",
        "bpf",
        "io_uring_setup",
        "pidfd_getfd",
        "process_vm_readv",
        "process_vm_writev",
        "chroot",
        "setns",
        "name_to_handle_at",
        "open_by_handle_at",
        "fanotify_init",
        "perf_event_open",
        "userfaultfd",
        "keyctl",
        "add_key",
        "init_module",
        "finit_module",
        "delete_module",
        "kexec_load",
        "swapon",
        "swapoff",
        "acct",
        "reboot",
    };

    if (argc > 1) {
        for (int i = 1; i < argc; i++) {
            probe(argv[i]);
        }
    } else {
        for (size_t i = 0; i < sizeof(all) / sizeof(all[0]); i++) {
            probe(all[i]);
        }
    }
    return failures ? 1 : 0;
}
