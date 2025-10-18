use std::io::Result;
use std::env;
use std::path::PathBuf;

fn main() -> Result<()> {
    // Get the output directory for generated files
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    
    // Generate Rust code from protobuf definitions
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .out_dir(&out_dir)
        .compile(&["proto/leafmind.proto"], &["proto/"])?;
    
    println!("cargo:rerun-if-changed=proto/leafmind.proto");
    println!("cargo:rerun-if-changed=proto/");
    
    Ok(())
}