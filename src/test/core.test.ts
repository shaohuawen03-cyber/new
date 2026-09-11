import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseAuthority, formatAuthority, normalizeRemotePath } from '../core';

describe('Core: Authority Parsing & Formatting (Pure Logic)', () => {
  it('1. parses standard authority with user, host, and port', () => {
    const res = parseAuthority('root@192.168.1.100:2222');
    assert.deepEqual(res, {
      username: 'root',
      host: '192.168.1.100',
      port: 2222
    });
  });

  it('2. parses authority with default port', () => {
    const res = parseAuthority('dev@myserver.com');
    assert.deepEqual(res, {
      username: 'dev',
      host: 'myserver.com',
      port: 22
    });
  });

  it('3. parses authority without user (uses defaultUser)', () => {
    const res = parseAuthority('10.0.0.1:8022', 'ubuntu');
    assert.deepEqual(res, {
      username: 'ubuntu',
      host: '10.0.0.1',
      port: 8022
    });
  });

  it('4. parses IPv6 bracket host with port', () => {
    const res = parseAuthority('admin@[fe80::1]:2222');
    assert.deepEqual(res, {
      username: 'admin',
      host: 'fe80::1',
      port: 2222
    });
  });

  it('5. parses URL-encoded username in authority', () => {
    const res = parseAuthority('user%40domain@example.org:22');
    assert.deepEqual(res, {
      username: 'user@domain',
      host: 'example.org',
      port: 22
    });
  });

  it('6. formats authority object to canonical string', () => {
    assert.equal(formatAuthority({ username: 'root', host: '192.168.1.1', port: 22 }), 'root@192.168.1.1');
    assert.equal(formatAuthority({ username: 'admin', host: '192.168.1.1', port: 2222 }), 'admin@192.168.1.1:2222');
    assert.equal(formatAuthority({ username: 'root', host: 'fe80::1', port: 22 }), 'root@[fe80::1]');
  });

  it('7. normalizes remote UNIX paths and expands tilde', () => {
    assert.equal(normalizeRemotePath('~', '/home/user'), '/home/user');
    assert.equal(normalizeRemotePath('~/workspace/project', '/home/user'), '/home/user/workspace/project');
    assert.equal(normalizeRemotePath('workspace/../foo/bar', '/root'), '/foo/bar');
    assert.equal(normalizeRemotePath('/var/www//html/./index.php', '/root'), '/var/www/html/index.php');
    assert.equal(normalizeRemotePath('.', '/home/test'), '/home/test');
  });
});
