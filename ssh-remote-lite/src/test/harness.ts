/**
 * 测试用的内嵌 SSH 服务器: 密码认证 + 内存文件系统 SFTP + echo shell。
 * 让自动化测试不依赖真实远程主机。
 */
import { AddressInfo } from 'net';
import { Server, SFTPWrapper, Attributes, utils } from 'ssh2';
import * as nodePath from 'path';

const { OPEN_MODE, STATUS_CODE } = utils.sftp;

export class MemFs {
  files = new Map<string, Buffer>();
  dirs = new Set<string>(['/']);

  norm(p: string): string {
    const n = nodePath.posix.normalize(p || '/');
    return n === '.' ? '/' : n;
  }

  isFile(p: string): boolean {
    return this.files.has(this.norm(p));
  }

  isDir(p: string): boolean {
    return this.dirs.has(this.norm(p));
  }

  exists(p: string): boolean {
    const n = this.norm(p);
    return this.files.has(n) || this.dirs.has(n);
  }

  attrs(p: string): Attributes {
    const n = this.norm(p);
    const now = Math.floor(Date.now() / 1000);
    if (this.files.has(n)) {
      return { mode: 0o100644, uid: 0, gid: 0, size: this.files.get(n)!.length, atime: now, mtime: now };
    }
    return { mode: 0o40755, uid: 0, gid: 0, size: 0, atime: now, mtime: now };
  }

  /** 目录的直接子项(文件 + 子目录) */
  children(dir: string): string[] {
    const d = this.norm(dir);
    const prefix = d === '/' ? '/' : `${d}/`;
    const names = new Set<string>();
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix)) {
        names.add(f.slice(prefix.length).split('/')[0]);
      }
    }
    for (const sub of this.dirs) {
      if (sub !== d && sub.startsWith(prefix)) {
        names.add(sub.slice(prefix.length).split('/')[0]);
      }
    }
    return Array.from(names);
  }

  rename(src: string, dst: string): boolean {
    const s = this.norm(src);
    const dd = this.norm(dst);
    if (this.files.has(s)) {
      this.files.set(dd, this.files.get(s)!);
      this.files.delete(s);
      return true;
    }
    if (this.dirs.has(s)) {
      this.dirs.delete(s);
      this.dirs.add(dd);
      return true;
    }
    return false;
  }
}

function readSshString(buf: Buffer, offset: number): { value: string; next: number } {
  const len = buf.readUInt32BE(offset);
  return { value: buf.toString('utf8', offset + 4, offset + 4 + len), next: offset + 4 + len };
}

function wireSftp(sftp: SFTPWrapper, mem: MemFs): void {
  let handleSeq = 0;
  const openHandles = new Map<number, { kind: 'file' | 'dir'; path: string; dirSent: boolean }>();

  const mkHandle = (kind: 'file' | 'dir', path: string): Buffer => {
    const id = ++handleSeq;
    openHandles.set(id, { kind, path: mem.norm(path), dirSent: false });
    const b = Buffer.alloc(4);
    b.writeUInt32BE(id, 0);
    return b;
  };
  const getHandle = (h: Buffer) =>
    h.length === 4 ? openHandles.get(h.readUInt32BE(0)) : undefined;

  sftp.on('OPEN', (reqid, filename, flags) => {
    const n = mem.norm(filename);
    const exists = mem.isFile(n);
    const writing = !!(flags & OPEN_MODE.WRITE);
    if (!exists && !(flags & OPEN_MODE.CREAT)) {
      return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    }
    if (!exists) {
      mem.files.set(n, Buffer.alloc(0));
    } else if (writing && flags & OPEN_MODE.TRUNC) {
      mem.files.set(n, Buffer.alloc(0));
    }
    sftp.handle(reqid, mkHandle('file', n));
  });

  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const h = getHandle(handle);
    if (!h || h.kind !== 'file' || !mem.isFile(h.path)) {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    let buf = mem.files.get(h.path)!;
    const end = offset + data.length;
    if (end > buf.length) {
      const grown = Buffer.alloc(end);
      buf.copy(grown);
      buf = grown;
    }
    data.copy(buf, offset);
    mem.files.set(h.path, buf);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('READ', (reqid, handle, offset, len) => {
    const h = getHandle(handle);
    if (!h || h.kind !== 'file' || !mem.isFile(h.path)) {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    const buf = mem.files.get(h.path)!;
    if (offset >= buf.length) {
      return sftp.status(reqid, STATUS_CODE.EOF);
    }
    sftp.data(reqid, buf.subarray(offset, Math.min(offset + len, buf.length)));
  });

  sftp.on('CLOSE', (reqid, handle) => {
    const h = getHandle(handle);
    if (h) {
      openHandles.delete(handle.readUInt32BE(0));
    }
    sftp.status(reqid, STATUS_CODE.OK);
  });

  const replyStat = (reqid: number, path: string) => {
    if (!mem.exists(path)) {
      return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    }
    sftp.attrs(reqid, mem.attrs(path));
  };

  sftp.on('STAT', (reqid, path) => replyStat(reqid, path));
  sftp.on('LSTAT', (reqid, path) => replyStat(reqid, path));
  sftp.on('FSTAT', (reqid, handle) => {
    const h = getHandle(handle);
    if (!h) {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    replyStat(reqid, h.path);
  });

  sftp.on('SETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
  sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));

  sftp.on('OPENDIR', (reqid, path) => {
    if (!mem.isDir(path)) {
      return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    }
    sftp.handle(reqid, mkHandle('dir', path));
  });

  sftp.on('READDIR', (reqid, handle) => {
    const h = getHandle(handle);
    if (!h || h.kind !== 'dir') {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    if (h.dirSent) {
      return sftp.status(reqid, STATUS_CODE.EOF);
    }
    h.dirSent = true;
    sftp.name(
      reqid,
      mem.children(h.path).map((name) => ({
        filename: name,
        longname: name,
        attrs: mem.attrs(`${h.path === '/' ? '' : h.path}/${name}`),
      }))
    );
  });

  sftp.on('MKDIR', (reqid, path) => {
    const n = mem.norm(path);
    if (mem.exists(n)) {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    mem.dirs.add(n);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('RMDIR', (reqid, path) => {
    const n = mem.norm(path);
    if (!mem.isDir(n) || mem.children(n).length > 0) {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    mem.dirs.delete(n);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('REMOVE', (reqid, path) => {
    const n = mem.norm(path);
    if (!mem.isFile(n)) {
      return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    }
    mem.files.delete(n);
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    if (!mem.rename(oldPath, newPath)) {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    sftp.status(reqid, STATUS_CODE.OK);
  });

  sftp.on('REALPATH', (reqid, path) => {
    const n = mem.norm(path);
    sftp.name(reqid, [{ filename: n, longname: n, attrs: mem.attrs(n) }]);
  });

  sftp.on('EXTENDED', (reqid, extName, extData) => {
    if (extName === 'posix-rename@openssh.com') {
      const src = readSshString(extData, 0);
      const dst = readSshString(extData, src.next);
      if (!mem.rename(src.value, dst.value)) {
        return sftp.status(reqid, STATUS_CODE.FAILURE);
      }
      return sftp.status(reqid, STATUS_CODE.OK);
    }
    sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED);
  });
}

export interface TestServer {
  port: number;
  fs: MemFs;
  close(): Promise<void>;
}

export function startTestServer(
  user = 'testuser',
  password = 'testpass',
  authorizedPubKey?: string
): Promise<TestServer> {
  const keys = utils.generateKeyPairSync('ed25519');
  const mem = new MemFs();

  const server = new Server({ hostKeys: [keys.private] }, (client) => {
    client.on('authentication', (ctx) => {
      try {
        if (ctx.method === 'password' && ctx.username === user && ctx.password === password) {
          return ctx.accept();
        }
        if (ctx.method === 'publickey' && authorizedPubKey && ctx.username === user) {
          // ctx.key is { algo, data, comment } - NOT a Buffer. Calling
          // .equals() on it threw inside the event handler, which ssh2 turns
          // into an abrupt "Connection closed by <host>" and a client exit
          // 255 (field report 2026-09-24, integration round 5).
          const parsed = utils.parseKey(authorizedPubKey);
          if (parsed && !(parsed instanceof Error)) {
            const allowed = Array.isArray(parsed) ? parsed[0] : parsed;
            const pubBuf: Buffer = (allowed as any).getPublicSSH();
            const offered: Buffer = (ctx.key as any).data;
            if (
              pubBuf &&
              offered &&
              (ctx.key as any).algo === (allowed as any).type &&
              Buffer.compare(pubBuf, offered) === 0
            ) {
              // no signature yet = the "may I offer this key?" query phase
              if (!(ctx as any).signature) {
                return ctx.accept();
              }
              // NB: two arguments only. Passing the algo ('ssh-ed25519') as
              // the third one makes node throw
              // "Invalid digest: ssh-ed25519" (ERR_CRYPTO_INVALID_DIGEST).
              const ok = (allowed as any).verify((ctx as any).blob, (ctx as any).signature);
              if (ok === true) {
                return ctx.accept();
              }
            }
          }
        }
        return ctx.reject();
      } catch (err) {
        // never let a throw kill the connection silently - the client would
        // only see "Connection closed", which says nothing about the cause
        // eslint-disable-next-line no-console
        console.error('[harness] authentication handler failed:', err);
        try {
          return ctx.reject();
        } catch (e) {
          return undefined;
        }
      }
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acceptPty) => {
          acceptPty();
        });
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          stream.write('HELLO-FROM-TEST-SERVER\r\n');
          stream.on('data', (d: Buffer) => {
            stream.write(d); // echo
          });
        });
        session.on('exec', (acceptExec, _rejectExec, info) => {
          const stream = acceptExec();
          stream.write(`EXEC:${info.command}\n`);
          stream.exit(0);
          stream.close();
        });
        session.on('sftp', (acceptSftp) => {
          wireSftp(acceptSftp(), mem);
        });
      });
    });
    client.on('error', () => {
      /* ignore */
    });
  });

  return new Promise<TestServer>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        fs: mem,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
