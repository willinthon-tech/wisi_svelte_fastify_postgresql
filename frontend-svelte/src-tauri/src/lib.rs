use tauri::Manager;
use std::time::Duration;

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

    req = req
      .header("Accept", "application/json, text/plain, */*")
      .header("Content-Type", "application/json; charset=UTF-8");

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

  // Si requiere autenticación Digest (401)
  if status == 401 {
    if let Some(auth_header) = initial_res.headers().get("www-authenticate") {
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

  let data = initial_res.text().await.unwrap_or_default();
  Ok(IsapiResponse {
    status,
    ok: status >= 200 && status < 300,
    data,
  })
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

#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
  open::that(&url).map_err(|e| format!("Error al abrir navegador: {}", e))
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
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      save_file_to_downloads,
      open_in_browser,
      isapi_request
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
