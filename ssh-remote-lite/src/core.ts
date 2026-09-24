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
    readyTimeout: 20000,
    keepaliveInterval: 20000,
    // 老服务器(CentOS 7 / OpenSSH 7.4 及更早)常常只给这些算法,
    // ssh2 的默认列表已经把它们摘掉了 -> 握手直接失败
    algorithms: {
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-512',
        'rsa-sha2-256',
        'ssh-rsa',
      ],
      kex: [
        'curve25519-sha256',
        'curve25519-sha256@libssh.org',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group16-sha512',
        'diffie-hellman-group14-sha1',
      ],
    },
    // 很多服务器把密码登录放在 keyboard-interactive 里(PAM),
    // 只发 password 会被拒 -> 用户看到"密码不对"(实测 2026-09-24)
    tryKeyboard: true,
  } as ConnectConfig;
  if (cfg.privateKeyPath) {
    connectCfg.privateKey = fs.readFileSync(expandHome(cfg.privateKeyPath));
    if (cfg.passphrase) {
      connectCfg.passphrase = cfg.passphrase;
    }
  }
  if (cfg.password) {
    // 两个都给: 私钥不被接受时还能退回密码
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
    // PAM/keyboard-interactive: 服务器逐条问, 我们用同一个密码回答
    (client as unknown as NodeJS.EventEmitter).on(
      'keyboard-interactive',
      (
        _name: string,
        _instructions: string,
        _lang: string,
        prompts: Array<{ prompt: string; echo: boolean }>,
        finish: (answers: string[]) => void
      ) => {
        if (!cfg.password) {
          finish([]);
          return;
        }
        finish(prompts.map(() => cfg.password as string));
      }
    );
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

/** 在远端执行一条命令, 返回退出码与输出 */
export function execCommand(
  client: Client,
  command: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        return reject(err);
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
      stream.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      stream.on('close', (code: number) => {
        stream.close();
        resolve({ code: code ?? null, stdout, stderr });
      });
      stream.end();
    });
  });
}

/** 生成"把公钥写入远端 authorized_keys"的 shell 命令(base64 传输, 避免转义问题) */
export function buildAuthorizeKeyCommand(pubKey: string): string {
  const b64 = Buffer.from(`${pubKey.trim()}\n`).toString('base64');
  return (
    'mkdir -p ~/.ssh && chmod 700 ~/.ssh && ' +
    `echo ${b64} | base64 -d >> ~/.ssh/authorized_keys && ` +
    'chmod 600 ~/.ssh/authorized_keys'
  );
}
