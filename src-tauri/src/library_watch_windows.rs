use std::{
    fs::{File, OpenOptions},
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    path::Path,
};
#[repr(C)]
#[derive(Default)]
struct Overlapped {
    internal: usize,
    high: usize,
    offset: u32,
    offset_high: u32,
    event: usize,
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateEventW(
        attributes: *const std::ffi::c_void,
        manual: i32,
        initial: i32,
        name: *const u16,
    ) -> usize;
    fn ResetEvent(event: usize) -> i32;
    fn CloseHandle(handle: usize) -> i32;
    fn WaitForSingleObject(handle: usize, ms: u32) -> u32;
    fn ReadDirectoryChangesW(
        directory: usize,
        buffer: *mut std::ffi::c_void,
        len: u32,
        subtree: i32,
        filter: u32,
        returned: *mut u32,
        overlapped: *mut Overlapped,
        completion: usize,
    ) -> i32;
    fn GetOverlappedResult(
        file: usize,
        overlapped: *mut Overlapped,
        bytes: *mut u32,
        wait: i32,
    ) -> i32;
    fn CancelIoEx(file: usize, overlapped: *mut Overlapped) -> i32;
}
pub struct Native {
    file: File,
    buffer: Box<[u32; 16384]>,
    overlapped: Box<Overlapped>,
    pending: bool,
}
impl Native {
    pub fn new(path: &Path) -> Result<Self, String> {
        let file = OpenOptions::new()
            .read(true)
            .access_mode(1)
            .share_mode(7)
            .custom_flags(0x42000000)
            .open(path.canonicalize().map_err(|e| e.to_string())?)
            .map_err(|e| format!("文件通知不可用，改用周期核对：{e}"))?;
        let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
        if event == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut native = Self {
            file,
            buffer: Box::new([0; 16384]),
            overlapped: Box::new(Overlapped {
                event,
                ..Default::default()
            }),
            pending: false,
        };
        native.arm()?;
        Ok(native)
    }
    fn arm(&mut self) -> Result<(), String> {
        unsafe {
            ResetEvent(self.overlapped.event);
        }
        self.overlapped.internal = 0;
        self.overlapped.high = 0;
        let ok = unsafe {
            ReadDirectoryChangesW(
                self.file.as_raw_handle() as usize,
                self.buffer.as_mut_ptr().cast(),
                65536,
                1,
                1 | 2 | 4 | 8 | 16 | 64,
                std::ptr::null_mut(),
                &mut *self.overlapped,
                0,
            )
        };
        if ok == 0 && std::io::Error::last_os_error().raw_os_error() != Some(997) {
            return Err(format!(
                "文件通知中断，将周期核对：{}",
                std::io::Error::last_os_error()
            ));
        }
        self.pending = true;
        Ok(())
    }
    pub fn poll(&mut self) -> Result<bool, String> {
        match unsafe { WaitForSingleObject(self.overlapped.event, 0) } {
            258 => return Ok(false),
            0 => {}
            _ => return Err("文件通知句柄不可用，将周期核对".into()),
        }
        let mut count = 0;
        if unsafe {
            GetOverlappedResult(
                self.file.as_raw_handle() as usize,
                &mut *self.overlapped,
                &mut count,
                0,
            )
        } == 0
        {
            return Err(format!(
                "文件通知失败，将周期核对：{}",
                std::io::Error::last_os_error()
            ));
        }
        self.pending = false;
        let bytes = unsafe {
            std::slice::from_raw_parts(self.buffer.as_ptr().cast::<u8>(), count as usize)
        };
        let mut changed = count == 0; // 通知溢出没有明细，触发事实核对。
        let mut offset = 0;
        while offset + 12 <= bytes.len() {
            let next = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            let length =
                u32::from_le_bytes(bytes[offset + 8..offset + 12].try_into().unwrap()) as usize;
            if length % 2 != 0 || offset + 12 + length > bytes.len() {
                changed = true;
                break;
            }
            let chars: Vec<u16> = bytes[offset + 12..offset + 12 + length]
                .chunks_exact(2)
                .map(|v| u16::from_le_bytes([v[0], v[1]]))
                .collect();
            let name = String::from_utf16_lossy(&chars).replace('\\', "/");
            let first = name.split('/').next().unwrap_or("").to_ascii_lowercase();
            if first != ".ceas" && first != ".pixcall" && !first.starts_with(".ceas-") {
                changed = true;
            }
            if next == 0 {
                break;
            }
            if next < 12 || offset + next > bytes.len() {
                changed = true;
                break;
            }
            offset += next;
        }
        self.arm()?;
        Ok(changed)
    }
}
impl Drop for Native {
    fn drop(&mut self) {
        unsafe {
            if self.pending {
                CancelIoEx(self.file.as_raw_handle() as usize, &mut *self.overlapped);
                let mut count = 0;
                GetOverlappedResult(
                    self.file.as_raw_handle() as usize,
                    &mut *self.overlapped,
                    &mut count,
                    1,
                );
            }
            CloseHandle(self.overlapped.event);
        }
    }
}
