use anyhow::Result;
use eframe::{egui::{self, TextureHandle}, NativeOptions};
use eframe::egui::Widget;
use eframe::egui_wgpu;
use project::{AssetRow, ProjectDb};
extern crate timeline as timeline_crate;
extern crate jobs as jobs_crate;
use timeline_crate::{
    ClipNode, CommandHistory, FrameRange, Fps, Item, ItemKind, NodeId, Sequence, Track, TimelineCommand,
    TimelineError, TimelineNode, TimelineNodeKind, TrackKind, TrackPlacement,
};
use serde_json::Value;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use std::path::{Path, PathBuf};
mod clock;
mod decode;
mod interaction;
mod timeline;
use clock::PlaybackClock;
use decode::{DecodeCmd, DecodeManager, EngineState, FramePayload, PlayState, VideoFrameOut, VideoProps};
use interaction::{DragMode, DragState};
mod audio_engine;
mod audio_decode;
mod preview;
mod jobs;
use preview::PreviewState;
use audio_engine::{ActiveAudioClip, AudioBuffer, AudioEngine};
use audio_decode::decode_audio_to_buffer;
use jobs_crate::{JobEvent, JobStatus};
use media_io::YuvPixFmt;
use native_decoder::{create_decoder, DecoderConfig, VideoFrame, YuvPixFmt as NativeYuvPixFmt, is_native_decoding_available};
use std::collections::HashMap;
use std::collections::VecDeque;
use renderer::{convert_yuv_to_rgba, ColorSpace as RenderColorSpace, PixelFormat as RenderPixelFormat};
use std::hash::Hash;
use preview::visual_source_at;

static PRESENT_SIZE_MISMATCH_LOGGED: OnceLock<AtomicBool> = OnceLock::new();

use tracing_subscriber::EnvFilter;

fn main() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .try_init();
    // Ensure DB exists before UI
    let data_dir = project::app_data_dir();
    std::fs::create_dir_all(&data_dir).expect("create data dir");
    let db_path = data_dir.join("app.db");
    let db = ProjectDb::open_or_create(&db_path).expect("open db");

    let options = NativeOptions::default();
    let _ = eframe::run_native(
        "Gausian Native Editor",
        options,
        Box::new(move |_cc| Ok(Box::new(App::new(db)))),
    );
}



fn nearest_common_ancestor(paths: &[PathBuf]) -> Option<PathBuf> {
    if paths.is_empty() { return None; }
    let mut it = paths.iter();
    let mut acc = it.next()?.ancestors().map(|p| p.to_path_buf()).collect::<Vec<_>>();
    for p in it {
        let set = p.ancestors().map(|p| p.to_path_buf()).collect::<Vec<_>>();
        acc.retain(|cand| set.contains(cand));
        if acc.is_empty() { break; }
    }
    acc.first().cloned()
}

#[derive(Clone, Debug)]
struct VisualSource { path: String, is_image: bool }

// -------------------------
// Export UI + ffmpeg runner
// -------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum ExportCodec { H264, AV1 }

#[derive(Clone, Copy, PartialEq, Eq)]
enum ExportPreset { Source, P1080, P4K }

#[derive(Default, Clone)]
struct ExportProgress { progress: f32, eta: Option<String>, done: bool, error: Option<String> }

struct ExportUiState {
    open: bool,
    codec: ExportCodec,
    preset: ExportPreset,
    crf: i32,
    output_path: String,
    running: bool,
    progress: f32,
    status: String,
    progress_shared: Option<std::sync::Arc<std::sync::Mutex<ExportProgress>>>,
    worker: Option<std::thread::JoinHandle<()>>,
    encoders_h264: Vec<String>,
    encoders_av1: Vec<String>,
    selected_encoder: Option<String>,
}

impl Default for ExportCodec { fn default() -> Self { ExportCodec::H264 } }
impl Default for ExportPreset { fn default() -> Self { ExportPreset::Source } }

impl Default for ExportUiState {
    fn default() -> Self {
        Self {
            open: false,
            codec: ExportCodec::H264,
            preset: ExportPreset::Source,
            crf: 23,
            output_path: String::new(),
            running: false,
            progress: 0.0,
            status: String::new(),
            progress_shared: None,
            worker: None,
            encoders_h264: Vec::new(),
            encoders_av1: Vec::new(),
            selected_encoder: None,
        }
    }
}

impl ExportUiState {
    fn ui(&mut self, ctx: &egui::Context, seq: &timeline_crate::Sequence, db: &ProjectDb, project_id: &str) {
        if !self.open { return; }
        let mut keep_open = true;
        egui::Window::new("Export")
            .open(&mut keep_open)
            .resizable(true)
            .show(ctx, |ui| {
                ui.vertical(|ui| {
                    // Gather available encoders once per UI open
                    if self.encoders_h264.is_empty() && self.encoders_av1.is_empty() {
                        let map = media_io::get_hardware_encoders();
                        if let Some(v) = map.get("h264") { self.encoders_h264 = v.clone(); }
                        if let Some(v) = map.get("av1") { self.encoders_av1 = v.clone(); }
                        // Always include software options at front
                        if !self.encoders_h264.iter().any(|e| e == "libx264") { self.encoders_h264.insert(0, "libx264".into()); }
                        if !self.encoders_av1.iter().any(|e| e == "libaom-av1") { self.encoders_av1.insert(0, "libaom-av1".into()); }
                    }
                    // Output path picker
                    ui.horizontal(|ui| {
                        ui.label("Output:");
                        ui.text_edit_singleline(&mut self.output_path);
                        if ui.button("Browse").clicked() {
                            // Default extension based on codec
                            let default_name = match self.codec { ExportCodec::H264 => "export.mp4", ExportCodec::AV1 => "export.mkv" };
                            if let Some(path) = rfd::FileDialog::new().set_file_name(default_name).save_file() {
                                self.output_path = path.display().to_string();
                            }
                        }
                    });

                    // Codec + preset + CRF
                    ui.horizontal(|ui| {
                        ui.label("Codec:");
                        let mut codec_idx = match self.codec { ExportCodec::H264 => 0, ExportCodec::AV1 => 1 };
                        egui::ComboBox::from_id_salt("codec_combo")
                            .selected_text(match self.codec { ExportCodec::H264 => "H.264", ExportCodec::AV1 => "AV1" })
                            .show_ui(ui, |ui| {
                                ui.selectable_value(&mut codec_idx, 0, "H.264");
                                ui.selectable_value(&mut codec_idx, 1, "AV1");
                            });
                        let prev_codec = self.codec;
                        self.codec = if codec_idx == 0 { ExportCodec::H264 } else { ExportCodec::AV1 };
                        if self.codec != prev_codec && !self.output_path.is_empty() {
                            // Gate extension automatically on codec change
                            self.output_path = adjust_extension(&self.output_path, match self.codec { ExportCodec::H264 => "mp4", ExportCodec::AV1 => "mkv" });
                        }

                        ui.label("Encoder:");
                        let list = match self.codec { ExportCodec::H264 => &mut self.encoders_h264, ExportCodec::AV1 => &mut self.encoders_av1 };
                        if list.is_empty() { list.push(match self.codec { ExportCodec::H264 => "libx264".into(), ExportCodec::AV1 => "libaom-av1".into() }); }
                        let mut selection = self.selected_encoder.clone().unwrap_or_else(|| list[0].clone());
                        egui::ComboBox::from_id_salt("encoder_combo")
                            .selected_text(selection.clone())
                            .show_ui(ui, |ui| {
                                for enc in list.iter() { ui.selectable_value(&mut selection, enc.clone(), enc); }
                            });
                        self.selected_encoder = Some(selection);
                    });

                    ui.horizontal(|ui| {
                        ui.label("Preset:");
                        let mut preset_idx = match self.preset { ExportPreset::Source => 0, ExportPreset::P1080 => 1, ExportPreset::P4K => 2 };
                        egui::ComboBox::from_id_salt("preset_combo")
                            .selected_text(match self.preset { ExportPreset::Source => "Source", ExportPreset::P1080 => "1080p", ExportPreset::P4K => "4K" })
                            .show_ui(ui, |ui| {
                                ui.selectable_value(&mut preset_idx, 0, "Source");
                                ui.selectable_value(&mut preset_idx, 1, "1080p");
                                ui.selectable_value(&mut preset_idx, 2, "4K");
                            });
                        self.preset = match preset_idx { 1 => ExportPreset::P1080, 2 => ExportPreset::P4K, _ => ExportPreset::Source };

                        ui.label("CRF:");
                        let crf_range = if matches!(self.codec, ExportCodec::H264) { 12..=32 } else { 20..=50 };
                        ui.add(egui::Slider::new(&mut self.crf, crf_range));
                    });

                    // Suggested input source and seq info
                    let (src_path, total_ms) = default_export_source_and_duration(db, project_id, seq);
                    ui.label(format!("Input: {}", src_path.as_deref().unwrap_or("<none>")));
                    ui.label(format!("Duration: {:.2}s", total_ms as f32 / 1000.0));

                    ui.separator();
                    if !self.running {
                        let can_start = src_path.is_some() && !self.output_path.trim().is_empty();
                        if ui.add_enabled(can_start, egui::Button::new("Start Export")).clicked() {
                            if src_path.is_some() {
                                let fps = seq.fps.num.max(1) as f32 / seq.fps.den.max(1) as f32;
                                let (w, h) = match self.preset {
                                    ExportPreset::Source => (seq.width, seq.height),
                                    ExportPreset::P1080 => (1920, 1080),
                                    ExportPreset::P4K => (3840, 2160),
                                };
                                let codec = self.codec;
                                // Ensure extension matches codec
                                if !self.output_path.is_empty() {
                                    self.output_path = adjust_extension(&self.output_path, match codec { ExportCodec::H264 => "mp4", ExportCodec::AV1 => "mkv" });
                                }
                                let crf = self.crf;
                                let out_path = self.output_path.clone();
                                let progress = std::sync::Arc::new(std::sync::Mutex::new(ExportProgress::default()));
                                self.progress_shared = Some(progress.clone());
                                self.running = true;
                                self.status.clear();
                                let selected_encoder = self.selected_encoder.clone();
                                let seq_owned = seq.clone();

                                self.worker = Some(std::thread::spawn(move || {
                                    run_ffmpeg_timeline(out_path, (w, h), fps, codec, selected_encoder, crf, total_ms as u64, seq_owned, progress);
                                }));
                            }
                        }
                    } else {
                        if let Some(p) = &self.progress_shared {
                            if let Ok(p) = p.lock() {
                                self.progress = p.progress;
                                if let Some(eta) = &p.eta { self.status = format!("ETA: {}", eta); }
                                if p.done {
                                    self.running = false;
                                    self.status = p.error.clone().unwrap_or_else(|| "Done".to_string());
                                }
                            }
                        }
                        ui.add(egui::ProgressBar::new(self.progress).show_percentage());
                        ui.label(&self.status);
                    }
                });
            });
        if !keep_open { self.open = false; }
    }
}

fn default_export_source_and_duration(db: &ProjectDb, project_id: &str, seq: &timeline_crate::Sequence) -> (Option<String>, u64) {
    // Pick first video asset as a simple source; duration from asset or sequence
    let assets = db.list_assets(project_id).unwrap_or_default();
    let src = assets.into_iter().find(|a| a.kind.eq_ignore_ascii_case("video")).map(|a| a.src_abs);
    let fps = seq.fps.num.max(1) as f32 / seq.fps.den.max(1) as f32;
    let total_ms = ((seq.duration_in_frames as f32 / fps) * 1000.0) as u64;
    (src, total_ms)
}

fn run_ffmpeg_timeline(out_path: String, size: (u32, u32), fps: f32, codec: ExportCodec, selected_encoder: Option<String>, crf: i32, total_ms: u64, seq: timeline_crate::Sequence, progress: std::sync::Arc<std::sync::Mutex<ExportProgress>>) {
    // Build inputs from timeline
    let (w, h) = size;
    let timeline = build_export_timeline(&seq);
    let mut args: Vec<String> = Vec::new();
    args.push("-y".into());

    // Inputs: video segments
    let mut input_index = 0usize;
    let mut video_labels: Vec<String> = Vec::new();
    for seg in &timeline.video_segments {
        match &seg.kind {
            VideoSegKind::Video { path, start_sec } => {
                args.push("-ss".into()); args.push(format!("{:.3}", start_sec));
                args.push("-t".into()); args.push(format!("{:.3}", seg.duration));
                args.push("-i".into()); args.push(path.clone());
            }
            VideoSegKind::Image { path } => {
                args.push("-loop".into()); args.push("1".into());
                args.push("-t".into()); args.push(format!("{:.3}", seg.duration));
                args.push("-i".into()); args.push(path.clone());
            }
            VideoSegKind::Black => {
                args.push("-f".into()); args.push("lavfi".into());
                args.push("-t".into()); args.push(format!("{:.3}", seg.duration));
                args.push("-r".into()); args.push(format!("{}", fps.max(1.0) as i32));
                args.push("-i".into()); args.push(format!("color=black:s={}x{}", w, h));
            }
        }
        video_labels.push(format!("v{}", input_index));
        input_index += 1;
    }

    // Inputs: audio clips
    let audio_input_start = input_index;
    for clip in &timeline.audio_clips {
        args.push("-i".into()); args.push(clip.path.clone());
        input_index += 1;
    }

    // Filter complex assembly
    let mut filters: Vec<String> = Vec::new();
    let mut vouts: Vec<String> = Vec::new();
    for (i, _seg) in timeline.video_segments.iter().enumerate() {
        let label_in = format!("{}:v", i);
        let label_out = format!("v{}o", i);
        filters.push(format!("[{}]scale={}x{}:flags=lanczos,fps={},format=yuv420p[{}]", label_in, w, h, fps.max(1.0) as i32, label_out));
        vouts.push(format!("[{}]", label_out));
    }
    if !vouts.is_empty() {
        filters.push(format!("{}concat=n={}:v=1:a=0[vout]", vouts.join(""), vouts.len()));
    }

    let mut aouts: Vec<String> = Vec::new();
    for (j, clip) in timeline.audio_clips.iter().enumerate() {
        let in_idx = audio_input_start + j;
        let label_in = format!("{}:a", in_idx);
        let label_out = format!("a{}o", j);
        let delay_ms = (clip.offset_sec * 1000.0).round() as u64;
        let total_s = total_ms as f32 / 1000.0;
        filters.push(format!("[{}]adelay={}|{},atrim=0:{:.3},aresample=async=1[{}]", label_in, delay_ms, delay_ms, total_s, label_out));
        aouts.push(format!("[{}]", label_out));
    }
    let has_audio = !aouts.is_empty();
    if has_audio {
        filters.push(format!("{}amix=inputs={}:normalize=0:duration=longest[aout]", aouts.join(""), aouts.len()));
    }

    if !filters.is_empty() {
        args.push("-filter_complex".into());
        args.push(filters.join(";"));
    }

    args.push("-map".into()); args.push("[vout]".into());
    if has_audio { args.push("-map".into()); args.push("[aout]".into()); } else { args.push("-an".into()); }

    // Codec settings
    args.push("-pix_fmt".into()); args.push("yuv420p".into());
    match codec {
        ExportCodec::H264 => {
            let encoder = selected_encoder.unwrap_or_else(|| "libx264".into());
            args.push("-c:v".into()); args.push(encoder);
            args.push("-crf".into()); args.push(crf.to_string());
            args.push("-preset".into()); args.push("medium".into());
            args.push("-movflags".into()); args.push("+faststart".into());
        }
        ExportCodec::AV1 => {
            let encoder = selected_encoder.unwrap_or_else(|| "libaom-av1".into());
            args.push("-c:v".into()); args.push(encoder.clone());
            if encoder.starts_with("libaom") {
                args.push("-b:v".into()); args.push("0".into());
                args.push("-crf".into()); args.push(crf.to_string());
                args.push("-row-mt".into()); args.push("1".into());
            } else {
                // hw av1 encoders typically use cq
                args.push("-cq".into()); args.push(crf.to_string());
            }
        }
    }

    args.push("-progress".into()); args.push("pipe:2".into());
    args.push(out_path.clone());

    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args(args.iter().map(|s| s.as_str()));
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            if let Ok(mut p) = progress.lock() { p.done = true; p.error = Some(format!("ffmpeg spawn failed: {}", e)); }
            return;
        }
    };

    if let Some(stderr) = child.stderr.take() {
        use std::io::{BufRead, BufReader};
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while let Ok(n) = reader.read_line(&mut line) {
            if n == 0 { break; }
            if let Some((k,v)) = line.trim().split_once('=') {
                if k == "out_time_ms" {
                    if let Ok(ms) = v.parse::<u64>() {
                        let prog = if total_ms > 0 { (ms as f32 / total_ms as f32).min(1.0) } else { 0.0 };
                        if let Ok(mut p) = progress.lock() { p.progress = prog; }
                    }
                }
            }
            line.clear();
        }
    }

    let status = child.wait().ok();
    if let Ok(mut p) = progress.lock() {
        p.done = true;
        if let Some(st) = status { if !st.success() { p.error = Some(format!("ffmpeg failed: {:?}", st.code())); } }
    }
}

#[derive(Clone)]
struct VideoSegment { kind: VideoSegKind, start_sec: f32, duration: f32 }

#[derive(Clone)]
enum VideoSegKind { Video { path: String, start_sec: f32 }, Image { path: String }, Black }

#[derive(Clone)]
struct AudioClip { path: String, offset_sec: f32, duration: f32 }

struct ExportTimeline { video_segments: Vec<VideoSegment>, audio_clips: Vec<AudioClip> }

fn build_export_timeline(seq: &timeline_crate::Sequence) -> ExportTimeline {
    // Build breakpoints from all non-audio item edges
    let mut points: Vec<i64> = vec![0, seq.duration_in_frames];
    for (_ti, track) in seq.tracks.iter().enumerate() {
        for it in &track.items {
            match &it.kind {
                ItemKind::Audio { .. } => {}
                _ => {
                    points.push(it.from);
                    points.push(it.from + it.duration_in_frames);
                }
            }
        }
    }
    points.sort_unstable();
    points.dedup();

    let fps = seq.fps.num.max(1) as f32 / seq.fps.den.max(1) as f32;
    let mut video_segments: Vec<VideoSegment> = Vec::new();
    for w in points.windows(2) {
        let a = w[0];
        let b = w[1];
        if b <= a { continue; }
        let (item_opt, _ti) = topmost_item_covering(seq, a);
        let kind = if let Some(item) = item_opt {
            match &item.kind {
                ItemKind::Video { src, .. } => {
                    let start_into = (a - item.from).max(0) as f32 / fps;
                    VideoSegKind::Video { path: src.clone(), start_sec: start_into }
                }
                ItemKind::Image { src } => VideoSegKind::Image { path: src.clone() },
                _ => VideoSegKind::Black,
            }
        } else { VideoSegKind::Black };
        let seg = VideoSegment { kind, start_sec: a as f32 / fps, duration: (b - a) as f32 / fps };
        video_segments.push(seg);
    }

    // Audio clips from explicit audio tracks only
    let mut audio_clips: Vec<AudioClip> = Vec::new();
    for track in &seq.tracks {
        for it in &track.items {
            if let ItemKind::Audio { src, .. } = &it.kind {
                audio_clips.push(AudioClip {
                    path: src.clone(),
                    offset_sec: it.from as f32 / fps,
                    duration: it.duration_in_frames as f32 / fps,
                });
            }
        }
    }

    ExportTimeline { video_segments, audio_clips }
}

fn topmost_item_covering<'a>(seq: &'a timeline_crate::Sequence, frame: i64) -> (Option<&'a timeline_crate::Item>, Option<usize>) {
    for (ti, track) in seq.tracks.iter().enumerate().rev() {
        for it in &track.items {
            if frame >= it.from && frame < it.from + it.duration_in_frames {
                match it.kind { ItemKind::Audio { .. } => {}, _ => return (Some(it), Some(ti)) }
            }
        }
    }
    (None, None)
}

fn adjust_extension(path: &str, ext: &str) -> String {
    let mut p = std::path::PathBuf::from(path);
    p.set_extension(ext);
    p.display().to_string()
}

fn detect_hw_encoder<const N: usize>(candidates: [&str; N]) -> Option<String> {
    // best-effort: check existence by running ffmpeg -hide_banner -encoders and scanning; fallback None
    let out = std::process::Command::new("ffmpeg").arg("-hide_banner").arg("-encoders")
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    for cand in candidates {
        if s.contains(cand) { return Some(cand.to_string()); }
    }
    None
}
#[derive(Clone, Debug)]
struct AudioPeaks {
    peaks: Vec<(f32, f32)>, // (min, max) in [-1,1]
    duration_sec: f32,
    channels: u16,
    sample_rate: u32,
}

#[derive(Default)]
struct AudioCache {
    map: std::collections::HashMap<std::path::PathBuf, std::sync::Arc<AudioPeaks>>,
}

#[derive(Default)]
struct AudioBufferCache {
    map: HashMap<PathBuf, Arc<AudioBuffer>>,
}

impl AudioBufferCache {
    fn get_or_load(&mut self, path: &Path) -> anyhow::Result<Arc<AudioBuffer>> {
        if let Some(buf) = self.map.get(path) {
            return Ok(buf.clone());
        }
        let decoded = decode_audio_to_buffer(path)?;
        let arc = Arc::new(decoded);
        self.map.insert(path.to_path_buf(), arc.clone());
        Ok(arc)
    }
}
