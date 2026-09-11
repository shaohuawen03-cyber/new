import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FileEntryWithStats, Stats } from 'ssh2';
import { connectWithConfig, startSftp, call } from '../core';
import { startTestServer, TestServer } from './harness';

let srv: TestServer;

before(async () => {
  srv = await startTestServer();
});

after(async () => {
  await srv.close();
});

const baseCfg = () => ({
  host: '127.0.0.1',
  port: srv.port,
  username: 'testuser',
  password: 'testpass',
});

async function waitFor(cond: () => boolean, what: string, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) {
      throw new Error(`等待超时: ${what}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('密码认证 + SFTP 全流程 (mkdir/写/读/列目录/统计/改名/删除)', async () => {
  const client = await connectWithConfig(baseCfg());
  const sftp = await startSftp(client);

  await call<void>((cb) => sftp.mkdir('/proj', cb));

  const content = 'hello 反重力测试 ✓';
  await call<void>((cb) => sftp.writeFile('/proj/a.txt', Buffer.from(content, 'utf8'), cb));

  const data = await call<Buffer>((cb) => sftp.readFile('/proj/a.txt', cb));
  assert.equal(data.toString('utf8'), content);

  const list = await call<FileEntryWithStats[]>((cb) => sftp.readdir('/proj', cb));
  assert.deepEqual(list.map((e) => e.filename), ['a.txt']);

  const st = await call<Stats>((cb) => sftp.stat('/proj/a.txt', cb));
  assert.equal(st.size, Buffer.byteLength(content, 'utf8'));
  assert.ok(st.isFile());

  const dirSt = await call<Stats>((cb) => sftp.stat('/proj', cb));
  assert.ok(dirSt.isDirectory());

  await call<void>((cb) => sftp.rename('/proj/a.txt', '/proj/b.txt', cb));
  const list2 = await call<FileEntryWithStats[]>((cb) => sftp.readdir('/proj', cb));
  assert.deepEqual(list2.map((e) => e.filename), ['b.txt']);

  await call<void>((cb) => sftp.unlink('/proj/b.txt', cb));
  await call<void>((cb) => sftp.rmdir('/proj', cb));

  client.end();
});

test('读取不存在的文件应报错', async () => {
  const client = await connectWithConfig(baseCfg());
  const sftp = await startSftp(client);
  await assert.rejects(call<Buffer>((cb) => sftp.readFile('/no/such/file', cb)));
  client.end();
});

test('错误密码应被拒绝', async () => {
  await assert.rejects(
    connectWithConfig({ ...baseCfg(), password: 'wrong' }),
    /authentication|All configured authentication methods failed/i
  );
});

test('shell 终端: 欢迎语 + 输入回显', async () => {
  const client = await connectWithConfig(baseCfg());
  const chunks: string[] = [];
  const channel = await new Promise<any>((resolve, reject) => {
    client.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, ch) =>
      err ? reject(err) : resolve(ch)
    );
  });
  channel.on('data', (d: Buffer) => chunks.push(d.toString('utf8')));
  channel.stderr.on('data', (d: Buffer) => chunks.push(d.toString('utf8')));

  const all = () => chunks.join('');
  await waitFor(() => all().includes('HELLO-FROM-TEST-SERVER'), '欢迎语');

  channel.write('ping-antigravity\n');
  await waitFor(() => all().includes('ping-antigravity'), '回显');

  channel.close();
  client.end();
});

test('execCommand 在远端执行并返回退出码', async () => {
  const { execCommand } = await import('../core');
  const client = await connectWithConfig(baseCfg());
  const res = await execCommand(client, 'echo hello');
  assert.equal(res.code, 0);
  assert.ok(res.stdout.includes('EXEC:echo hello'));
  client.end();
});

test('buildAuthorizeKeyCommand 用 base64 传输公钥', async () => {
  const { buildAuthorizeKeyCommand } = await import('../core');
  const cmd = buildAuthorizeKeyCommand('ssh-rsa AAAA test@host');
  const b64 = cmd.match(/echo ([A-Za-z0-9+/=]+) \|/)?.[1];
  assert.ok(b64);
  assert.equal(Buffer.from(b64!, 'base64').toString('utf8').trim(), 'ssh-rsa AAAA test@host');
  assert.ok(cmd.includes('chmod 600'));
});
