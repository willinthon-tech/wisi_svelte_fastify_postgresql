use tauri::{Manager, Emitter};
use std::time::Duration;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct IsapiResponse {
  pub status: u16,
  pub ok: bool,
  pub data: String,
}

fn get_auth_param(header: &str, param: &str) -> String {
  let param_lower = param.to_lowercase();
  for part in header.split(',') {
    let trimmed = part.trim();
    if let Some(eq_idx) = trimmed.find('=') {
      let key = trimmed[..eq_idx].trim().to_lowercase();
      if key == param_lower || key.ends_with(&format!(" {}", param_lower)) {
        let mut val = trimmed[eq_idx + 1..].trim();
        if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
          val = &val[1..val.len() - 1];
        }
        return val.to_string();
      }
    }
  }
  String::new()
}

fn md5_hex(s: &str) -> String {
  format!("{:x}", md5::compute(s.as_bytes()))
}

fn compute_digest_header(www_auth: &str, username: &str, password: &str, method: &str, uri: &str) -> String {
  let realm = get_auth_param(www_auth, "realm");
  let nonce = get_auth_param(www_auth, "nonce");
  let qop = get_auth_param(www_auth, "qop");
  let opaque = get_auth_param(www_auth, "opaque");

  let ha1 = md5_hex(&format!("{}:{}:{}", username, realm, password));
  let ha2 = md5_hex(&format!("{}:{}", method, uri));

  let mut parts = vec![
    format!("username=\"{}\"", username),
    format!("realm=\"{}\"", realm),
    format!("nonce=\"{}\"", nonce),
    format!("uri=\"{}\"", uri),
  ];

  if qop.to_lowercase().contains("auth") {
    let cnonce = "0a4f11a9";
    let nc = "00000001";
    let response = md5_hex(&format!("{}:{}:{}:{}:auth:{}", ha1, nonce, nc, cnonce, ha2));
    parts.push("qop=\"auth\"".to_string());
    parts.push(format!("nc={}", nc));
    parts.push(format!("cnonce=\"{}\"", cnonce));
    parts.push(format!("response=\"{}\"", response));
  } else {
    let response = md5_hex(&format!("{}:{}:{}", ha1, nonce, ha2));
    parts.push(format!("response=\"{}\"", response));
  }

  if !opaque.is_empty() {
    parts.push(format!("opaque=\"{}\"", opaque));
  }

  format!("Digest {}", parts.join(", "))
}

#[tauri::command]
async fn isapi_request(
  host: String,
  uri: String,
  method: Option<String>,
  body: Option<String>,
  username: Option<String>,
  password: Option<String>,
  timeout_secs: Option<u64>,
) -> Result<IsapiResponse, String> {
  let m = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
  let u = username.unwrap_or_else(|| "admin".to_string());
  let p = password.unwrap_or_default();
  let t_secs = timeout_secs.unwrap_or(10);

  let clean_host = if host.starts_with("http://") || host.starts_with("https://") {
    host.trim_end_matches('/').to_string()
  } else {
    format!("http://{}", host.trim_end_matches('/'))
  };

  let clean_uri = if uri.starts_with('/') {
    uri
  } else {
    format!("/{}", uri)
  };

  let full_url = format!("{}{}", clean_host, clean_uri);

  let client = reqwest::Client::builder()
    .http1_title_case_headers()
    .timeout(Duration::from_secs(t_secs))
    .danger_accept_invalid_certs(true)
    .build()
    .map_err(|e| format!("Error al crear cliente HTTP nativo: {}", e))?;

  let build_req = |auth: Option<String>| {
    let mut req = match m.as_str() {
      "POST" => client.post(&full_url),
      "PUT" => client.put(&full_url),
      "DELETE" => client.delete(&full_url),
      _ => client.get(&full_url),
    };

    let is_xml = if let Some(ref b) = body {
      b.trim().starts_with('<')
    } else {
      false
    };

    let content_type = if is_xml {
      "application/xml; charset=UTF-8"
    } else {
      "application/json; charset=UTF-8"
    };

    let accept_header = if is_xml {
      "application/xml, text/xml, */*"
    } else {
      "application/json, text/plain, */*"
    };

    req = req
      .header("Accept", accept_header)
      .header("Content-Type", content_type);

    if let Some(auth_val) = auth {
      req = req.header("Authorization", auth_val);
    }

    if let Some(ref b) = body {
      if m == "POST" || m == "PUT" {
        req = req.body(b.clone());
      }
    }

    req
  };

  // Paso 1: Petición inicial (suele responder 401 con reto Digest)
  let initial_res = build_req(None)
    .send()
    .await
    .map_err(|e| format!("Fallo de conexión con {}: {}", clean_host, e))?;

  let status = initial_res.status().as_u16();
  let initial_headers = initial_res.headers().clone();
  let initial_bytes = initial_res.bytes().await.unwrap_or_default();

  // Si requiere autenticación Digest (401)
  if status == 401 {
    if let Some(auth_header) = initial_headers.get("www-authenticate") {
      if let Ok(auth_str) = auth_header.to_str() {
        let digest_header = compute_digest_header(auth_str, &u, &p, &m, &clean_uri);

        let authed_res = build_req(Some(digest_header))
          .send()
          .await
          .map_err(|e| format!("Fallo en reintento autenticado a {}: {}", clean_host, e))?;

        let final_status = authed_res.status().as_u16();
        let data = authed_res.text().await.unwrap_or_default();

        return Ok(IsapiResponse {
          status: final_status,
          ok: final_status >= 200 && final_status < 300,
          data,
        });
      }
    }
  }

  let data = String::from_utf8_lossy(&initial_bytes).to_string();
  Ok(IsapiResponse {
    status,
    ok: status >= 200 && status < 300,
    data,
  })
}

#[tauri::command]
async fn ping_device(host: String, timeout_ms: Option<u64>) -> bool {
  let clean_host = host.trim()
    .trim_start_matches("http://")
    .trim_start_matches("https://")
    .split('/')
    .next()
    .unwrap_or("")
    .split(':')
    .next()
    .unwrap_or("")
    .to_string();

  if clean_host.is_empty() || clean_host == "—" {
    return false;
  }

  let t_ms = timeout_ms.unwrap_or(1200);
  let timeout = Duration::from_millis(t_ms);

  let client = match reqwest::Client::builder()
    .timeout(timeout)
    .connect_timeout(timeout)
    .danger_accept_invalid_certs(true)
    .build() {
      Ok(c) => c,
      Err(_) => return false,
    };

  // Validar estrictamente contra endpoints ISAPI de Hikvision
  // Un equipo Hikvision (biométrico o panel) responde a /ISAPI/System/deviceInfo con status 401 o 200 y esquema isapi.org o userCheck
  // Equipos ajenos (impresoras, routers, PCs, etc.) responden con 404, HTML o timeout, y son descartados
  let urls = [
    format!("http://{}/ISAPI/System/deviceInfo", clean_host),
    format!("http://{}:8000/ISAPI/System/deviceInfo", clean_host),
    format!("https://{}/ISAPI/System/deviceInfo", clean_host),
  ];

  for url in urls {
    if let Ok(resp) = client.get(&url).send().await {
      let status = resp.status().as_u16();
      if status == 200 || status == 401 {
        let www_auth = resp.headers().get("www-authenticate")
          .and_then(|h| h.to_str().ok())
          .unwrap_or("")
          .to_lowercase();

        if let Ok(text) = resp.text().await {
          let lower = text.to_lowercase();
          if lower.contains("isapi.org") || lower.contains("usercheck") || lower.contains("deviceinfo") || lower.contains("substatuscode") || lower.contains("hikvision") || www_auth.contains("digest") {
            return true;
          }
        } else if www_auth.contains("digest") {
          return true;
        }
      }
    }
  }

  false
}

#[tauri::command]
fn save_file_to_downloads(app_handle: tauri::AppHandle, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
  let download_dir = app_handle.path().download_dir()
    .map_err(|e| format!("No se pudo obtener la carpeta de descargas: {}", e))?;

  let file_path = download_dir.join(&file_name);
  std::fs::write(&file_path, &bytes)
    .map_err(|e| format!("No se pudo guardar el archivo en {}: {}", file_path.display(), e))?;

  // Abrir la carpeta de descargas de forma nativa sin invocar procesos cmd o explorer
  let _ = open::that(&download_dir);

  Ok(file_path.to_string_lossy().to_string())
}

#[derive(Clone, serde::Serialize)]
pub struct CecomDownloadProgress {
  pub task_id: String,
  pub percent: u32,
  pub stage: String,
  pub status: String, // "downloading", "completed", "error"
  pub output_file: String,
  pub error: Option<String>,
}

fn get_internal_converter_exe(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
  // 1. En recursos empaquetados de Tauri (en Windows instalado)
  if let Ok(res_dir) = app_handle.path().resource_dir() {
    let cand = res_dir.join("sdk_hikvision").join("Converter.exe");
    if cand.exists() {
      return Some(cand);
    }
  }

  // 2. Al lado del ejecutable .exe de la app
  if let Ok(exe_path) = std::env::current_exe() {
    if let Some(parent) = exe_path.parent() {
      let cand = parent.join("sdk_hikvision").join("Converter.exe");
      if cand.exists() {
        return Some(cand);
      }
    }
  }

  // 3. Carpeta integrada en el workspace del proyecto
  let dev_cand = PathBuf::from(r"C:\new_wisi\frontend-svelte\src-tauri\sdk_hikvision\Converter.exe");
  if dev_cand.exists() {
    return Some(dev_cand);
  }

  None
}

#[tauri::command]
fn prompt_save_video_dialog(default_name: String) -> Option<String> {
  rfd::FileDialog::new()
    .set_title("Guardar Video de CECOM")
    .set_file_name(&default_name)
    .add_filter("Video MP4 (*.mp4)", &["mp4"])
    .save_file()
    .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn prompt_select_folder_dialog() -> Option<String> {
  rfd::FileDialog::new()
    .set_title("Seleccionar Carpeta para Guardar Videos de CECOM")
    .pick_folder()
    .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn get_cecom_default_paths(app_handle: tauri::AppHandle) -> serde_json::Value {
  let download_dir = app_handle.path().download_dir().unwrap_or_else(|_| PathBuf::from(r"C:\Users\Public\Downloads"));
  let video_dir = app_handle.path().video_dir().unwrap_or_else(|_| download_dir.clone());
  let target_dir = video_dir.join("Wisi_Cecom_Videos");
  if !target_dir.exists() {
    let _ = std::fs::create_dir_all(&target_dir);
  }

  let detected_sdk = get_internal_converter_exe(&app_handle)
    .map(|p| p.to_string_lossy().to_string())
    .unwrap_or_default();

  serde_json::json!({
    "dest_dir": target_dir.to_string_lossy().to_string(),
    "sdk_converter_path": detected_sdk,
    "sdk_available": !detected_sdk.is_empty(),
  })
}

#[tauri::command]
fn open_media_file(file_path: String) -> Result<(), String> {
  let p = Path::new(&file_path);
  if !p.exists() {
    return Err(format!("El archivo no existe en el disco: {}", file_path));
  }
  open::that(&file_path).map_err(|e| format!("Error abriendo video: {}", e))
}

#[tauri::command]
fn show_in_folder(file_path: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;
    let _ = Command::new("explorer")
      .args(["/select,", &file_path])
      .spawn();
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  {
    if let Some(parent) = Path::new(&file_path).parent() {
      open::that(parent).map_err(|e| format!("Error abriendo carpeta: {}", e))?;
    }
    Ok(())
  }
}

#[tauri::command]
fn open_folder(folder_path: String) -> Result<(), String> {
  open::that(&folder_path).map_err(|e| format!("Error abriendo carpeta: {}", e))
}

#[tauri::command]
async fn start_cecom_video_download(
  app_handle: tauri::AppHandle,
  task_id: String,
  ip: String,
  usuario: String,
  clave: String,
  canal: String,
  inicio_str: String,
  fin_str: String,
  output_filename: String,
  destination_path: Option<String>,
  modo: Option<String>,
) -> Result<String, String> {
  let exe_path = get_internal_converter_exe(&app_handle).ok_or_else(|| {
    "El módulo interno de descarga Hikvision (Converter.exe) no está presente en el paquete de la aplicación.".to_string()
  })?;

  let exe_dir = exe_path.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();

  // Si el usuario seleccionó la ruta con el diálogo nativo de Windows (Guardar como...):
  let final_file_path = if let Some(dp) = destination_path {
    if !dp.trim().is_empty() {
      PathBuf::from(dp)
    } else {
      let base = app_handle.path().video_dir().unwrap_or_else(|_| app_handle.path().download_dir().unwrap_or_else(|_| PathBuf::from(r"C:\Users\Public\Downloads")));
      base.join("Wisi_Cecom_Videos").join(&output_filename)
    }
  } else {
    let base = app_handle.path().video_dir().unwrap_or_else(|_| app_handle.path().download_dir().unwrap_or_else(|_| PathBuf::from(r"C:\Users\Public\Downloads")));
    base.join("Wisi_Cecom_Videos").join(&output_filename)
  };

  if let Some(parent) = final_file_path.parent() {
    if !parent.exists() {
      let _ = std::fs::create_dir_all(parent);
    }
  }

  let final_file_str = final_file_path.to_string_lossy().to_string();

  let mut args = vec![
    ip,
    usuario,
    clave,
    canal,
    inicio_str,
    fin_str,
    final_file_str.clone(),
  ];

  if let Some(m) = modo {
    if m == "f" {
      args.push("f".to_string());
    }
  }

  let app_clone = app_handle.clone();
  let task_id_clone = task_id.clone();
  let final_dest_clone = final_file_str.clone();

  std::thread::spawn(move || {
    let _ = app_clone.emit("cecom_download_progress", CecomDownloadProgress {
      task_id: task_id_clone.clone(),
      percent: 5,
      stage: "[1/3] Conectando con grabador...".to_string(),
      status: "downloading".to_string(),
      output_file: final_dest_clone.clone(),
      error: None,
    });

    let mut cmd = Command::new(&exe_path);
    cmd.current_dir(&exe_dir);
    cmd.args(&args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
      Ok(c) => c,
      Err(e) => {
        let _ = app_clone.emit("cecom_download_progress", CecomDownloadProgress {
          task_id: task_id_clone,
          percent: 0,
          stage: "Error de ejecución".to_string(),
          status: "error".to_string(),
          output_file: final_dest_clone,
          error: Some(format!("Fallo al iniciar Converter.exe: {}", e)),
        });
        return;
      }
    };

    let mut captured_error: Option<String> = None;

    if let Some(stdout) = child.stdout.take() {
      let reader = BufReader::new(stdout);
      for line_res in reader.lines() {
        if let Ok(line) = line_res {
          let trimmed = line.trim();
          if trimmed.starts_with("PROGRESS:") {
            if let Some(num_str) = trimmed.split(':').nth(1) {
              if let Ok(val) = num_str.trim().parse::<u32>() {
                let _ = app_clone.emit("cecom_download_progress", CecomDownloadProgress {
                  task_id: task_id_clone.clone(),
                  percent: val,
                  stage: format!("Extrayendo video desde grabador: {}%", val),
                  status: "downloading".to_string(),
                  output_file: final_dest_clone.clone(),
                  error: None,
                });
              }
            }
          } else if trimmed.starts_with("LOGIN_ERROR:") 
            || trimmed.starts_with("DOWNLOAD_ERROR:") 
            || trimmed.starts_with("DOWNLOAD_POS_ERROR:") 
            || trimmed.starts_with("DOWNLOAD_TIMEOUT:")
            || trimmed.starts_with("FILE_MISSING:")
            || trimmed.starts_with("DOWNLOAD_INCOMPLETE:")
            || trimmed.starts_with("ERROR:") {
            let msg = if let Some(first_idx) = trimmed.find(':') {
              let rest = trimmed[first_idx + 1..].trim();
              if let Some(second_idx) = rest.find(':') {
                rest[second_idx + 1..].trim().to_string()
              } else {
                rest.to_string()
              }
            } else {
              trimmed.to_string()
            };
            captured_error = Some(msg);
          }
        }
      }
    }

    let status = child.wait();
    let file_exists = Path::new(&final_dest_clone).exists();
    let file_size = if file_exists {
      std::fs::metadata(&final_dest_clone).map(|m| m.len()).unwrap_or(0)
    } else {
      0
    };

    match status {
      Ok(s) if s.success() && file_exists && file_size > 0 => {
        let _ = app_clone.emit("cecom_download_progress", CecomDownloadProgress {
          task_id: task_id_clone,
          percent: 100,
          stage: "Completado (Video MP4 Listo)".to_string(),
          status: "completed".to_string(),
          output_file: final_dest_clone,
          error: None,
        });
      }
      Ok(s) => {
        // Garantizar que nunca quede un archivo corrupto o de 0 bytes en disco
        if Path::new(&final_dest_clone).exists() {
          if let Ok(meta) = std::fs::metadata(&final_dest_clone) {
            if meta.len() == 0 {
              let _ = std::fs::remove_file(&final_dest_clone);
            }
          }
        }

        let err_msg = if let Some(e) = captured_error {
          e
        } else if !file_exists || file_size == 0 {
          "El grabador no encontró video en ese canal para la fecha y rango de horas seleccionadas (NET_DVR_NORECORD).".to_string()
        } else {
          format!("El proceso finalizó con código {}", s)
        };
        let _ = app_clone.emit("cecom_download_progress", CecomDownloadProgress {
          task_id: task_id_clone,
          percent: 0,
          stage: "Descarga Fallida".to_string(),
          status: "error".to_string(),
          output_file: final_dest_clone,
          error: Some(err_msg),
        });
      }
      Err(e) => {
        if Path::new(&final_dest_clone).exists() {
          let _ = std::fs::remove_file(&final_dest_clone);
        }
        let _ = app_clone.emit("cecom_download_progress", CecomDownloadProgress {
          task_id: task_id_clone,
          percent: 0,
          stage: "Error en SDK".to_string(),
          status: "error".to_string(),
          output_file: final_dest_clone,
          error: Some(format!("Error esperando Converter.exe: {}", e)),
        });
      }
    }
  });

  Ok(final_file_str)
}

#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
  open::that(&url).map_err(|e| format!("Error al abrir navegador: {}", e))
}

fn ensure_ai_engine_running() {
  std::thread::spawn(|| {
    // 1. Verificar si el puerto 5005 ya está activo
    if let Ok(addr) = "127.0.0.1:5005".parse::<std::net::SocketAddr>() {
      if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok() {
        println!("✅ [AI Engine] Motor de IA ya está activo en puerto 5005");
        return;
      }
    }

    println!("🚀 [AI Engine] Motor no detectado en puerto 5005. Arrancando internamente en segundo plano...");

    // Candidatos para python.exe
    let candidate_pythons = [
      PathBuf::from(r"C:\Users\antho\Downloads\ia_wisi_space\.venv\Scripts\python.exe"),
      PathBuf::from(r"C:\new_wisi\ai-engine\.venv\Scripts\python.exe"),
      PathBuf::from(r"C:\new_wisi\.venv\Scripts\python.exe"),
    ];

    let mut found_python = None;
    for p in &candidate_pythons {
      if p.exists() {
        found_python = Some(p.clone());
        break;
      }
    }

    let python_bin = found_python.unwrap_or_else(|| PathBuf::from("python"));

    // Candidatos para server.py
    let mut candidate_scripts = vec![
      PathBuf::from(r"C:\new_wisi\ai-engine\server.py"),
      PathBuf::from(r"ai-engine\server.py"),
    ];

    if let Ok(exe) = std::env::current_exe() {
      if let Some(parent) = exe.parent() {
        candidate_scripts.push(parent.join("ai-engine").join("server.py"));
        candidate_scripts.push(parent.join("resources").join("ai-engine").join("server.py"));
      }
    }

    let mut found_script = None;
    for s in &candidate_scripts {
      if s.exists() {
        found_script = Some(s.clone());
        break;
      }
    }

    let script_path = found_script.unwrap_or_else(|| PathBuf::from(r"C:\new_wisi\ai-engine\server.py"));
    let working_dir = script_path.parent().unwrap_or(Path::new("."));

    println!("▶ [AI Engine] Lanzando {:?} con script {:?}", python_bin, script_path);

    let mut cmd = Command::new(&python_bin);
    cmd.arg(&script_path);
    cmd.current_dir(working_dir);
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
      const CREATE_NO_WINDOW: u32 = 0x08000000;
      cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
      Ok(child) => {
        println!("✔ [AI Engine] Motor iniciado automáticamente con PID: {}", child.id());
      }
      Err(e) => {
        eprintln!("⚠️ [AI Engine] No se pudo iniciar automáticamente: {}", e);
      }
    }
  });
}

#[tauri::command]
fn start_ai_engine() -> Result<bool, String> {
  ensure_ai_engine_running();
  Ok(true)
}

#[tauri::command]
fn is_ai_engine_running() -> bool {
  if let Ok(addr) = "127.0.0.1:5005".parse::<std::net::SocketAddr>() {
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
  } else {
    false
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Arrancar motor de IA internamente de forma automática en Windows
      ensure_ai_engine_running();
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      save_file_to_downloads,
      open_in_browser,
      isapi_request,
      ping_device,
      get_cecom_default_paths,
      prompt_save_video_dialog,
      prompt_select_folder_dialog,
      start_cecom_video_download,
      open_media_file,
      show_in_folder,
      open_folder,
      start_ai_engine,
      is_ai_engine_running
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
