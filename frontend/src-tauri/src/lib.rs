use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct Backend(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let backend = app
                .path()
                .resource_dir()?
                .join("resources")
                .join("mapi-backend")
                .join("mapi-backend-aarch64-apple-darwin");
            let command = app
                .shell()
                .command(backend)
                .args([
                    "--data-dir",
                    &data_dir.to_string_lossy(),
                    "--port",
                    "18421",
                    "--parent-pid",
                    &std::process::id().to_string(),
                ]);
            let (_events, child) = command.spawn()?;
            app.manage(Backend(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("No se pudo iniciar MAPI");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(backend) = app.try_state::<Backend>() {
                if let Some(child) = backend.0.lock().expect("backend lock").take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
