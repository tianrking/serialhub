fn main() {
    for name in [
        "assets/serialhub.ico",
        "assets/serialhub.rc",
        "assets/serialhub.manifest",
    ] {
        println!("cargo:rerun-if-changed={name}");
    }
    let target = std::env::var("TARGET").unwrap();
    if target.ends_with("windows-gnu") {
        let compiler =
            std::env::var("WINDRES").unwrap_or_else(|_| "x86_64-w64-mingw32-windres".into());
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("serialhub-resource.o");
        let status = std::process::Command::new(compiler)
            .args(["-I", "assets", "assets/serialhub.rc", "-O", "coff", "-o"])
            .arg(&output)
            .status()
            .expect("Windows GNU builds require windres (set WINDRES if it is outside PATH)");
        assert!(
            status.success(),
            "Could not compile the application icon and DPI manifest"
        );
        println!(
            "cargo:rustc-link-arg-bin=serialhub-desktop={}",
            output.display()
        );
    } else if target.contains("windows-msvc") && std::env::var("HOST").unwrap().contains("windows")
    {
        winresource::WindowsResource::new()
            .set_icon("assets/serialhub.ico")
            .set_manifest_file("assets/serialhub.manifest")
            .set("ProductName", "SerialHub")
            .set("FileDescription", "SerialHub desktop workspace")
            .compile()
            .expect("Could not compile Windows application resources");
    }
}
