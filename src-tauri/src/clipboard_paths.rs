//! 只读资源管理器的 CF_HDROP；不清空剪贴板，也不执行“剪切”删除来源。
#[cfg(windows)]
pub fn read() -> Result<Vec<String>, String> {
    use std::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(window: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn IsClipboardFormatAvailable(format: u32) -> i32;
        fn GetClipboardData(format: u32) -> *mut c_void;
    }
    if unsafe { IsClipboardFormatAvailable(15) } == 0 {
        return Ok(vec![]);
    }
    let mut opened = false;
    for _ in 0..5 {
        if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
            opened = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    if !opened {
        return Err("剪贴板正被其他程序使用，请稍后再粘贴".into());
    }
    struct Close;
    impl Drop for Close {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }
    let _close = Close;
    let handle = unsafe { GetClipboardData(15) };
    if handle.is_null() {
        return Err("无法读取剪贴板文件，请重新复制".into());
    }
    unsafe { drop_paths(handle) }
}
#[cfg(windows)]
unsafe fn drop_paths(handle: *mut std::ffi::c_void) -> Result<Vec<String>, String> {
    use std::os::windows::ffi::OsStringExt;
    #[link(name = "shell32")]
    extern "system" {
        fn DragQueryFileW(
            drop: *mut std::ffi::c_void,
            index: u32,
            path: *mut u16,
            length: u32,
        ) -> u32;
    }
    let count = DragQueryFileW(handle, u32::MAX, std::ptr::null_mut(), 0);
    if count > 100_000 {
        return Err("剪贴板文件过多，请分批粘贴".into());
    }
    let mut paths = Vec::new();
    for index in 0..count {
        let length = unsafe { DragQueryFileW(handle, index, std::ptr::null_mut(), 0) };
        if length == 0 || length > 32768 {
            return Err("剪贴板包含无效文件地址".into());
        }
        let mut text = vec![0u16; length as usize + 1];
        if unsafe { DragQueryFileW(handle, index, text.as_mut_ptr(), length + 1) } != length {
            return Err("剪贴板文件清单已改变，请重新复制".into());
        }
        paths.push(
            std::ffi::OsString::from_wide(&text[..length as usize])
                .to_string_lossy()
                .into_owned(),
        );
    }
    Ok(paths)
}
#[cfg(not(windows))]
pub fn read() -> Result<Vec<String>, String> {
    Err("当前平台暂不支持文件粘贴，请拖入文件".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn windows_drop_handle_reads_unicode_file_list_without_changing_clipboard() {
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        extern "system" {
            fn GlobalAlloc(flags: u32, size: usize) -> *mut c_void;
            fn GlobalLock(handle: *mut c_void) -> *mut c_void;
            fn GlobalUnlock(handle: *mut c_void) -> i32;
            fn GlobalFree(handle: *mut c_void) -> *mut c_void;
        }
        let expected = vec!["E:\\参考\\画作.png", "F:\\Empty folder"];
        let text: Vec<u16> = expected
            .iter()
            .flat_map(|path| path.encode_utf16().chain(Some(0)))
            .chain(Some(0))
            .collect();
        unsafe {
            let handle = GlobalAlloc(0x42, 20 + text.len() * 2);
            assert!(!handle.is_null());
            let bytes = GlobalLock(handle) as *mut u8;
            assert!(!bytes.is_null());
            // DROPFILES: pFiles=20，fWide=1；内存只归本测试，不占用系统剪贴板。
            std::ptr::write_unaligned(bytes as *mut u32, 20);
            std::ptr::write_unaligned(bytes.add(16) as *mut u32, 1);
            std::ptr::copy_nonoverlapping(
                text.as_ptr() as *const u8,
                bytes.add(20),
                text.len() * 2,
            );
            GlobalUnlock(handle);
            assert_eq!(drop_paths(handle).unwrap(), expected);
            GlobalFree(handle);
        }
    }
}
