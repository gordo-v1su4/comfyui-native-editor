fn main() {
    #[cfg(target_os = "macos")]
    {
        // Link system frameworks
        println!("cargo:rustc-link-lib=framework=VideoToolbox");
        println!("cargo:rustc-link-lib=framework=CoreVideo");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
        println!("cargo:rustc-link-lib=framework=IOSurface");
        
        // Compile the Obj-C shim
        let shim_path = std::path::Path::new("src/avfoundation_shim.m");
        if shim_path.exists() {
            cc::Build::new()
                .file("src/avfoundation_shim.m")
                .flag("-fobjc-arc")
                .compile("avfoundation_shim");
        }
    }
}
