import * as path from 'path';
import type { Client, SFTPWrapper as SSH2SFTP, Stats, FileEntry } from 'ssh2';

export interface AuthorityInfo {
  username: string;
  host: string;
  port: number;
}

export interface HostConfig {
  name?: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKey?: string | Buffer;
  defaultPath?: string;
}

/**
 * Parses authority string formatted as:
 * [username@]host[:port]
 * e.g. "root@192.168.1.1:22", "user@my-host", "my-host:2222", "admin@[::1]:2222"
 */
export function parseAuthority(authority: string, defaultUser = 'root', defaultPort = 22): AuthorityInfo {
  if (!authority) {
    throw new Error('Authority cannot be empty');
  }

  let raw = authority;
  let username = defaultUser;

  // Extract username if present
  const atIndex = raw.lastIndexOf('@');
  if (atIndex !== -1) {
    username = decodeURIComponent(raw.substring(0, atIndex));
    raw = raw.substring(atIndex + 1);
  }

  let host = raw;
  let port = defaultPort;

  // Check IPv6 bracket syntax e.g. [::1]:22 or [::1]
  if (host.startsWith('[')) {
    const closeBracket = host.indexOf(']');
    if (closeBracket !== -1) {
      const ipv6Host = host.substring(1, closeBracket);
      const remainder = host.substring(closeBracket + 1);
      if (remainder.startsWith(':')) {
        const parsedPort = parseInt(remainder.substring(1), 10);
        if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
          port = parsedPort;
        }
      }
      return { username, host: ipv6Host, port };
    }
  }

  const colonIndex = raw.lastIndexOf(':');
  if (colonIndex !== -1) {
    const portStr = raw.substring(colonIndex + 1);
    const parsedPort = parseInt(portStr, 10);
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      port = parsedPort;
      host = raw.substring(0, colonIndex);
    }
  }

  if (!host) {
    throw new Error(`Invalid host in authority: "${authority}"`);
  }

  return { username, host, port };
}

/**
 * Formats authority into canonical [username@]host[:port] string
 */
export function formatAuthority(info: { username?: string; host: string; port?: number }): string {
  const user = info.username ? `${encodeURIComponent(info.username)}@` : '';
  const port = info.port && info.port !== 22 ? `:${info.port}` : '';
  const host = info.host.includes(':') && !info.host.startsWith('[') ? `[${info.host}]` : info.host;
  return `${user}${host}${port}`;
}

/**
 * Normalizes remote UNIX paths and expands '~' home shortcuts.
 */
export function normalizeRemotePath(remotePath: string, homeDir = '/root'): string {
  if (!remotePath || remotePath === '.') {
    return homeDir;
  }

  let normalized = remotePath.replace(/\\/g, '/');

  if (normalized === '~' || normalized.startsWith('~/')) {
    const home = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
    const sub = normalized === '~' ? '' : normalized.substring(1);
    normalized = `${home}${sub}`;
  }

  // Ensure absolute path
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // Posix normalize resolves .., ., and multiple slashes
  normalized = path.posix.normalize(normalized);
  return normalized;
}

/**
 * Promise-based SFTP Client wrapper over ssh2 SFTPStream
 */
export class SFTPClient {
  constructor(public readonly sftp: SSH2SFTP) {}

  stat(remotePath: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      this.sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });
  }

  lstat(remotePath: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
      this.sftp.lstat(remotePath, (err, stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });
  }

  readdir(remotePath: string): Promise<FileEntry[]> {
    return new Promise((resolve, reject) => {
      this.sftp.readdir(remotePath, (err, list) => {
        if (err) return reject(err);
        resolve(list);
      });
    });
  }

  readFile(remotePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = this.sftp.createReadStream(remotePath);

      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err: Error) => reject(err));
    });
  }

  writeFile(remotePath: string, data: Buffer | Uint8Array | string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = this.sftp.createWriteStream(remotePath);
      stream.on('close', () => resolve());
      stream.on('error', (err: Error) => reject(err));

      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
      stream.end(buf);
    });
  }

  mkdir(remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.mkdir(remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  rmdir(remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.rmdir(remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  unlink(remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.unlink(remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.rename(oldPath, newPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      await this.stat(remotePath);
      return true;
    } catch {
      return false;
    }
  }
}
