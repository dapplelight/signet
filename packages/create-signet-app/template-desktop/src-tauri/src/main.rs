// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{ErrorKind, Read, Write},
    net::TcpListener,
    thread,
    time::{Duration, Instant},
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

const CALLBACK_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Signed in</title>\
<p style=\"font-family:system-ui;margin:3rem\">Signed in. You can close this tab.</p>";

fn reply(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

/// Sign-in step: bind a loopback port for the OAuth redirect and return it. The
/// first `GET /callback?...` is emitted to the webview as `oauth-callback`
/// (the raw query string), then the listener closes; so does it after 5 minutes.
#[tauri::command]
fn listen_for_callback(app: tauri::AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let target = request.split_whitespace().nth(1).unwrap_or("");
                    if let Some(query) = target.strip_prefix("/callback?") {
                        let _ = app.emit("oauth-callback", query.to_string());
                        reply(&mut stream, "200 OK", CALLBACK_PAGE);
                        break;
                    }
                    reply(&mut stream, "404 Not Found", "");
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100))
                }
                Err(_) => break,
            }
        }
    });
    Ok(port)
}

fn show(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![listen_for_callback])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("bundle icon").clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app, "main"),
                    "quit" => app.exit(0),
                    _ => {}
                })
                // Left click toggles the small window; right click opens the menu.
                // ponytail: not positioned under the icon; add a positioner when it matters.
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        match app.get_webview_window("tray") {
                            Some(w) if w.is_visible().unwrap_or(false) => {
                                let _ = w.hide();
                            }
                            _ => show(app, "tray"),
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // The tray window hides when it loses focus; closing the main window
            // keeps the app running in the tray (Quit is in the tray menu).
            ("tray", WindowEvent::Focused(false)) => {
                let _ = window.hide();
            }
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
