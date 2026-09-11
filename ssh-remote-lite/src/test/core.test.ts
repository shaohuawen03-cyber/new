import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { parseAuthority, makeAuthority, expandHome } from '../core';

test('parseAuthority: user@host:port', () => {
  const cfg = parseAuthority('root@10.0.0.5:22');
  assert.equal(cfg.username, 'root');
  assert.equal(cfg.host, '10.0.0.5');
  assert.equal(cfg.port, 22);
});

test('parseAuthority: 省略端口默认 22', () => {
  const cfg = parseAuthority('dev@example.com');
  assert.equal(cfg.host, 'example.com');
  assert.equal(cfg.port, 22);
  assert.equal(cfg.username, 'dev');
});

test('parseAuthority: 省略用户名', () => {
  const cfg = parseAuthority('1.2.3.4:2222');
  assert.equal(cfg.username, undefined);
  assert.equal(cfg.host, '1.2.3.4');
  assert.equal(cfg.port, 2222);
});

test('parseAuthority: 非法端口回退 22', () => {
  const cfg = parseAuthority('user@host:notaport');
  assert.equal(cfg.port, 22);
});

test('makeAuthority: 缺省值', () => {
  assert.equal(makeAuthority({ host: 'h' }), 'root@h:22');
});

test('makeAuthority: 全量', () => {
  assert.equal(makeAuthority({ host: 'h', port: 2222, username: 'u' }), 'u@h:2222');
});

test('expandHome: 展开 ~', () => {
  assert.equal(expandHome('~/x'), path.join(os.homedir(), 'x'));
  assert.equal(expandHome('/abs/path'), '/abs/path');
});
