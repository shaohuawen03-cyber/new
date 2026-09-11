import * as vscode from 'vscode';
import { SshFileSystemProvider } from './fs';
import { openSshTerminal } from './terminal';
import { makeAuthority, HostConfig } from './ssh';

export function activate(context: vscode.ExtensionContext): void {
  // 注册 ssh:// 文件系统
  const fsProvider = new SshFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ssh', fsProvider, {
      isCaseSensitive: true,
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
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      let authority: string | undefined;
      if (wsFolder && wsFolder.uri.scheme === 'ssh') {
        authority = wsFolder.uri.authority;
      }
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
      const authority = makeAuthority(cfg);
      await openSshTerminal(authority);
    })
  );
}

export function deactivate(): void {
  // 连接由 ssh2 keepalive 管理, 窗口关闭时进程退出即断开
}
