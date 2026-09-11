import { Server, utils } from 'ssh2';
import * as crypto from 'crypto';
import * as path from 'path';

const { OPEN_MODE, STATUS_CODE } = utils.sftp;

export interface MemNode {
  type: 'file' | 'dir';
  content?: Buffer;
  mtime: number;
  mode: number;
}

export class InMemoryFS {
  private nodes = new Map<string, MemNode>();

  constructor() {
    // Root directory
    this.nodes.set('/', {
      type: 'dir',
      mtime: Math.floor(Date.now() / 1000),
      mode: 0o755 | 0o040000 // S_IFDIR
    });
  }

  private normalize(p: string): string {
    let norm = p.replace(/\\/g, '/');
    if (!norm.startsWith('/')) norm = '/' + norm;
    norm = path.posix.normalize(norm);
    if (norm.length > 1 && norm.endsWith('/')) norm = norm.slice(0, -1);
    return norm;
  }

  mkdir(p: string): boolean {
    const norm = this.normalize(p);
    if (this.nodes.has(norm)) return false;
    const parent = path.posix.dirname(norm);
    if (parent !== norm && !this.nodes.has(parent)) {
      this.mkdir(parent);
    }
    this.nodes.set(norm, {
      type: 'dir',
      mtime: Math.floor(Date.now() / 1000),
      mode: 0o755 | 0o040000
    });
    return true;
  }

  rmdir(p: string): boolean {
    const norm = this.normalize(p);
    const node = this.nodes.get(norm);
    if (!node || node.type !== 'dir') return false;

    // Check if directory has children
    for (const k of this.nodes.keys()) {
      if (k !== norm && (k.startsWith(norm + '/') || (norm === '/' && k !== '/'))) {
        return false; // Not empty
      }
    }
    this.nodes.delete(norm);
    return true;
  }

  writeFile(p: string, content: Buffer): void {
    const norm = this.normalize(p);
    const parent = path.posix.dirname(norm);
    if (!this.nodes.has(parent)) {
      this.mkdir(parent);
    }
    this.nodes.set(norm, {
      type: 'file',
      content: Buffer.from(content),
      mtime: Math.floor(Date.now() / 1000),
      mode: 0o644 | 0o100000 // S_IFREG
    });
  }

  readFile(p: string): Buffer | null {
    const norm = this.normalize(p);
    const node = this.nodes.get(norm);
    if (!node || node.type !== 'file') return null;
    return node.content || Buffer.alloc(0);
  }

  unlink(p: string): boolean {
    const norm = this.normalize(p);
    const node = this.nodes.get(norm);
    if (!node || node.type !== 'file') return false;
    this.nodes.delete(norm);
    return true;
  }

  rename(oldPath: string, newPath: string): boolean {
    const oldNorm = this.normalize(oldPath);
    const newNorm = this.normalize(newPath);
    const node = this.nodes.get(oldNorm);
    if (!node) return false;

    this.nodes.delete(oldNorm);
    this.nodes.set(newNorm, node);

    // If directory, move all subpaths
    if (node.type === 'dir') {
      const prefix = oldNorm === '/' ? '/' : oldNorm + '/';
      const toMove: Array<[string, MemNode]> = [];
      for (const [k, v] of this.nodes.entries()) {
        if (k.startsWith(prefix)) {
          toMove.push([k, v]);
        }
      }
      for (const [k, v] of toMove) {
        this.nodes.delete(k);
        const sub = k.substring(prefix.length);
        const target = (newNorm === '/' ? '' : newNorm) + '/' + sub;
        this.nodes.set(target, v);
      }
    }
    return true;
  }

  stat(p: string): MemNode | null {
    const norm = this.normalize(p);
    return this.nodes.get(norm) || null;
  }

  readdir(p: string): Array<{ filename: string; longname: string; attrs: any }> | null {
    const norm = this.normalize(p);
    const node = this.nodes.get(norm);
    if (!node || node.type !== 'dir') return null;

    const results: Array<{ filename: string; longname: string; attrs: any }> = [];
    const directChildren = new Set<string>();

    const prefix = norm === '/' ? '/' : norm + '/';
    for (const k of this.nodes.keys()) {
      if (k !== norm && k.startsWith(prefix)) {
        const rel = k.substring(prefix.length);
        const childName = rel.split('/')[0];
        if (childName && !directChildren.has(childName)) {
          directChildren.add(childName);
          const childPath = prefix + childName;
          const childNode = this.nodes.get(childPath);
          const isDir = childNode ? childNode.type === 'dir' : false;
          const mode = childNode ? childNode.mode : 0o644;
          const size = childNode?.content?.length ?? 0;
          const mtime = childNode?.mtime ?? Math.floor(Date.now() / 1000);

          results.push({
            filename: childName,
            longname: `${isDir ? 'd' : '-'}rwxr-xr-x 1 root root ${size} Jan 1 00:00 ${childName}`,
            attrs: {
              mode,
              uid: 0,
              gid: 0,
              size,
              atime: mtime,
              mtime
            }
          });
        }
      }
    }
    return results;
  }
}

export interface TestServerInstance {
  port: number;
  host: string;
  fs: InMemoryFS;
  close: () => Promise<void>;
}

export async function createEmbeddedSSHServer(options?: {
  port?: number;
  username?: string;
  password?: string;
}): Promise<TestServerInstance> {
  const expectedUser = options?.username || 'testuser';
  const expectedPass = options?.password || 'testpass';

  // Generate ephemeral RSA host key
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
  });

  const memFs = new InMemoryFS();

  // Create standard directories
  memFs.mkdir('/root');
  memFs.mkdir('/home/testuser');

  return new Promise((resolve, reject) => {
    let nextHandleId = 1;
    const handles = new Map<number, {
      path: string;
      type: 'file' | 'dir';
      flags?: number;
      offset?: number;
      readDirDone?: boolean;
    }>();

    const server = new Server(
      {
        hostKeys: [privateKey]
      },
      (client) => {
        client.on('authentication', (ctx) => {
          if (ctx.method === 'password') {
            if (ctx.username === expectedUser && ctx.password === expectedPass) {
              ctx.accept();
            } else {
              ctx.reject();
            }
          } else {
            ctx.reject(['password']);
          }
        });

        client.on('ready', () => {
          client.on('session', (acceptSession) => {
            const session = acceptSession();

            // Handle SFTP
            session.on('sftp', (acceptSFTP) => {
              const sftpStream: any = acceptSFTP();

              sftpStream.on('REALPATH', (reqId: number, reqPath: string) => {
                let resolved = reqPath || '/';
                if (resolved === '.') resolved = '/home/testuser';
                else if (resolved === '~' || resolved.startsWith('~/')) {
                  resolved = '/home/testuser' + (resolved === '~' ? '' : resolved.substring(1));
                }
                sftpStream.name(reqId, [{ filename: resolved, longname: resolved, attrs: {} as any }]);
              });

              sftpStream.on('STAT', (reqId: number, p: string) => {
                const node = memFs.stat(p);
                if (!node) {
                  sftpStream.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                  return;
                }
                sftpStream.attrs(reqId, {
                  mode: node.mode,
                  uid: 0,
                  gid: 0,
                  size: node.content?.length || 0,
                  atime: node.mtime,
                  mtime: node.mtime
                });
              });

              sftpStream.on('LSTAT', (reqId: number, p: string) => {
                const node = memFs.stat(p);
                if (!node) {
                  sftpStream.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                  return;
                }
                sftpStream.attrs(reqId, {
                  mode: node.mode,
                  uid: 0,
                  gid: 0,
                  size: node.content?.length || 0,
                  atime: node.mtime,
                  mtime: node.mtime
                });
              });

              sftpStream.on('OPEN', (reqId: number, p: string, flags: number) => {
                const node = memFs.stat(p);
                const isCreat = (flags & OPEN_MODE.CREAT) !== 0;
                const isTrunc = (flags & OPEN_MODE.TRUNC) !== 0;

                if (!node && !isCreat) {
                  sftpStream.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                  return;
                }

                if (!node && isCreat) {
                  memFs.writeFile(p, Buffer.alloc(0));
                } else if (node && isTrunc) {
                  memFs.writeFile(p, Buffer.alloc(0));
                }

                const handleId = nextHandleId++;
                handles.set(handleId, { path: p, type: 'file', flags });
                const handleBuf = Buffer.alloc(4);
                handleBuf.writeUInt32BE(handleId, 0);
                sftpStream.handle(reqId, handleBuf);
              });

              sftpStream.on('READ', (reqId: number, handle: Buffer, offset: number, length: number) => {
                const handleId = handle.readUInt32BE(0);
                const info = handles.get(handleId);
                if (!info) {
                  sftpStream.status(reqId, STATUS_CODE.FAILURE);
                  return;
                }
                const content = memFs.readFile(info.path);
                if (content === null) {
                  sftpStream.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                  return;
                }
                if (offset >= content.length) {
                  sftpStream.status(reqId, STATUS_CODE.EOF);
                  return;
                }
                const chunk = content.slice(offset, offset + length);
                sftpStream.data(reqId, chunk);
              });

              sftpStream.on('WRITE', (reqId: number, handle: Buffer, offset: number, data: Buffer) => {
                const handleId = handle.readUInt32BE(0);
                const info = handles.get(handleId);
                if (!info) {
                  sftpStream.status(reqId, STATUS_CODE.FAILURE);
                  return;
                }
                let content = memFs.readFile(info.path) || Buffer.alloc(0);
                if (offset + data.length > content.length) {
                  const newBuf = Buffer.alloc(offset + data.length);
                  content.copy(newBuf, 0, 0, content.length);
                  content = newBuf;
                }
                data.copy(content, offset, 0, data.length);
                memFs.writeFile(info.path, content);
                sftpStream.status(reqId, STATUS_CODE.OK);
              });

              sftpStream.on('CLOSE', (reqId: number, handle: Buffer) => {
                const handleId = handle.readUInt32BE(0);
                handles.delete(handleId);
                sftpStream.status(reqId, STATUS_CODE.OK);
              });

              sftpStream.on('OPENDIR', (reqId: number, p: string) => {
                const node = memFs.stat(p);
                if (!node || node.type !== 'dir') {
                  sftpStream.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                  return;
                }
                const handleId = nextHandleId++;
                handles.set(handleId, { path: p, type: 'dir', readDirDone: false });
                const handleBuf = Buffer.alloc(4);
                handleBuf.writeUInt32BE(handleId, 0);
                sftpStream.handle(reqId, handleBuf);
              });

              sftpStream.on('READDIR', (reqId: number, handle: Buffer) => {
                const handleId = handle.readUInt32BE(0);
                const info = handles.get(handleId);
                if (!info || info.type !== 'dir') {
                  sftpStream.status(reqId, STATUS_CODE.FAILURE);
                  return;
                }
                if (info.readDirDone) {
                  sftpStream.status(reqId, STATUS_CODE.EOF);
                  return;
                }
                info.readDirDone = true;
                const entries = memFs.readdir(info.path);
                if (entries === null) {
                  sftpStream.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                  return;
                }
                sftpStream.name(reqId, entries);
              });

              sftpStream.on('MKDIR', (reqId: number, p: string) => {
                const ok = memFs.mkdir(p);
                sftpStream.status(reqId, ok ? STATUS_CODE.OK : STATUS_CODE.FAILURE);
              });

              sftpStream.on('RMDIR', (reqId: number, p: string) => {
                const ok = memFs.rmdir(p);
                sftpStream.status(reqId, ok ? STATUS_CODE.OK : STATUS_CODE.FAILURE);
              });

              sftpStream.on('REMOVE', (reqId: number, p: string) => {
                const ok = memFs.unlink(p);
                sftpStream.status(reqId, ok ? STATUS_CODE.OK : STATUS_CODE.NO_SUCH_FILE);
              });

              sftpStream.on('RENAME', (reqId: number, oldPath: string, newPath: string) => {
                const ok = memFs.rename(oldPath, newPath);
                sftpStream.status(reqId, ok ? STATUS_CODE.OK : STATUS_CODE.FAILURE);
              });
            });

            // Handle PTY request
            session.on('pty', (acceptPty) => {
              acceptPty();
            });

            session.on('window-change', (acceptWin) => {
              if (acceptWin) acceptWin();
            });

            // Handle Interactive Shell
            session.on('shell', (acceptShell) => {
              const stream = acceptShell();
              stream.write('Welcome to SSH Remote Lite In-Process Server\r\n$ ');
              stream.on('data', (data: Buffer) => {
                // Terminal echo back
                stream.write(data);
              });
            });
          });
        });
      }
    );

    server.listen(options?.port || 0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        host: '127.0.0.1',
        fs: memFs,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          })
      });
    });

    server.on('error', (err: any) => reject(err));
  });
}
