use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        let has_system_cf =
            PathBuf::from("/System/Library/Frameworks/CoreFoundation.framework").exists();
        let has_sdkroot = env::var_os("SDKROOT").is_some();

        // Quando si effettua cross-compilazione da Linux/Windows verso macOS con cargo-zigbuild
        // senza un MacOSX.sdk completo installato, forniamo uno stub TBD minimale per CoreFoundation
        // (richiesto da iana-time-zone e sys-locale) così il linker Mach-O di Zig risolve i simboli dinamici.
        if !has_system_cf && !has_sdkroot {
            let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR non impostato"));
            let cf_dir = out_dir.join("Frameworks").join("CoreFoundation.framework");
            fs::create_dir_all(&cf_dir)
                .expect("Impossibile creare directory CoreFoundation.framework");

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
            fs::write(cf_dir.join("CoreFoundation.tbd"), tbd_content)
                .expect("Impossibile scrivere CoreFoundation.tbd");

            println!(
                "cargo:rustc-link-search=framework={}",
                out_dir.join("Frameworks").display()
            );
        }
    }
}
