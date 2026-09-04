use tauri::Manager;

#[tauri::command]
fn save_file_to_downloads(app_handle: tauri::AppHandle, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
  let download_dir = app_handle.path().download_dir()
    .map_err(|e| format!("No se pudo obtener la carpeta de descargas: {}", e))?;

  let file_path = download_dir.join(&file_name);
  std::fs::write(&file_path, &bytes)
    .map_err(|e| format!("No se pudo guardar el archivo en {}: {}", file_path.display(), e))?;

  #[cfg(target_os = "windows")]
  {
    // Abrir la carpeta Descargas con el archivo seleccionado en el Explorador de Windows
    let path_str = file_path.to_string_lossy().to_string();
    let _ = std::process::Command::new("explorer")
      .args(["/select,", &path_str])
      .spawn();
  }

  Ok(file_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![save_file_to_downloads])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
