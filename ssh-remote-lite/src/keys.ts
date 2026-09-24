// 本机 SSH 密钥管理(不 import vscode, 方便单测)。
//
// 目标: 用户只提供一次密码, 之后终端全部走密钥, 不再需要输入任何东西。
// 系统 ssh 命令行没有"把密码传进去"的正规办法(sshpass 在 Windows 上也没有),
// 所以正确做法是: 用 ssh2(库, 支持密码) 登录一次 -> 把本机公钥写进远端
// authorized_keys -> 之后终端用 ssh -i <私钥> 免密登录。
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { utils } from 'ssh2';

export interface LocalKeyPair {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
  created: boolean;
}

/** Windows OpenSSH 拒绝"别人也能读"的私钥(bad permissions), node 的 mode 不管 ACL */
export function hardenKeyFile(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  if (process.platform !== 'win32') {
    return;
  }
  const me = process.env.USERNAME || process.env.USER || '';
  const before = (() => {
    try {
      return fs.readFileSync(file).length;
    } catch {
      return -1;
    }
  })();
  try {
    execFileSync('icacls', [file, '/inheritance:r'], { stdio: 'pipe' });
    // grant by well-known SID first: a non-ASCII user name (e.g. Chinese) can
    // fail to match through icacls' code page, and then the file ends up with
    // NO ACE at all - ssh reads nothing and reports "invalid format".
    try {
      execFileSync('icacls', [file, '/grant:r', '*S-1-3-4:R'], { stdio: 'pipe' });
    } catch {
      /* OWNER RIGHTS not supported here - fall through to the name */
    }
    if (me) {
      try {
        execFileSync('icacls', [file, '/grant', `${me}:R`], { stdio: 'pipe' });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  // verify we can still read it; if not, undo the lockdown rather than leave
  // an unusable key behind
  try {
    const after = fs.readFileSync(file).length;
    if (after !== before) {
      throw new Error('size changed');
    }
  } catch {
    try {
      execFileSync('icacls', [file, '/reset'], { stdio: 'pipe' });
    } catch {
      /* ignore */
    }
  }
}

/** 找到(或生成)本机密钥对。sshDir 可注入, 便于测试。 */
export function ensureLocalKeyPair(sshDir?: string): LocalKeyPair {
  const dir = sshDir ?? path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  const candidates = ['id_ed25519', 'id_rsa', 'id_ecdsa'];
  for (const name of candidates) {
    const priv = path.join(dir, name);
    const pub = `${priv}.pub`;
    if (fs.existsSync(priv) && fs.existsSync(pub)) {
      hardenKeyFile(priv);
      return {
        privateKeyPath: priv,
        publicKeyPath: pub,
        publicKey: fs.readFileSync(pub, 'utf8').trim(),
        created: false,
      };
    }
  }
  // 一个都没有 -> 生成一把 ed25519(老服务器的 OpenSSH >= 6.5 都认)
  const kp = utils.generateKeyPairSync('ed25519', { comment: 'ssh-remote-lite' } as never);
  const priv = path.join(dir, 'id_ed25519');
  const pub = `${priv}.pub`;
  fs.writeFileSync(priv, kp.private, { mode: 0o600 });
  fs.writeFileSync(pub, `${kp.public.trim()}\n`);
  hardenKeyFile(priv);
  return {
    privateKeyPath: priv,
    publicKeyPath: pub,
    publicKey: kp.public.trim(),
    created: true,
  };
}
