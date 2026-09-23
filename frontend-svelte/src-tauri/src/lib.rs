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
async fn ping_device(host: String, timeout_ms: Option<u64>) -> bool {
  use std::net::ToSocketAddrs;
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

  if clean_host.is_empty() {
    return false;
  }

  let t_ms = timeout_ms.unwrap_or(800);
  let t = Duration::from_millis(t_ms);
  let host_clone = clean_host.clone();

  tauri::async_runtime::spawn_blocking(move || {
    // 1. Intento rápido de conexión TCP a los puertos comunes de biométricos/paneles (80, 8000, 443)
    for port in [80, 8000, 443] {
      let target = format!("{}:{}", host_clone, port);
      if let Ok(mut addrs) = target.to_socket_addrs() {
        if let Some(addr) = addrs.next() {
          if std::net::TcpStream::connect_timeout(&addr, t).is_ok() {
            return true;
          }
        }
      }
    }

    // 2. Si los puertos TCP no respondieron (por firewall o puertos no estándar entre VLANs),
    // ejecutar ping ICMP a nivel de sistema operativo
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      let timeout_str = t_ms.to_string();
      let output = std::process::Command::new("ping")
        .args(["-n", "1", "-w", &timeout_str, &host_clone])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW: no abre ventana de consola
        .output();

      if let Ok(out) = output {
        if out.status.success() {
          let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
          let is_loss = text.contains("100% perdidos") || text.contains("100% loss");
          let is_unreachable = text.contains("inaccesible") || text.contains("unreachable") || text.contains("agotado") || text.contains("timed out");
          let has_reply = text.contains("ttl=") || text.contains("bytes=");
          if has_reply && !is_loss && !is_unreachable {
            return true;
          }
        }
      }
    }

    false
  }).await.unwrap_or(false)
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
      isapi_request,
      ping_device
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
