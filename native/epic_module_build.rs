use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../epic_module_build.rs");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        println!("cargo:rustc-link-lib=dylib=winsqlite3");
    } else {
        println!("cargo:rustc-link-lib=dylib=sqlite3");
    }
    if env::var_os("CARGO_FEATURE_TRANSPORT_CLIENT").is_some() {
        let transport_lib_dir = env::var_os("ALTBASE_EPIC_TRANSPORT_LIB_DIR")
            .expect("ALTBASE_EPIC_TRANSPORT_LIB_DIR is required for transport-client");
        println!("cargo:rustc-link-search=native={}", PathBuf::from(transport_lib_dir).display());
        println!("cargo:rustc-link-lib=dylib=altbase_epic_transport");
    }
    if target_os == "linux" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
    } else if target_os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path");
    }
    if target_os != "windows" {
        return;
    }

    let package = env::var("CARGO_PKG_NAME").expect("Cargo package name is required");
    let stem = package.replace('-', "_");
    let title = package
        .split('_')
        .map(|part| {
            let mut chars = part.chars();
            chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo did not set OUT_DIR"));
    let resource_script = out_dir.join(format!("{stem}.rc"));
    let resource_object = out_dir.join(format!("{stem}.res"));
    let resource_text = format!(r#"
1 VERSIONINFO
 FILEVERSION 0,1,6,0
 PRODUCTVERSION 0,1,6,0
 FILEFLAGSMASK 0x3fL
 FILEFLAGS 0x0L
 FILEOS 0x40004L
 FILETYPE 0x2L
 FILESUBTYPE 0x0L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
      VALUE "CompanyName", "Altbase"
      VALUE "FileDescription", "{title}"
      VALUE "FileVersion", "0.1.6"
      VALUE "InternalName", "{stem}"
      VALUE "LegalCopyright", "Copyright (C) Altbase"
      VALUE "OriginalFilename", "{stem}.dll"
      VALUE "ProductName", "Altbase Wallet"
      VALUE "ProductVersion", "0.1.6"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
"#);
    fs::write(&resource_script, resource_text).expect("failed to write Epic module resource");
    let status = Command::new("rc.exe")
        .arg("/nologo")
        .arg(format!("/fo{}", resource_object.display()))
        .arg(&resource_script)
        .status()
        .expect("failed to start the Windows resource compiler");
    assert!(status.success(), "Windows resource compilation failed");
    println!("cargo:rustc-link-arg={}", resource_object.display());
    for option in [
        "/DYNAMICBASE", "/NXCOMPAT", "/HIGHENTROPYVA", "/CETCOMPAT",
        "/OPT:REF", "/OPT:ICF", "/INCREMENTAL:NO", "/RELEASE", "/Brepro",
    ] {
        println!("cargo:rustc-link-arg={option}");
    }
}
