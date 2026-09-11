import * as vscode from 'vscode';
import { ClientChannel } from 'ssh2';
import * as sshfs from './ssh';

/**
 * 用 vscode.window.createTerminal({ pty }) 把 ssh shell 接进 VS Code 终端。
 * 等价于 xshell/mobaxterm 的交互式终端,但跑在最新版 VS Code 里。
 */
export async function openSshTerminal(authority: string): Promise<void> {
  let channel: ClientChannel;
  try {
    const client = await sshfs.acquireConnection(authority);
    channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell(
        { term: 'xterm-256color', cols: 120, rows: 30 },
        (err, ch) => (err ? reject(err) : resolve(ch))
      );
    });
  } catch (err: any) {
    vscode.window.showErrorMessage(`SSH 连接失败: ${err?.message ?? err}`);
    return;
  }

  const writeEmitter = new vscode.EventEmitter<string>();
  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    open: () => {
      channel.on('data', (data: Buffer) => writeEmitter.fire(data.toString('utf8')));
      channel.stderr.on('data', (data: Buffer) => writeEmitter.fire(data.toString('utf8')));
      channel.on('close', () => {
        writeEmitter.fire('\r\n\x1b[90m[连接已关闭]\x1b[0m\r\n');
      });
    },
    close: () => {
      try {
        channel.close();
      } catch {
        /* ignore */
      }
      sshfs.releaseConnection(authority);
    },
    handleInput: (data: string) => {
      channel.write(data);
    },
    setDimensions: (dims: vscode.TerminalDimensions) => {
      try {
        channel.setWindow(dims.rows, dims.columns, 0, 0);
      } catch {
        /* ignore */
      }
    },
  };

  const term = vscode.window.createTerminal({ name: `SSH ${authority}`, pty });
  term.show();
}
