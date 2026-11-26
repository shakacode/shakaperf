/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

#include <node_api.h>
#include <sys/file.h>
#include <cerrno>
#include <cstring>

namespace {

napi_value try_file_lock(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  int32_t fd;
  if (napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr) != napi_ok ||
      argc != 1 || napi_get_value_int32(env, arg, &fd) != napi_ok) {
    napi_throw_type_error(env, nullptr, "tryFileLock expects a file descriptor");
    return nullptr;
  }

  int result;
  do {
    result = ::flock(fd, LOCK_EX | LOCK_NB);
  } while (result < 0 && errno == EINTR);
  if (result < 0 && errno != EWOULDBLOCK && errno != EAGAIN) {
    napi_throw_error(env, nullptr, std::strerror(errno));
    return nullptr;
  }
  napi_value acquired;
  napi_get_boolean(env, result == 0, &acquired);
  return acquired;
}

}  // namespace

napi_value add_file_lock(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "tryFileLock", NAPI_AUTO_LENGTH, try_file_lock, nullptr, &fn);
  napi_set_named_property(env, exports, "tryFileLock", fn);
  return exports;
}
