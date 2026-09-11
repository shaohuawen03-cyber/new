import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { Client } from 'ssh2';
import { createEmbeddedSSHServer, TestServerInstance } from './harness';
import { SFTPClient } from '../core';

describe('SSH & SFTP End-to-End Tests with In-Process SSH Server', () => {
  let server: TestServerInstance;

  before(async () => {
    server = await createEmbeddedSSHServer({
      username: 'testuser',
      password: 'correctpassword'
    });
  });

  after(async () => {
    if (server) {
      await server.close();
    }
  });

  it('8. authenticates successfully with correct credentials and fails on wrong password', async () => {
    // 1. Success case
    const validClient = new Client();
    await new Promise<void>((resolve, reject) => {
      validClient
        .on('ready', () => {
          validClient.end();
          resolve();
        })
        .on('error', (err) => reject(err))
        .connect({
          host: server.host,
          port: server.port,
          username: 'testuser',
          password: 'correctpassword'
        });
    });

    // 2. Reject case
    const invalidClient = new Client();
    await new Promise<void>((resolve, reject) => {
      invalidClient
        .on('ready', () => {
          invalidClient.end();
          reject(new Error('Should not have authenticated with invalid password'));
        })
        .on('error', () => {
          // Expected auth error
          resolve();
        })
        .connect({
          host: server.host,
          port: server.port,
          username: 'testuser',
          password: 'wrongpassword'
        });
    });
  });

  it('9. executes full SFTP lifecycle: mkdir, write UTF-8/Chinese, read, readdir, stat, rename, delete', async () => {
    const client = new Client();

    await new Promise<void>((resolve, reject) => {
      client
        .on('ready', resolve)
        .on('error', reject)
        .connect({
          host: server.host,
          port: server.port,
          username: 'testuser',
          password: 'correctpassword'
        });
    });

    const sftp = await new Promise<any>((resolve, reject) => {
      client.sftp((err, sftpStream) => {
        if (err) return reject(err);
        resolve(sftpStream);
      });
    });

    const sftpClient = new SFTPClient(sftp);

    // 1. mkdir
    await sftpClient.mkdir('/home/testuser/workspace');

    // 2. writeFile (Chinese + UTF8)
    const testContent = '你好，反重力！Hello Antigravity 2026 🚀';
    const filePath = '/home/testuser/workspace/hello.txt';
    await sftpClient.writeFile(filePath, testContent);

    // 3. readFile
    const readBuf = await sftpClient.readFile(filePath);
    assert.equal(readBuf.toString('utf8'), testContent);

    // 4. stat
    const fileStat = await sftpClient.stat(filePath);
    assert.equal(fileStat.size, Buffer.byteLength(testContent, 'utf8'));

    // 5. readdir
    const entries = await sftpClient.readdir('/home/testuser/workspace');
    const filenames = entries.map((e) => e.filename);
    assert.ok(filenames.includes('hello.txt'));

    // 6. rename
    const renamedPath = '/home/testuser/workspace/greeting.txt';
    await sftpClient.rename(filePath, renamedPath);
    const existsOld = await sftpClient.exists(filePath);
    assert.equal(existsOld, false);
    const existsNew = await sftpClient.exists(renamedPath);
    assert.equal(existsNew, true);

    // 7. delete / unlink
    await sftpClient.unlink(renamedPath);
    const existsAfterDelete = await sftpClient.exists(renamedPath);
    assert.equal(existsAfterDelete, false);

    // 8. rmdir
    await sftpClient.rmdir('/home/testuser/workspace');

    client.end();
  });

  it('10. reports error when reading non-existent file', async () => {
    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      client
        .on('ready', resolve)
        .on('error', reject)
        .connect({
          host: server.host,
          port: server.port,
          username: 'testuser',
          password: 'correctpassword'
        });
    });

    const sftp = await new Promise<any>((resolve, reject) => {
      client.sftp((err, sftpStream) => {
        if (err) return reject(err);
        resolve(sftpStream);
      });
    });

    const sftpClient = new SFTPClient(sftp);
    await assert.rejects(async () => {
      await sftpClient.readFile('/non/existent/path/file.txt');
    });

    client.end();
  });

  it('11. opens interactive shell terminal: receives welcome banner and echoes input', async () => {
    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      client
        .on('ready', resolve)
        .on('error', reject)
        .connect({
          host: server.host,
          port: server.port,
          username: 'testuser',
          password: 'correctpassword'
        });
    });

    const stream = await new Promise<any>((resolve, reject) => {
      client.shell((err, channel) => {
        if (err) return reject(err);
        resolve(channel);
      });
    });

    let output = '';
    const received = new Promise<void>((resolve) => {
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (output.includes('SSH Remote Lite In-Process Server') && output.includes('echo test message')) {
          resolve();
        }
      });
    });

    stream.write('echo test message\r\n');
    await received;

    assert.ok(output.includes('Welcome to SSH Remote Lite In-Process Server'));
    assert.ok(output.includes('echo test message'));

    client.end();
  });
});
