import * as vscode from 'vscode';
import { Client } from 'ssh2';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseAuthority, normalizeRemotePath, SFTPClient, HostConfig } from './core';

interface Session {
  client: Client;
  sftp: SFTPClient;
  connected: boolean;
}

export class SFTPFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

  private sessions = new Map<string, Promise<Session>>();
  private passwords = new Map<string, string>();

  watch(uri: vscode.Uri): vscode.Disposable {
    // Ignore watcher for remote sftp or return a dummy disposable
    return new vscode.Disposable(() => {});
  }

  setPassword(authorityKey: string, pass: string) {
    this.passwords.set(authorityKey, pass);
  }

  private async getSession(uri: vscode.Uri): Promise<Session> {
    const authorityKey = uri.authority;
    if (this.sessions.has(authorityKey)) {
      const sess = await this.sessions.get(authorityKey)!;
      if (sess.connected) {
        return sess;
      }
      this.sessions.delete(authorityKey);
    }

    const sessionPromise = this.connectSession(uri);
    this.sessions.set(authorityKey, sessionPromise);
    return sessionPromise;
  }

  private async connectSession(uri: vscode.Uri): Promise<Session> {
    const auth = parseAuthority(uri.authority);
    const config = vscode.workspace.getConfiguration('sshRemoteLite');
    const hosts: HostConfig[] = config.get('hosts', []);
    const matchingHost = hosts.find(
      (h) => (h.name && h.name === uri.authority) || (h.host === auth.host && (!h.port || h.port === auth.port))
    );

    let password = matchingHost?.password || this.passwords.get(uri.authority);
    let privateKey: Buffer | undefined;

    if (matchingHost?.privateKeyPath) {
      let keyPath = matchingHost.privateKeyPath;
      if (keyPath.startsWith('~/') || keyPath === '~') {
        keyPath = path.join(os.homedir(), keyPath.substring(keyPath === '~' ? 1 : 2));
      }
      if (fs.existsSync(keyPath)) {
        privateKey = fs.readFileSync(keyPath);
      }
    }

    if (!password && !privateKey) {
      // Prompt user for password
      const input = await vscode.window.showInputBox({
        prompt: `请输入 ${auth.username}@${auth.host}:${auth.port} 的 SSH 登录密码`,
        password: true,
        ignoreFocusOut: true
      });
      if (!input) {
        throw vscode.FileSystemError.NoPermissions('SSH 连接需要密码');
      }
      password = input;
      this.passwords.set(uri.authority, password);
    }

    const client = new Client();

    return new Promise((resolve, reject) => {
      client
        .on('ready', () => {
          client.sftp((err, sftpStream) => {
            if (err) {
              client.end();
              return reject(vscode.FileSystemError.Unavailable(err.message));
            }
            const sftp = new SFTPClient(sftpStream);
            const sess: Session = {
              client,
              sftp,
              connected: true
            };
            client.on('close', () => {
              sess.connected = false;
            });
            client.on('error', () => {
              sess.connected = false;
            });
            resolve(sess);
          });
        })
        .on('error', (err) => {
          this.passwords.delete(uri.authority);
          reject(vscode.FileSystemError.Unavailable(err.message));
        })
        .connect({
          host: auth.host,
          port: auth.port,
          username: auth.username,
          password,
          privateKey,
          readyTimeout: 20000,
          keepaliveInterval: 10000
        });
    });
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const session = await this.getSession(uri);
    const remotePath = normalizeRemotePath(uri.path);

    try {
      const st = await session.sftp.stat(remotePath);
      let type = vscode.FileType.Unknown;
      // S_IFDIR = 0o040000, S_IFREG = 0o100000, S_IFLNK = 0o120000
      if ((st.mode & 0o040000) !== 0) {
        type = vscode.FileType.Directory;
      } else if ((st.mode & 0o100000) !== 0) {
        type = vscode.FileType.File;
      } else if ((st.mode & 0o120000) !== 0) {
        type = vscode.FileType.SymbolicLink;
      }

      return {
        type,
        ctime: (st.mtime || 0) * 1000,
        mtime: (st.mtime || 0) * 1000,
        size: st.size
      };
    } catch (err: any) {
      if (err && (err.code === 2 || err.code === 'ENOENT' || err.message?.includes('No such file'))) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw vscode.FileSystemError.Unavailable(err?.message || 'Failed to stat path');
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const session = await this.getSession(uri);
    const remotePath = normalizeRemotePath(uri.path);

    try {
      const entries = await session.sftp.readdir(remotePath);
      const result: [string, vscode.FileType][] = [];

      for (const entry of entries) {
        if (entry.filename === '.' || entry.filename === '..') {
          continue;
        }
        let type = vscode.FileType.File;
        if ((entry.attrs.mode & 0o040000) !== 0) {
          type = vscode.FileType.Directory;
        } else if ((entry.attrs.mode & 0o120000) !== 0) {
          type = vscode.FileType.SymbolicLink;
        }
        result.push([entry.filename, type]);
      }
      return result;
    } catch (err: any) {
      if (err && (err.code === 2 || err.code === 'ENOENT')) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw vscode.FileSystemError.Unavailable(err?.message || 'Failed to read directory');
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const session = await this.getSession(uri);
    const remotePath = normalizeRemotePath(uri.path);

    try {
      const buffer = await session.sftp.readFile(remotePath);
      return new Uint8Array(buffer);
    } catch (err: any) {
      if (err && (err.code === 2 || err.code === 'ENOENT')) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      throw vscode.FileSystemError.Unavailable(err?.message || 'Failed to read file');
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const session = await this.getSession(uri);
    const remotePath = normalizeRemotePath(uri.path);

    try {
      await session.sftp.writeFile(remotePath, Buffer.from(content));
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(err?.message || 'Failed to write file');
    }
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const session = await this.getSession(uri);
    const remotePath = normalizeRemotePath(uri.path);

    try {
      const st = await session.sftp.stat(remotePath);
      if ((st.mode & 0o040000) !== 0) {
        await session.sftp.rmdir(remotePath);
      } else {
        await session.sftp.unlink(remotePath);
      }
      this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(err?.message || 'Failed to delete file');
    }
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    const session = await this.getSession(oldUri);
    const oldPath = normalizeRemotePath(oldUri.path);
    const newPath = normalizeRemotePath(newUri.path);

    try {
      await session.sftp.rename(oldPath, newPath);
      this._emitter.fire([
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri }
      ]);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(err?.message || 'Failed to rename file');
    }
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const session = await this.getSession(uri);
    const remotePath = normalizeRemotePath(uri.path);

    try {
      await session.sftp.mkdir(remotePath);
      this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
    } catch (err: any) {
      throw vscode.FileSystemError.Unavailable(err?.message || 'Failed to create directory');
    }
  }
}
