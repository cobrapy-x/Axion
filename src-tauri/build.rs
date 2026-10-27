fn main() {
    // Declaring the app's commands generates the permissions `allow-health`, `allow-compile` and
    // `allow-setup` and `allow-save-file`, so capabilities (including the one for the localhost origin) can grant them.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["health", "compile", "setup", "save_file"])))
        .expect("failed to run tauri-build");
}
