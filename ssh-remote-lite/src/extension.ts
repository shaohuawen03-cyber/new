import * as vscode from 'vscode';
import { SshFileSystemProvider } from './fs';
import { makeSshPty, openSshTerminal } from './terminal';
import { makeAuthority, HostConfig } from './ssh';

function currentSshAuthority(): string | undefined {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder && wsFolder.uri.scheme === 'ssh') {
    return wsFolder.uri.authority;
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  // 注册 ssh:// 文件系统
  const fsProvider = new SshFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ssh', fsProvider, {
      isCaseSensitive: true,
    })
  );

  // 注册终端 Profile: 终端面板 "+" 旁边的下拉菜单里会出现 "SSH: user@host:port",
  // 也可以在 "Select Default Profile" 里把它设为默认终端
  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider('sshRemoteLite.terminal', {
      provideTerminalProfile(): vscode.TerminalProfile {
        const authority = currentSshAuthority();
        if (!authority) {
          throw new Error('当前工作区不是 ssh:// 远程工作区,无法创建 SSH 终端');
        }
        return new vscode.TerminalProfile({
          name: `SSH: ${authority}`,
          pty: makeSshPty(authority),
        });
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

  // 命令: 对当前打开的 ssh:// 工作区开一个终端
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.openTerminal', async () => {
      let authority = currentSshAuthority();
      if (!authority) {
        const input = await vscode.window.showInputBox({
          prompt: '输入 user@host[:port]',
          ignoreFocusOut: true,
        });
        if (!input) {
          return;
        }
        authority = input;
      }
      await openSshTerminal(authority);
    })
  );

  // 让预配置主机出现在命令面板/状态栏提示中(可选)
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.connectConfigured', async (cfg: HostConfig) => {
      await openSshTerminal(makeAuthority(cfg));
    })
  );

  // 打开 ssh:// 工作区时自动开一个 SSH 终端(设置 sshRemoteLite.autoOpenTerminal 可关)
  const authority = currentSshAuthority();
  const autoOpen = vscode.workspace
    .getConfiguration('sshRemoteLite')
    .get<boolean>('autoOpenTerminal', true);
  if (authority && autoOpen) {
    void openSshTerminal(authority).then((term) => {
      void term;
      vscode.window.setStatusBarMessage(`SSH 终端已打开: ${authority}`, 8000);
    });
  }
}

export function deactivate(): void {
  // 连接由 ssh2 keepalive 管理, 窗口关闭时进程退出即断开
}
