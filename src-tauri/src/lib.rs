// SPDX-License-Identifier: Apache-2.0
//! Axion desktop app (Tauri 2). The web app runs unchanged in the system webview; this file
//! replaces the Node compile service (server/compile.ts) with two commands the page calls
//! through Tauri's IPC: `health` and `compile`. arduino-cli (GPL-3.0) is run as a separate
//! program, exactly like the Node service does, and is not bundled.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

/// One compile at a time: arduino-cli is CPU and disk heavy.
static COMPILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    arduino_cli: Option<String>,
    cores: Vec<String>,
    ready: bool,
}

#[derive(Deserialize)]
struct CompileRequest {
    fqbn: String,
    files: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct CompileResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    hex: Option<String>,
    log: String,
    cached: bool,
}

impl CompileResult {
    fn fail(log: impl Into<String>) -> Self {
        CompileResult { ok: false, hex: None, log: log.into(), cached: false }
    }
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

/// arduino-cli: $ARDUINO_CLI, then PATH, then the usual install folders. Apps started from
/// the Finder / Start menu do not get the shell's PATH, so Homebrew & co. are checked by hand.
fn find_cli() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("ARDUINO_CLI") {
        return Some(PathBuf::from(p));
    }
    let exe = if cfg!(windows) { "arduino-cli.exe" } else { "arduino-cli" };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    let h = home();
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        h.join("bin"),
        h.join(".local/bin"),
        h.join("AppData/Local/Programs/Arduino CLI"),
        h.join("AppData/Local/Microsoft/WinGet/Links"),
        PathBuf::from("C:/Program Files/Arduino CLI"),
    ]);
    dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
}

fn run_cli(cli: &Path, args: &[&str]) -> (bool, String) {
    let mut cmd = Command::new(cli);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    }
    match cmd.output() {
        Ok(o) => (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))),
        Err(e) => (false, format!("Could not run {}: {e}", cli.display())),
    }
}

#[tauri::command]
async fn health() -> Health {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(cli) = find_cli() else {
            return Health { arduino_cli: None, cores: vec![], ready: false };
        };
        let (ok, version) = run_cli(&cli, &["version"]);
        if !ok {
            return Health { arduino_cli: None, cores: vec![], ready: false };
        }
        let (_, list) = run_cli(&cli, &["core", "list", "--format", "json"]);
        let cores: Vec<String> = serde_json::from_str::<serde_json::Value>(&list)
            .ok()
            .and_then(|v| {
                let platforms = v.get("platforms").cloned().unwrap_or(v);
                platforms.as_array().map(|a| a.iter().filter_map(|p| p.get("id")?.as_str().map(String::from)).collect())
            })
            .unwrap_or_default();
        let ready = cores.iter().any(|c| c == "arduino:avr");
        Health { arduino_cli: Some(version.trim().to_string()), cores, ready }
    })
    .await
    .unwrap_or(Health { arduino_cli: None, cores: vec![], ready: false })
}

fn valid_fqbn(f: &str) -> bool {
    let parts: Vec<&str> = f.split(':').collect();
    (3..=4).contains(&parts.len())
        && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || "_.-=,".contains(c)))
}

fn valid_file(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    !stem.is_empty()
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && ["ino", "h", "hpp", "c", "cpp"].contains(&ext)
}

/// Raw flash images (RP2040 .bin) as Intel HEX, like src/mcu/intelhex.ts binToHex.
fn bin_to_hex(data: &[u8], base: u32) -> String {
    let mut out = String::with_capacity(data.len() * 3);
    let mut upper: i64 = -1;
    let record = |out: &mut String, kind: u8, addr: u16, bytes: &[u8]| {
        let mut sum: u32 = bytes.len() as u32 + (addr >> 8) as u32 + (addr & 0xff) as u32 + kind as u32;
        out.push_str(&format!(":{:02X}{:04X}{:02X}", bytes.len(), addr, kind));
        for b in bytes {
            sum += *b as u32;
            out.push_str(&format!("{b:02X}"));
        }
        out.push_str(&format!("{:02X}\n", (0x100 - (sum & 0xff)) & 0xff));
    };
    for (i, chunk) in data.chunks(16).enumerate() {
        let addr = base.wrapping_add((i * 16) as u32);
        let hi = (addr >> 16) as i64;
        if hi != upper {
            upper = hi;
            record(&mut out, 4, 0, &[(hi >> 8) as u8, hi as u8]);
        }
        record(&mut out, 0, addr as u16, chunk);
    }
    out.push_str(":00000001FF\n");
    out
}

fn firmware_hex(fqbn: &str, out_dir: &Path) -> Result<String, String> {
    if let Ok(hex) = std::fs::read_to_string(out_dir.join("sketch.ino.hex")) {
        return Ok(hex);
    }
    if fqbn.split(':').nth(1) == Some("rp2040") {
        let bin = std::fs::read(out_dir.join("sketch.ino.bin")).map_err(|e| e.to_string())?;
        return Ok(bin_to_hex(&bin, 0x1000_0000));
    }
    Err("The compiler produced no .hex file".into())
}

fn do_compile(req: CompileRequest) -> CompileResult {
    if !valid_fqbn(&req.fqbn) {
        return CompileResult::fail(format!("Invalid board id \"{}\"", req.fqbn));
    }
    if !req.files.contains_key("sketch.ino") {
        return CompileResult::fail("Missing sketch.ino");
    }
    if let Some(bad) = req.files.keys().find(|n| !valid_file(n)) {
        return CompileResult::fail(format!("Invalid file name \"{bad}\""));
    }

    // Same cache as the Node service (~/.axion/cache), keyed by board + files.
    let mut h = Sha256::new();
    h.update(serde_json::to_string(&(&req.fqbn, &req.files)).unwrap_or_default());
    let hash: String = h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect();
    let cache_dir = std::env::var_os("AXION_CACHE").map(PathBuf::from).unwrap_or_else(|| home().join(".axion").join("cache"));
    let cached = cache_dir.join(format!("{hash}.hex"));
    if let Ok(hex) = std::fs::read_to_string(&cached) {
        return CompileResult { ok: true, hex: Some(hex), log: "Using cached build.".into(), cached: true };
    }

    let Some(cli) = find_cli() else {
        return CompileResult::fail("\"arduino-cli\" was not found.\nInstall arduino-cli (see README), then run \"npm run setup\" or install the cores with arduino-cli.");
    };
    let work = std::env::temp_dir().join(format!("axion-{hash}"));
    let sketch_dir = work.join("sketch");
    let out_dir = work.join("out");
    let result = (|| {
        std::fs::create_dir_all(&sketch_dir).map_err(|e| e.to_string())?;
        for (name, text) in &req.files {
            std::fs::write(sketch_dir.join(name), text).map_err(|e| e.to_string())?;
        }
        let (ok, log) = run_cli(
            &cli,
            &["compile", "--fqbn", &req.fqbn, "--warnings", "default", "--output-dir", &out_dir.to_string_lossy(), &sketch_dir.to_string_lossy()],
        );
        if !ok {
            return Ok(CompileResult::fail(log));
        }
        let hex = firmware_hex(&req.fqbn, &out_dir)?;
        let _ = std::fs::create_dir_all(&cache_dir);
        let _ = std::fs::write(&cached, &hex);
        Ok::<_, String>(CompileResult { ok: true, hex: Some(hex), log, cached: false })
    })();
    let _ = std::fs::remove_dir_all(&work);
    result.unwrap_or_else(CompileResult::fail)
}

#[tauri::command]
async fn compile(fqbn: String, files: BTreeMap<String, String>) -> CompileResult {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = COMPILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        do_compile(CompileRequest { fqbn, files })
    })
    .await
    .unwrap_or_else(|e| CompileResult::fail(e.to_string()))
}

/// Save a text file (project / diagram) through the native "Save as" dialog: webviews do not
/// do browser-style downloads. Returns the path, or None if the user cancelled.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, contents: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let ext = name.rsplit('.').next().unwrap_or("json").to_string();
        let Some(path) = app.dialog().file().set_file_name(&name).add_filter("Axion / Wokwi files", &[ext.as_str()]).blocking_save_file() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, contents).map_err(|e| e.to_string())?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The arduino-pico core's board index (Raspberry Pi Pico).
const PICO_INDEX: &str = "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json";

/// One-time setup, the same steps as `npm run setup` (scripts/setup.mjs): the AVR and
/// RP2040 cores and the common libraries. Needs the internet once; returns the log.
#[tauri::command]
async fn setup(pico: bool) -> CompileResult {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = COMPILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let Some(cli) = find_cli() else {
            return CompileResult::fail("\"arduino-cli\" was not found. Install it first (see README).");
        };
        let urls: Vec<&str> = if pico { vec!["--additional-urls", PICO_INDEX] } else { vec![] };
        let mut steps: Vec<Vec<&str>> = vec![[&["core", "update-index"][..], &urls].concat(), vec!["core", "install", "arduino:avr"]];
        if pico {
            steps.push([&["core", "install", "rp2040:rp2040"][..], &urls].concat());
        }
        for lib in ["Servo", "LiquidCrystal I2C", "LiquidCrystal"] {
            steps.push(vec!["lib", "install", lib]);
        }
        let mut log = String::new();
        for args in steps {
            log.push_str(&format!("> arduino-cli {}\n", args.join(" ")));
            let (ok, out) = run_cli(&cli, &args);
            log.push_str(&out);
            if !ok {
                return CompileResult::fail(log);
            }
        }
        CompileResult { ok: true, hex: None, log, cached: false }
    })
    .await
    .unwrap_or_else(|e| CompileResult::fail(e.to_string()))
}

/// Port of the local web server in release builds. Fixed, so the page keeps its origin (and
/// with it the saved project in localStorage) from one start to the next; a random free port
/// is used only if something else already listens there.
const PREFERRED_PORT: u16 = 47_819;

/// Multi-core simulation needs SharedArrayBuffer, which webviews only allow to cross-origin
/// isolated pages served over http(s). The default `tauri://` scheme is not isolated on macOS
/// and Linux, so release builds serve the app from http://127.0.0.1 (tauri-plugin-localhost)
/// with these headers instead. The server only answers with Axion's own bundled files.
const ISOLATION: [(&str, &str); 2] = [("Cross-Origin-Opener-Policy", "same-origin"), ("Cross-Origin-Embedder-Policy", "require-corp")];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = if portpicker::is_free(PREFERRED_PORT) { PREFERRED_PORT } else { portpicker::pick_unused_port().unwrap_or(PREFERRED_PORT) };
    tauri::Builder::default()
        .plugin(
            tauri_plugin_localhost::Builder::new(port)
                .host("127.0.0.1")
                .on_request(|_req, res| {
                    for (k, v) in ISOLATION {
                        res.add_header(k, v);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![health, compile, setup, save_file])
        .setup(move |app| {
            // `tauri dev` uses the Vite dev server (which sends the same headers).
            #[cfg(dev)]
            let url = tauri::WebviewUrl::App("/".into());
            #[cfg(not(dev))]
            let url = {
                let url: tauri::Url = format!("http://127.0.0.1:{port}").parse().expect("valid url");
                tauri::Manager::add_capability(
                    app,
                    tauri::ipc::CapabilityBuilder::new("localhost")
                        .remote(url.to_string())
                        .window("main")
                        .permission("core:default")
                        .permission("allow-health")
                        .permission("allow-compile")
                        .permission("allow-setup")
                        .permission("allow-save-file"),
                )?;
                tauri::WebviewUrl::External(url)
            };
            tauri::WebviewWindowBuilder::new(app, "main", url)
                .title("Axion")
                .inner_size(1400.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .disable_drag_drop_handler()
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Axion");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_matches_the_typescript_encoder() {
        let hex = bin_to_hex(&[1, 2, 3], 0x1000_0000);
        assert_eq!(hex, ":020000041000EA\n:03000000010203F7\n:00000001FF\n");
    }

    #[test]
    fn validates_inputs() {
        assert!(valid_fqbn("arduino:avr:uno"));
        assert!(valid_fqbn("rp2040:rp2040:rpipico:usbstack=nousb"));
        assert!(!valid_fqbn("arduino:avr"));
        assert!(!valid_fqbn("a:b:c; rm -rf /"));
        assert!(valid_file("sketch.ino"));
        assert!(!valid_file("../x.ino"));
        assert!(!valid_file("sketch.exe"));
    }
}
