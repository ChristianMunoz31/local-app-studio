//! Native menu: File (Quit), Edit (clipboard, needed on macOS) and Help (data folder, export, about).
//! The About box names the channel (Local App Studio or Local App Studio Dev) and shows the display version.

use crate::channel::{display_version, Channel};
use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

/// Help > Open data folder.
pub const OPEN_DATA_ID: &str = "open-data-folder";
/// Help > Export my data.
pub const EXPORT_DATA_ID: &str = "export-data";

fn about_label(channel: Channel) -> &'static str {
    match channel {
        Channel::Stable => "About Local App Studio",
        Channel::Dev => "About Local App Studio Dev",
    }
}

fn about_comments(channel: Channel) -> &'static str {
    match channel {
        Channel::Stable => "Private, local-first desktop app.",
        Channel::Dev => "Dev build. Private, local-first desktop app.",
    }
}

/// Builds the application menu.
pub fn build<R: Runtime>(app: &AppHandle<R>, channel: Channel) -> tauri::Result<Menu<R>> {
    let file = SubmenuBuilder::new(app, "File").quit().build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let about = AboutMetadataBuilder::new()
        .name(Some(channel.product_name()))
        .version(Some(display_version(
            channel,
            &app.package_info().version.to_string(),
        )))
        .comments(Some(about_comments(channel)))
        .build();
    let help = SubmenuBuilder::new(app, "Help")
        .text(OPEN_DATA_ID, "Open data folder")
        .text(EXPORT_DATA_ID, "Export my data")
        .separator()
        .about_with_text(about_label(channel), Some(about))
        .build()?;
    MenuBuilder::new(app).items(&[&file, &edit, &help]).build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn about_copy_names_the_channel() {
        assert_eq!(about_label(Channel::Stable), "About Local App Studio");
        assert_eq!(about_label(Channel::Dev), "About Local App Studio Dev");
        assert_eq!(
            about_comments(Channel::Stable),
            "Private, local-first desktop app."
        );
        assert!(about_comments(Channel::Dev).starts_with("Dev build."));
    }
}
