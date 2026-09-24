# Runs ON the remote server (through ssh) to explain Remote-SSH instability.
# Read-only: nothing is installed, nothing is deleted.
echo "=== identity"; uname -a; cat /etc/redhat-release 2>/dev/null; ldd --version | head -1
echo "=== load / memory"; uptime; free -g 2>/dev/null | head -3; nproc
echo "=== my cgroup limits"
for f in /sys/fs/cgroup/memory/user.slice/user-$(id -u).slice/memory.limit_in_bytes \
         /sys/fs/cgroup/memory/user.slice/user-$(id -u).slice/memory.max_usage_in_bytes \
         /sys/fs/cgroup/user.slice/user-$(id -u).slice/memory.max; do
  [ -r "$f" ] && echo "$f = $(cat $f)"
done
echo "=== ulimits"; ulimit -a 2>/dev/null | egrep -i 'process|memory|file|cpu'
echo "=== home quota / free space"; quota -s 2>/dev/null | head -5; df -h "$HOME" 2>/dev/null | tail -2
echo "=== vscode-server footprint"
du -sh ~/.vscode-server 2>/dev/null
ls -1 ~/.vscode-server/bin 2>/dev/null | wc -l | sed 's/^/server builds: /'
ls -1t ~/.vscode-server/bin 2>/dev/null | head -5
du -sh ~/.vscode-server/extensions 2>/dev/null
echo "=== my heaviest processes"
ps -u "$(id -un)" -o pid,etime,rss,pcpu,comm --sort=-rss 2>/dev/null | head -12
echo "=== node/vscode servers running"
pgrep -u "$(id -un)" -af node 2>/dev/null | head -8
echo "=== sshd keepalive policy"; egrep -i 'ClientAlive|MaxSessions|MaxStartups|TCPKeepAlive' /etc/ssh/sshd_config 2>/dev/null
echo "=== recent OOM kills for me"
dmesg 2>/dev/null | egrep -i 'killed process|out of memory' | tail -5
grep -i -h 'killed process' /var/log/messages 2>/dev/null | tail -5
echo "=== cron/reaper that kills user processes on login nodes"
ls /etc/cron.d 2>/dev/null | head -10
echo "=== done"
