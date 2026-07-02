// Minimal N-API binding exposing a single AF_LOCAL socketpair() with both fds
// set to CLOEXEC + NONBLOCK. Used by the Lighthouse sampling worker pool to
// build the barrier-sync channel between paired workers.
//
// Linux supports SOCK_CLOEXEC/SOCK_NONBLOCK atomically as flag bits on
// socketpair(); macOS/BSD do not, so on those platforms the flags are applied
// post-hoc with fcntl().
//
// Derived from `node-unix-socketpair` by Maarten de Vries
// <maarten@de-vri.es> (https://github.com/de-vri-es/node-unix-socketpair),
// BSD-3-Clause. The original was Linux-only and significantly larger; this
// version is rewritten down to a single function with portable fcntl()
// fallback so we can ship it as in-tree source instead of patching the npm
// package.

#include <node_api.h>

#include <sys/socket.h>
#include <fcntl.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <string>

#if !defined(SOCK_CLOEXEC)
#define SOCK_CLOEXEC 0
#define SHAKA_SOCKETPAIR_FALLBACK_CLOEXEC 1
#endif
#if !defined(SOCK_NONBLOCK)
#define SOCK_NONBLOCK 0
#define SHAKA_SOCKETPAIR_FALLBACK_NONBLOCK 1
#endif

namespace {

napi_value throw_errno(napi_env env, const char* what) {
  int err = errno;
  std::string msg = std::string(what) + " failed: " + std::strerror(err);
  napi_throw_error(env, nullptr, msg.c_str());
  napi_value undef;
  napi_get_undefined(env, &undef);
  return undef;
}

napi_value socketpair_impl(napi_env env, napi_callback_info /*info*/) {
  int fds[2];
  if (::socketpair(AF_LOCAL, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0, fds) != 0) {
    return throw_errno(env, "socketpair");
  }

#if defined(SHAKA_SOCKETPAIR_FALLBACK_CLOEXEC) || defined(SHAKA_SOCKETPAIR_FALLBACK_NONBLOCK)
  for (int i = 0; i < 2; ++i) {
#ifdef SHAKA_SOCKETPAIR_FALLBACK_CLOEXEC
    int fd_flags = ::fcntl(fds[i], F_GETFD, 0);
    if (fd_flags < 0 || ::fcntl(fds[i], F_SETFD, fd_flags | FD_CLOEXEC) < 0) {
      ::close(fds[0]); ::close(fds[1]);
      return throw_errno(env, "fcntl(F_SETFD, FD_CLOEXEC)");
    }
#endif
#ifdef SHAKA_SOCKETPAIR_FALLBACK_NONBLOCK
    int fl_flags = ::fcntl(fds[i], F_GETFL, 0);
    if (fl_flags < 0 || ::fcntl(fds[i], F_SETFL, fl_flags | O_NONBLOCK) < 0) {
      ::close(fds[0]); ::close(fds[1]);
      return throw_errno(env, "fcntl(F_SETFL, O_NONBLOCK)");
    }
#endif
  }
#endif

  napi_value arr;
  napi_create_array_with_length(env, 2, &arr);

  napi_value v0;
  napi_create_int32(env, fds[0], &v0);
  napi_set_element(env, arr, 0, v0);

  napi_value v1;
  napi_create_int32(env, fds[1], &v1);
  napi_set_element(env, arr, 1, v1);

  return arr;
}

napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "socketpair", NAPI_AUTO_LENGTH, socketpair_impl, nullptr, &fn);
  napi_set_named_property(env, exports, "socketpair", fn);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
