// 用"系统 ssh 命令行"打通测试服务器 —— 这正是插件终端走的路径
// (Pseudoterminal 里跑不了 ssh2,终端必须用原生 ssh 进程)。
//
// 为什么要有这个用例: 集成测试第 2~5 轮都栽在这里,而单元测试全绿,
// 因为没有任何一个用例用真正的 ssh 客户端做过公钥登录:
//   * harness 把 ctx.key 当成 Buffer 调 .equals() -> 处理器抛异常 ->
//     客户端只看到 "Connection closed"、退出码 255;
//   * key.verify(blob, sig, algo) 多传了第三个参数 ->
//     "Invalid digest: ssh-ed25519"。
// 现在这两条都在 npm test 里被守住。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { utils } from 'ssh2';
import { startTestServer, TestServer } from './harness';

let srv: TestServer;
let keyFile: string;

before(async () => {
  const kp = utils.generateKeyPairSync('ed25519');
  srv = await startTestServer('testuser', 'testpass', kp.public);
  keyFile = path.join(os.tmpdir(), `ssh_remote_lite_cli_${process.pid}_${Date.now()}`);
  fs.writeFileSync(keyFile, kp.private, { mode: 0o600 });
});

after(async () => {
  try {
    fs.rmSync(keyFile, { force: true });
  } catch {
    /* ignore */
  }
  await srv.close();
});

function sshArgs(extra: string[]): string[] {
  return [
    '-p',
    String(srv.port),
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-i',
    keyFile,
    'testuser@127.0.0.1',
    ...extra,
  ];
}

function runSsh(extra: string[], killAfterMs = 0): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh', sshArgs(extra), { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    let killed = false;
    const timers: NodeJS.Timeout[] = [];
    if (killAfterMs > 0) {
      timers.push(
        setTimeout(() => {
          killed = true;
          child.kill();
        }, killAfterMs)
      );
    }
    timers.push(
      setTimeout(() => {
        child.kill();
      }, 30000)
    );
    child.on('error', () => resolve({ code: null, out, err }));
    child.on('close', (code) => {
      timers.forEach(clearTimeout);
      resolve({ code: killed ? 0 : code, out, err });
    });
  });
}

test('系统 ssh 用公钥登录并执行命令 (exec)', async () => {
  const r = await runSsh(['echo IT_SSH_OK']);
  assert.equal(r.code, 0, `ssh 退出码 ${r.code}: ${r.err.split('\n').slice(-3).join(' | ')}`);
  assert.match(r.out, /EXEC:/, `测试服务器没有回应 exec: ${r.out}`);
});

test('系统 ssh 开交互式 shell 后保持存活 (终端场景)', async () => {
  // -tt 强制分配 pty,和 VS Code 终端里跑 ssh 一样
  const started = Date.now();
  const r = await runSsh(['-tt'], 4000);
  const alive = Date.now() - started;
  assert.ok(alive >= 3500, `shell 太早退出 (${alive}ms, 退出码 ${r.code})`);
  assert.match(r.out + r.err, /HELLO-FROM-TEST-SERVER/, `没有收到服务器欢迎行: ${r.out} ${r.err}`);
});
