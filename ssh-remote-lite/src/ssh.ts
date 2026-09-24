import * as vscode from 'vscode';
import { Client, SFTPWrapper } from 'ssh2';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HostConfig, parseAuthority, connectWithConfig, startSftp } from './core';

export { call, makeAuthority } from './core';
export type { HostConfig } from './core';

interface ManagedConnection {
  client: Client;
  sftp: SFTPWrapper | null;
  /** refCount>0 表示有终端等调用方需要持有连接 */
  refCount: number;
}

const connections = new Map<string, ManagedConnection>();

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

function promptPassword(cfg: HostConfig): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    prompt: `输入 ${cfg.username}@${cfg.host} 的 SSH 密码`,
    password: true,
    ignoreFocusOut: true,
  });
}

export async function getConnection(authority: string): Promise<Client> {
  const existing = connections.get(authority);
  if (existing) {
    return existing.client;
  }
  const cfg = resolveConfig(authority);
  // 先试本机已有的私钥(很多人 ~/.ssh/config 早就配好了免密, 例如
  // IdentityFile ~/.ssh/id_ed25519) —— 能免密就绝不该弹密码框
  let client: Client | undefined;
  if (!cfg.privateKeyPath) {
    for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
      const p = path.join(os.homedir(), '.ssh', name);
      if (!fs.existsSync(p)) {
        continue;
      }
      try {
        client = await connectWithConfig({ ...cfg, privateKeyPath: p });
        break;
      } catch {
        /* 这把钥匙不行, 试下一把 */
      }
    }
  }
  if (!client && !cfg.password && !cfg.privateKeyPath) {
    const pw = await promptPassword(cfg);
    if (!pw) {
      throw new Error('未提供密码/私钥,已取消连接');
    }
    cfg.password = pw;
  }
  if (!client) {
    client = await connectWithConfig(cfg);
  }
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
  managed.sftp = await startSftp(managed.client);
  return managed.sftp;
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

/** 供终端/外部使用: 解析当前 authority 的完整配置(合并 settings 预配置) */
export function getConfigForAuthority(authority: string): HostConfig {
  return resolveConfig(authority);
}

/** 关掉所有池化连接(集成测试收尾用: 留着的连接会让宿主退出码变成 1) */
export function closeAllConnections(): void {
  for (const [authority, managed] of Array.from(connections.entries())) {
    try {
      managed.client.end();
    } catch {
      /* ignore */
    }
    connections.delete(authority);
  }
}
