//! Local App Studio desktop shell. It starts the bundled `local-app-studio-server` sidecar, waits for its ready line
//! while showing a local splash page, then points the main webview at the server's loopback URL.
//! The window has no IPC capability: the server UI is plain web content.

mod channel;
mod downloads;
mod exit_dialog;
mod menu;
mod nav;
mod secret;
mod sidecar;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::webview::{DownloadEvent, NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

use channel::Channel;
use exit_dialog::{classify_exit, should_show_exit_dialog, DialogAction, ExitDialog, ExitKind};
use nav::NavDecision;
use sidecar::{log_line, ExitInfo, ServerEvent, SharedLog, Sidecar};

const READY_TIMEOUT: Duration = Duration::from_secs(60);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
const MAIN_LABEL: &str = "main";

/// Runtime state shared by the window handlers, menu and shutdown path.
struct AppState {
    /// Port of the running server, 0 until it is ready.
    port: Arc<AtomicU16>,
    data_dir: Mutex<Option<String>>,
    sidecar: Mutex<Option<Sidecar>>,
    log: SharedLog,
    log_path: PathBuf,
    shutting_down: AtomicBool,
    /// Stable (Local App Studio) or Dev (Local App Studio Dev), from the Tauri identifier.
    channel: Channel,
}

fn splash_url(path_and_query: &str) -> Option<Url> {
    let origin = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    Url::parse(&format!("{origin}/{path_and_query}")).ok()
}

fn open_external(app: &AppHandle, url: &Url) {
    if let Err(e) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("could not open an external link: {e}");
    }
}

fn error_page(app: &AppHandle) {
    let state = app.state::<AppState>();
    let log = state.log_path.to_string_lossy().into_owned();
    let Some(mut url) = splash_url("error.html") else {
        return;
    };
    url.query_pairs_mut().append_pair("log", &log);
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.navigate(url);
    }
}

/// Opens the folder a dialog button asked for. Each candidate is checked like the Help menu's data
/// folder (absolute, not UNC, an existing directory). The restore dialog tries the folder named by
/// the server, then the shell's own data folder; every dialog ends at the log folder, with a log
/// line whenever it falls back.
fn open_folder(app: &AppHandle, dialog: &ExitDialog) {
    let state = app.state::<AppState>();
    let as_text = |p: &Path| p.to_string_lossy().into_owned();
    let mut candidates: Vec<(&str, Option<String>)> =
        vec![("dialog", dialog.open_dir.as_deref().map(as_text))];
    if dialog.kind == ExitKind::RestoreRecovery {
        candidates.push((
            "default data",
            exit_dialog::default_data_dir(|k| std::env::var(k).ok(), state.channel)
                .as_deref()
                .map(as_text),
        ));
    }
    let mut dir = None;
    for (index, (name, candidate)) in candidates.into_iter().enumerate() {
        if let Some(c) = candidate.filter(|c| is_safe_data_dir(c)) {
            if index > 0 {
                log_line(
                    &state.log,
                    "shell",
                    &format!("opening the {name} folder instead"),
                );
            }
            dir = Some(c);
            break;
        }
    }
    let dir = dir.or_else(|| {
        log_line(&state.log, "shell", "opening the log folder instead");
        state.log_path.parent().map(as_text)
    });
    if let Some(dir) = dir {
        if let Err(e) = app.opener().open_path(dir, None::<&str>) {
            eprintln!("could not open the folder: {e}");
        }
    }
}

/// Shows the native exit dialog and keeps showing it after "Open ..." and "Copy details" until the
/// user chooses Quit or closes it. Blocks the calling thread (never the main thread). Never
/// deletes or moves a file.
fn show_exit_dialog(app: &AppHandle, dialog: &ExitDialog) {
    loop {
        let buttons = match dialog.buttons.as_slice() {
            [a, b, c] => MessageDialogButtons::YesNoCancelCustom(a.clone(), b.clone(), c.clone()),
            [a, b] => MessageDialogButtons::OkCancelCustom(a.clone(), b.clone()),
            _ => MessageDialogButtons::OkCustom(exit_dialog::QUIT_LABEL.to_string()),
        };
        let mut builder = app
            .dialog()
            .message(&dialog.message)
            .title(&dialog.title)
            .kind(MessageDialogKind::Error)
            .buttons(buttons);
        if let Some(window) = app.get_webview_window(MAIN_LABEL) {
            builder = builder.parent(&window);
        }
        let label = match builder.blocking_show_with_result() {
            MessageDialogResult::Custom(label) => label,
            _ => exit_dialog::QUIT_LABEL.to_string(),
        };
        match dialog.action_for(&label) {
            DialogAction::OpenFolder => open_folder(app, dialog),
            DialogAction::CopyDetails => {
                if let Err(e) = app.clipboard().write_text(dialog.details.clone()) {
                    eprintln!("could not copy the details: {e}");
                }
            }
            DialogAction::Quit => {
                app.exit(0);
                return;
            }
        }
    }
}

/// Explains an early or unexpected server exit in a native dialog, after the error page is shown.
fn report_exit(app: &AppHandle, info: &ExitInfo) {
    let state = app.state::<AppState>();
    let code_text = info
        .code
        .map_or_else(|| "none".to_string(), |c| c.to_string());
    let shutting_down = state.shutting_down.load(Ordering::SeqCst);
    if !should_show_exit_dialog(shutting_down, info.code) {
        log_line(
            &state.log,
            "shell",
            &format!("the server exited with code {code_text}; no dialog (shutting down: {shutting_down})"),
        );
        if !shutting_down {
            state.port.store(0, Ordering::SeqCst);
            error_page(app);
        }
        return;
    }
    log_line(
        &state.log,
        "shell",
        &format!("the server exited with code {code_text}"),
    );
    let data_dir = exit_dialog::default_data_dir(|k| std::env::var(k).ok(), state.channel);
    let dialog = classify_exit(
        info.code,
        &info.stderr_tail,
        data_dir.as_deref(),
        &state.log_path,
    );
    state.port.store(0, Ordering::SeqCst);
    error_page(app);
    show_exit_dialog(app, &dialog);
}

fn navigate_main(app: &AppHandle, url: Url) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.navigate(url);
    }
}

/// Waits for the server, then loads the UI. Runs on its own thread for the app's lifetime so a
/// server that dies later also lands on the error page.
fn supervise(app: AppHandle, rx: Receiver<ServerEvent>, token: String) {
    let state = app.state::<AppState>();
    let ready = match rx.recv_timeout(READY_TIMEOUT) {
        Ok(ServerEvent::Ready(ready)) => ready,
        Err(RecvTimeoutError::Timeout) => {
            log_line(&state.log, "shell", "timed out waiting for the server");
            if let Some(sidecar) = state.sidecar.lock().ok().and_then(|mut s| s.take()) {
                sidecar.shutdown(Duration::ZERO);
            }
            state.port.store(0, Ordering::SeqCst);
            error_page(&app);
            return;
        }
        Ok(ServerEvent::Exited(info)) => {
            log_line(&state.log, "shell", "the server exited before it was ready");
            report_exit(&app, &info);
            return;
        }
        Err(RecvTimeoutError::Disconnected) => {
            log_line(&state.log, "shell", "the server exited before it was ready");
            report_exit(
                &app,
                &ExitInfo {
                    code: None,
                    stderr_tail: String::new(),
                },
            );
            return;
        }
    };
    if let Err(message) = check_ready(&state, &ready) {
        log_line(&state.log, "shell", &message);
        if let Some(sidecar) = state.sidecar.lock().ok().and_then(|mut s| s.take()) {
            sidecar.shutdown(Duration::ZERO);
        }
        state.port.store(0, Ordering::SeqCst);
        error_page(&app);
        return;
    }
    log_line(
        &state.log,
        "shell",
        &format!("server {} ready on port {}", ready.version, ready.port),
    );
    state.port.store(ready.port, Ordering::SeqCst);
    if let Ok(mut dir) = state.data_dir.lock() {
        *dir = Some(ready.data_dir.clone());
    }
    match Url::parse(&format!(
        "http://127.0.0.1:{}/desktop/bootstrap?token={token}",
        ready.port
    )) {
        Ok(url) => navigate_main(&app, url),
        Err(_) => {
            error_page(&app);
            return;
        }
    }
    let mut exit = None;
    while let Ok(event) = rx.recv() {
        if let ServerEvent::Exited(info) = event {
            exit = Some(info);
            break;
        }
    }
    if !state.shutting_down.load(Ordering::SeqCst) {
        log_line(&state.log, "shell", "the server stopped unexpectedly");
        report_exit(
            &app,
            &exit.unwrap_or(ExitInfo {
                code: None,
                stderr_tail: String::new(),
            }),
        );
    }
}

/// A ready line is only trusted when the server runs in this shell's channel and, for Local App Studio Dev, on a
/// data folder that does not overlap the one of Local App Studio.
fn check_ready(state: &AppState, ready: &sidecar::Ready) -> Result<(), String> {
    if !ready.matches_channel(state.channel) {
        return Err(format!(
            "the server reported channel \"{}\" but this app is {}; refusing it",
            ready.channel,
            state.channel.as_str()
        ));
    }
    sidecar::check_reported_data_dir(state.channel, &shell_env(), &ready.data_dir)
}

fn shell_env() -> HashMap<String, String> {
    std::env::vars_os()
        .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
        .collect()
}

/// Spawns the server. Returns the token the webview presents once the server is ready.
fn start_server(
    app: &AppHandle,
    state: &AppState,
) -> Result<(Receiver<ServerEvent>, String), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("no resource directory: {e}"))?;
    let source = shell_env();
    // Local App Studio Dev never runs on the data folder of Local App Studio: refuse before the server starts.
    sidecar::check_data_dir_isolation(state.channel, &source)?;
    let launch = sidecar::resolve_launch(&resource_dir, &source, state.channel)?;
    let env = sidecar::build_sidecar_env(
        &source,
        &launch.dist_dir,
        &launch.migrations_dir,
        state.channel,
    );
    if let Some(dir) = source.get("APP_DESKTOP_DATA_DIR").filter(|d| !d.is_empty()) {
        log_line(
            &state.log,
            "shell",
            &format!("Using data folder override from APP_DESKTOP_DATA_DIR: {dir}"),
        );
    }
    if state.channel == Channel::Dev {
        if let Some(dir) = source
            .get("APP_DESKTOP_STABLE_DATA_DIR")
            .filter(|d| !d.trim().is_empty())
        {
            log_line(
                &state.log,
                "shell",
                &format!("Using copy source override from APP_DESKTOP_STABLE_DATA_DIR: {dir}"),
            );
        }
    }
    let secret = secret::generate_secret()?;
    let token = secret::bootstrap_token(&secret);
    let (sidecar, rx) = sidecar::spawn(&launch, &env, &secret, &state.log)?;
    if let Ok(mut slot) = state.sidecar.lock() {
        *slot = Some(sidecar);
    }
    Ok((rx, token))
}

fn download_allowed(url: &Url, port: u16) -> bool {
    if url.scheme() == "blob" {
        return Url::parse(url.path())
            .map(|inner| nav::classify(&inner, port) == NavDecision::Allow)
            .unwrap_or(false);
    }
    nav::classify(url, port) == NavDecision::Allow
}

fn build_main_window(app: &AppHandle, port: Arc<AtomicU16>, channel: Channel) -> tauri::Result<()> {
    let nav_app = app.clone();
    let nav_port = Arc::clone(&port);
    let new_app = app.clone();
    let new_port = Arc::clone(&port);
    let dl_port = port;

    WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        .title(channel.product_name())
        .inner_size(1200.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .on_navigation(
            move |url| match nav::classify(url, nav_port.load(Ordering::SeqCst)) {
                NavDecision::Allow => true,
                NavDecision::External => {
                    open_external(&nav_app, url);
                    false
                }
                NavDecision::Deny => false,
            },
        )
        .on_new_window(move |url, _features| {
            if nav::classify(&url, new_port.load(Ordering::SeqCst)) == NavDecision::External {
                open_external(&new_app, &url);
            }
            NewWindowResponse::Deny
        })
        .on_download(move |webview, event| match event {
            DownloadEvent::Requested { url, destination } => {
                if !download_allowed(&url, dl_port.load(Ordering::SeqCst)) {
                    return false;
                }
                let app = webview.app_handle();
                let name = destination
                    .file_name()
                    .map(|n| downloads::sanitize_file_name(&n.to_string_lossy()))
                    .unwrap_or_else(|| downloads::sanitize_file_name(""));
                let dir = app
                    .path()
                    .download_dir()
                    .ok()
                    .or_else(|| destination.parent().map(PathBuf::from));
                if let Some(dir) = dir {
                    let _ = fs::create_dir_all(&dir);
                    *destination = downloads::unique_path(&dir, &name, |p| p.exists());
                }
                true
            }
            DownloadEvent::Finished { path, success, .. } => {
                if let (true, Some(path)) = (success, path) {
                    let _ = webview.app_handle().opener().reveal_item_in_dir(path);
                }
                true
            }
            _ => true,
        })
        .build()?;
    Ok(())
}

/// Only an absolute, non-UNC path to an existing directory may be opened from the menu.
fn is_safe_data_dir(dir: &str) -> bool {
    let path = Path::new(dir);
    path.is_absolute()
        && !dir.starts_with("\\\\")
        && !dir.starts_with("//")
        && fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

fn on_menu_event(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    match id {
        menu::OPEN_DATA_ID => {
            let dir = state.data_dir.lock().ok().and_then(|d| d.clone());
            if let Some(dir) = dir {
                if !is_safe_data_dir(&dir) {
                    log_line(&state.log, "shell", "ignored an unsafe data folder path");
                } else if let Err(e) = app.opener().open_path(dir, None::<&str>) {
                    eprintln!("could not open the data folder: {e}");
                }
            }
        }
        menu::EXPORT_DATA_ID => {
            let port = state.port.load(Ordering::SeqCst);
            if port != 0 {
                if let Ok(url) =
                    Url::parse(&format!("http://127.0.0.1:{port}/settings#data-storage"))
                {
                    navigate_main(app, url);
                }
            }
        }
        _ => {}
    }
}

fn mark_shutting_down(app: &AppHandle) {
    app.state::<AppState>()
        .shutting_down
        .store(true, Ordering::SeqCst);
}

fn shutdown_sidecar(app: &AppHandle) {
    mark_shutting_down(app);
    let state = app.state::<AppState>();
    let sidecar = state.sidecar.lock().ok().and_then(|mut s| s.take());
    if let Some(sidecar) = sidecar {
        sidecar.shutdown(SHUTDOWN_GRACE);
    }
}

/// Entry point shared by the binary and (later) mobile targets.
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window(MAIN_LABEL) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();
            let log_dir = handle.path().app_log_dir()?;
            fs::create_dir_all(&log_dir)?;
            let log_path = log_dir.join("server.log");
            let log: SharedLog = Arc::new(Mutex::new(fs::File::create(&log_path)?));
            let port = Arc::new(AtomicU16::new(0));
            let channel = Channel::from_identifier(&handle.config().identifier);
            app.manage(AppState {
                port: Arc::clone(&port),
                data_dir: Mutex::new(None),
                sidecar: Mutex::new(None),
                log,
                log_path,
                shutting_down: AtomicBool::new(false),
                channel,
            });

            log_line(
                &handle.state::<AppState>().log,
                "shell",
                &format!("{} ({})", channel.product_name(), channel.identifier()),
            );
            app.set_menu(menu::build(&handle, channel)?)?;
            build_main_window(&handle, port, channel)?;

            let started = {
                let state = handle.state::<AppState>();
                start_server(&handle, &state).inspect_err(|message| {
                    log_line(&state.log, "shell", message);
                })
            };
            match started {
                Ok((rx, token)) => {
                    std::thread::spawn(move || supervise(handle, rx, token));
                }
                Err(_) => error_page(&handle),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Local App Studio desktop shell");

    app.run(|app, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { .. },
            ..
        } => mark_shutting_down(app),
        RunEvent::ExitRequested { .. } | RunEvent::Exit => shutdown_sidecar(app),
        _ => {}
    });
}
