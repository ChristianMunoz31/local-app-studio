//! What to tell the user when the server process ends before it is ready, or stops later.
//!
//! [`classify_exit`] is pure: it maps the exit code and the tail of stderr to the copy and buttons
//! of a native dialog. Exit code 3 (`EXIT_RESTORE_RECOVERY` in `server/backup/restore.js`) means the
//! startup recovery of an interrupted backup restore failed; the server then prints a plain message
//! naming where the user's previous data is. The shell never deletes or moves any file.

use std::path::{Path, PathBuf};

use crate::channel::Channel;

/// Server exit code for "startup recovery of an interrupted backup restore failed".
pub const EXIT_RESTORE_RECOVERY: i32 = 3;

/// Windows exit status when a process is ended by a console control event, which is what a user
/// logoff or system shutdown does to the server (`0xC000013A` as an `i32`).
pub const STATUS_CONTROL_C_EXIT: i32 = 0xC000_013Au32 as i32;

pub const OPEN_DATA_LABEL: &str = "Open data folder";
pub const OPEN_LOG_LABEL: &str = "Open log folder";
pub const COPY_DETAILS_LABEL: &str = "Copy details";
pub const QUIT_LABEL: &str = "Quit";

const RESTORE_TITLE: &str = "Local App Studio could not finish restoring";
const GENERIC_TITLE: &str = "Local App Studio stopped unexpectedly";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitKind {
    /// Exit code 3: the interrupted restore could not be recovered.
    RestoreRecovery,
    /// Any other early exit.
    Generic,
}

/// What a pressed button means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogAction {
    OpenFolder,
    CopyDetails,
    Quit,
}

/// Copy and buttons of the native dialog. `buttons` are in display order and the last one is
/// always Quit (it is also what closing the dialog means).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExitDialog {
    pub kind: ExitKind,
    pub title: String,
    pub message: String,
    pub buttons: Vec<String>,
    /// Plain text for the clipboard.
    pub details: String,
    /// Folder that "Open ..." should reveal, when known.
    pub open_dir: Option<PathBuf>,
}

impl ExitDialog {
    /// Maps a pressed button label to its action. Anything unknown (including a closed dialog)
    /// is Quit.
    pub fn action_for(&self, label: &str) -> DialogAction {
        match self.buttons.iter().position(|b| b == label) {
            Some(0) => DialogAction::OpenFolder,
            Some(1) if self.kind == ExitKind::RestoreRecovery => DialogAction::CopyDetails,
            _ => DialogAction::Quit,
        }
    }
}

/// Whether an exit of the server deserves a dialog. No dialog when the app is quitting (a Quit
/// during the splash, a logoff or shutdown), when the server ended cleanly (code 0), or when
/// Windows ended it for a session end (`STATUS_CONTROL_C_EXIT`).
pub fn should_show_exit_dialog(shutting_down: bool, code: Option<i32>) -> bool {
    !shutting_down && code != Some(0) && code != Some(STATUS_CONTROL_C_EXIT)
}

/// Paths the server named in its recovery message.
#[derive(Debug, PartialEq, Eq)]
struct RecoveryPaths {
    listed: Vec<String>,
    data_dir: String,
}

fn last_component(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn parent_of(path: &str) -> Option<&str> {
    path.rfind(['/', '\\'])
        .map(|i| &path[..i])
        .filter(|p| !p.is_empty())
}

/// True when two folder paths name the same place (component-wise; case-insensitive on Windows).
fn same_dir(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        let lower = |p: &Path| p.to_string_lossy().to_lowercase();
        Path::new(&lower(a)) == Path::new(&lower(b))
    } else {
        a == b
    }
}

/// Reads the folders out of the server's exit-3 stderr message:
/// `... Your previous data is in <aside db> and safety copies are in <backups>. Close programs ...`
/// or `... Your previous data is in the safety backup <id> in <backups> [and the restore-failed
/// files a, b]. Close programs ...`. The final such message wins. The aside db must sit in
/// `restore-aside` directly under the data folder (the parent of `backups`), and when the shell
/// knows its own data folder (`expected`) the parsed one must be the same. `None` when the text
/// does not match.
fn parse_recovery_paths(stderr: &str, expected: Option<&Path>) -> Option<RecoveryPaths> {
    let flat = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let rest = flat.rsplit_once("Your previous data is in ")?.1;
    let rest = rest.split(". Close programs").next()?.trim_end_matches('.');

    let (backups, aside_dir, failed): (&str, Option<&str>, Vec<&str>) =
        if let Some((aside, backups)) = rest.split_once(" and safety copies are in ") {
            if last_component(aside) != "app.db" {
                return None;
            }
            (backups, Some(parent_of(aside)?), Vec::new())
        } else {
            let after = if let Some(r) = rest.strip_prefix("the safety backup ") {
                r.split_once(" in ")?.1
            } else {
                rest.strip_prefix("the safety copies in ")?
            };
            let (backups, failed) = match after.split_once(" and the restore-failed files ") {
                Some((b, f)) => (b, f.split(", ").filter(|s| !s.is_empty()).collect()),
                None => (after, Vec::new()),
            };
            (backups, None, failed)
        };
    if last_component(backups) != "backups" {
        return None;
    }
    let data_dir = parent_of(backups)?;
    if let Some(aside_dir) = aside_dir {
        if last_component(aside_dir) != "restore-aside" || parent_of(aside_dir)? != data_dir {
            return None;
        }
    }
    if let Some(expected) = expected {
        if !same_dir(Path::new(data_dir), expected) {
            return None;
        }
    }
    // Restore-failed files sit directly in the data folder: name the folder once, not each file
    // (long file paths are cut off in the dialog; the full list is in the copied details).
    let failed_dir = (!failed.is_empty()).then_some(data_dir);
    let listed = aside_dir
        .into_iter()
        .chain(Some(backups))
        .chain(failed_dir)
        .map(str::to_string)
        .collect();
    let data_dir = data_dir.to_string();
    Some(RecoveryPaths { listed, data_dir })
}

fn restore_dialog(stderr_tail: &str, data_dir: Option<&Path>, log_path: &Path) -> ExitDialog {
    let (listed, open_dir): (Vec<String>, Option<PathBuf>) =
        match parse_recovery_paths(stderr_tail, data_dir) {
            Some(p) => (p.listed, Some(PathBuf::from(p.data_dir))),
            None => match data_dir {
                Some(dir) => (
                    vec![
                        dir.join("restore-aside").display().to_string(),
                        dir.join("backups").display().to_string(),
                    ],
                    Some(dir.to_path_buf()),
                ),
                None => (Vec::new(), None),
            },
        };
    let place = if listed.is_empty() {
        " the restore-aside and backups folders inside your Local App Studio data folder."
            .to_string()
    } else {
        format!("\n{}", listed.join("\n"))
    };
    let message = format!(
        "Local App Studio couldn't finish restoring a backup. Your data is safe in:{place}\n\nNothing was deleted. Close programs that may be using these files (antivirus, sync tools), then start Local App Studio again."
    );
    let server_text = stderr_tail.trim();
    let body = if server_text.is_empty() {
        message.clone()
    } else {
        server_text.to_string()
    };
    ExitDialog {
        kind: ExitKind::RestoreRecovery,
        title: RESTORE_TITLE.to_string(),
        message,
        buttons: vec![
            OPEN_DATA_LABEL.to_string(),
            COPY_DETAILS_LABEL.to_string(),
            QUIT_LABEL.to_string(),
        ],
        details: format!("{body}\n\nLog file: {}", log_path.display()),
        open_dir,
    }
}

/// The server's stderr is deliberately not copied into these details: only the restore dialog
/// shows server text (a message the server wrote for the user). The full output is in the log.
fn generic_dialog(code: Option<i32>, log_path: &Path) -> ExitDialog {
    let code_text = match code {
        Some(c) => format!("Exit code: {c}"),
        None => "Exit code: none (the server was stopped from outside)".to_string(),
    };
    let message = format!(
        "Local App Studio's server stopped, so the app can't continue. Technical details were saved to this log file:\n{}\n\n{code_text}",
        log_path.display()
    );
    let details = format!("{code_text}\nLog file: {}", log_path.display());
    ExitDialog {
        kind: ExitKind::Generic,
        title: GENERIC_TITLE.to_string(),
        message,
        buttons: vec![OPEN_LOG_LABEL.to_string(), QUIT_LABEL.to_string()],
        details,
        open_dir: log_path.parent().map(Path::to_path_buf),
    }
}

/// Maps how the server ended to the dialog to show. `data_dir` is the data folder the shell knows
/// about (the override or the per-OS default), used when the server's message cannot be parsed.
pub fn classify_exit(
    code: Option<i32>,
    stderr_tail: &str,
    data_dir: Option<&Path>,
    log_path: &Path,
) -> ExitDialog {
    if code == Some(EXIT_RESTORE_RECOVERY) {
        restore_dialog(stderr_tail, data_dir, log_path)
    } else {
        generic_dialog(code, log_path)
    }
}

/// The data folder the server will use, mirroring `server/paths.js`: the shell's
/// `APP_DESKTOP_DATA_DIR` override, else the per-OS default for this channel.
pub fn default_data_dir(get: impl Fn(&str) -> Option<String>, channel: Channel) -> Option<PathBuf> {
    let non_empty = |key: &str| get(key).filter(|v| !v.trim().is_empty());
    if let Some(dir) = non_empty("APP_DESKTOP_DATA_DIR") {
        return Some(PathBuf::from(dir.trim()));
    }
    platform_data_dir(get, channel)
}

/// The per-OS default data folder of `channel`, ignoring any override.
pub fn platform_data_dir(
    get: impl Fn(&str) -> Option<String>,
    channel: Channel,
) -> Option<PathBuf> {
    let non_empty = |key: &str| get(key).filter(|v| !v.trim().is_empty());
    if cfg!(windows) {
        let base = non_empty("APPDATA").map(PathBuf::from).or_else(|| {
            non_empty("USERPROFILE").map(|h| Path::new(&h).join("AppData").join("Roaming"))
        })?;
        return Some(base.join(channel.data_folder_name()));
    }
    if cfg!(target_os = "macos") {
        let home = non_empty("HOME")?;
        return Some(
            Path::new(&home)
                .join("Library")
                .join("Application Support")
                .join(channel.data_folder_name()),
        );
    }
    let base = non_empty("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| non_empty("HOME").map(|h| Path::new(&h).join(".local").join("share")))?;
    Some(base.join(channel.data_folder_name()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ASIDE_MSG: &str = "Local App Studio could not finish recovering an interrupted backup restore, so it did not start. Nothing was deleted. Your previous data is in C:\\Users\\example\\AppData\\Roaming\\Local App Studio\\restore-aside\\app.db and safety copies are in C:\\Users\\example\\AppData\\Roaming\\Local App Studio\\backups. Close programs that may be using these files (antivirus, sync tools) and start Local App Studio again.";
    const SAFETY_MSG: &str = "Local App Studio could not finish recovering an interrupted backup restore, so it did not start. Nothing was deleted. Your previous data is in the safety backup 20260101-101010 in /home/example/.local/share/local-app-studio/backups and the restore-failed files /home/example/.local/share/local-app-studio/restore-failed-1.db, /home/example/.local/share/local-app-studio/restore-failed-2.db. Close programs that may be using these files (antivirus, sync tools) and start Local App Studio again.";
    const SAFETY_NO_ID_MSG: &str = "Local App Studio could not finish recovering an interrupted backup restore, so it did not start. Nothing was deleted. Your previous data is in the safety copies in D:\\Data\\Local App Studio\\backups. Close programs that may be using these files (antivirus, sync tools) and start Local App Studio again.";

    fn log() -> PathBuf {
        // Built with join so the parent folder resolves on every OS (a backslash is not a
        // separator on Linux or macOS).
        PathBuf::from("logs")
            .join("com.neuralfoundry.localappstudio")
            .join("server.log")
    }

    #[test]
    fn code_3_with_restore_aside_message_lists_the_named_paths() {
        let d = classify_exit(Some(3), ASIDE_MSG, None, &log());
        assert_eq!(d.kind, ExitKind::RestoreRecovery);
        assert_eq!(d.title, "Local App Studio could not finish restoring");
        assert!(d.message.starts_with(
            "Local App Studio couldn't finish restoring a backup. Your data is safe in:\n"
        ));
        assert!(d
            .message
            .contains("\nC:\\Users\\example\\AppData\\Roaming\\Local App Studio\\restore-aside\n"));
        assert!(d
            .message
            .contains("C:\\Users\\example\\AppData\\Roaming\\Local App Studio\\backups"));
        assert_eq!(
            d.open_dir,
            Some(PathBuf::from(
                "C:\\Users\\example\\AppData\\Roaming\\Local App Studio"
            ))
        );
        assert_eq!(d.buttons, ["Open data folder", "Copy details", "Quit"]);
        assert!(d.details.starts_with(ASIDE_MSG));
        assert!(d
            .details
            .ends_with(&format!("Log file: {}", log().display())));
    }

    #[test]
    fn code_3_with_safety_backup_message_lists_backups_and_failed_files() {
        let d = classify_exit(Some(3), SAFETY_MSG, None, &log());
        assert_eq!(d.kind, ExitKind::RestoreRecovery);
        assert!(d
            .message
            .contains("\n/home/example/.local/share/local-app-studio/backups\n"));
        assert!(d
            .message
            .contains("backups\n/home/example/.local/share/local-app-studio\n\n"));
        assert!(d
            .details
            .contains("/home/example/.local/share/local-app-studio/restore-failed-2.db"));
        assert_eq!(
            d.open_dir,
            Some(PathBuf::from("/home/example/.local/share/local-app-studio"))
        );
    }

    #[test]
    fn code_3_with_safety_copies_and_no_failed_files() {
        let parsed = parse_recovery_paths(SAFETY_NO_ID_MSG, None).unwrap();
        assert_eq!(parsed.listed, ["D:\\Data\\Local App Studio\\backups"]);
        assert_eq!(parsed.data_dir, "D:\\Data\\Local App Studio");
    }

    #[test]
    fn code_3_parses_a_message_wrapped_over_several_lines() {
        let wrapped = ASIDE_MSG
            .replace(". Nothing", ".\nNothing")
            .replace(" and safety", "\nand safety");
        assert!(parse_recovery_paths(&wrapped, None).is_some());
    }

    #[test]
    fn code_3_with_unparseable_stderr_falls_back_to_the_known_data_dir() {
        let dir = PathBuf::from("C:\\Temp\\local-app-studio-dev");
        for tail in [
            "",
            "something unexpected",
            "Your previous data is in somewhere odd.",
        ] {
            let d = classify_exit(Some(3), tail, Some(&dir), &log());
            assert_eq!(d.kind, ExitKind::RestoreRecovery);
            assert!(d
                .message
                .contains(&dir.join("restore-aside").display().to_string()));
            assert!(d
                .message
                .contains(&dir.join("backups").display().to_string()));
            assert_eq!(d.open_dir, Some(dir.clone()));
            assert_eq!(d.buttons.len(), 3);
        }
    }

    #[test]
    fn code_3_with_no_paths_at_all_still_names_the_folders() {
        let d = classify_exit(Some(3), "", None, &log());
        assert!(d.message.contains("restore-aside and backups folders"));
        assert_eq!(d.open_dir, None);
        assert!(d
            .details
            .contains("Local App Studio couldn't finish restoring a backup."));
    }

    #[test]
    fn rejects_paths_that_are_not_the_expected_folders() {
        let bad = "Your previous data is in C:\\x\\other.db and safety copies are in C:\\x\\backups. Close programs";
        assert!(parse_recovery_paths(bad, None).is_none());
        let bad2 = "Your previous data is in C:\\x\\restore-aside\\app.db and safety copies are in C:\\x\\stuff. Close programs";
        assert!(parse_recovery_paths(bad2, None).is_none());
    }

    #[test]
    fn parser_binds_to_the_final_message_in_the_tail() {
        let tail = format!("{SAFETY_NO_ID_MSG}\n{ASIDE_MSG}");
        let parsed = parse_recovery_paths(&tail, None).unwrap();
        assert_eq!(
            parsed.data_dir,
            "C:\\Users\\example\\AppData\\Roaming\\Local App Studio"
        );
    }

    #[test]
    fn aside_dir_must_be_restore_aside_directly_under_the_data_dir() {
        let wrong_name = "Your previous data is in C:\\x\\elsewhere\\app.db and safety copies are in C:\\x\\backups. Close programs";
        assert!(parse_recovery_paths(wrong_name, None).is_none());
        let wrong_parent = "Your previous data is in C:\\y\\restore-aside\\app.db and safety copies are in C:\\x\\backups. Close programs";
        assert!(parse_recovery_paths(wrong_parent, None).is_none());
        let ok = "Your previous data is in C:\\x\\restore-aside\\app.db and safety copies are in C:\\x\\backups. Close programs";
        assert!(parse_recovery_paths(ok, None).is_some());
    }

    #[test]
    fn parsed_data_dir_must_match_the_known_one() {
        let known = Path::new("/home/example/.local/share/local-app-studio");
        assert!(parse_recovery_paths(SAFETY_MSG, Some(known)).is_some());
        let other = PathBuf::from("/home/example/elsewhere");
        assert!(parse_recovery_paths(SAFETY_MSG, Some(&other)).is_none());
        let d = classify_exit(Some(3), SAFETY_MSG, Some(&other), &log());
        assert_eq!(d.open_dir, Some(other.clone()));
        assert!(d
            .message
            .contains(&other.join("backups").display().to_string()));
        assert!(!d.message.contains(".local/share/local-app-studio/backups"));
    }

    #[test]
    fn dialog_policy_by_shutdown_state_and_exit_code() {
        assert_eq!(STATUS_CONTROL_C_EXIT, -1_073_741_510);
        for code in [Some(1), Some(2), Some(3), Some(-1), None] {
            assert!(should_show_exit_dialog(false, code), "{code:?}");
            assert!(!should_show_exit_dialog(true, code), "{code:?}");
        }
        for code in [Some(0), Some(STATUS_CONTROL_C_EXIT)] {
            assert!(!should_show_exit_dialog(false, code), "{code:?}");
            assert!(!should_show_exit_dialog(true, code), "{code:?}");
        }
    }

    #[test]
    fn other_exit_codes_get_the_generic_dialog_with_the_log_path() {
        for (code, expected) in [
            (Some(1), "Exit code: 1"),
            (Some(2), "Exit code: 2"),
            (None, "Exit code: none"),
        ] {
            let d = classify_exit(code, "boom", Some(Path::new("C:\\d")), &log());
            assert_eq!(d.kind, ExitKind::Generic, "{code:?}");
            assert_eq!(d.title, "Local App Studio stopped unexpectedly");
            assert!(d.message.contains(&log().display().to_string()));
            assert!(d.message.contains(expected), "{code:?}");
            assert_eq!(d.buttons, ["Open log folder", "Quit"]);
            assert_eq!(
                d.open_dir,
                Some(PathBuf::from("logs").join("com.neuralfoundry.localappstudio"))
            );
            assert!(!d.details.contains("boom"));
            assert!(!d.message.contains("boom"));
        }
    }

    #[test]
    fn buttons_map_to_actions_and_unknown_means_quit() {
        let restore = classify_exit(Some(3), "", None, &log());
        assert_eq!(
            restore.action_for("Open data folder"),
            DialogAction::OpenFolder
        );
        assert_eq!(
            restore.action_for("Copy details"),
            DialogAction::CopyDetails
        );
        assert_eq!(restore.action_for("Quit"), DialogAction::Quit);
        assert_eq!(restore.action_for("Cancel"), DialogAction::Quit);
        let generic = classify_exit(Some(1), "", None, &log());
        assert_eq!(
            generic.action_for("Open log folder"),
            DialogAction::OpenFolder
        );
        assert_eq!(generic.action_for("Copy details"), DialogAction::Quit);
        assert_eq!(generic.action_for("Quit"), DialogAction::Quit);
    }

    #[test]
    fn no_copy_string_contains_an_em_dash() {
        let dash = '\u{2014}';
        let mut all = vec![
            RESTORE_TITLE.to_string(),
            GENERIC_TITLE.to_string(),
            OPEN_DATA_LABEL.to_string(),
            OPEN_LOG_LABEL.to_string(),
            COPY_DETAILS_LABEL.to_string(),
            QUIT_LABEL.to_string(),
        ];
        for code in [Some(0), Some(1), Some(2), Some(3), None] {
            for tail in ["", ASIDE_MSG, SAFETY_MSG] {
                let d = classify_exit(code, tail, Some(Path::new("C:\\d")), &log());
                all.extend([d.title, d.message, d.details]);
                all.extend(d.buttons);
            }
        }
        assert!(all.iter().all(|s| !s.contains(dash)));
    }

    #[test]
    fn default_data_dir_prefers_the_override() {
        let env = |k: &str| match k {
            "APP_DESKTOP_DATA_DIR" => Some("C:\\Temp\\x".to_string()),
            "APPDATA" => Some("C:\\Roaming".to_string()),
            _ => None,
        };
        assert_eq!(
            default_data_dir(env, Channel::Stable),
            Some(PathBuf::from("C:\\Temp\\x"))
        );
        let padded =
            |k: &str| (k == "APP_DESKTOP_DATA_DIR").then(|| "  C:\\Temp\\y \n".to_string());
        assert_eq!(
            default_data_dir(padded, Channel::Dev),
            Some(PathBuf::from("C:\\Temp\\y"))
        );
        let none = |_: &str| None;
        assert_eq!(default_data_dir(none, Channel::Stable), None);
        if cfg!(windows) {
            let appdata = |k: &str| (k == "APPDATA").then(|| "C:\\Roaming".to_string());
            assert_eq!(
                default_data_dir(appdata, Channel::Stable),
                Some(PathBuf::from("C:\\Roaming\\Local App Studio"))
            );
            assert_eq!(
                default_data_dir(appdata, Channel::Dev),
                Some(PathBuf::from("C:\\Roaming\\Local App Studio Dev"))
            );
        }
    }

    #[test]
    fn default_data_dir_is_per_channel() {
        let get = |k: &str| match k {
            "APPDATA" => Some("C:\\Roaming".to_string()),
            "HOME" => Some("/tmp/u".to_string()),
            "XDG_DATA_HOME" => Some("/xdg".to_string()),
            _ => None,
        };
        let stable = default_data_dir(get, Channel::Stable).expect("stable dir");
        let dev = default_data_dir(get, Channel::Dev).expect("dev dir");
        assert_ne!(stable, dev);
        assert_eq!(
            stable.file_name().and_then(|n| n.to_str()),
            Some(Channel::Stable.data_folder_name())
        );
        assert_eq!(
            dev.file_name().and_then(|n| n.to_str()),
            Some(Channel::Dev.data_folder_name())
        );
        assert_eq!(stable.parent(), dev.parent());
    }
}
