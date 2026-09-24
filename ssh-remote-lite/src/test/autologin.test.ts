// "只给密码 -> 自动变免密 -> 系统 ssh 直接进去" 的完整链路测试。
// 这是用户要的"密码能不能自动配置"的正解: 系统 ssh 不接受命令行密码,
// 所以用 ssh2 拿密码登录一次, 把公钥写进远端 authorized_keys, 之后终端免密。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureLocalKeyPair } from '../keys';
import { ensurePasswordlessLogin } from '../autologin';
import { startTestServer, TestServer } from './harness';

let srv: TestServer;
let sshDir: string;

before(async () => {
  // 没有 authorizedPubKey: 服务器一开始只认密码
  srv = await startTestServer('testuser', 'testpass');
  sshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srl-ssh-'));
});

after(async () => {
  await srv.close();
  try {
    fs.rmSync(sshDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('ensureLocalKeyPair: 本机没有密钥时自动生成一把 ed25519', () => {
  const kp = ensureLocalKeyPair(sshDir);
  assert.equal(kp.created, true);
  assert.ok(fs.existsSync(kp.privateKeyPath), '私钥文件应存在');
  assert.ok(kp.publicKey.startsWith('ssh-ed25519 '), `公钥格式不对: ${kp.publicKey}`);
  // 第二次调用必须复用, 不能重新生成
  const again = ensureLocalKeyPair(sshDir);
  assert.equal(again.created, false);
  assert.equal(again.privateKeyPath, kp.privateKeyPath);
});

test('密码登录 -> 部署公钥 -> 系统 ssh 免密进入', async () => {
  const res = await ensurePasswordlessLogin(
    { host: '127.0.0.1', port: srv.port, username: 'testuser', password: 'testpass' },
    sshDir
  );
  assert.equal(res.deployed, true, `部署失败: ${res.error}`);
  assert.ok(res.cfg.privateKeyPath, '返回的配置里应带上私钥路径');

  const args = [
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
    String(res.cfg.privateKeyPath),
    'testuser@127.0.0.1',
    'echo IT_NOPASS_OK',
  ];
  const out = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn('ssh', args, { windowsHide: true });
    let o = '';
    let e = '';
    child.stdout.on('data', (d) => {
      o += String(d);
    });
    child.stderr.on('data', (d) => {
      e += String(d);
    });
    const t = setTimeout(() => child.kill(), 30000);
    child.on('error', () => resolve({ code: null, out: o, err: e }));
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, out: o, err: e });
    });
  });
  assert.equal(out.code, 0, `免密登录失败: ${out.err.split('\n').slice(-3).join(' | ')}`);
  assert.match(out.out, /EXEC:/, '远端没有执行命令');
});

test('没有密码也没有私钥时不报错, 只是不部署', async () => {
  const res = await ensurePasswordlessLogin(
    { host: '127.0.0.1', port: srv.port, username: 'testuser' },
    sshDir
  );
  assert.equal(res.deployed, false);
  assert.ok(res.error, '应该给出原因');
});
