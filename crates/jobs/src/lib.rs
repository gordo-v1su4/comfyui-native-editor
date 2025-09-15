use anyhow::Result;
use crossbeam_channel::{unbounded, Receiver, Sender};
use parking_lot::Mutex;
use std::collections::{HashSet, VecDeque};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, thread, time::Duration};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum JobError {
    #[error("worker stopped")]
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum JobKind {
    Waveform,
    Thumbnails,
    Proxy,
    SeekIndex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSpec {
    pub asset_id: String,
    pub kind: JobKind,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobStatus {
    Pending,
    Running,
    Progress(f32),
    Done,
    Failed(String),
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobEvent {
    pub id: String,
    pub asset_id: String,
    pub kind: JobKind,
    pub status: JobStatus,
}

#[derive(Clone)]
pub struct JobsHandle {
    tx_submit: Sender<(String, JobSpec)>,
    tx_cancel: Sender<String>,
    pub rx_events: Receiver<JobEvent>,
}

pub struct JobsRuntime {
    queue: Arc<Mutex<VecDeque<(String, JobSpec)>>>,
    rx_submit: Receiver<(String, JobSpec)>,
    rx_cancel: Receiver<String>,
    tx_events: Sender<JobEvent>,
    workers: Vec<thread::JoinHandle<()>>,
    canceled: Arc<Mutex<HashSet<String>>>,
}

impl JobsRuntime {
    pub fn start(num_workers: usize) -> JobsHandle {
        let (tx_submit, rx_submit) = unbounded::<(String, JobSpec)>();
        let (tx_cancel, rx_cancel) = unbounded::<String>();
        let (tx_events, rx_events) = unbounded::<JobEvent>();
        let queue = Arc::new(Mutex::new(VecDeque::new()));
        let canceled = Arc::new(Mutex::new(HashSet::new()));

        let runtime = JobsRuntime { queue: queue.clone(), rx_submit, rx_cancel, tx_events: tx_events.clone(), workers: Vec::new(), canceled: canceled.clone() };
        runtime.spawn_workers(num_workers, queue.clone());

        // Feeder thread
        {
            let q = queue.clone();
            let canceled = canceled.clone();
            let rx_s = runtime.rx_submit.clone();
            let rx_c = runtime.rx_cancel.clone();
            let tx_e = runtime.tx_events.clone();
            thread::spawn(move || {
                loop {
                    crossbeam_channel::select! {
                        recv(rx_s) -> msg => {
                            if let Ok((id, spec)) = msg {
                                if canceled.lock().contains(&id) { continue; }
                                q.lock().push_back((id.clone(), spec.clone()));
                                let _ = tx_e.send(JobEvent { id, asset_id: spec.asset_id.clone(), kind: spec.kind, status: JobStatus::Pending });
                            }
                            else { break; }
                        }
                        recv(rx_c) -> msg => {
                            if let Ok(id) = msg { canceled.lock().insert(id); }
                            else { break; }
                        }
                        default(Duration::from_millis(10)) => {}
                    }
                }
            });
        }

        JobsHandle { tx_submit, tx_cancel, rx_events }
    }

    fn spawn_workers(&self, n: usize, queue: Arc<Mutex<VecDeque<(String, JobSpec)>>>) {
        for _ in 0..n {
            let q = queue.clone();
            let tx_e = self.tx_events.clone();
            let canceled = self.canceled.clone();
            thread::spawn(move || loop {
                let job_opt = {
                    let mut ql = q.lock();
                    let mut found: Option<(String, JobSpec)> = None;
                    while let Some((id, spec)) = ql.pop_front() {
                        if !canceled.lock().contains(&id) { found = Some((id, spec)); break; }
                    }
                    found
                };
                if let Some((id, spec)) = job_opt {
                    if canceled.lock().contains(&id) {
                        let _ = tx_e.send(JobEvent { id, asset_id: spec.asset_id.clone(), kind: spec.kind, status: JobStatus::Canceled });
                        continue;
                    }
                    let _ = tx_e.send(JobEvent { id: id.clone(), asset_id: spec.asset_id.clone(), kind: spec.kind, status: JobStatus::Running });
                    // Simulate work with progress
                    let steps = 20;
                    for i in 0..steps {
                        thread::sleep(Duration::from_millis(50));
                        if canceled.lock().contains(&id) { let _ = tx_e.send(JobEvent { id: id.clone(), asset_id: spec.asset_id.clone(), kind: spec.kind, status: JobStatus::Canceled }); break; }
                        let _ = tx_e.send(JobEvent { id: id.clone(), asset_id: spec.asset_id.clone(), kind: spec.kind, status: JobStatus::Progress((i as f32 + 1.0) / steps as f32) });
                    }
                    if !canceled.lock().contains(&id) {
                        let _ = tx_e.send(JobEvent { id, asset_id: spec.asset_id, kind: spec.kind, status: JobStatus::Done });
                    }
                } else {
                    thread::sleep(Duration::from_millis(10));
                }
            });
        }
    }
}

impl JobsHandle {
    pub fn enqueue(&self, spec: JobSpec) -> String {
        let id = Uuid::new_v4().to_string();
        let _ = self.tx_submit.send((id.clone(), spec));
        id
    }

    pub fn cancel_by_asset(&self, _asset_id: &str) {
        // stub: a real impl would track and cancel
    }

    pub fn cancel_job(&self, job_id: &str) {
        let _ = self.tx_cancel.send(job_id.to_string());
    }
}
