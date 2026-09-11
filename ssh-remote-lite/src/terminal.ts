import * as vscode from 'vscode';
import { ClientChannel } from 'ssh2';
import * as sshfs from './ssh';

/**
 * 用 vscode.window.createTerminal({ pty }) 把 ssh shell 接进 VS Code / Antigravity 终端。
 * 等价于 xshell/mobaxterm 的交互式终端,支持窗口大小同步。
 * 连接在 open() 里惰性建立, 失败时把错误直接打印到终端面板。
 */
export function makeSshPty(authority: string): vscode.Pseudoterminal {
  const writeEmitter = new vscode.EventEmitter<string>();
  let channel: ClientChannel | undefined;

  return {
    onDidWrite: writeEmitter.event,
    open: async () => {
      try {
        const client = await sshfs.acquireConnection(authority);
        channel = await new Promise<ClientChannel>((resolve, reject) => {
          client.shell(
            { term: 'xterm-256color', cols: 120, rows: 30 },
            (err, ch) => (err ? reject(err) : resolve(ch))
          );
        });
        channel.on('data', (data: Buffer) => writeEmitter.fire(data.toString('utf8')));
        channel.stderr.on('data', (data: Buffer) => writeEmitter.fire(data.toString('utf8')));
        channel.on('close', () => {
          writeEmitter.fire('\r\n\x1b[90m[连接已关闭]\x1b[0m\r\n');
        });
      } catch (err: any) {
        writeEmitter.fire(`\r\n\x1b[31mSSH 连接失败: ${err?.message ?? err}\x1b[0m\r\n`);
      }
    },
    close: () => {
      try {
        channel?.close();
      } catch {
        /* ignore */
      }
      sshfs.releaseConnection(authority);
    },
    handleInput: (data: string) => {
      channel?.write(data);
    },
    setDimensions: (dims: vscode.TerminalDimensions) => {
      try {
        channel?.setWindow(dims.rows, dims.columns, 0, 0);
      } catch {
        /* ignore */
      }
    },
  };
}

export async function openSshTerminal(authority: string): Promise<vscode.Terminal> {
  const term = vscode.window.createTerminal({
    name: `SSH: ${authority}`,
    pty: makeSshPty(authority),
  });
  term.show();
  return term;
}
