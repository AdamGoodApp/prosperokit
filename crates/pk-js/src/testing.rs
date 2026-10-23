//! Mock platform services for tests (in-memory fs, canned http).

use std::collections::BTreeMap;
use std::sync::Arc;

use parking_lot::Mutex;
use pk_platform::{
    AppControl, Clock, DirEntry, FileStat, Fs, FsError, Http, HttpError, HttpRequest, HttpResponse,
    Log, LogLevel, Notify, Services, SystemInfo,
};

#[derive(Default)]
pub struct MemFs {
    pub files: Mutex<BTreeMap<String, Vec<u8>>>,
}

impl MemFs {
    pub fn put(&self, path: &str, data: &[u8]) {
        self.files.lock().insert(path.to_string(), data.to_vec());
    }
}

impl Fs for MemFs {
    fn read(&self, path: &str) -> Result<Vec<u8>, FsError> {
        self.files
            .lock()
            .get(path)
            .cloned()
            .ok_or(FsError::NotFound)
    }
    fn write(&self, path: &str, data: &[u8]) -> Result<(), FsError> {
        self.put(path, data);
        Ok(())
    }
    fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>, FsError> {
        let prefix = format!("{}/", path.trim_end_matches('/'));
        let files = self.files.lock();
        let out: Vec<DirEntry> = files
            .iter()
            .filter_map(|(k, v)| {
                let rest = k.strip_prefix(&prefix)?;
                (!rest.contains('/')).then(|| DirEntry {
                    name: rest.to_string(),
                    is_dir: false,
                    size: v.len() as u64,
                    mtime_ms: 0,
                })
            })
            .collect();
        if out.is_empty() {
            Err(FsError::NotFound)
        } else {
            Ok(out)
        }
    }
    fn stat(&self, path: &str) -> Result<FileStat, FsError> {
        self.files
            .lock()
            .get(path)
            .map(|v| FileStat {
                is_dir: false,
                size: v.len() as u64,
                mtime_ms: 0,
            })
            .ok_or(FsError::NotFound)
    }
    fn mkdir_all(&self, _path: &str) -> Result<(), FsError> {
        Ok(())
    }
    fn remove(&self, path: &str) -> Result<(), FsError> {
        self.files
            .lock()
            .remove(path)
            .map(|_| ())
            .ok_or(FsError::NotFound)
    }
    fn rename(&self, from: &str, to: &str) -> Result<(), FsError> {
        let mut files = self.files.lock();
        let v = files.remove(from).ok_or(FsError::NotFound)?;
        files.insert(to.to_string(), v);
        Ok(())
    }
    fn exists(&self, path: &str) -> bool {
        self.files.lock().contains_key(path)
    }
    fn resolve(&self, path: &str) -> String {
        path.to_string()
    }
}

pub struct EchoHttp;

impl Http for EchoHttp {
    fn request(&self, req: HttpRequest) -> Result<HttpResponse, HttpError> {
        Ok(HttpResponse {
            status: 200,
            headers: vec![("x-url".into(), req.url)],
            body: req.body.unwrap_or_default(),
        })
    }
}

struct TestClock(std::time::Instant);

impl Clock for TestClock {
    fn now_ms(&self) -> f64 {
        self.0.elapsed().as_secs_f64() * 1000.0
    }
    fn now_us(&self) -> u64 {
        self.0.elapsed().as_micros() as u64
    }
    fn wall_ms(&self) -> f64 {
        0.0
    }
    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

#[derive(Default)]
pub struct MemLog {
    pub lines: Mutex<Vec<(LogLevel, String)>>,
}

impl Log for MemLog {
    fn log(&self, level: LogLevel, message: &str) {
        self.lines.lock().push((level, message.to_string()));
    }
    fn recent(&self, n: usize) -> Vec<(LogLevel, String)> {
        let l = self.lines.lock();
        l[l.len().saturating_sub(n)..].to_vec()
    }
}

#[derive(Default)]
pub struct MemNotify {
    pub messages: Mutex<Vec<String>>,
}

impl Notify for MemNotify {
    fn notify(&self, message: &str) {
        self.messages.lock().push(message.to_string());
    }
}

struct TestApp;

impl AppControl for TestApp {
    fn exit(&self) -> ! {
        panic!("exit() called in a test");
    }
    fn info(&self) -> SystemInfo {
        SystemInfo {
            platform: "host",
            title_id: "PPSA00000".into(),
            app_name: "Test".into(),
            app_version: "1.0.0".into(),
            uptime_ms: 42,
        }
    }
}

pub struct TestServices {
    pub services: Services,
    pub fs: Arc<MemFs>,
    pub log: Arc<MemLog>,
    pub notify: Arc<MemNotify>,
}

pub fn test_services() -> TestServices {
    let fs = Arc::new(MemFs::default());
    let log = Arc::new(MemLog::default());
    let notify = Arc::new(MemNotify::default());
    let services = Services {
        fs: fs.clone(),
        http: Arc::new(EchoHttp),
        clock: Arc::new(TestClock(std::time::Instant::now())),
        notify: notify.clone(),
        log: log.clone(),
        app: Arc::new(TestApp),
    };
    TestServices {
        services,
        fs,
        log,
        notify,
    }
}
