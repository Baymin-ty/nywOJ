// Single source of truth for every supported language.
//
// `name` MUST equal `languages.name` in the DB — that's the field the worker
// matches on. `syncLanguages(db)` keeps the DB catalog aligned with this file.
//
// Each entry describes:
//   sourceFile  : filename inside the sandbox to write the user's code into.
//   binary      : sandbox cache key for the artifact reused across cases. For
//                 compiled languages this is the executable; for interpreted
//                 ones it's the source itself (the "compile" stage is just a
//                 syntax check via pylint).
//   compileArgs : argv handed to the sandbox as the compile step.
//   runArgs     : argv handed to the sandbox for each test case (the binary
//                 appears in inputFiles under its `binary` name).

const COMPILE_LIMITS = {
  limits: {
    cpuMs: 10_000,
    wallMs: 20_000,
    memoryMB: 512,
    stackMB: 512,
    processes: 50,
  },
};

const DEFAULT_ENV = ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME=/tmp'];

const stdioFiles = (stdin = { content: '' }) => [
  stdin,
  { name: 'stdout', max: 64 * 1024 * 1024 },
  { name: 'stderr', max: 64 * 1024 * 1024 },
];

const LANGUAGES = {
  'C': {
    sourceFile: 'main.c',
    binary: 'main',
    compileArgs: ['gcc', '-O2', '-std=c11', '-DONLINE_JUDGE', 'main.c', '-lm', '-o', 'main'],
    runArgs: ['main'],
  },
  'C++': {
    sourceFile: 'main.cpp',
    binary: 'main',
    compileArgs: ['/usr/bin/g++-9', '-O2', '-std=c++14', '-DONLINE_JUDGE', 'main.cpp', '-o', 'main'],
    runArgs: ['main'],
  },
  'Python3': {
    sourceFile: 'main.py',
    binary: 'main.py',
    compileArgs: ['python3', '-m', 'py_compile', 'main.py'],
    runArgs: ['python3', 'main.py'],
  },
};

const LANGUAGE_ROWS = [
  { id: 1, name: 'C++', des: 'C++14', lang: 'cpp' },
  { id: 2, name: 'Python3', des: 'Python 3', lang: 'python' },
  { id: 3, name: 'C', des: 'C11', lang: 'c' },
];

const getLanguage = (name) => LANGUAGES[name] || null;

const syncLanguages = async (db) => {
  for (const row of LANGUAGE_ROWS) {
    const existing = await db.one('SELECT id FROM languages WHERE name=?', [row.name]);
    if (existing) {
      await db.query('UPDATE languages SET des=?,lang=? WHERE id=?', [row.des, row.lang, existing.id]);
      continue;
    }
    const occupied = await db.one('SELECT id FROM languages WHERE id=?', [row.id]);
    if (!occupied) {
      await db.query('INSERT INTO languages(id,name,des,lang) VALUES (?,?,?,?)', [row.id, row.name, row.des, row.lang]);
    } else {
      await db.query('INSERT INTO languages(name,des,lang) VALUES (?,?,?)', [row.name, row.des, row.lang]);
    }
  }
};

module.exports = {
  COMPILE_LIMITS,
  DEFAULT_ENV,
  stdioFiles,
  LANGUAGES,
  LANGUAGE_ROWS,
  getLanguage,
  syncLanguages,
};
