/**
 * 纯 Node 层: 不依赖 vscode 模块, 可以被 node --test 直接测试。
 * 也是插件在 Antigravity / VS Code / 各 VS Code 分支里运行的公共底座。
 */
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

/** authority 格式: user@host:port (port 缺省 22, 兼容 ssh:// 的 authority 部分) */
export function parseAuthority(authority: string): HostConfig {
  const at = authority.lastIndexOf('@');
  const username = at >= 0 ? authority.slice(0, at) : undefined;
  const rest = at >= 0 ? authority.slice(at + 1) : authority;
  const [host, portStr] = rest.split(':');
  const parsedPort = portStr ? parseInt(portStr, 10) : NaN;
  return {
    host,
    port: Number.isFinite(parsedPort) ? parsedPort : 22,
    username: username || undefined,
  };
}

export function makeAuthority(cfg: HostConfig): string {
  return `${cfg.username ?? 'root'}@${cfg.host}:${cfg.port ?? 22}`;
}

export function expandHome(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export function buildConnectConfig(cfg: HostConfig): ConnectConfig {
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
  }
  return connectCfg;
}

export function connectWithConfig(cfg: HostConfig): Promise<Client> {
  return new Promise<Client>((resolve, reject) => {
    const client = new Client();
    let settled = false;
    // 保留常驻 error 监听, 避免连接建立后的网络错误变成 unhandled 'error'
    client.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    client.once('ready', () => {
      settled = true;
      resolve(client);
    });
    client.connect(buildConnectConfig(cfg));
  });
}

export function startSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

/** 把 ssh2 回调式 API 包装成 Promise */
export function call<T>(
  fn: (cb: (err: Error | null | undefined, result?: T) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn((err, result) => (err ? reject(err) : resolve(result as T)));
  });
}
