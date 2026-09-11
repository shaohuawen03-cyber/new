import * as vscode from 'vscode';
import * as fs from 'fs';
import { HostConfig } from './core';

/**
 * SSH 终端 = IDE 原生进程终端(直接跑系统 ssh),与 PowerShell 终端同机制,
 * 在 VS Code / Antigravity / Cursor 等任何分支里都可用。
 * 密码直接在终端里输入(和 xshell 一样),或走预配置的私钥。
 */
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
  const args: string[] = [
    '-p',
    String(cfg.port ?? 22),
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
  if (cfg.privateKeyPath) {
    args.push('-i', cfg.privateKeyPath);
  }
  args.push(`${cfg.username ?? 'root'}@${cfg.host}`);
  return {
    name: `SSH: ${authority}`,
    shellPath: findSshExecutable(),
    shellArgs: args,
  };
}

export async function openSshTerminal(cfg: HostConfig): Promise<vscode.Terminal> {
  const term = vscode.window.createTerminal(sshTerminalOptions(cfg));
  term.show();
  return term;
}
