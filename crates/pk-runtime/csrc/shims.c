/*
 * ProsperoKit - C shims for libc symbols that Rust std references and the
 * console's import stubs do not provide (or provide only through modules a
 * native title does not load).
 *
 * The kit compiles this file and links it before the SDK's import stubs, so an
 * object definition wins over a stub. Every shim here was found with
 * `scripts/ps5-link-check.sh`:
 *   - the symbols prospero-lld reports as undefined for libprosperokit_runtime.a;
 *   - symbols the SDK stubs export ONLY from libScePosixForWebKit.so or
 *     libkernel_sys.so (modules a native title does not load: the import would
 *     resolve to address 0 or pull in a system-only module).
 * Everything that is not implemented for real calls pk_abort(): it posts a
 * notification with the symbol name and parks the thread, so a missing function
 * is visible on the TV instead of a silent crash. None of them is reachable from
 * ProsperoKit's own code paths (fs uses sceKernel*, HTTP uses libSceHttp,
 * panic = abort); std only references them from process/fs/net code.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* The PK_MISSING stubs ignore their parameters on purpose. */
#pragma clang diagnostic ignored "-Wunused-parameter"

#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

/* libkernel / libSceRandom (SDK import stubs). */
int sceKernelSendNotificationRequest(uint32_t device, void *request, size_t size, int blocking);
int sceKernelUsleep(uint32_t microseconds);
int sceRandomGetRandomNumber(void *buf, size_t len);

struct pk_notification {
    uint8_t reserved[45];
    char message[3075];
};

__attribute__((noreturn)) static void pk_abort(const char *what)
{
    static struct pk_notification note;
    static const char prefix[] = "ProsperoKit missing: ";
    size_t n = sizeof prefix - 1;
    memcpy(note.message, prefix, n);
    size_t w = strlen(what);
    if (w > sizeof note.message - n - 1)
        w = sizeof note.message - n - 1;
    memcpy(note.message + n, what, w);
    note.message[n + w] = '\0';
    (void)sceKernelSendNotificationRequest(0, &note, sizeof note, 0);
    for (;;)
        (void)sceKernelUsleep(1000000);
}

#define PK_MISSING(ret, name, params)                                                              \
    ret name params                                                                                \
    {                                                                                              \
        pk_abort("missing: " #name);                                                               \
    }

/* ---- Real implementations ------------------------------------------------ */

/* std::thread::sleep. FreeBSD returns the error number, not -1. */
int clock_nanosleep(clockid_t clock, int flags, const struct timespec *request, struct timespec *remain)
{
    struct timespec relative = *request;
    if (flags & TIMER_ABSTIME) {
        struct timespec now;
        if (clock_gettime(clock, &now) != 0)
            return errno;
        relative.tv_sec = request->tv_sec - now.tv_sec;
        relative.tv_nsec = request->tv_nsec - now.tv_nsec;
        if (relative.tv_nsec < 0) {
            relative.tv_sec -= 1;
            relative.tv_nsec += 1000000000L;
        }
        if (relative.tv_sec < 0)
            return 0;
        remain = NULL;
    }
    if (nanosleep(&relative, remain) == 0)
        return 0;
    return errno;
}

/* Hash-map seeds (std on FreeBSD uses arc4random_buf). Only libScePosixForWebKit
 * exports it, so it is implemented over libSceRandom. */
void arc4random_buf(void *buf, size_t len)
{
    uint8_t *p = buf;
    while (len > 0) {
        size_t chunk = len > 256 ? 256 : len;
        if (sceRandomGetRandomNumber(p, chunk) != 0)
            pk_abort("sceRandomGetRandomNumber failed");
        p += chunk;
        len -= chunk;
    }
}

/* QuickJS-NG asserts (FreeBSD's assert() calls __assert). Reported like any
 * other fatal error: a notification on the TV, then the thread parks. */
static size_t pk_append(char *dst, size_t at, size_t cap, const char *src)
{
    while (*src && at + 1 < cap)
        dst[at++] = *src++;
    dst[at] = '\0';
    return at;
}

__attribute__((noreturn)) void __assert(const char *func, const char *file, int line, const char *expr)
{
    static char msg[512];
    char num[12];
    int n = 0;
    unsigned v = line < 0 ? 0u : (unsigned)line;
    do {
        num[n++] = (char)('0' + v % 10);
        v /= 10;
    } while (v && n < 11);
    char digits[12];
    for (int i = 0; i < n; i++)
        digits[i] = num[n - 1 - i];
    digits[n] = '\0';
    size_t at = pk_append(msg, 0, sizeof msg, "assertion failed: ");
    at = pk_append(msg, at, sizeof msg, expr ? expr : "?");
    at = pk_append(msg, at, sizeof msg, " (");
    at = pk_append(msg, at, sizeof msg, file ? file : "?");
    at = pk_append(msg, at, sizeof msg, ":");
    at = pk_append(msg, at, sizeof msg, digits);
    at = pk_append(msg, at, sizeof msg, " ");
    at = pk_append(msg, at, sizeof msg, func ? func : "?");
    pk_append(msg, at, sizeof msg, ")");
    pk_abort(msg);
}

/* JS Date (QuickJS-NG uses localtime_r and reads tm_gmtoff). libSceLibcInternal
 * only exports the non-reentrant localtime(), and its struct tm is not known to
 * carry FreeBSD's tm_gmtoff/tm_zone tail, so only the nine standard fields
 * (same order in every libc) are copied and the UTC offset is derived. */
static pthread_mutex_t pk_localtime_lock = PTHREAD_MUTEX_INITIALIZER;
static char pk_no_zone[] = "";

/* Days since 1970-01-01 of a proleptic Gregorian date (month 1..12). */
static int64_t pk_days_from_civil(int64_t y, int64_t m, int64_t d)
{
    y -= m <= 2;
    int64_t era = (y >= 0 ? y : y - 399) / 400;
    int64_t yoe = y - era * 400;
    int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + doe - 719468;
}

struct tm *localtime_r(const time_t *timep, struct tm *result)
{
    int std_fields[9];
    pthread_mutex_lock(&pk_localtime_lock);
    const struct tm *shared = localtime(timep);
    if (shared)
        memcpy(std_fields, shared, sizeof std_fields);
    pthread_mutex_unlock(&pk_localtime_lock);
    if (!shared)
        return NULL;
    memset(result, 0, sizeof *result);
    result->tm_sec = std_fields[0];
    result->tm_min = std_fields[1];
    result->tm_hour = std_fields[2];
    result->tm_mday = std_fields[3];
    result->tm_mon = std_fields[4];
    result->tm_year = std_fields[5];
    result->tm_wday = std_fields[6];
    result->tm_yday = std_fields[7];
    result->tm_isdst = std_fields[8];
    int64_t local_as_utc =
        pk_days_from_civil(1900 + (int64_t)result->tm_year, 1 + (int64_t)result->tm_mon, result->tm_mday) * 86400 +
        (int64_t)result->tm_hour * 3600 + (int64_t)result->tm_min * 60 + result->tm_sec;
    result->tm_gmtoff = (long)(local_as_utc - (int64_t)*timep);
    result->tm_zone = pk_no_zone;
    return result;
}

/* Sockets/pipes with flags: the plain calls exist in libkernel. */
static int pk_apply_fd_flags(int fd, int flags)
{
    if (fd < 0)
        return fd;
    if (flags & O_NONBLOCK) {
        int fl = fcntl(fd, F_GETFL, 0);
        if (fl < 0 || fcntl(fd, F_SETFL, fl | O_NONBLOCK) < 0)
            goto fail;
    }
    if (flags & O_CLOEXEC) {
        if (fcntl(fd, F_SETFD, FD_CLOEXEC) < 0)
            goto fail;
    }
    return fd;
fail:;
    int saved = errno;
    close(fd);
    errno = saved;
    return -1;
}

int accept4(int s, struct sockaddr *addr, socklen_t *addrlen, int flags)
{
    int fd = accept(s, addr, addrlen);
    int fd_flags = 0;
    if (flags & SOCK_NONBLOCK)
        fd_flags |= O_NONBLOCK;
    if (flags & SOCK_CLOEXEC)
        fd_flags |= O_CLOEXEC;
    return pk_apply_fd_flags(fd, fd_flags);
}

int pipe2(int fds[2], int flags)
{
    if (pipe(fds) != 0)
        return -1;
    if (pk_apply_fd_flags(fds[0], flags) < 0) {
        int saved = errno;
        close(fds[1]);
        errno = saved;
        return -1;
    }
    if (pk_apply_fd_flags(fds[1], flags) < 0) {
        int saved = errno;
        close(fds[0]);
        errno = saved;
        return -1;
    }
    return 0;
}

/* The real one hangs on the console: threads are never named. */
int pthread_setname_np(pthread_t thread, const char *name)
{
    (void)thread;
    (void)name;
    return 0;
}

/* std::env::home_dir: no passwd database, so "no home directory". */
int getpwuid_r(uid_t uid, void *pwd, char *buf, size_t buflen, void **result)
{
    (void)uid;
    (void)pwd;
    (void)buf;
    (void)buflen;
    *result = NULL;
    return 0;
}

/* ---- Unwinder (panic = abort: never reached) ----------------------------- */

void *_Unwind_FindEnclosingFunction(void *ip)
{
    (void)ip;
    return NULL;
}
uintptr_t _Unwind_GetCFA(void *context)
{
    (void)context;
    return 0;
}
uintptr_t _Unwind_GetDataRelBase(void *context)
{
    (void)context;
    return 0;
}
uintptr_t _Unwind_GetTextRelBase(void *context)
{
    (void)context;
    return 0;
}
uintptr_t _Unwind_GetRegionStart(void *context)
{
    (void)context;
    return 0;
}
uintptr_t _Unwind_GetIPInfo(void *context, int *ip_before_insn)
{
    (void)context;
    *ip_before_insn = 0;
    return 0;
}
void *_Unwind_GetLanguageSpecificData(void *context)
{
    (void)context;
    return NULL;
}
PK_MISSING(void, _Unwind_SetGR, (void *context, int index, uintptr_t value))
PK_MISSING(void, _Unwind_SetIP, (void *context, uintptr_t value))

/* ---- Not available to a native title: park with a visible message --------- */

/* Missing from every stub library. */
PK_MISSING(int, futimens, (int fd, const struct timespec times[2]))
PK_MISSING(int, utimensat, (int fd, const char *path, const struct timespec times[2], int flag))
PK_MISSING(int, getpeereid, (int s, uid_t *euid, gid_t *egid))
PK_MISSING(int, setgid, (gid_t gid))
PK_MISSING(int, killpg, (pid_t pgrp, int sig))
PK_MISSING(int, mkfifo, (const char *path, mode_t mode))
PK_MISSING(int, dirfd, (void *dir))

/* Weak references in std (process spawning): the kit's converter wants every
 * referenced symbol exported by a stub, so they get a definition that fails. */
PK_MISSING(int, posix_spawn_file_actions_addchdir_np, (void *actions, const char *path))
PK_MISSING(int, posix_spawn_file_actions_addchdir, (void *actions, const char *path))

/* Only in libScePosixForWebKit.so: not loaded by a native title. */
PK_MISSING(int, getaddrinfo, (const char *node, const char *service, const void *hints, void **res))
PK_MISSING(void, freeaddrinfo, (void *res))
PK_MISSING(const char *, gai_strerror, (int code))

/* Only in libkernel_sys.so (system-only): ProsperoKit's fs uses sceKernel*. */
PK_MISSING(int, chown, (const char *path, uid_t owner, gid_t group))
PK_MISSING(int, lchown, (const char *path, uid_t owner, gid_t group))
PK_MISSING(int, fchown, (int fd, uid_t owner, gid_t group))
PK_MISSING(int, chroot, (const char *path))
PK_MISSING(pid_t, fork, (void))
PK_MISSING(int, setpgid, (pid_t pid, pid_t pgid))
PK_MISSING(pid_t, setsid, (void))
PK_MISSING(int, openat, (int fd, const char *path, int flags, ...))
PK_MISSING(int, fstatat, (int fd, const char *path, void *buf, int flag))
PK_MISSING(int, fchmodat, (int fd, const char *path, mode_t mode, int flag))
PK_MISSING(int, mkdirat, (int fd, const char *path, mode_t mode))
PK_MISSING(int, unlinkat, (int fd, const char *path, int flag))
PK_MISSING(int, renameat, (int from_fd, const char *from, int to_fd, const char *to))
PK_MISSING(int, linkat, (int fd1, const char *name1, int fd2, const char *name2, int flag))
PK_MISSING(int, symlink, (const char *target, const char *link))
PK_MISSING(ssize_t, readlink, (const char *path, char *buf, size_t size))
