{
  "targets": [
    {
      "target_name": "shaka_perf_socketpair",
      "sources": ["native/socketpair.cpp"],
      "cflags_cc": ["-std=c++11", "-Wall", "-Wextra", "-Wpedantic"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++11",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
      },
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 }
      }
    }
  ]
}
