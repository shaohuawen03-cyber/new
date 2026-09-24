// Deploy the local public key to a remote ~/.ssh/authorized_keys using a
// PASSWORD (ssh2 can do password auth; the ssh CLI cannot take one).
// Usage:  node code/deploy_key.js <user@host[:port]> <password> [pubKeyPath]
// Exit 0 = the key is installed, 1 = failed (reason on stderr).
const fs = require('fs');
const os = require('os');
const path = require('path');

const ssh2Dir = path.join(__dirname, '..', 'ssh-remote-lite', 'node_modules', 'ssh2');
let ssh2;
try {
  ssh2 = require(ssh2Dir);
} catch (e) {
  try {
    ssh2 = require('ssh2');
  } catch (e2) {
    console.error('[deploy] ssh2 is not installed - run: npm install in ssh-remote-lite/');
    process.exit(1);
  }
}
const { Client, utils } = ssh2;

function parseTarget(t) {
  const m = /^(?:([^@]+)@)?([^:@]+)(?::(\d+))?$/.exec(String(t).trim());
  if (!m) {
    throw new Error(`cannot parse target: ${t}`);
  }
  return { username: m[1] || 'root', host: m[2], port: m[3] ? Number(m[3]) : 22 };
}

function ensureKey() {
  const dir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
    const priv = path.join(dir, name);
    if (fs.existsSync(priv) && fs.existsSync(`${priv}.pub`)) {
      return { priv, pub: fs.readFileSync(`${priv}.pub`, 'utf8').trim(), created: false };
    }
  }
  const kp = utils.generateKeyPairSync('ed25519', { comment: 'ssh-remote-lite' });
  const priv = path.join(dir, 'id_ed25519');
  fs.writeFileSync(priv, kp.private, { mode: 0o600 });
  fs.writeFileSync(`${priv}.pub`, `${kp.public.trim()}\n`);
  return { priv, pub: kp.public.trim(), created: true };
}

function authorizeCommand(pub) {
  const b64 = Buffer.from(`${pub.trim()}\n`).toString('base64');
  return (
    'mkdir -p ~/.ssh && chmod 700 ~/.ssh && ' +
    `echo ${b64} | base64 -d >> ~/.ssh/authorized_keys && ` +
    'chmod 600 ~/.ssh/authorized_keys && echo SRL_KEY_INSTALLED'
  );
}

const [, , target, password, pubArg] = process.argv;
if (!target || !password) {
  console.error('usage: node code/deploy_key.js <user@host[:port]> <password> [pubKeyPath]');
  process.exit(2);
}

const cfg = parseTarget(target);
const key = pubArg
  ? { priv: pubArg.replace(/\.pub$/, ''), pub: fs.readFileSync(pubArg, 'utf8').trim(), created: false }
  : ensureKey();
console.log(`[deploy] local key : ${key.priv}${key.created ? ' (just generated)' : ''}`);
console.log(`[deploy] target    : ${cfg.username}@${cfg.host}:${cfg.port}`);

const conn = new Client();
let done = false;
const finish = (code, msg) => {
  if (done) {
    return;
  }
  done = true;
  if (msg) {
    console.log(msg);
  }
  try {
    conn.end();
  } catch (e) {
    /* ignore */
  }
  process.exit(code);
};

conn
  .on('ready', () => {
    conn.exec(authorizeCommand(key.pub), (err, stream) => {
      if (err) {
        return finish(1, `[deploy] exec failed: ${err.message}`);
      }
      let out = '';
      let errOut = '';
      stream
        .on('close', (code) => {
          if (code === 0 && /SRL_KEY_INSTALLED/.test(out)) {
            return finish(0, `[deploy] OK - public key added to ${cfg.username}@${cfg.host}:~/.ssh/authorized_keys`);
          }
          return finish(1, `[deploy] remote exit ${code}: ${errOut || out}`);
        })
        .on('data', (d) => {
          out += d.toString();
        })
        .stderr.on('data', (d) => {
          errOut += d.toString();
        });
    });
  })
  .on('error', (e) => finish(1, `[deploy] connection failed: ${e.message}`))
  .connect({
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password,
    readyTimeout: 20000,
    // old servers: allow the legacy algorithms their sshd still speaks
    algorithms: {
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'rsa-sha2-512',
        'rsa-sha2-256',
        'ssh-rsa',
      ],
    },
  });

setTimeout(() => finish(1, '[deploy] timeout after 40s'), 40000).unref();
