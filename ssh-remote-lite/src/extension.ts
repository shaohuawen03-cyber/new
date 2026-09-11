import * as vscode from 'vscode';
import { SshFileSystemProvider } from './fs';
import { sshTerminalOptions, openSshTerminal } from './terminal';
import { getConfigForAuthority, makeAuthority, HostConfig } from './ssh';

/** 当前工作区如果是 ssh://, 返回其完整主机配置 */
function currentSshConfig(): HostConfig | undefined {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder && wsFolder.uri.scheme === 'ssh') {
    return getConfigForAuthority(wsFolder.uri.authority);
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  // 注册 ssh:// 文件系统(浏览/编辑远端文件, 走 ssh2/SFTP)
  const fsProvider = new SshFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ssh', fsProvider, {
      isCaseSensitive: true,
    })
  );

  // 注册终端 Profile: 终端面板 "+" 旁边的下拉菜单里会出现 "SSH: user@host:port"
  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider('sshRemoteLite.terminal', {
      provideTerminalProfile(): vscode.TerminalProfile {
        const cfg = currentSshConfig();
        if (!cfg) {
          throw new Error('当前工作区不是 ssh:// 远程工作区,无法创建 SSH 终端');
        }
        return new vscode.TerminalProfile(sshTerminalOptions(cfg));
      },
    })
  );

  // 命令: 连接到主机 —— 弹出输入框, 然后以远程文件夹方式打开工作区
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.connect', async () => {
      const input = await vscode.window.showInputBox({
        prompt: '输入 user@host[:port]/路径, 例如 root@10.0.0.5:22/data/app',
        placeHolder: 'root@10.0.0.5:22/root/project',
        ignoreFocusOut: true,
      });
      if (!input) {
        return;
      }
      const uri = vscode.Uri.parse(`ssh://${input}`);
      await vscode.commands.executeCommand('vscode.openFolder', uri, {
        forceNewWindow: true,
      });
    })
  );

  // 命令: 对当前打开的 ssh:// 工作区开一个 SSH 终端
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.openTerminal', async () => {
      let cfg = currentSshConfig();
      if (!cfg) {
        const input = await vscode.window.showInputBox({
          prompt: '输入 user@host[:port]',
          ignoreFocusOut: true,
        });
        if (!input) {
          return;
        }
        cfg = getConfigForAuthority(input);
      }
      await openSshTerminal(cfg);
    })
  );

  // 预配置主机一键开终端(可选)
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.connectConfigured', async (cfg: HostConfig) => {
      await openSshTerminal(cfg);
    })
  );

  // 打开 ssh:// 工作区时自动开一个 SSH 终端(设置 sshRemoteLite.autoOpenTerminal 可关)
  const cfg = currentSshConfig();
  const autoOpen = vscode.workspace
    .getConfiguration('sshRemoteLite')
    .get<boolean>('autoOpenTerminal', true);
  if (cfg && autoOpen) {
    void openSshTerminal(cfg).then(() => {
      vscode.window.setStatusBarMessage(
        `SSH 终端已打开: ${makeAuthority(cfg)}`,
        8000
      );
    });
  }
}

export function deactivate(): void {
  // 终端是 IDE 原生进程, 窗口关闭自动结束; SFTP 连接随进程退出断开
}
