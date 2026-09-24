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
/** 当前用户的 SID(ASCII, 不受中文用户名/代码页影响) */
export function currentUserSid(): string {
  try {
    const out = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    const m = /S-1-[0-9-]+/.exec(out);
    return m ? m[0] : '';
  } catch {
    return '';
  }
}

export function hardenKeyFile(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  if (process.platform !== 'win32') {
    return;
  }
  // 为什么用 SID 而不是用户名: 中文用户名经 icacls 的代码页常常匹配失败,
  // 结果文件一个 ACE 都不剩 -> ssh 读不到内容, 报 "Load key: invalid format"。
  // 为什么不用 OWNER RIGHTS(*S-1-3-4): ssh 不认它是属主, 会判 "bad permissions"。
  const sid = currentUserSid();
  // icacls 要求 SID 以 * 开头, 否则 "No mapping between account names and
  // security IDs" -> 授权失败 -> 文件仍是继承来的宽松 ACL -> ssh 报
  // "bad permissions" (round 13 实测)。
  const principal = sid ? `*${sid}` : process.env.USERNAME || process.env.USER || '';
  if (!principal) {
    return;
  }
  const before = (() => {
    try {
      return fs.readFileSync(file).length;
    } catch {
      return -1;
    }
  })();
  try {
    execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${principal}:F`], {
      stdio: 'pipe',
    });
  } catch {
    /* ignore - 下面的自检会兜底 */
  }
  let ok = false;
  try {
    ok = fs.readFileSync(file).length === before && before > 0;
  } catch {
    ok = false;
  }
  if (!ok && principal.startsWith('*')) {
    // SID 路线失败时退回用户名(这是 v0.0.6~0.0.9 一直有效的写法)
    try {
      execFileSync(
        'icacls',
        [file, '/inheritance:r', '/grant:r', `${process.env.USERNAME || ''}:R`],
        { stdio: 'pipe' }
      );
      ok = fs.readFileSync(file).length === before && before > 0;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
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
