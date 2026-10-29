use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=assets/icons/icon.ico");
    println!("cargo:rerun-if-changed=assets/icons/icons.ico");

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        let has_system_cf =
            PathBuf::from("/System/Library/Frameworks/CoreFoundation.framework").exists();
        let has_sdkroot = env::var_os("SDKROOT").is_some();

        // Quando si effettua cross-compilazione da Linux/Windows verso macOS con cargo-zigbuild
        // senza un MacOSX.sdk completo installato, forniamo uno stub TBD minimale per CoreFoundation
        // (richiesto da iana-time-zone e sys-locale) così il linker Mach-O di Zig risolve i simboli dinamici.
        if !has_system_cf && !has_sdkroot {
            if let Ok(out_dir_str) = env::var("OUT_DIR") {
                let out_dir = PathBuf::from(out_dir_str);
                let cf_dir = out_dir.join("Frameworks").join("CoreFoundation.framework");
                if fs::create_dir_all(&cf_dir).is_ok() {
                    let tbd_content = "--- !tapi-tbd
tbd-version:     4
targets:         [ x86_64-macos, arm64-macos ]
install-name:    '/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation'
exports:
  - targets:         [ x86_64-macos, arm64-macos ]
    symbols:         [ _CFArrayGetCount, _CFArrayGetValueAtIndex, _CFDataGetBytePtr,
                       _CFDataGetLength, _CFDictionaryGetValueIfPresent,
                       _CFErrorCopyDescription, _CFErrorGetCode, _CFGetTypeID,
                       _CFLocaleCopyCurrent, _CFLocaleCopyPreferredLanguages,
                       _CFLocaleGetIdentifier, _CFLocaleGetValue, _CFRelease,
                       _CFRetain, _CFStringCompare, _CFStringCreateWithBytes,
                       _CFStringCreateWithBytesNoCopy, _CFStringCreateWithCString,
                       _CFStringGetBytes, _CFStringGetCString, _CFStringGetCStringPtr,
                       _CFStringGetLength, _CFStringGetMaximumSizeForEncoding,
                       _CFStringGetSystemEncoding, _CFStringGetTypeID,
                       _CFTimeZoneCopyDefault, _CFTimeZoneCopySystem,
                       _CFTimeZoneGetName, _kCFAllocatorDefault, _kCFAllocatorNull,
                       _kCFLocaleCountryCode, _kCFLocaleLanguageCode,
                       _kCFTypeArrayCallBacks, _kCFTypeDictionaryKeyCallBacks,
                       _kCFTypeDictionaryValueCallBacks ]
...
";
                    if fs::write(cf_dir.join("CoreFoundation.tbd"), tbd_content).is_ok() {
                        println!(
                            "cargo:rustc-link-search=framework={}",
                            out_dir.join("Frameworks").display()
                        );
                    }
                }
            }
        }
    } else if target_os == "windows" {
        let candidates = ["assets/icons/icons.ico", "assets/icons/icon.ico"];
        if let Some(icon_path) = candidates.iter().copied().find(|p| Path::new(p).exists()) {
            let mut res = winres::WindowsResource::new();
            res.set_icon(icon_path);

            // Support cross-compilation from Linux to Windows (x86_64-pc-windows-gnu)
            if env::var("HOST").unwrap_or_default().contains("linux")
                && env::var("TARGET")
                    .unwrap_or_default()
                    .contains("windows-gnu")
            {
                res.set_windres_path("x86_64-w64-mingw32-windres");
                res.set_ar_path("x86_64-w64-mingw32-ar");
            }

            if let Err(err) = res.compile() {
                println!(
                    "cargo:warning=Failed to compile Windows icon resource '{}': {}",
                    icon_path, err
                );
            } else if env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default() == "gnu" {
                // In crates with both [lib] and [[bin]], cargo:rustc-link-lib=static=resource
                // attaches libresource.a to the rlib and GNU ld drops unreferenced .rsrc objects
                // from .a archives. Passing resource.o / resource.lib directly to binary targets
                // forces the PE .rsrc icon section into mmex-sync.exe.
                //
                // NOTA: Questo workaround è necessario SOLO per l'ambiente GNU (mingw).
                // Per l'ambiente MSVC (windows-msvc), winres gestisce già correttamente
                // l'iniezione delle risorse senza bisogno di forzarle tramite arg-bins,
                // evitando l'errore "LNK1123: CVT1100: duplicate resource".
                if let Ok(out_dir) = env::var("OUT_DIR") {
                    let res_obj = PathBuf::from(&out_dir).join("resource.o");
                    let res_lib = PathBuf::from(&out_dir).join("resource.lib");
                    if res_obj.exists() {
                        println!("cargo:rustc-link-arg-bins={}", res_obj.display());
                    } else if res_lib.exists() {
                        println!("cargo:rustc-link-arg-bins={}", res_lib.display());
                    }
                }
            }
        } else {
            println!(
                "cargo:warning=Windows icon file not found in assets/icons/; skipping PE icon embedding."
            );
        }
    }
}
