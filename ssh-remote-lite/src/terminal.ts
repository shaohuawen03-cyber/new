import * as vscode from 'vscode';
import * as fs from 'fs';
import { HostConfig } from './core';

/**
 * SSH 终端 = IDE 原生进程终端(直接跑系统 ssh),与 PowerShell 终端同机制,
 * 在 VS Code / Antigravity / Cursor 等任何分支里都可用。
 * 优先走私钥免密;只有密码时可以自动把密码打进终端(见 openSshTerminal)。
 */

/** 终端下拉菜单里显示的 profile 名称(定义在 profile.ts, 与 package.json 对齐) */
export { PROFILE_ID, PROFILE_TITLE } from './profile';
import { buildSshArgs } from './profile';

export function findSshExecutable(): string {
  const cfgPath = vscode.workspace
    .getConfiguration('sshRemoteLite')
    .get<string>('sshPath', '');
  if (cfgPath) {
    return cfgPath;
  }
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
      'C:\\Program Files\\OpenSSH\\ssh.exe',
      'C:\\Program Files (x86)\\OpenSSH\\ssh.exe',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
  }
  return 'ssh';
}

export function sshTerminalOptions(cfg: HostConfig): vscode.TerminalOptions {
  const authority = `${cfg.username ?? 'root'}@${cfg.host}:${cfg.port ?? 22}`;
  return {
    name: `SSH: ${authority}`,
    shellPath: findSshExecutable(),
    shellArgs: buildSshArgs(cfg),
  };
}

/**
 * 只有密码、没有私钥时的兜底: 等 ssh 打出 password 提示后把密码敲进去。
 * (系统 ssh 只从 tty 读密码,所以只能"打字";正规路径仍是 ensurePasswordlessLogin。)
 */
export function autoTypePassword(term: vscode.Terminal, password: string, delayMs = 1500): void {
  setTimeout(() => {
    try {
      term.sendText(password, true);
    } catch {
      /* 终端可能已被关闭 */
    }
  }, delayMs);
}

export async function openSshTerminal(
  cfg: HostConfig,
  opts?: { autoPassword?: boolean }
): Promise<vscode.Terminal> {
  const term = vscode.window.createTerminal(sshTerminalOptions(cfg));
  term.show();
  if (!cfg.privateKeyPath && cfg.password && opts?.autoPassword !== false) {
    autoTypePassword(term, cfg.password);
  }
  return term;
}
