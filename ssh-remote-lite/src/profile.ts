// 终端 profile 的"单一真相": package.json 的 contributes.terminal.profiles、
// 代码里的 registerTerminalProfileProvider、以及 setDefaultTerminal 写进
// terminal.integrated.defaultProfile.* 的名字, 三处必须完全一致。
// (不 import vscode, 这样 node 单测也能引用它做契约校验。)
export const PROFILE_ID = 'sshRemoteLite.terminal';
export const PROFILE_TITLE = 'SSH Remote Lite';

// ---------------------------------------------------------------- 静态 profile
// 依赖"扩展提供的 profile"有个致命弱点: 只要插件那一刻没被激活(旧版本、
// 另一个 IDE 分支、禁用状态), IDE 就会报
//   No terminal profile provider registered for id "sshRemoteLite.terminal"
// 于是终端又回到本地 shell。所以 setDefaultTerminal 改为同时往设置里写一条
// 普通的 path+args profile —— 那是 IDE 自己的内置机制, 不需要任何插件活着。
export interface StaticProfile {
  path: string;
  args: string[];
  overrideName?: boolean;
}

export interface StaticHost {
  host: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;
}

export function staticProfileName(cfg: StaticHost): string {
  return `${PROFILE_TITLE} (${cfg.username ?? 'root'}@${cfg.host})`;
}

export function buildSshArgs(cfg: StaticHost): string[] {
  const args = ['-p', String(cfg.port ?? 22), '-o', 'StrictHostKeyChecking=accept-new'];
  if (cfg.privateKeyPath) {
    args.push('-o', 'IdentitiesOnly=yes', '-i', cfg.privateKeyPath);
  }
  args.push(`${cfg.username ?? 'root'}@${cfg.host}`);
  return args;
}

export function staticProfileEntry(cfg: StaticHost, sshPath: string): StaticProfile {
  return { path: sshPath, args: buildSshArgs(cfg), overrideName: true };
}

/**
 * 只把"我们这一条"写回全局设置。
 *
 * v0.0.8 的 bug: 用 getConfiguration().get('profiles.windows') 读到的是
 * IDE 默认值 + 用户值 **合并后**的对象, 再整个写回 Global, 等于把一堆内置
 * profile 固化进用户设置 —— 在不同 IDE 分支(Antigravity)里这会让终端整体
 * 失灵。正确做法是只基于 inspect().globalValue(用户自己写过的那份)做增量。
 */
export function mergeProfileSetting(
  existingGlobalValue: Record<string, unknown> | undefined,
  name: string,
  entry: StaticProfile
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(existingGlobalValue ?? {}) };
  out[name] = entry;
  return out;
}

/** settings 里残留的私钥路径可能早就不存在了, 带上 -i 只会让登录失败 */
export function sanitizeKeyPath(
  keyPath: string | undefined,
  exists: (p: string) => boolean
): string | undefined {
  if (!keyPath) {
    return undefined;
  }
  return exists(keyPath) ? keyPath : undefined;
}
