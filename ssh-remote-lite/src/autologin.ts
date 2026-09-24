// 密码 -> 免密 的自动化:
//   1. 本机没有密钥就生成一把;
//   2. 用 ssh2(支持密码) 登录一次, 把公钥写进远端 ~/.ssh/authorized_keys;
//   3. 返回带 privateKeyPath 的配置, 之后终端 ssh -i <key> 直接进去, 不再问密码。
// 失败也不阻塞: 返回原配置, 终端会照常打开(由调用方决定是否自动输入密码)。
import { HostConfig, connectWithConfig, execCommand, buildAuthorizeKeyCommand } from './core';
import { ensureLocalKeyPair } from './keys';

export interface AutoLoginResult {
  cfg: HostConfig;
  deployed: boolean;
  keyPath?: string;
  error?: string;
}

/** 已经有可用私钥就直接返回; 只有密码时才去部署公钥。 */
export async function ensurePasswordlessLogin(
  cfg: HostConfig,
  sshDir?: string
): Promise<AutoLoginResult> {
  if (cfg.privateKeyPath) {
    return { cfg, deployed: false, keyPath: cfg.privateKeyPath };
  }
  if (!cfg.password) {
    return { cfg, deployed: false, error: '没有密码也没有私钥,无法自动配置免密' };
  }
  let keyPath = '';
  try {
    const kp = ensureLocalKeyPair(sshDir);
    keyPath = kp.privateKeyPath;
    const client = await connectWithConfig(cfg);
    try {
      const r = await execCommand(client, buildAuthorizeKeyCommand(kp.publicKey));
      if (r.code !== 0) {
        return { cfg, deployed: false, error: `远端写 authorized_keys 失败(code=${r.code}) ${r.stderr}` };
      }
    } finally {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
    return {
      cfg: { ...cfg, privateKeyPath: keyPath },
      deployed: true,
      keyPath,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { cfg, deployed: false, keyPath: keyPath || undefined, error: msg };
  }
}
