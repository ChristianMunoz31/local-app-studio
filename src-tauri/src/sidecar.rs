//! The `local-app-studio-server` sidecar: environment, launch, ready handshake, log draining, shutdown.
//!
//! Protocol (fixed contract with the server):
//! - The child gets a minimal environment (see [`build_sidecar_env`]) and a 64-hex secret plus a
//!   newline on stdin. We keep stdin open for the whole app lifetime; closing it is the graceful
//!   shutdown signal.
//! - The child prints `APP_READY {"port":N,"dataDir":"...","version":"...","channel":"stable|dev"}` on
//!   stdout. The shell refuses a ready line whose channel is not its own.

use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::channel::{paths_overlap, Channel};
use crate::exit_dialog::platform_data_dir;
use crate::secret::{to_hex, SECRET_LEN};

/// Prefix of the stdout line that announces the server is listening.
pub const READY_PREFIX: &str = "APP_READY ";

/// Variables copied from the shell's environment into the sidecar's, when present.
const PASSTHROUGH: [&str; 8] = [
    "SystemRoot",
    "TEMP",
    "TMP",
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
    "HOME",
    "XDG_DATA_HOME",
];

/// The parsed `APP_READY` payload.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Ready {
    pub port: u16,
    #[serde(rename = "dataDir")]
    pub data_dir: String,
    pub version: String,
    /// Channel of the server (`stable` or `dev`); a line without it is not a ready line.
    pub channel: String,
}

impl Ready {
    /// True when the server runs in the same channel as this shell.
    pub fn matches_channel(&self, channel: Channel) -> bool {
        self.channel == channel.as_str()
    }
}

/// Parses one stdout line. Returns `None` for anything that is not a well-formed ready line
/// (including port 0 or missing fields, the channel included).
pub fn parse_ready_line(line: &str) -> Option<Ready> {
    let payload = line
        .trim_end_matches(['\r', '\n'])
        .strip_prefix(READY_PREFIX)?;
    let ready: Ready = serde_json::from_str(payload).ok()?;
    (ready.port != 0).then_some(ready)
}

fn lookup<'a>(source: &'a HashMap<String, String>, key: &str) -> Option<&'a String> {
    if let Some(v) = source.get(key) {
        return Some(v);
    }
    if cfg!(windows) {
        return source
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v);
    }
    None
}

/// Message shown (and logged) when a Dev shell would run on the data folder of Local App Studio.
pub const DEV_DATA_DIR_REFUSED: &str = "Local App Studio Dev cannot use this data folder because it is the same as, or overlaps, the folder where Local App Studio keeps its data. Nothing was read or changed.";

/// Dev shell only: refuses a data folder (the `APP_DESKTOP_DATA_DIR` override, else the Dev default)
/// that is, contains or lies inside the stable default folder or the stable copy source. The stable
/// shell is not checked. Pure path comparison by real location.
pub fn check_data_dir_isolation(
    channel: Channel,
    source: &HashMap<String, String>,
) -> Result<(), String> {
    if channel != Channel::Dev {
        return Ok(());
    }
    let get = |key: &str| lookup(source, key).cloned();
    let Some(effective) = source
        .get("APP_DESKTOP_DATA_DIR")
        .filter(|d| !d.trim().is_empty())
        .map(|d| PathBuf::from(d.trim()))
        .or_else(|| platform_data_dir(get, Channel::Dev))
    else {
        return Ok(());
    };
    refuse_if_stable(source, &effective)
}

/// The same check for a data folder the server reported in its ready line.
pub fn check_reported_data_dir(
    channel: Channel,
    source: &HashMap<String, String>,
    data_dir: &str,
) -> Result<(), String> {
    if channel != Channel::Dev {
        return Ok(());
    }
    refuse_if_stable(source, Path::new(data_dir))
}

fn refuse_if_stable(source: &HashMap<String, String>, dir: &Path) -> Result<(), String> {
    let get = |key: &str| lookup(source, key).cloned();
    let mut stable: Vec<PathBuf> = platform_data_dir(get, Channel::Stable)
        .into_iter()
        .collect();
    if let Some(copy_source) =
        lookup(source, "APP_DESKTOP_STABLE_DATA_DIR").filter(|d| !d.trim().is_empty())
    {
        stable.push(PathBuf::from(copy_source.trim()));
    }
    if stable.iter().any(|s| paths_overlap(s, dir)) {
        Err(DEV_DATA_DIR_REFUSED.to_string())
    } else {
        Ok(())
    }
}

/// Builds the sidecar's complete environment from the shell's environment. Everything not named
/// here (NODE_OPTIONS, OLLAMA_HOST, APP_PASSWORD, tokens, APP_DATA_DIR, ...) is dropped.
/// `APP_DESKTOP_DATA_DIR` in the shell becomes `APP_DATA_DIR` for the child. In the Dev channel only,
/// `APP_DESKTOP_STABLE_DATA_DIR` becomes `APP_STABLE_DATA_DIR` (the test source for "Copy my data
/// from Local App Studio"); a stable shell never passes it, and a raw `APP_STABLE_DATA_DIR` is always dropped.
pub fn build_sidecar_env(
    source: &HashMap<String, String>,
    dist_dir: &Path,
    migrations_dir: &Path,
    channel: Channel,
) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in PASSTHROUGH {
        if let Some(v) = lookup(source, key) {
            env.insert(key.to_string(), v.clone());
        }
    }
    if cfg!(windows) {
        if let Some(root) = lookup(source, "SystemRoot") {
            env.insert("PATH".into(), format!("{root}\\System32"));
        }
    } else {
        // Fixed system path: the developer's PATH never reaches the sidecar.
        env.insert("PATH".into(), "/usr/bin:/bin".into());
    }
    env.insert("APP_DESKTOP".into(), "1".into());
    // The server refuses to start when this is not its own channel (see server/channelGuards.js).
    env.insert("APP_SHELL_CHANNEL".into(), channel.as_str().into());
    env.insert("APP_HOST".into(), "127.0.0.1".into());
    env.insert("APP_PORT".into(), "0".into());
    env.insert("APP_NO_DOTENV".into(), "1".into());
    env.insert(
        "APP_DIST_DIR".into(),
        dist_dir.to_string_lossy().into_owned(),
    );
    env.insert(
        "APP_MIGRATIONS_DIR".into(),
        migrations_dir.to_string_lossy().into_owned(),
    );
    if let Some(dir) = source.get("APP_DESKTOP_DATA_DIR").filter(|d| !d.is_empty()) {
        env.insert("APP_DATA_DIR".into(), dir.clone());
    }
    if channel == Channel::Dev {
        if let Some(dir) = source
            .get("APP_DESKTOP_STABLE_DATA_DIR")
            .filter(|d| !d.trim().is_empty())
        {
            env.insert("APP_STABLE_DATA_DIR".into(), dir.clone());
        }
    }
    env
}

/// How to start the server process.
#[derive(Debug)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: Option<PathBuf>,
    pub dist_dir: PathBuf,
    pub migrations_dir: PathBuf,
}

/// Resolves the launch plan. Release: the bundled sidecar of `channel` (`local-app-studio-server`, or
/// `local-app-studio-dev-server` for Local App Studio Dev) next to the app exe, with the UI and migrations under the
/// resource dir. Debug builds with `APP_DEV_NODE` and
/// `APP_DEV_ENTRY` run `node server.js` from the repo instead.
pub fn resolve_launch(
    resource_dir: &Path,
    source: &HashMap<String, String>,
    channel: Channel,
) -> Result<Launch, String> {
    #[cfg(debug_assertions)]
    {
        if let (Some(node), Some(entry)) = (
            source.get("APP_DEV_NODE").filter(|v| !v.is_empty()),
            source.get("APP_DEV_ENTRY").filter(|v| !v.is_empty()),
        ) {
            let entry = PathBuf::from(entry);
            let root = entry
                .parent()
                .ok_or_else(|| "APP_DEV_ENTRY has no parent directory".to_string())?
                .to_path_buf();
            return Ok(Launch {
                program: PathBuf::from(node),
                args: vec![entry.into_os_string()],
                cwd: Some(root.clone()),
                dist_dir: root.join("dist"),
                migrations_dir: root.join("server").join("db").join("migrations"),
            });
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = source;
    let exe = std::env::current_exe().map_err(|e| format!("cannot locate the app: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "the app executable has no parent directory".to_string())?;
    Ok(Launch {
        program: dir.join(sidecar_file_name(channel)),
        args: Vec::new(),
        cwd: None,
        dist_dir: resource_dir.join("resources").join("dist"),
        migrations_dir: resource_dir.join("resources").join("migrations"),
    })
}

/// File name of the bundled sidecar of `channel` (with `.exe` on Windows).
pub fn sidecar_file_name(channel: Channel) -> String {
    if cfg!(windows) {
        format!("{}.exe", channel.sidecar_name())
    } else {
        channel.sidecar_name().to_string()
    }
}

/// How the server process ended, as far as the shell could tell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExitInfo {
    /// Process exit code; `None` when it was killed by a signal or the status was unavailable.
    pub code: Option<i32>,
    /// The last lines the server wrote to stderr, joined with newlines.
    pub stderr_tail: String,
}

/// Messages from the stdout reader thread.
#[derive(Debug)]
pub enum ServerEvent {
    Ready(Ready),
    Exited(ExitInfo),
}

/// Shared handle to `server.log`.
pub type SharedLog = Arc<Mutex<File>>;

/// Appends one tagged line to the log (best effort).
pub fn log_line(log: &SharedLog, tag: &str, line: &str) {
    if let Ok(mut f) = log.lock() {
        let _ = writeln!(f, "[{tag}] {line}");
        let _ = f.flush();
    }
}

/// Most stderr lines kept for the exit dialog.
const MAX_TAIL_LINES: usize = 40;
/// Longest stderr line kept in the tail (characters).
const MAX_TAIL_LINE_CHARS: usize = 2000;
/// How long to wait for the exit status once the server's stdout has closed.
const EXIT_STATUS_WAIT: Duration = Duration::from_secs(3);
/// How long to wait for the stderr reader to finish after the exit status is known.
const STDERR_DRAIN_WAIT: Duration = Duration::from_secs(2);

#[derive(Default)]
struct TailInner {
    lines: VecDeque<String>,
    closed: bool,
}

/// The last lines of the server's stderr, plus a way to wait until the stream has ended.
#[derive(Default)]
pub struct StderrTail {
    inner: Mutex<TailInner>,
    closed: Condvar,
}

impl StderrTail {
    pub fn push(&self, line: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if inner.lines.len() >= MAX_TAIL_LINES {
                inner.lines.pop_front();
            }
            inner
                .lines
                .push_back(line.chars().take(MAX_TAIL_LINE_CHARS).collect());
        }
    }

    /// Marks the stream as ended and wakes any waiter.
    pub fn close(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.closed = true;
        }
        self.closed.notify_all();
    }

    /// Waits up to `timeout` for the stream to end, then returns the kept lines joined by newlines.
    pub fn wait_text(&self, timeout: Duration) -> String {
        let Ok(guard) = self.inner.lock() else {
            return String::new();
        };
        let guard = self
            .closed
            .wait_timeout_while(guard, timeout, |inner| !inner.closed)
            .map(|(g, _)| g)
            .unwrap_or_else(|e| e.into_inner().0);
        guard.lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

/// A running sidecar. Dropping `stdin` tells the server to shut down.
pub struct Sidecar {
    child: Arc<Mutex<Child>>,
    stdin: Option<ChildStdin>,
    _job: Option<job::JobGuard>,
}

impl Sidecar {
    /// Graceful stop: close stdin, wait up to `grace`, then kill.
    pub fn shutdown(mut self, grace: Duration) {
        drop(self.stdin.take());
        let deadline = Instant::now() + grace;
        loop {
            let status = self.child.lock().map(|mut c| c.try_wait());
            match status {
                Ok(Ok(Some(_))) => return,
                Ok(Ok(None)) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                _ => break,
            }
        }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Polls for the child's exit status for up to `wait`. The lock is only held for each poll, so
/// [`Sidecar::shutdown`] is never blocked.
fn wait_for_exit_code(child: &Mutex<Child>, wait: Duration) -> Option<i32> {
    let deadline = Instant::now() + wait;
    loop {
        match child.lock().map(|mut c| c.try_wait()) {
            Ok(Ok(Some(status))) => return status.code(),
            Ok(Ok(None)) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => return None,
        }
    }
}

/// Longest line kept from the server's output; the rest of a longer line is discarded.
const MAX_LINE_BYTES: usize = 64 * 1024;

/// Reads one line (without its line ending), lossily decoded, keeping at most [`MAX_LINE_BYTES`]
/// and discarding the remainder. `None` at EOF or on a read error.
fn read_capped_line<R: BufRead>(reader: &mut R) -> Option<String> {
    let mut kept: Vec<u8> = Vec::new();
    let mut seen_any = false;
    loop {
        let (consumed, done) = {
            let buf = match reader.fill_buf() {
                Ok(b) => b,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return None,
            };
            if buf.is_empty() {
                return seen_any.then(|| decode_line(&kept));
            }
            seen_any = true;
            let (chunk, done) = match buf.iter().position(|b| *b == b'\n') {
                Some(i) => (&buf[..i], true),
                None => (buf, false),
            };
            let room = MAX_LINE_BYTES.saturating_sub(kept.len());
            kept.extend_from_slice(&chunk[..chunk.len().min(room)]);
            (chunk.len() + usize::from(done), done)
        };
        reader.consume(consumed);
        if done {
            return Some(decode_line(&kept));
        }
    }
}

fn decode_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_end_matches('\r')
        .to_string()
}

/// Reads `stream` line by line on its own thread: every line goes to the log and `on_line`;
/// `on_end` runs once at EOF.
fn pump<R, L, E>(stream: R, tag: &'static str, log: SharedLog, mut on_line: L, on_end: E)
where
    R: std::io::Read + Send + 'static,
    L: FnMut(&str) + Send + 'static,
    E: FnOnce() + Send + 'static,
{
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        while let Some(line) = read_capped_line(&mut reader) {
            log_line(&log, tag, &line);
            on_line(&line);
        }
        on_end();
    });
}

/// Starts the server, hands it the secret on stdin and begins draining its output to `log`.
pub fn spawn(
    launch: &Launch,
    env: &HashMap<String, String>,
    secret: &[u8; SECRET_LEN],
    log: &SharedLog,
) -> Result<(Sidecar, Receiver<ServerEvent>), String> {
    let mut cmd = Command::new(&launch.program);
    cmd.args(&launch.args)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &launch.cwd {
        cmd.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("cannot start {}: {e}", launch.program.display()))?;
    let job = job::assign(&child);
    if job.is_none() {
        log_line(
            log,
            "shell",
            "could not attach the server to a job object; it may outlive the app if the app is killed",
        );
    }

    let mut stdin = child.stdin.take().ok_or("sidecar stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("sidecar stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("sidecar stderr unavailable")?;
    let handshake = format!("{}\n", to_hex(secret));
    if let Err(e) = stdin
        .write_all(handshake.as_bytes())
        .and_then(|()| stdin.flush())
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("cannot send the startup secret: {e}"));
    }

    let child = Arc::new(Mutex::new(child));
    let tail = Arc::new(StderrTail::default());
    let (tx, rx) = mpsc::channel();
    let ready_tx = tx.clone();
    let exit_child = Arc::clone(&child);
    let exit_tail = Arc::clone(&tail);
    pump(
        stdout,
        "out",
        Arc::clone(log),
        move |line| {
            if let Some(ready) = parse_ready_line(line) {
                let _ = ready_tx.send(ServerEvent::Ready(ready));
            }
        },
        move || {
            let code = wait_for_exit_code(&exit_child, EXIT_STATUS_WAIT);
            let stderr_tail = exit_tail.wait_text(STDERR_DRAIN_WAIT);
            let _ = tx.send(ServerEvent::Exited(ExitInfo { code, stderr_tail }));
        },
    );
    let line_tail = Arc::clone(&tail);
    pump(
        stderr,
        "err",
        Arc::clone(log),
        move |line| line_tail.push(line),
        move || tail.close(),
    );
    Ok((
        Sidecar {
            child,
            stdin: Some(stdin),
            _job: job,
        },
        rx,
    ))
}

/// Windows Job Object so a crash or kill of the app never leaves the server running.
#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct JobGuard(HANDLE);

    // SAFETY: the handle is only used to keep the job alive and to close it on drop.
    unsafe impl Send for JobGuard {}

    impl Drop for JobGuard {
        fn drop(&mut self) {
            // SAFETY: the handle came from CreateJobObjectW and is closed exactly once.
            unsafe { CloseHandle(self.0) };
        }
    }

    pub fn assign(child: &Child) -> Option<JobGuard> {
        // SAFETY: plain Win32 calls with valid, owned handles and a correctly sized struct.
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let guard = JobGuard(handle);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(info).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0 {
                return None;
            }
            Some(guard)
        }
    }
}

#[cfg(not(windows))]
mod job {
    use std::process::Child;

    pub struct JobGuard;

    pub fn assign(_child: &Child) -> Option<JobGuard> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> HashMap<String, String> {
        [
            ("SystemRoot", "C:\\Windows"),
            ("TEMP", "C:\\Temp"),
            ("TMP", "C:\\Temp"),
            ("APPDATA", "C:\\Users\\user\\AppData\\Roaming"),
            ("LOCALAPPDATA", "C:\\Users\\user\\AppData\\Local"),
            ("USERPROFILE", "C:\\Users\\user"),
            ("PATH", "C:\\evil;C:\\Windows\\System32"),
            ("NODE_OPTIONS", "--require evil.js"),
            ("OLLAMA_HOST", "http://10.0.0.5:11434"),
            ("APP_PASSWORD", "hunter2"),
            ("ASSISTANT_CONFIRM_WRITES", "0"),
            ("APP_DATA_DIR", "C:\\real\\data"),
            ("APP_DESKTOP_DATA_DIR", "C:\\Temp\\sandbox"),
            ("SOME_RANDOM_VAR", "x"),
            ("GITHUB_TOKEN", "t"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    fn env() -> HashMap<String, String> {
        build_sidecar_env(
            &source(),
            Path::new("/r/dist"),
            Path::new("/r/migrations"),
            Channel::Stable,
        )
    }

    #[test]
    fn env_excludes_everything_not_allowlisted() {
        let env = env();
        for key in [
            "NODE_OPTIONS",
            "OLLAMA_HOST",
            "APP_PASSWORD",
            "ASSISTANT_CONFIRM_WRITES",
            "SOME_RANDOM_VAR",
            "GITHUB_TOKEN",
            "APP_DESKTOP_DATA_DIR",
        ] {
            assert!(!env.contains_key(key), "{key} leaked");
        }
        assert!(!env
            .values()
            .any(|v| v.contains("hunter2") || v.contains("evil")));
    }

    #[test]
    fn env_carries_the_fixed_app_vars_and_passthrough() {
        let env = env();
        assert_eq!(env["APP_DESKTOP"], "1");
        assert_eq!(env["APP_HOST"], "127.0.0.1");
        assert_eq!(env["APP_PORT"], "0");
        assert_eq!(env["APP_NO_DOTENV"], "1");
        assert_eq!(env["SystemRoot"], "C:\\Windows");
        assert_eq!(env["APPDATA"], "C:\\Users\\user\\AppData\\Roaming");
        assert!(env["APP_DIST_DIR"].contains("dist"));
        assert!(env["APP_MIGRATIONS_DIR"].contains("migrations"));
        assert!(!env.contains_key("HOME"));
        if cfg!(windows) {
            assert_eq!(env["PATH"], "C:\\Windows\\System32");
        } else {
            assert_eq!(env["PATH"], "/usr/bin:/bin");
        }
    }

    #[test]
    fn desktop_data_dir_maps_to_app_data_dir() {
        assert_eq!(env()["APP_DATA_DIR"], "C:\\Temp\\sandbox");
    }

    #[test]
    fn real_data_dir_is_not_passed_without_the_desktop_name() {
        let mut src = source();
        src.remove("APP_DESKTOP_DATA_DIR");
        let env = build_sidecar_env(&src, Path::new("d"), Path::new("m"), Channel::Stable);
        assert!(!env.contains_key("APP_DATA_DIR"));
    }

    fn env_with_stable_dir(channel: Channel) -> HashMap<String, String> {
        let mut src = source();
        src.insert(
            "APP_DESKTOP_STABLE_DATA_DIR".into(),
            "C:\\Temp\\fake-stable".into(),
        );
        src.insert("APP_STABLE_DATA_DIR".into(), "C:\\Temp\\raw-stable".into());
        build_sidecar_env(&src, Path::new("d"), Path::new("m"), channel)
    }

    #[test]
    fn dev_maps_the_desktop_stable_dir_and_drops_a_raw_one() {
        let env = env_with_stable_dir(Channel::Dev);
        assert_eq!(env["APP_STABLE_DATA_DIR"], "C:\\Temp\\fake-stable");
        assert!(!env.contains_key("APP_DESKTOP_STABLE_DATA_DIR"));
    }

    #[test]
    fn stable_never_passes_a_stable_dir() {
        let env = env_with_stable_dir(Channel::Stable);
        assert!(!env.contains_key("APP_STABLE_DATA_DIR"));
        assert!(!env.contains_key("APP_DESKTOP_STABLE_DATA_DIR"));
    }

    #[test]
    fn dev_drops_a_raw_stable_dir_when_no_desktop_name_is_set() {
        let mut src = source();
        src.insert("APP_STABLE_DATA_DIR".into(), "C:\\Temp\\raw-stable".into());
        let env = build_sidecar_env(&src, Path::new("d"), Path::new("m"), Channel::Dev);
        assert!(!env.contains_key("APP_STABLE_DATA_DIR"));
        src.insert("APP_DESKTOP_STABLE_DATA_DIR".into(), "  ".into());
        let blank = build_sidecar_env(&src, Path::new("d"), Path::new("m"), Channel::Dev);
        assert!(!blank.contains_key("APP_STABLE_DATA_DIR"));
    }

    #[test]
    fn capped_lines_survive_bad_utf8_and_huge_lines() {
        let mut data: Vec<u8> = b"ok\r\n".to_vec();
        data.extend_from_slice(&[0xff, 0xfe, b'x', b'\n']);
        data.resize(data.len() + MAX_LINE_BYTES * 2 + 5, b'a');
        data.extend_from_slice(b"\nlast");
        let mut r = std::io::BufReader::with_capacity(7, &data[..]);
        assert_eq!(read_capped_line(&mut r).unwrap(), "ok");
        assert_eq!(read_capped_line(&mut r).unwrap(), "\u{fffd}\u{fffd}x");
        assert_eq!(read_capped_line(&mut r).unwrap().len(), MAX_LINE_BYTES);
        assert_eq!(read_capped_line(&mut r).unwrap(), "last");
        assert!(read_capped_line(&mut r).is_none());
    }

    #[test]
    fn ready_line_valid() {
        let r = parse_ready_line(
            "APP_READY {\"port\":51234,\"dataDir\":\"C:\\\\data\",\"version\":\"0.1.0\",\"channel\":\"stable\"}\r\n",
        )
        .unwrap();
        assert_eq!(r.port, 51234);
        assert_eq!(r.data_dir, "C:\\data");
        assert_eq!(r.version, "0.1.0");
        assert_eq!(r.channel, "stable");
    }

    #[test]
    fn ready_line_rejects_junk_port_zero_and_missing_fields() {
        assert!(parse_ready_line("listening on 4321").is_none());
        assert!(parse_ready_line("APP_READY not json").is_none());
        let zero = "APP_READY {\"port\":0,\"dataDir\":\"d\",\"version\":\"1\",\"channel\":\"dev\"}";
        assert!(parse_ready_line(zero).is_none());
        let big =
            "APP_READY {\"port\":70000,\"dataDir\":\"d\",\"version\":\"1\",\"channel\":\"dev\"}";
        assert!(parse_ready_line(big).is_none());
        let no_port = "APP_READY {\"dataDir\":\"d\",\"version\":\"1\",\"channel\":\"dev\"}";
        assert!(parse_ready_line(no_port).is_none());
        let no_dir = "APP_READY {\"port\":5,\"version\":\"1\",\"channel\":\"dev\"}";
        assert!(parse_ready_line(no_dir).is_none());
        let no_version = "APP_READY {\"port\":5,\"dataDir\":\"d\",\"channel\":\"dev\"}";
        assert!(parse_ready_line(no_version).is_none());
        assert!(parse_ready_line("").is_none());
    }

    #[test]
    fn ready_line_without_a_channel_is_refused() {
        let old = "APP_READY {\"port\":5,\"dataDir\":\"d\",\"version\":\"1\"}";
        assert!(parse_ready_line(old).is_none());
    }

    #[test]
    fn ready_line_must_carry_the_shell_channel() {
        let dev = parse_ready_line(
            "APP_READY {\"port\":5,\"dataDir\":\"d\",\"version\":\"1\",\"channel\":\"dev\"}",
        )
        .unwrap();
        assert!(dev.matches_channel(Channel::Dev));
        assert!(!dev.matches_channel(Channel::Stable));
        let stable = parse_ready_line(
            "APP_READY {\"port\":5,\"dataDir\":\"d\",\"version\":\"1\",\"channel\":\"stable\"}",
        )
        .unwrap();
        assert!(stable.matches_channel(Channel::Stable));
        assert!(!stable.matches_channel(Channel::Dev));
        let other = parse_ready_line(
            "APP_READY {\"port\":5,\"dataDir\":\"d\",\"version\":\"1\",\"channel\":\"Dev\"}",
        )
        .unwrap();
        assert!(!other.matches_channel(Channel::Dev));
    }

    #[test]
    fn the_sidecar_always_learns_the_shell_channel() {
        assert_eq!(env()["APP_SHELL_CHANNEL"], "stable");
        let dev = build_sidecar_env(&source(), Path::new("d"), Path::new("m"), Channel::Dev);
        assert_eq!(dev["APP_SHELL_CHANNEL"], "dev");
        // A value in the shell's own environment never overrides it.
        let mut src = source();
        src.insert("APP_SHELL_CHANNEL".into(), "dev".into());
        let stable = build_sidecar_env(&src, Path::new("d"), Path::new("m"), Channel::Stable);
        assert_eq!(stable["APP_SHELL_CHANNEL"], "stable");
    }

    #[test]
    fn each_channel_launches_its_own_sidecar_binary() {
        let stable = sidecar_file_name(Channel::Stable);
        let dev = sidecar_file_name(Channel::Dev);
        assert_ne!(stable, dev);
        assert!(stable.starts_with("local-app-studio-server"));
        assert!(dev.starts_with("local-app-studio-dev-server"));
        if cfg!(windows) {
            assert!(stable.ends_with(".exe") && dev.ends_with(".exe"));
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "local-app-studio-sidecar-test-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A shell environment whose per-OS default folders live under `home`.
    fn home_env(home: &Path) -> HashMap<String, String> {
        let mut src = HashMap::new();
        let text = |p: PathBuf| p.to_string_lossy().into_owned();
        src.insert("APPDATA".into(), text(home.join("AppData").join("Roaming")));
        src.insert("USERPROFILE".into(), text(home.to_path_buf()));
        src.insert("HOME".into(), text(home.to_path_buf()));
        src.insert(
            "XDG_DATA_HOME".into(),
            text(home.join(".local").join("share")),
        );
        src
    }

    fn stable_default(src: &HashMap<String, String>) -> PathBuf {
        let get = |k: &str| src.get(k).cloned();
        platform_data_dir(get, Channel::Stable).unwrap()
    }

    #[test]
    fn a_dev_shell_refuses_the_stable_data_folder() {
        let home = scratch("isolation");
        let mut src = home_env(&home);
        let stable = stable_default(&src);
        std::fs::create_dir_all(stable.join("backups")).unwrap();
        // The Dev default is a sibling of the stable folder: fine.
        assert!(check_data_dir_isolation(Channel::Dev, &src).is_ok());
        for dir in [
            stable.clone(),
            stable.join("backups"),
            stable.join("not-yet"),
            stable.parent().unwrap().to_path_buf(),
        ] {
            src.insert(
                "APP_DESKTOP_DATA_DIR".into(),
                dir.to_string_lossy().into_owned(),
            );
            let res = check_data_dir_isolation(Channel::Dev, &src);
            assert_eq!(res, Err(DEV_DATA_DIR_REFUSED.to_string()), "{dir:?}");
            assert!(check_reported_data_dir(Channel::Dev, &src, &dir.to_string_lossy()).is_err());
        }
        // The stable shell is never blocked by this check.
        assert!(check_data_dir_isolation(Channel::Stable, &src).is_ok());
        assert!(check_reported_data_dir(Channel::Stable, &src, &stable.to_string_lossy()).is_ok());
        // An unrelated folder is fine.
        let other = home.join("elsewhere");
        src.insert(
            "APP_DESKTOP_DATA_DIR".into(),
            other.to_string_lossy().into_owned(),
        );
        assert!(check_data_dir_isolation(Channel::Dev, &src).is_ok());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_dev_shell_also_refuses_the_stable_copy_source_as_its_data_folder() {
        let home = scratch("copysource");
        let mut src = home_env(&home);
        let fake = home.join("fake-stable");
        std::fs::create_dir_all(&fake).unwrap();
        src.insert(
            "APP_DESKTOP_STABLE_DATA_DIR".into(),
            fake.to_string_lossy().into_owned(),
        );
        src.insert(
            "APP_DESKTOP_DATA_DIR".into(),
            fake.to_string_lossy().into_owned(),
        );
        assert!(check_data_dir_isolation(Channel::Dev, &src).is_err());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn stderr_tail_keeps_only_the_last_lines_and_caps_long_ones() {
        let tail = StderrTail::default();
        for i in 0..(MAX_TAIL_LINES + 5) {
            tail.push(&format!("line {i}"));
        }
        tail.push(&"x".repeat(MAX_TAIL_LINE_CHARS + 50));
        tail.close();
        let text = tail.wait_text(Duration::from_millis(10));
        let lines: Vec<&str> = text.split('\n').collect();
        assert_eq!(lines.len(), MAX_TAIL_LINES);
        assert_eq!(lines[0], "line 6");
        assert_eq!(
            lines[MAX_TAIL_LINES - 1].chars().count(),
            MAX_TAIL_LINE_CHARS
        );
    }

    #[test]
    fn stderr_tail_wait_returns_after_timeout_when_never_closed() {
        let tail = StderrTail::default();
        tail.push("partial");
        assert_eq!(tail.wait_text(Duration::from_millis(10)), "partial");
    }
}
