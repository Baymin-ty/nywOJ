// Single source of truth for every supported language.
//
// `name` MUST equal `languages.name` in the DB — that's the field the worker
// matches on. The worker reads from this table to pick compile/run commands;
// adding a new language is one entry here plus one INSERT into `languages`.
//
// Each entry describes:
//   sourceFile  : filename inside the sandbox to write the user's code into.
//   binary      : sandbox cache key for the artifact reused across cases. For
//                 compiled languages this is the executable; for interpreted
//                 ones it's the source itself (the "compile" stage is just a
//                 syntax check via pylint).
//   compileArgs : argv handed to /run as the compile step.
//   runArgs     : argv handed to /run for each test case (the binary appears
//                 in copyIn under its `binary` name).

const COMPILE_LIMITS = {
  cpuLimit: 10_000_000_000,        // 10 s in ns
  memoryLimit: 512 * 1024 * 1024,  // 512 MB
  stackLimit: 512 * 1024 * 1024,
  procLimit: 50,
  strictMemoryLimit: true,
};

const stdFiles = (stdin = { content: '' }) => [
  stdin,
  { name: 'stdout', max: 64 * 1024 * 1024 },
  { name: 'stderr', max: 64 * 1024 * 1024 },
];

const LANGUAGES = {
  'C++': {
    sourceFile: 'main.cpp',
    binary: 'main',
    compileArgs: ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', 'main.cpp', '-o', 'main'],
    runArgs: ['main'],
  },
  'Python3': {
    // pylint --errors-only acts as the syntax-check pass; the cached "binary"
    // is just the source file copied through copyOutCached.
    sourceFile: 'main.py',
    binary: 'main.py',
    compileArgs: ['pylint', '--errors-only', 'main.py'],
    runArgs: ['python3', 'main.py'],
  },
};

const getLanguage = (name) => LANGUAGES[name] || null;

module.exports = {
  COMPILE_LIMITS,
  stdFiles,
  LANGUAGES,
  getLanguage,
};
