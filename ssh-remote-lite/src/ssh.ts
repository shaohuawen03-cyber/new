import * as vscode from 'vscode';
import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface HostConfig {
  name?: string;
  host: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

/** authority 格式: user@host:port (port 缺省 22) */
export function parseAuthority(authority: string): HostConfig {
  // ssh://user@host:port/...
  const at = authority.lastIndexOf('@');
  const username = at >= 0 ? authority.slice(0, at) : undefined;
  const rest = at >= 0 ? authority.slice(at + 1) : authority;
  const [host, portStr] = rest.split(':');
  return { host, port: portStr ? parseInt(portStr, 10) : 22, username };
}

export function makeAuthority(cfg: HostConfig): string {
  const user = cfg.username ?? 'root';
  const port = cfg.port ?? 22;
  return `${user}@${cfg.host}:${port}`;
}

function expandHome(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** 合并: 内置解析的 authority + 用户在 settings 里预配置的凭据 */
function resolveConfig(authority: string): HostConfig {
  const parsed = parseAuthority(authority);
  const hosts: HostConfig[] =
    vscode.workspace.getConfiguration('sshRemoteLite').get('hosts', []) || [];
  const pre = hosts.find(
    (h) =>
      h.host === parsed.host &&
      (h.port ?? 22) === (parsed.port ?? 22) &&
      (!h.username || !parsed.username || h.username === parsed.username)
  );
  return {
    host: parsed.host,
    port: parsed.port ?? 22,
    username: parsed.username ?? pre?.username ?? 'root',
    password: pre?.password,
    privateKeyPath: pre?.privateKeyPath,
    passphrase: pre?.passphrase,
  };
}

interface ManagedConnection {
  client: Client;
  sftp: SFTPWrapper | null;
  refCount: number;
}

const connections = new Map<string, ManagedConnection>();

function promptPassword(cfg: HostConfig): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    prompt: `输入 ${cfg.username}@${cfg.host} 的 SSH 密码`,
    password: true,
    ignoreFocusOut: true,
  });
}

async function connectConfig(cfg: HostConfig): Promise<Client> {
  const connectCfg: ConnectConfig = {
    host: cfg.host,
    port: cfg.port ?? 22,
    username: cfg.username ?? 'root',
    readyTimeout: 15000,
    keepaliveInterval: 20000,
  };

  if (cfg.privateKeyPath) {
    connectCfg.privateKey = fs.readFileSync(expandHome(cfg.privateKeyPath));
    if (cfg.passphrase) {
      connectCfg.passphrase = cfg.passphrase;
    }
  } else if (cfg.password) {
    connectCfg.password = cfg.password;
  } else {
    const pw = await promptPassword(cfg);
    if (!pw) {
      throw new Error('未提供密码,已取消连接');
    }
    connectCfg.password = pw;
  }

  return new Promise<Client>((resolve, reject) => {
    const client = new Client();
    client.once('ready', () => resolve(client));
    client.once('error', (err) => reject(err));
    client.connect(connectCfg);
  });
}

/** refCount>0 表示有调用方(如终端)需要持有连接; 文件系统使用时不计引用 */
export async function getConnection(authority: string): Promise<Client> {
  const existing = connections.get(authority);
  if (existing) {
    return existing.client;
  }
  const cfg = resolveConfig(authority);
  const client = await connectConfig(cfg);
  const managed: ManagedConnection = { client, sftp: null, refCount: 0 };
  connections.set(authority, managed);
  client.once('close', () => {
    connections.delete(authority);
  });
  return client;
}

export function acquireConnection(authority: string): Promise<Client> {
  return getConnection(authority).then((client) => {
    const managed = connections.get(authority);
    if (managed) {
      managed.refCount++;
    }
    return client;
  });
}

export async function getSftp(authority: string): Promise<SFTPWrapper> {
  await getConnection(authority);
  const managed = connections.get(authority);
  if (!managed) {
    throw new Error(`SSH 连接不可用: ${authority}`);
  }
  if (managed.sftp) {
    return managed.sftp;
  }
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    managed.client.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
  managed.sftp = sftp;
  return sftp;
}

export function releaseConnection(authority: string): void {
  const managed = connections.get(authority);
  if (!managed) {
    return;
  }
  managed.refCount--;
  if (managed.refCount <= 0) {
    managed.client.end();
    connections.delete(authority);
  }
}

export function listConnectedAuthorities(): string[] {
  return Array.from(connections.keys());
}

/** 把 ssh2 回调式 API 包装成 Promise */
export function call<T>(fn: (cb: (err: any, result?: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn((err, result) => (err ? reject(err) : resolve(result as T)));
  });
}


