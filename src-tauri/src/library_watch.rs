use serde::Serialize;
use std::path::Path;
#[cfg(windows)]
#[path = "library_watch_windows.rs"]
mod windows;
pub struct Watch {
    #[cfg(windows)]
    native: Option<windows::Native>,
    error: Option<String>,
}
#[derive(Serialize)]
pub struct Status {
    pub changed: bool,
    pub mode: &'static str,
    pub error: Option<String>,
}
impl Watch {
    pub fn new(path: &Path) -> Self {
        #[cfg(windows)]
        {
            match windows::Native::new(path) {
                Ok(native) => Self {
                    native: Some(native),
                    error: None,
                },
                Err(error) => Self {
                    native: None,
                    error: Some(error),
                },
            }
        }
        #[cfg(not(windows))]
        {
            let _ = path;
            Self { error: None }
        }
    }
    pub fn poll(&mut self) -> Status {
        #[cfg(windows)]
        if let Some(native) = &mut self.native {
            match native.poll() {
                Ok(changed) => {
                    return Status {
                        changed,
                        mode: "native",
                        error: None,
                    }
                }
                Err(error) => {
                    self.error = Some(error);
                    self.native = None;
                }
            }
        }
        Status {
            changed: false,
            mode: "polling",
            error: self.error.clone(),
        }
    }
}
