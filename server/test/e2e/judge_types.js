// =============================================================================
// 判题 e2e（需活 Rust sandbox :5050）。直接走 sandbox 客户端 + languages 注册表，
// 验证编译 / 运行 / 比对链路在 legacy 退役后完好。runner 探测到沙箱才执行。
//
//   node test/e2e/judge_types.js
// =============================================================================
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const sandbox = require('../../api/judge/sandbox');
const { getLanguage, stdioFiles, COMPILE_LIMITS, DEFAULT_ENV } = require('../../api/judge/languages');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
const ko = (n, m) => { fail++; console.log(`  FAIL ${n} -- ${m}`); };

const compile = (lang, code) =>
  sandbox.runOne({
    command: lang.compileArgs, env: lang.compileEnv || DEFAULT_ENV,
    stdio: stdioFiles(), ...COMPILE_LIMITS,
    inputFiles: { [lang.sourceFile]: { content: code } },
    outputFiles: ['stdout', 'stderr'], cachedOutputs: [lang.binary],
  });

const runOnce = (lang, cachedFile, input) =>
  sandbox.runOne({
    command: lang.runArgs, env: lang.runEnv || DEFAULT_ENV,
    stdio: stdioFiles({ content: input }),
    limits: { cpuMs: 1000, wallMs: 2000, memoryMB: 256, stackMB: 256, processes: 50 },
    inputFiles: { [lang.binary]: { cachedFile } },
  });

(async () => {
  try {
    const v = await sandbox.version();
    ok(`sandbox 可达: ${v.name} ${v.buildVersion}`);

    const lang = getLanguage('C++');
    if (!lang) { ko('C++ 语言注册', 'getLanguage returned null'); throw new Error('no C++'); }

    // 传统 A+B：AC 与 WA 两种判定
    const solAC = '#include<iostream>\nint main(){long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n';
    const solWA = '#include<iostream>\nint main(){long a,b;std::cin>>a>>b;std::cout<<(a*b)<<"\\n";}\n'; // 故意乘法

    const cAC = await compile(lang, solAC);
    if (cAC.exitCode !== 0) { ko('AC 程序编译', (cAC.outputFiles || {}).stderr || 'CE'); }
    else {
      ok('AC 程序编译成功');
      const file = cAC.cachedFiles && cAC.cachedFiles[lang.binary];
      const r = await runOnce(lang, file, '111 222\n');
      const out = ((r.outputFiles || {}).stdout || '').trim();
      (out === '333' && r.status === 'Accepted')
        ? ok('传统题 AC：111+222=333')
        : ko('传统题 AC', `status=${r.status} out=${JSON.stringify(out)}`);
      if (file) await sandbox.deleteFile(file).catch(() => {});
    }

    const cWA = await compile(lang, solWA);
    if (cWA.exitCode === 0) {
      ok('WA 程序编译成功');
      const file = cWA.cachedFiles && cWA.cachedFiles[lang.binary];
      const r = await runOnce(lang, file, '111 222\n');
      const out = ((r.outputFiles || {}).stdout || '').trim();
      (out !== '333')
        ? ok(`传统题 WA：输出 ${out} ≠ 期望 333`)
        : ko('传统题 WA', '错误程序竟输出了正确答案');
      if (file) await sandbox.deleteFile(file).catch(() => {});
    } else ko('WA 程序编译', 'unexpected CE');

    // 运行期错误（空指针解引用 -> SIGSEGV，跨架构一致）应非 Accepted
    const solRE = '#include<iostream>\nint main(){int n;std::cin>>n;int*p=nullptr;*p=n;std::cout<<*p;}\n';
    const cRE = await compile(lang, solRE);
    if (cRE.exitCode === 0) {
      const file = cRE.cachedFiles && cRE.cachedFiles[lang.binary];
      const r = await runOnce(lang, file, '1\n');
      (r.status !== 'Accepted' || r.exitCode !== 0)
        ? ok(`RE：空指针解引用判定 status=${r.status} exit=${r.exitCode}`)
        : ko('RE', 'null-deref 未被判定为非 Accepted');
      if (file) await sandbox.deleteFile(file).catch(() => {});
    }
  } catch (e) {
    ko('unexpected exception', e && e.stack || String(e));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
