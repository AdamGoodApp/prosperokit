//! Worker pool for blocking native work, and the thread helper.

use std::io;
use std::thread::{Builder, JoinHandle};

use crossbeam_channel::{Receiver, Sender, unbounded};

type Job = Box<dyn FnOnce() + Send>;

/// Spawns a thread. Threads are never named on the PS5 target
/// (`pthread_setname_np` hangs there).
pub fn spawn_thread<F>(name: &str, stack_size: usize, f: F) -> io::Result<JoinHandle<()>>
where
    F: FnOnce() + Send + 'static,
{
    let builder = Builder::new().stack_size(stack_size);
    #[cfg(not(target_vendor = "sie"))]
    let builder = builder.name(name.to_string());
    #[cfg(target_vendor = "sie")]
    let _ = name;
    builder.spawn(f)
}

pub struct WorkerPool {
    tx: Sender<Job>,
    _threads: Vec<JoinHandle<()>>,
}

impl WorkerPool {
    pub fn new(n: usize) -> WorkerPool {
        let (tx, rx) = unbounded::<Job>();
        let threads = (0..n.max(1))
            .filter_map(|i| {
                let rx: Receiver<Job> = rx.clone();
                spawn_thread(&format!("pk-worker-{i}"), 1 << 20, move || {
                    while let Ok(job) = rx.recv() {
                        job();
                    }
                })
                .ok()
            })
            .collect();
        WorkerPool {
            tx,
            _threads: threads,
        }
    }

    pub fn submit(&self, job: Box<dyn FnOnce() + Send>) {
        let _ = self.tx.send(job);
    }
}
