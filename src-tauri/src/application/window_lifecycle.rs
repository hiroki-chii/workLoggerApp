use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, WebviewWindow,
};

use crate::{app_state::AppState, error::AppResult};

const MINI_WIDTH: i32 = 240;
const MINI_HEIGHT: i32 = 160;
const MINI_MARGIN: i32 = 20;

pub fn setup(app: &AppHandle) -> AppResult<()> {
    let show = MenuItem::with_id(app, "show", "表示", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit_item])?;

    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .expect("application icon is required")
                .clone(),
        )
        .tooltip("ゆとリズム")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                let _ = show_main(app);
            }
            "quit" => quit(app),
            _ => {}
        })
        .build(app)?;

    app.on_tray_icon_event(|app, event| {
        if matches!(
            event,
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
        ) {
            let _ = show_main(app);
        }
    });

    let main = app
        .get_webview_window("main")
        .expect("main window is required");
    let main_app = app.clone();
    main.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            let state = main_app.state::<AppState>();
            if !state.is_quitting() {
                api.prevent_close();
                let _ = main_app.get_webview_window("main").map(|window| window.hide());
                if state.show_mini_on_close() {
                    let _ = show_mini(&main_app);
                }
            }
        }
        tauri::WindowEvent::Focused(true) => {
            let _ = hide_mini(&main_app);
        }
        tauri::WindowEvent::Resized(_) => {
            if main_app
                .get_webview_window("main")
                .map(|window| window.is_minimized().unwrap_or(false))
                .unwrap_or(false)
                && main_app.state::<AppState>().show_mini_on_close()
            {
                let _ = show_mini(&main_app);
            }
        }
        _ => {}
    });

    let mini = app
        .get_webview_window("mini")
        .expect("mini window is required");
    let mini_app = app.clone();
    mini.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(position) => {
            let _ = mini_app
                .state::<AppState>()
                .save_mini_window_position(position.x, position.y);
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = mini_app.get_webview_window("mini").map(|window| window.hide());
        }
        _ => {}
    });
    Ok(())
}

pub fn show_main(app: &AppHandle) -> AppResult<()> {
    hide_mini(app)?;
    let main = required_window(app, "main")?;
    main.unminimize()?;
    main.show()?;
    main.set_focus()?;
    Ok(())
}

pub fn show_mini(app: &AppHandle) -> AppResult<()> {
    required_window(app, "main")?.hide()?;
    let mini = required_window(app, "mini")?;
    position_mini(app, &mini)?;
    mini.show()?;
    Ok(())
}

pub fn hide_mini(app: &AppHandle) -> AppResult<()> {
    required_window(app, "mini")?.hide()?;
    Ok(())
}

pub fn quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.begin_quit();
    app.exit(0);
}

fn position_mini(app: &AppHandle, mini: &WebviewWindow) -> AppResult<()> {
    if let Some((x, y)) = app.state::<AppState>().mini_window_position()? {
        if saved_position_is_visible(app, x, y)? {
            mini.set_position(PhysicalPosition::new(x, y))?;
            return Ok(());
        }
    }

    let monitor = mini
        .current_monitor()?
        .or(app.primary_monitor()?)
        .ok_or_else(|| crate::error::AppError::ActivitySource("display is unavailable".to_owned()))?;
    let work_area = monitor.work_area();
    let x = work_area.position.x + work_area.size.width as i32 - MINI_WIDTH - MINI_MARGIN;
    let y = work_area.position.y + work_area.size.height as i32 - MINI_HEIGHT - MINI_MARGIN;
    mini.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

fn saved_position_is_visible(app: &AppHandle, x: i32, y: i32) -> AppResult<bool> {
    let right = x + MINI_WIDTH;
    let bottom = y + MINI_HEIGHT;
    Ok(app.available_monitors()?.iter().any(|monitor| {
        let area = monitor.work_area();
        let area_right = area.position.x + area.size.width as i32;
        let area_bottom = area.position.y + area.size.height as i32;
        x < area_right && right > area.position.x && y < area_bottom && bottom > area.position.y
    }))
}

fn required_window(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| crate::error::AppError::ActivitySource(format!("{label} window is unavailable")))
}
