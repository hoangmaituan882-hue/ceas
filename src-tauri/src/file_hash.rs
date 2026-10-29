#[cfg(windows)]
mod native {
    use std::{ffi::c_void, fs::File, io::Read, path::Path, ptr};
    type Handle = *mut c_void;
    #[link(name = "bcrypt")]
    extern "system" {
        fn BCryptOpenAlgorithmProvider(
            handle: *mut Handle,
            name: *const u16,
            implementation: *const u16,
            flags: u32,
        ) -> i32;
        fn BCryptGetProperty(
            handle: Handle,
            name: *const u16,
            output: *mut u8,
            size: u32,
            result: *mut u32,
            flags: u32,
        ) -> i32;
        fn BCryptCreateHash(
            algorithm: Handle,
            hash: *mut Handle,
            object: *mut u8,
            size: u32,
            secret: *mut u8,
            secret_size: u32,
            flags: u32,
        ) -> i32;
        fn BCryptHashData(hash: Handle, input: *const u8, size: u32, flags: u32) -> i32;
        fn BCryptFinishHash(hash: Handle, output: *mut u8, size: u32, flags: u32) -> i32;
        fn BCryptDestroyHash(hash: Handle) -> i32;
        fn BCryptCloseAlgorithmProvider(handle: Handle, flags: u32) -> i32;
    }
    struct Hasher {
        algorithm: Handle,
        hash: Handle,
        _object: Vec<u8>,
    }
    impl Drop for Hasher {
        fn drop(&mut self) {
            unsafe {
                if !self.hash.is_null() {
                    BCryptDestroyHash(self.hash);
                }
                if !self.algorithm.is_null() {
                    BCryptCloseAlgorithmProvider(self.algorithm, 0);
                }
            }
        }
    }
    fn check(status: i32) -> Result<(), String> {
        if status < 0 {
            Err(format!("系统 SHA-256 计算失败：{status}"))
        } else {
            Ok(())
        }
    }
    pub fn file(path: &Path) -> Result<String, String> {
        digest(&mut File::open(path).map_err(|e| e.to_string())?)
    }
    pub fn bytes(data: &[u8]) -> Result<String, String> {
        digest(&mut std::io::Cursor::new(data))
    }
    fn digest(input: &mut impl Read) -> Result<String, String> {
        let mut state = Hasher {
            algorithm: ptr::null_mut(),
            hash: ptr::null_mut(),
            _object: Vec::new(),
        };
        let algorithm: Vec<u16> = "SHA256\0".encode_utf16().collect();
        let property: Vec<u16> = "ObjectLength\0".encode_utf16().collect();
        unsafe {
            check(BCryptOpenAlgorithmProvider(
                &mut state.algorithm,
                algorithm.as_ptr(),
                ptr::null(),
                0,
            ))?;
            let mut length = 0u32;
            let mut returned = 0u32;
            check(BCryptGetProperty(
                state.algorithm,
                property.as_ptr(),
                (&mut length as *mut u32).cast(),
                4,
                &mut returned,
                0,
            ))?;
            state._object = vec![0; length as usize];
            check(BCryptCreateHash(
                state.algorithm,
                &mut state.hash,
                state._object.as_mut_ptr(),
                length,
                ptr::null_mut(),
                0,
                0,
            ))?;
        }
        let mut buffer = [0u8; 65536];
        loop {
            let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            unsafe {
                check(BCryptHashData(state.hash, buffer.as_ptr(), count as u32, 0))?;
            }
        }
        let mut digest = [0u8; 32];
        unsafe {
            check(BCryptFinishHash(state.hash, digest.as_mut_ptr(), 32, 0))?;
        }
        Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
    }
}
#[cfg(windows)]
pub use native::{bytes, file};
#[cfg(not(windows))]
pub fn file(_path: &std::path::Path) -> Result<String, String> {
    Err("此桌面构建的原生校验仅支持 Windows".into())
}

#[cfg(not(windows))]
pub fn bytes(_data: &[u8]) -> Result<String, String> {
    Err("此桌面构建的原生校验仅支持 Windows".into())
}
