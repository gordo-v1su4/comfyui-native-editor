use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use eframe::egui::TextureHandle;
use eframe::egui_wgpu;
use eframe::{egui, wgpu};
use media_io::YuvPixFmt;
use native_decoder::{self, create_decoder, DecoderConfig, NativeVideoDecoder, VideoFrame, YuvPixFmt as NativeYuvPixFmt, is_native_decoding_available};

use crate::preview::visual_source_at;
use crate::PRESENT_SIZE_MISMATCH_LOGGED;
use crate::VisualSource;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum PreviewShaderMode { Solid, ShowY, UvDebug, Nv12 }

impl Default for PreviewShaderMode { fn default() -> Self { PreviewShaderMode::Solid } }

pub(crate) struct PreviewState {
    pub(crate) texture: Option<TextureHandle>,
    pub(crate) frame_cache: Arc<Mutex<HashMap<FrameCacheKey, CachedFrame>>>,
    pub(crate) cache_worker: Option<JoinHandle<()>>,
    pub(crate) cache_stop: Option<Arc<AtomicBool>>,
    pub(crate) current_source: Option<VisualSource>,
    pub(crate) last_frame_time: f64,
    pub(crate) last_size: (u32, u32),
    pub(crate) gpu_tex_a: Option<Arc<eframe::wgpu::Texture>>,
    pub(crate) gpu_view_a: Option<eframe::wgpu::TextureView>,
    pub(crate) gpu_tex_b: Option<Arc<eframe::wgpu::Texture>>,
    pub(crate) gpu_view_b: Option<eframe::wgpu::TextureView>,
    pub(crate) gpu_use_b: bool,
    pub(crate) gpu_tex_id: Option<egui::TextureId>,
    pub(crate) gpu_size: (u32, u32),
    pub(crate) y_tex: [Option<Arc<eframe::wgpu::Texture>>; 3],
    pub(crate) uv_tex: [Option<Arc<eframe::wgpu::Texture>>; 3],
    pub(crate) y_stage: [Option<eframe::wgpu::Buffer>; 3],
    pub(crate) uv_stage: [Option<eframe::wgpu::Buffer>; 3],
    pub(crate) y_size: (u32, u32),
    pub(crate) uv_size: (u32, u32),
    pub(crate) ring_write: usize,
    pub(crate) ring_present: usize,
    pub(crate) y_pad_bpr: usize,
    pub(crate) uv_pad_bpr: usize,
    pub(crate) y_rows: u32,
    pub(crate) uv_rows: u32,
    nv12_cache: HashMap<FrameCacheKey, Nv12Frame>,
    nv12_keys: VecDeque<FrameCacheKey>,
    pub(crate) cache_hits: u64,
    pub(crate) cache_misses: u64,
    pub(crate) decode_time_ms: f64,
    pub(crate) last_fmt: Option<YuvPixFmt>,
    pub(crate) last_cpu_tick: u64,
    pub(crate) last_present_tick: u64,
    pub(crate) shader_mode: PreviewShaderMode,
    #[cfg(target_os = "macos")]
    pub(crate) gpu_yuv: Option<native_decoder::GpuYuv>,
    #[cfg(target_os = "macos")]
    pub(crate) last_zc: Option<(YuvPixFmt, Arc<eframe::wgpu::Texture>, Arc<eframe::wgpu::Texture>, (u32, u32))>,
    #[cfg(target_os = "macos")]
    pub(crate) last_zc_tick: u64,
    #[cfg(target_os = "macos")]
    pub(crate) zc_logged: bool,
}

impl PreviewState {
    pub(crate) fn new() -> Self {
        Self {
            texture: None,
            frame_cache: Arc::new(Mutex::new(HashMap::new())),
            cache_worker: None,
            cache_stop: None,
            current_source: None,
            last_frame_time: -1.0,
            last_size: (0, 0),
            gpu_tex_a: None,
            gpu_view_a: None,
            gpu_tex_b: None,
            gpu_view_b: None,
            gpu_use_b: false,
            gpu_tex_id: None,
            gpu_size: (0, 0),
            y_tex: [None, None, None],
            uv_tex: [None, None, None],
            y_stage: [None, None, None],
            uv_stage: [None, None, None],
            y_size: (0, 0),
            uv_size: (0, 0),
            ring_write: 0,
            ring_present: 0,
            y_pad_bpr: 0,
            uv_pad_bpr: 0,
            y_rows: 0,
            uv_rows: 0,
            nv12_cache: HashMap::new(),
            nv12_keys: VecDeque::new(),
            cache_hits: 0,
            cache_misses: 0,
            decode_time_ms: 0.0,
            last_fmt: None,
            last_cpu_tick: 0,
            last_present_tick: 0,
            shader_mode: PreviewShaderMode::Nv12,
            #[cfg(target_os = "macos")]
            gpu_yuv: None,
            #[cfg(target_os = "macos")]
            last_zc: None,
            #[cfg(target_os = "macos")]
            last_zc_tick: 0,
            #[cfg(target_os = "macos")]
            zc_logged: false,
        }
    }

    // Ensure triple-buffer NV12 plane textures at native size
    pub(crate) fn ensure_yuv_textures(&mut self, rs: &eframe::egui_wgpu::RenderState, w: u32, h: u32, fmt: YuvPixFmt) {
        let y_sz = (w, h);
        let uv_sz = ((w + 1) / 2, (h + 1) / 2);
        if self.y_size == y_sz && self.uv_size == uv_sz && self.y_tex[0].is_some() && self.uv_tex[0].is_some() {
            return;
        }
        let device = &*rs.device;
        let supports16 = device_supports_16bit_norm(rs);
        let (y_format, uv_format, y_bpp, uv_bpp_per_texel) = match fmt {
            YuvPixFmt::Nv12 => (eframe::wgpu::TextureFormat::R8Unorm, eframe::wgpu::TextureFormat::Rg8Unorm, 1usize, 2usize),
            YuvPixFmt::P010 => {
                if supports16 {
                    (eframe::wgpu::TextureFormat::R16Unorm, eframe::wgpu::TextureFormat::Rg16Unorm, 2usize, 4usize)
                } else {
                    (eframe::wgpu::TextureFormat::R16Uint, eframe::wgpu::TextureFormat::Rg16Uint, 2usize, 4usize)
                }
            }
        };
        let make_y = || device.create_texture(&eframe::wgpu::TextureDescriptor {
            label: Some("preview_nv12_y"),
            size: eframe::wgpu::Extent3d { width: y_sz.0, height: y_sz.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: eframe::wgpu::TextureDimension::D2,
            format: y_format,
            usage: eframe::wgpu::TextureUsages::COPY_DST | eframe::wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let make_uv = || device.create_texture(&eframe::wgpu::TextureDescriptor {
            label: Some("preview_nv12_uv"),
            size: eframe::wgpu::Extent3d { width: uv_sz.0, height: uv_sz.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: eframe::wgpu::TextureDimension::D2,
            format: uv_format,
            usage: eframe::wgpu::TextureUsages::COPY_DST | eframe::wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });

        for i in 0..3 {
            self.y_tex[i] = Some(std::sync::Arc::new(make_y()));
            self.uv_tex[i] = Some(std::sync::Arc::new(make_uv()));
            // (re)create staging buffers for COPY_BUFFER_TO_TEXTURE
            self.y_stage[i] = Some(device.create_buffer(&eframe::wgpu::BufferDescriptor {
                label: Some("stage_y"),
                size: (y_sz.1 as usize * align_to((y_sz.0 as usize)*y_bpp, eframe::wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize)) as u64,
                usage: eframe::wgpu::BufferUsages::COPY_SRC | eframe::wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            self.uv_stage[i] = Some(device.create_buffer(&eframe::wgpu::BufferDescriptor {
                label: Some("stage_uv"),
                size: (uv_sz.1 as usize * align_to((uv_sz.0 as usize) * uv_bpp_per_texel, eframe::wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize)) as u64,
                usage: eframe::wgpu::BufferUsages::COPY_SRC | eframe::wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
        }
        self.ring_write = 0;
        self.ring_present = 0;
        self.y_size = y_sz;
        self.uv_size = uv_sz;
        self.y_pad_bpr = align_to((y_sz.0 as usize)*y_bpp, eframe::wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize);
        self.uv_pad_bpr = align_to((uv_sz.0 as usize) * uv_bpp_per_texel, eframe::wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize);
        self.y_rows = y_sz.1;
        self.uv_rows = uv_sz.1;
    }

    pub(crate) fn upload_yuv_planes(&mut self, rs: &eframe::egui_wgpu::RenderState, fmt: YuvPixFmt, y: &[u8], uv: &[u8], w: u32, h: u32) {
        self.ensure_yuv_textures(rs, w, h, fmt);
        let queue = &*rs.queue;
        let device = &*rs.device;
        let next_idx = (self.ring_write + 1) % 3;
        if next_idx == self.ring_present {
            eprintln!("[RING DROP] write={} present={} (dropping frame to avoid stall)", self.ring_write, self.ring_present);
            return;
        }
        let idx = self.ring_write % 3;
        let y_tex = self.y_tex[idx].as_ref().map(|a| &**a).unwrap();
        let uv_tex = self.uv_tex[idx].as_ref().map(|a| &**a).unwrap();

        let uv_w = (w + 1) / 2;
        let uv_h = (h + 1) / 2;
        let (y_bpp, uv_bpp_per_texel) = match fmt { YuvPixFmt::Nv12 => (1usize, 2usize), YuvPixFmt::P010 => (2usize, 4usize) };
        let y_bpr = (w as usize) * y_bpp;
        let uv_bpr = (uv_w as usize) * uv_bpp_per_texel;
        let y_pad_bpr = self.y_pad_bpr;
        let uv_pad_bpr = self.uv_pad_bpr;

        // Fill pre-allocated scratch buffers with row padding, zero-initialized
        let mut y_scratch = vec![0u8; y_pad_bpr * h as usize];
        for r in 0..(h as usize) {
            let s = r * y_bpr;
            let d = r * y_pad_bpr;
            y_scratch[d..d + y_bpr].copy_from_slice(&y[s..s + y_bpr]);
        }
        let mut uv_scratch = vec![0u8; uv_pad_bpr * uv_h as usize];
        for r in 0..(uv_h as usize) {
            let s = r * uv_bpr;
            let d = r * uv_pad_bpr;
            uv_scratch[d..d + uv_bpr].copy_from_slice(&uv[s..s + uv_bpr]);
        }

        let y_stage = self.y_stage[idx].as_ref().unwrap();
        let uv_stage = self.uv_stage[idx].as_ref().unwrap();
        queue.write_buffer(y_stage, 0, &y_scratch);
        queue.write_buffer(uv_stage, 0, &uv_scratch);

        let mut encoder = device.create_command_encoder(&eframe::wgpu::CommandEncoderDescriptor { label: Some("nv12_upload") });
        encoder.copy_buffer_to_texture(
            eframe::wgpu::ImageCopyBuffer {
                buffer: y_stage,
                layout: eframe::wgpu::ImageDataLayout { offset: 0, bytes_per_row: Some(y_pad_bpr as u32), rows_per_image: Some(h) },
            },
            eframe::wgpu::ImageCopyTexture { texture: y_tex, mip_level: 0, origin: eframe::wgpu::Origin3d::ZERO, aspect: eframe::wgpu::TextureAspect::All },
            eframe::wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        encoder.copy_buffer_to_texture(
            eframe::wgpu::ImageCopyBuffer {
                buffer: uv_stage,
                layout: eframe::wgpu::ImageDataLayout { offset: 0, bytes_per_row: Some(uv_pad_bpr as u32), rows_per_image: Some(uv_h) },
            },
            eframe::wgpu::ImageCopyTexture { texture: uv_tex, mip_level: 0, origin: eframe::wgpu::Origin3d::ZERO, aspect: eframe::wgpu::TextureAspect::All },
            eframe::wgpu::Extent3d { width: uv_w, height: uv_h, depth_or_array_layers: 1 },
        );
        queue.submit([encoder.finish()]);
        eprintln!("[UV] w={} h={} bpr={} rows={}", uv_w, uv_h, uv_pad_bpr, uv_h);

        self.ring_present = idx;
        self.ring_write = next_idx;
        self.last_fmt = Some(fmt);
    }

    pub(crate) fn current_plane_textures(&self) -> Option<(YuvPixFmt, std::sync::Arc<eframe::wgpu::Texture>, std::sync::Arc<eframe::wgpu::Texture>)> {
        let mut best: Option<(u64, YuvPixFmt, std::sync::Arc<eframe::wgpu::Texture>, std::sync::Arc<eframe::wgpu::Texture>)> = None;
        if let Some(fmt) = self.last_fmt {
            let idx = self.ring_present % 3;
            if let (Some(y), Some(uv)) = (self.y_tex[idx].as_ref(), self.uv_tex[idx].as_ref()) {
                best = Some((self.last_cpu_tick, fmt, y.clone(), uv.clone()));
            }
        }
        #[cfg(target_os = "macos")]
        if let Some((fmt, y, uv, _sz)) = self.last_zc.as_ref() {
            match best {
                Some((tick, ..)) if self.last_zc_tick <= tick => {}
                _ => { best = Some((self.last_zc_tick, *fmt, y.clone(), uv.clone())); }
            }
        }
        best.map(|(_, fmt, y, uv)| (fmt, y, uv))
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn ensure_zero_copy_nv12_textures(
        &mut self,
        rs: &eframe::egui_wgpu::RenderState,
        w: u32,
        h: u32,
    ) {
        let target_y = (w, h);
        let target_uv = ((w + 1) / 2, (h + 1) / 2);
        let needs_new = match &self.gpu_yuv {
            Some(_) if self.y_size == target_y && self.uv_size == target_uv => false,
            _ => true,
        };
        if !needs_new {
            return;
        }

        let device = &*rs.device;
        let make_tex = |label: &str, size: (u32, u32), format: eframe::wgpu::TextureFormat| {
            Arc::new(device.create_texture(&eframe::wgpu::TextureDescriptor {
                label: Some(label),
                size: eframe::wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: eframe::wgpu::TextureDimension::D2,
                format,
                usage: eframe::wgpu::TextureUsages::COPY_DST | eframe::wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            }))
        };

        let y_tex = make_tex("preview_zc_nv12_y", target_y, eframe::wgpu::TextureFormat::R8Unorm);
        let uv_tex = make_tex(
            "preview_zc_nv12_uv",
            target_uv,
            eframe::wgpu::TextureFormat::Rg8Unorm,
        );
        self.gpu_yuv = Some(native_decoder::GpuYuv {
            y_tex: y_tex.clone(),
            uv_tex: uv_tex.clone(),
        });
        self.y_size = target_y;
        self.uv_size = target_uv;
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn set_last_zc_present(
        &mut self,
        fmt: YuvPixFmt,
        y_tex: std::sync::Arc<eframe::wgpu::Texture>,
        uv_tex: std::sync::Arc<eframe::wgpu::Texture>,
        w: u32,
        h: u32,
    ) {
        self.last_zc = Some((fmt, y_tex, uv_tex, (w, h)));
        self.last_fmt = Some(fmt);
        self.y_size = (w, h);
        self.uv_size = ((w + 1)/2, (h + 1)/2);
        self.last_present_tick = self.last_present_tick.wrapping_add(1);
        self.last_zc_tick = self.last_present_tick;
    }

    pub(crate) fn present_yuv(&mut self, rs: &eframe::egui_wgpu::RenderState, path: &str, t_sec: f64) -> Option<(YuvPixFmt, Arc<eframe::wgpu::Texture>, Arc<eframe::wgpu::Texture>)> {
        let key = FrameCacheKey::new(path, t_sec, 0, 0);
        let mut fmt; let mut y; let mut uv; let mut w; let mut h;
        if let Some(hit) = self.nv12_cache.get(&key) {
            fmt = hit.fmt; y = hit.y.clone(); uv = hit.uv.clone(); w = hit.w; h = hit.h;
            if let Some(pos) = self.nv12_keys.iter().position(|k| k == &key) { self.nv12_keys.remove(pos); }
            self.nv12_keys.push_back(key.clone());
            } else {
            if let Ok(frame) = media_io::decode_yuv_at(std::path::Path::new(path), t_sec) {
                fmt = frame.fmt; y = frame.y; uv = frame.uv; w = frame.width; h = frame.height;
                if fmt == YuvPixFmt::P010 && !device_supports_16bit_norm(rs) {
                    if let Some((_f, ny, nuv, nw, nh)) = decode_video_frame_nv12_only(path, t_sec) { fmt = YuvPixFmt::Nv12; y = ny; uv = nuv; w = nw; h = nh; }
                }
                self.nv12_cache.insert(key.clone(), Nv12Frame { fmt, y: y.clone(), uv: uv.clone(), w, h });
                self.nv12_keys.push_back(key.clone());
                if self.nv12_keys.len() > 64 { if let Some(old) = self.nv12_keys.pop_front() { self.nv12_cache.remove(&old); } }
            } else { return None; }
        }
        self.upload_yuv_planes(rs, fmt, &y, &uv, w, h);
        let idx = self.ring_present;
        Some((fmt, self.y_tex[idx].as_ref().unwrap().clone(), self.uv_tex[idx].as_ref().unwrap().clone()))
    }

    // Ensure double-buffered GPU textures and a registered TextureId
    pub(crate) fn ensure_gpu_textures(&mut self, rs: &eframe::egui_wgpu::RenderState, w: u32, h: u32) {
        if self.gpu_size == (w, h) && self.gpu_tex_id.is_some() && (self.gpu_view_a.is_some() || self.gpu_view_b.is_some()) {
            return;
        }
        let device = &*rs.device;
        let make_tex = || device.create_texture(&eframe::wgpu::TextureDescriptor {
            label: Some("preview_native_tex"),
            size: eframe::wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: eframe::wgpu::TextureDimension::D2,
            format: eframe::wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: eframe::wgpu::TextureUsages::COPY_DST | eframe::wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let tex_a = std::sync::Arc::new(make_tex());
        let view_a = tex_a.create_view(&eframe::wgpu::TextureViewDescriptor::default());
        let tex_b = std::sync::Arc::new(make_tex());
        let view_b = tex_b.create_view(&eframe::wgpu::TextureViewDescriptor::default());

        // Register a TextureId if needed, otherwise update it to A initially
        let mut renderer = rs.renderer.write();
        if let Some(id) = self.gpu_tex_id {
            renderer.update_egui_texture_from_wgpu_texture(device, &view_a, eframe::wgpu::FilterMode::Linear, id);
        } else {
            let id = renderer.register_native_texture(device, &view_a, eframe::wgpu::FilterMode::Linear);
            self.gpu_tex_id = Some(id);
        }

        self.gpu_tex_a = Some(tex_a);
        self.gpu_view_a = Some(view_a);
        self.gpu_tex_b = Some(tex_b);
        self.gpu_view_b = Some(view_b);
        self.gpu_use_b = false;
        self.gpu_size = (w, h);
    }

    // Upload RGBA bytes into the next back buffer and retarget the TextureId to it
    pub(crate) fn upload_gpu_frame(&mut self, rs: &eframe::egui_wgpu::RenderState, rgba: &[u8]) {
        let (w, h) = self.gpu_size;
        let queue = &*rs.queue;
        // swap buffer
        self.gpu_use_b = !self.gpu_use_b;
        let (tex, view) = if self.gpu_use_b {
            (self.gpu_tex_b.as_ref().map(|a| &**a), self.gpu_view_b.as_ref())
        } else {
            (self.gpu_tex_a.as_ref().map(|a| &**a), self.gpu_view_a.as_ref())
        };
        if let (Some(tex), Some(view)) = (tex, view) {
            let bytes_per_row = (w * 4) as usize;
            let align = eframe::wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize; // 256
            let padded_bpr = ((bytes_per_row + align - 1) / align) * align;
            if padded_bpr == bytes_per_row {
                queue.write_texture(
                    eframe::wgpu::ImageCopyTexture { texture: tex, mip_level: 0, origin: eframe::wgpu::Origin3d::ZERO, aspect: eframe::wgpu::TextureAspect::All },
                    rgba,
                    eframe::wgpu::ImageDataLayout { offset: 0, bytes_per_row: Some((bytes_per_row) as u32), rows_per_image: Some(h) },
                    eframe::wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                );
            } else {
                // build a padded buffer per row to satisfy alignment
                let mut padded = vec![0u8; padded_bpr * (h as usize)];
                for row in 0..(h as usize) {
                    let src_off = row * bytes_per_row;
                    let dst_off = row * padded_bpr;
                    padded[dst_off..dst_off + bytes_per_row]
                        .copy_from_slice(&rgba[src_off..src_off + bytes_per_row]);
                }
                queue.write_texture(
                    eframe::wgpu::ImageCopyTexture { texture: tex, mip_level: 0, origin: eframe::wgpu::Origin3d::ZERO, aspect: eframe::wgpu::TextureAspect::All },
                    &padded,
                    eframe::wgpu::ImageDataLayout { offset: 0, bytes_per_row: Some(padded_bpr as u32), rows_per_image: Some(h) },
                    eframe::wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                );
            }
            if let Some(id) = self.gpu_tex_id {
                let device = &*rs.device;
                let mut renderer = rs.renderer.write();
                renderer.update_egui_texture_from_wgpu_texture(device, view, eframe::wgpu::FilterMode::Linear, id);
            }
        }
    }

    // Present a GPU-cached frame for a source/time. If absent, decode one and upload.
    pub(crate) fn present_gpu_cached(
        &mut self,
        rs: &eframe::egui_wgpu::RenderState,
        path: &str,
        t_sec: f64,
        desired: (u32, u32),
    ) -> Option<egui::TextureId> {
        self.ensure_gpu_textures(rs, desired.0, desired.1);
        // Try cache first
        let key = FrameCacheKey::new(path, t_sec, desired.0, desired.1);
        if let Some(cached) = self.get_cached_frame(&key) {
            let mut bytes = Vec::with_capacity(cached.image.pixels.len() * 4);
            for p in &cached.image.pixels { bytes.extend_from_slice(&p.to_array()); }
            self.upload_gpu_frame(rs, &bytes);
            return self.gpu_tex_id; // ignored in wgpu path; retained for compatibility
        }
        // Decode one frame on demand
        let decoded = if path.to_lowercase().ends_with(".png") || path.to_lowercase().ends_with(".jpg") || path.to_lowercase().ends_with(".jpeg") {
            decode_image_optimized(path, desired.0, desired.1)
        } else {
            decode_video_frame_optimized(path, t_sec, desired.0, desired.1)
        };
        if let Some(img) = decoded {
            let mut bytes = Vec::with_capacity(img.pixels.len() * 4);
            for p in &img.pixels { bytes.extend_from_slice(&p.to_array()); }
            self.upload_gpu_frame(rs, &bytes);
            return self.gpu_tex_id; // ignored in wgpu path; retained for compatibility
        }
        None
    }

    pub(crate) fn update(&mut self, ctx: &egui::Context, size: (u32, u32), source: Option<&VisualSource>, _playing: bool, t_sec: f64) {
        // Check if we need to update the frame
        let need_update = match source {
            Some(src) => {
                self.current_source.as_ref().map_or(true, |current| {
                    current.path != src.path || 
                    (t_sec - self.last_frame_time).abs() > 0.05 || // Update every 50ms for smooth scrubbing
                    self.last_size != size
                })
            }
            None => {
                self.current_source.is_some()
            }
        };

        if need_update {
            self.current_source = source.cloned();
            self.last_frame_time = t_sec;
            self.last_size = size;

            if let Some(src) = source {
                // Try to get frame from cache first
                let cache_key = FrameCacheKey::new(&src.path, t_sec, size.0, size.1);
                
                if let Some(_cached_frame) = self.get_cached_frame(&cache_key) {
                    // Cache hit - let present_gpu_cached upload to native WGPU on paint
                    self.cache_hits += 1;
                    ctx.request_repaint();
                } else {
                    // Cache miss - decode frame asynchronously
                    self.cache_misses += 1;
                    self.decode_frame_async(ctx, src.clone(), cache_key, t_sec);
                }
            } else {
                // no source
            }
        }
    }
    
    pub(crate) fn get_cached_frame(&self, key: &FrameCacheKey) -> Option<CachedFrame> {
        if let Ok(cache) = self.frame_cache.lock() {
            if let Some(mut frame) = cache.get(key).cloned() {
                frame.access_count += 1;
                frame.last_access = std::time::Instant::now();
                return Some(frame);
            }
        }
        None
    }
    
    pub(crate) fn decode_frame_async(&mut self, ctx: &egui::Context, source: VisualSource, cache_key: FrameCacheKey, t_sec: f64) {
        // If native decoding is available and this is a video, do not spawn RGBA decoding.
        // The persistent native decoder will feed frames via the ring buffer.
        if !source.is_image && is_native_decoding_available() {
            return;
        }
        let cache = self.frame_cache.clone();
        let ctx = ctx.clone();
        
        // Stop any existing cache worker
        if let Some(stop) = &self.cache_stop {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(worker) = self.cache_worker.take() {
            let _ = worker.join();
        }
        
        let stop_flag = Arc::new(AtomicBool::new(false));
        self.cache_stop = Some(stop_flag.clone());
        
        let worker = thread::spawn(move || {
            if stop_flag.load(Ordering::Relaxed) { return; }
            
            let start_time = std::time::Instant::now();
            
            // Decode frame efficiently
            let frame_result = if source.is_image {
                decode_image_optimized(&source.path, cache_key.width, cache_key.height)
        } else {
                // Use native decoder if available, fallback to FFmpeg
                if is_native_decoding_available() {
                    decode_video_frame_native(&source.path, t_sec, cache_key.width, cache_key.height)
                } else {
                    decode_video_frame_optimized(&source.path, t_sec, cache_key.width, cache_key.height)
                }
            };
            
            if stop_flag.load(Ordering::Relaxed) { return; }
            
            if let Some(image) = frame_result {
                let _decode_time = start_time.elapsed();
                
                // Cache the frame
                let cached_frame = CachedFrame {
                    image: image.clone(),
                    decoded_at: std::time::Instant::now(),
                    access_count: 1,
                    last_access: std::time::Instant::now(),
                };
                
                if let Ok(mut cache) = cache.lock() {
                    // Implement LRU eviction if cache is too large
                    if cache.len() > 50 { // Max 50 cached frames
                        evict_lru_frames(&mut cache, 10); // Remove oldest 10 frames
                    }
                    
                    cache.insert(cache_key, cached_frame);
                }
                
                // Update texture on main thread
                ctx.request_repaint();
            }
        });
        
        self.cache_worker = Some(worker);
    }

    pub(crate) fn stop_cache_worker(&mut self) {
        if let Some(stop) = &self.cache_stop {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(worker) = self.cache_worker.take() {
            let _ = worker.join();
        }
        self.cache_stop = None;
    }
    
    pub(crate) fn print_cache_stats(&self) {
        let total_requests = self.cache_hits + self.cache_misses;
        if total_requests > 0 {
            let hit_rate = (self.cache_hits as f64 / total_requests as f64) * 100.0;
            println!("Preview Cache Stats: {:.1}% hit rate ({}/{} requests), avg decode: {:.1}ms", 
                     hit_rate, self.cache_hits, total_requests, self.decode_time_ms);
        }
    }
    
    pub(crate) fn preload_nearby_frames(&self, source: &VisualSource, current_time: f64, size: (u32, u32)) {
        if source.is_image { return; } // No need to preload for images
        
        let cache = self.frame_cache.clone();
        let source = source.clone();
        let (w, h) = size;
        
        // Preload frames around current time (±2 seconds)
        thread::spawn(move || {
            let _preload_range = 2.0; // seconds
            let _step = 0.2; // every 200ms
            
            for offset in [0.2, 0.4, 0.6, 0.8, 1.0, -0.2, -0.4, -0.6, -0.8, -1.0] {
                let preload_time = current_time + offset;
                if preload_time < 0.0 { continue; }
                
                let cache_key = FrameCacheKey::new(&source.path, preload_time, w, h);
                
                // Check if frame is already cached
                if let Ok(cache) = cache.lock() {
                    if cache.contains_key(&cache_key) {
                        continue; // Already cached
                    }
                }
                
                // Decode frame in background
                if let Some(image) = decode_video_frame_optimized(&source.path, preload_time, w, h) {
                    let cached_frame = CachedFrame {
                        image,
                        decoded_at: std::time::Instant::now(),
                        access_count: 0,
                        last_access: std::time::Instant::now(),
                    };
                    
                    if let Ok(mut cache) = cache.lock() {
                        // Only cache if we're not over the limit
                        if cache.len() < 50 {
                            cache.insert(cache_key, cached_frame);
                        }
                    }
                }
                
                // Small delay to avoid overwhelming the system
                thread::sleep(Duration::from_millis(10));
            }
        });
    }

    pub(crate) fn present_yuv_with_frame(
        &mut self,
        rs: &eframe::egui_wgpu::RenderState,
        path: &str,
        t_sec: f64,
        vf_opt: Option<&native_decoder::VideoFrame>,
    ) -> Option<(YuvPixFmt, Arc<eframe::wgpu::Texture>, Arc<eframe::wgpu::Texture>)> {
        if let Some(vf) = vf_opt {
            // Map NativeYuvPixFmt to local YuvPixFmt and handle P010->NV12 fallback
            let mut fmt = match vf.format {
                native_decoder::YuvPixFmt::Nv12 => YuvPixFmt::Nv12,
                native_decoder::YuvPixFmt::P010 => YuvPixFmt::P010,
            };
            let mut y: Vec<u8> = vf.y_plane.clone();
            let mut uv: Vec<u8> = vf.uv_plane.clone();
            let w = vf.width; let h = vf.height;
            if fmt == YuvPixFmt::P010 && !device_supports_16bit_norm(rs) {
                if let Some((_f, ny, nuv, nw, nh)) = decode_video_frame_nv12_only(path, t_sec) { fmt = YuvPixFmt::Nv12; y = ny; uv = nuv; let _ = (nw, nh); }
            }
            let key = FrameCacheKey::new(path, t_sec, 0, 0);
            self.nv12_cache.insert(key.clone(), Nv12Frame { fmt, y: y.clone(), uv: uv.clone(), w, h });
            self.nv12_keys.push_back(key);
            while self.nv12_keys.len() > 64 { if let Some(old) = self.nv12_keys.pop_front() { self.nv12_cache.remove(&old); } }
            self.upload_yuv_planes(rs, fmt, &y, &uv, w, h);
            let idx = self.ring_present;
            return Some((fmt, self.y_tex[idx].as_ref().unwrap().clone(), self.uv_tex[idx].as_ref().unwrap().clone()));
        }
        // Fallback to old path
        self.present_yuv(rs, path, t_sec)
    }

    pub(crate) fn present_yuv_from_bytes(
        &mut self,
        rs: &eframe::egui_wgpu::RenderState,
        fmt: YuvPixFmt,
        y_bytes: &[u8],
        uv_bytes: &[u8],
        w: u32,
        h: u32,
    ) -> Option<(YuvPixFmt, Arc<eframe::wgpu::Texture>, Arc<eframe::wgpu::Texture>)> {
        // Ensure textures/buffers exist at this decoded size/format
        self.ensure_yuv_textures(rs, w, h, fmt);

        // Write into current ring slot
        let wi = self.ring_write % 3;

        // Compute padded rows
        let (y_bpp, uv_bpp_per_texel) = match fmt { YuvPixFmt::Nv12 => (1usize, 2usize), YuvPixFmt::P010 => (2usize, 4usize) };
        let y_w = w as usize; let y_h = h as usize;
        let uv_w = ((w + 1) / 2) as usize; let uv_h = ((h + 1) / 2) as usize;
        let y_pad_bpr = align_to(y_w * y_bpp, eframe::wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize);
        let uv_pad_bpr = align_to(uv_w * uv_bpp_per_texel, eframe::wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize);
        debug_assert!(uv_pad_bpr % 2 == 0, "NV12 UV bpr must be even (#channels=2)");

        // Guard: verify plane lengths once; early out if mismatched
        let expected_y = y_w * y_bpp * y_h;
        let expected_uv = uv_w * uv_bpp_per_texel * uv_h;
        debug_assert_eq!(y_bytes.len(), expected_y, "Y plane size mismatch");
        debug_assert_eq!(uv_bytes.len(), expected_uv, "UV plane size mismatch");
        if y_bytes.len() != expected_y || uv_bytes.len() != expected_uv {
            let flag = PRESENT_SIZE_MISMATCH_LOGGED.get_or_init(|| AtomicBool::new(false));
            if !flag.swap(true, Ordering::Relaxed) {
                eprintln!(
                    "[present] size mismatch: got Y={} UV={}, expected Y={} UV={}",
                    y_bytes.len(), uv_bytes.len(), expected_y, expected_uv
                );
            }
            return None;
        }

        let device = &*rs.device;
        let queue = &*rs.queue;

        // Upload Y
        if let (Some(stage), Some(y_tex)) = (self.y_stage[wi].as_ref(), self.y_tex[wi].as_ref()) {
            if y_pad_bpr == y_w * y_bpp {
                queue.write_buffer(stage, 0, y_bytes);
            } else {
                let mut padded = vec![0u8; y_pad_bpr * y_h];
                for row in 0..y_h {
                    let src_off = row * y_w * y_bpp;
                    let dst_off = row * y_pad_bpr;
                    padded[dst_off..dst_off + y_w * y_bpp].copy_from_slice(&y_bytes[src_off..src_off + y_w * y_bpp]);
                }
                queue.write_buffer(stage, 0, &padded);
            }
            let mut enc = device.create_command_encoder(&eframe::wgpu::CommandEncoderDescriptor { label: Some("copy_y") });
            enc.copy_buffer_to_texture(
                eframe::wgpu::ImageCopyBuffer { buffer: stage, layout: eframe::wgpu::ImageDataLayout { offset: 0, bytes_per_row: Some(y_pad_bpr as u32), rows_per_image: Some(h) } },
                eframe::wgpu::ImageCopyTexture { texture: y_tex, mip_level: 0, origin: eframe::wgpu::Origin3d::ZERO, aspect: eframe::wgpu::TextureAspect::All },
                eframe::wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            );
            rs.queue.submit(std::iter::once(enc.finish()));
        }

        // Upload UV
        if let (Some(stage), Some(uv_tex)) = (self.uv_stage[wi].as_ref(), self.uv_tex[wi].as_ref()) {
            if uv_pad_bpr == uv_w * uv_bpp_per_texel {
                queue.write_buffer(stage, 0, uv_bytes);
            } else {
                let mut padded = vec![0u8; uv_pad_bpr * uv_h];
                for row in 0..uv_h {
                    let src_off = row * uv_w * uv_bpp_per_texel;
                    let dst_off = row * uv_pad_bpr;
                    padded[dst_off..dst_off + uv_w * uv_bpp_per_texel].copy_from_slice(&uv_bytes[src_off..src_off + uv_w * uv_bpp_per_texel]);
                }
                queue.write_buffer(stage, 0, &padded);
            }
            let mut enc = device.create_command_encoder(&eframe::wgpu::CommandEncoderDescriptor { label: Some("copy_uv") });
            enc.copy_buffer_to_texture(
                eframe::wgpu::ImageCopyBuffer { buffer: stage, layout: eframe::wgpu::ImageDataLayout { offset: 0, bytes_per_row: Some(uv_pad_bpr as u32), rows_per_image: Some((h + 1) / 2) } },
                eframe::wgpu::ImageCopyTexture { texture: uv_tex, mip_level: 0, origin: eframe::wgpu::Origin3d::ZERO, aspect: eframe::wgpu::TextureAspect::All },
                eframe::wgpu::Extent3d { width: (w + 1) / 2, height: (h + 1) / 2, depth_or_array_layers: 1 },
            );
            rs.queue.submit(std::iter::once(enc.finish()));
            eprintln!("[UV] w={} h={} bpr={} rows={}", uv_w, uv_h, uv_pad_bpr, uv_h);
        }

        // Persist last-good so fallback can reuse
        self.last_fmt = Some(fmt);
        self.y_size = (w, h);
        self.uv_size = ((w + 1) / 2, (h + 1) / 2);
        self.ring_present = wi;
        self.ring_write = (wi + 1) % 3;
        self.last_present_tick = self.last_present_tick.wrapping_add(1);
        self.last_cpu_tick = self.last_present_tick;

        let y_tex = self.y_tex[wi].as_ref()?.clone();
        let uv_tex = self.uv_tex[wi].as_ref()?.clone();
        Some((fmt, y_tex, uv_tex))
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn present_nv12_zero_copy(
        &mut self,
        rs: &eframe::egui_wgpu::RenderState,
        zc: &native_decoder::IOSurfaceFrame,
    ) -> Option<(YuvPixFmt, Arc<eframe::wgpu::Texture>, Arc<eframe::wgpu::Texture>)> {
        self.ensure_zero_copy_nv12_textures(rs, zc.width, zc.height);
        if let Some((y_arc, uv_arc)) = self.gpu_yuv.as_ref().map(|g| (g.y_tex.clone(), g.uv_tex.clone())) {
            let queue = &*rs.queue;
            if let Err(e) = self.gpu_yuv.as_ref().unwrap().import_from_iosurface(queue, zc) {
                eprintln!("[zc] import_from_iosurface error: {}", e);
                return None;
            }
            #[cfg(target_os = "macos")]
            if !self.zc_logged {
                tracing::info!("[preview] imported NV12 planes: Y={}x{}  UV={}x{}", zc.width, zc.height, (zc.width + 1)/2, (zc.height + 1)/2);
                self.zc_logged = true;
            }
            // Persist last ZC for reuse
            self.set_last_zc_present(YuvPixFmt::Nv12, y_arc.clone(), uv_arc.clone(), zc.width, zc.height);
            return Some((YuvPixFmt::Nv12, y_arc, uv_arc));
        }
        None
    }
}

// WGPU callback to draw NV12 planes via WGSL YUV->RGB.
pub(crate) struct PreviewYuvCallback {
    pub(crate) y_tex: Arc<eframe::wgpu::Texture>,
    pub(crate) uv_tex: Arc<eframe::wgpu::Texture>,
    pub(crate) fmt: YuvPixFmt,
    pub(crate) use_uint: bool,
    pub(crate) w: u32,
    pub(crate) h: u32,
    pub(crate) mode: PreviewShaderMode,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct PreviewUniforms {
    pub(crate) w: f32,
    pub(crate) h: f32,
    pub(crate) mode: u32, // 0=Solid,1=ShowY,2=UvDebug,3=Nv12
    pub(crate) _pad: u32, // 16B alignment
}

struct Nv12Resources {
    pipeline_nv12: eframe::wgpu::RenderPipeline,
    pub(crate) pipeline_solid: eframe::wgpu::RenderPipeline,
    pub(crate) pipeline_showy: eframe::wgpu::RenderPipeline,
    pub(crate) pipeline_uvdebug: eframe::wgpu::RenderPipeline,
    pub(crate) bind_group_layout: eframe::wgpu::BindGroupLayout,
    pub(crate) uniform_bgl: eframe::wgpu::BindGroupLayout,
    pub(crate) sampler: eframe::wgpu::Sampler,
}

struct Nv12BindGroup {
    pub(crate) bind: eframe::wgpu::BindGroup,
    pub(crate) y_id: usize,
    pub(crate) uv_id: usize,
}
struct P010UintResources {
    pub(crate) pipeline: eframe::wgpu::RenderPipeline,
    pub(crate) tex_bgl: eframe::wgpu::BindGroupLayout,
    pub(crate) uniform_bgl: eframe::wgpu::BindGroupLayout,
}
struct P010UintTexBind(eframe::wgpu::BindGroup);
struct P010UintConvBind(eframe::wgpu::BindGroup);

impl egui_wgpu::CallbackTrait for PreviewYuvCallback {
    fn prepare(
        &self,
        device: &eframe::wgpu::Device,
        queue: &eframe::wgpu::Queue,
        _screen: &eframe::egui_wgpu::ScreenDescriptor,
        _egui_encoder: &mut eframe::wgpu::CommandEncoder,
        resources: &mut eframe::egui_wgpu::CallbackResources,
    ) -> Vec<eframe::wgpu::CommandBuffer> {
        // Ensure pipeline resources
        if resources.get::<Nv12Resources>().is_none() {
            let shader_src = r#"
                @group(0) @binding(0) var samp: sampler;
                @group(0) @binding(1) var texY: texture_2d<f32>;
                @group(0) @binding(2) var texUV: texture_2d<f32>;
                struct Uniforms { w: f32, h: f32, mode: u32, _pad: u32 };
                @group(0) @binding(3) var<uniform> uni: Uniforms;

                struct Conv { y_bias: f32, y_scale: f32, uv_bias: f32, uv_scale: f32 };
                @group(1) @binding(0) var<uniform> conv: Conv;

                struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

                @vertex
                fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
                    var pos = array<vec2<f32>,3>(vec2(-1.0, -1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
                    var uv  = array<vec2<f32>,3>(vec2(0.0, 1.0), vec2(2.0,1.0), vec2(0.0,-1.0));
                    var o: VSOut;
                    o.pos = vec4<f32>(pos[vi], 0.0, 1.0);
                    o.uv = uv[vi];
                    return o;
                }

                @fragment
                fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
                    let tc = in.uv;
                    switch uni.mode {
                        case 0u: { // Solid
                            return vec4<f32>(0.0, 1.0, 0.0, 1.0);
                        }
                        case 1u: { // ShowY
                            let y = textureSampleLevel(texY, samp, tc, 0.0).r;
                            return vec4<f32>(y, y, y, 1.0);
                        }
                        case 2u: { // UvDebug
                            let uv = textureSampleLevel(texUV, samp, tc, 0.0).rg;
                            return vec4<f32>(uv.x, uv.y, 0.0, 1.0);
                        }
                        default: { // NV12 using BT.709 limited range conv
                            let y = textureSampleLevel(texY, samp, tc, 0.0).r;
                            let uv = textureSampleLevel(texUV, samp, tc, 0.0).rg;
                            let C = max((y - conv.y_bias) * conv.y_scale, 0.0);
                            let D = (uv.x - conv.uv_bias) * conv.uv_scale;
                            let E = (uv.y - conv.uv_bias) * conv.uv_scale;
                            let r = clamp(C + 1.5748 * E,              0.0, 1.0);
                            let g = clamp(C - 0.1873 * D - 0.4681 * E, 0.0, 1.0);
                            let b = clamp(C + 1.8556 * D,              0.0, 1.0);
                            return vec4<f32>(r, g, b, 1.0);
                        }
                    }
                }
            "#;
            let module = device.create_shader_module(eframe::wgpu::ShaderModuleDescriptor {
                label: Some("preview_nv12_shader"),
                source: eframe::wgpu::ShaderSource::Wgsl(shader_src.into()),
            });
            let bgl = device.create_bind_group_layout(&eframe::wgpu::BindGroupLayoutDescriptor {
                label: Some("NV12 tex BGL"),
                entries: &[
                    eframe::wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: eframe::wgpu::ShaderStages::FRAGMENT,
                        ty: eframe::wgpu::BindingType::Sampler(eframe::wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                    eframe::wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: eframe::wgpu::ShaderStages::FRAGMENT,
                        ty: eframe::wgpu::BindingType::Texture {
                            multisampled: false,
                            view_dimension: eframe::wgpu::TextureViewDimension::D2,
                            sample_type: eframe::wgpu::TextureSampleType::Float { filterable: true },
                        },
                        count: None,
                    },
                    eframe::wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: eframe::wgpu::ShaderStages::FRAGMENT,
                        ty: eframe::wgpu::BindingType::Texture {
                            multisampled: false,
                            view_dimension: eframe::wgpu::TextureViewDimension::D2,
                            sample_type: eframe::wgpu::TextureSampleType::Float { filterable: true },
                        },
                        count: None,
                    },
                    eframe::wgpu::BindGroupLayoutEntry {
                        binding: 3,
                        visibility: eframe::wgpu::ShaderStages::FRAGMENT,
                        ty: eframe::wgpu::BindingType::Buffer {
                            ty: eframe::wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });
            let uniform_bgl = device.create_bind_group_layout(&eframe::wgpu::BindGroupLayoutDescriptor {
                label: Some("NV12 conv BGL"),
                entries: &[eframe::wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: eframe::wgpu::ShaderStages::FRAGMENT,
                    ty: eframe::wgpu::BindingType::Buffer { ty: eframe::wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                }],
            });
            let pl = device.create_pipeline_layout(&eframe::wgpu::PipelineLayoutDescriptor {
                label: Some("NV12 pipeline layout"),
                bind_group_layouts: &[&bgl, &uniform_bgl],
                push_constant_ranges: &[],
            });
            let mk_pipeline = |label: &str, fs: &str| device.create_render_pipeline(&eframe::wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&pl),
                vertex: eframe::wgpu::VertexState {
                    module: &module,
                    entry_point: "vs_main",
                    compilation_options: eframe::wgpu::PipelineCompilationOptions::default(),
                    buffers: &[],
                },
                fragment: Some(eframe::wgpu::FragmentState {
                    module: &module,
                    entry_point: fs,
                    compilation_options: eframe::wgpu::PipelineCompilationOptions::default(),
                    targets: &[Some(eframe::wgpu::ColorTargetState {
                        format: eframe::wgpu::TextureFormat::Bgra8Unorm,
                        blend: Some(eframe::wgpu::BlendState::REPLACE),
                        write_mask: eframe::wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: eframe::wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: eframe::wgpu::MultisampleState::default(),
                multiview: None,
                cache: None,
            });
            let pipeline_nv12 = mk_pipeline("preview_nv12_pipeline", "fs_main");
            let pipeline_solid = mk_pipeline("preview_solid_pipeline", "fs_main");
            let pipeline_showy = mk_pipeline("preview_showy_pipeline", "fs_main");
            let pipeline_uvdebug = mk_pipeline("preview_uvdebug_pipeline", "fs_main");
            let sampler = device.create_sampler(&eframe::wgpu::SamplerDescriptor {
                label: Some("nv12_clamp_sampler"),
                address_mode_u: eframe::wgpu::AddressMode::ClampToEdge,
                address_mode_v: eframe::wgpu::AddressMode::ClampToEdge,
                address_mode_w: eframe::wgpu::AddressMode::ClampToEdge,
                mag_filter: eframe::wgpu::FilterMode::Linear,
                min_filter: eframe::wgpu::FilterMode::Linear,
                mipmap_filter: eframe::wgpu::FilterMode::Nearest,
                ..Default::default()
            });
            // Take ownership values, then insert to avoid overlapping borrows during insert
            let res = Nv12Resources { pipeline_nv12, pipeline_solid, pipeline_showy, pipeline_uvdebug, bind_group_layout: bgl, uniform_bgl, sampler };
            resources.insert(res);
        }

        if self.use_uint {
            if resources.get::<P010UintResources>().is_none() {
                let shader_src = r#"
                    @group(0) @binding(0) var texY: texture_2d<u32>;
                    @group(0) @binding(1) var texUV: texture_2d<u32>;
                    struct Conv { y_offset: f32, y_scale: f32, c_offset: f32, c_scale: f32, _pad: vec2<f32> };
                    @group(1) @binding(0) var<uniform> conv: Conv;
                    struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
                    @vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
                        var pos = array<vec2<f32>,3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
                        var uv = array<vec2<f32>,3>(vec2(0.0,1.0), vec2(2.0,1.0), vec2(0.0,-1.0));
                        var o: VSOut; o.pos = vec4<f32>(pos[vi],0.0,1.0); o.uv = uv[vi]; return o;
                    }
                    @fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
                        let dimY = textureDimensions(texY);
                        let dimUV = textureDimensions(texUV);
                        let coordY = vec2<i32>(in.uv * vec2<f32>(dimY));
                        let coordUV = vec2<i32>(in.uv * vec2<f32>(dimUV));
                        let y16 = textureLoad(texY, coordY, 0).x;
                        let uv16 = textureLoad(texUV, coordUV, 0);
                        let y10 = f32((y16 >> 6u) & 1023u) / 1023.0;
                        let u10 = f32((uv16.x >> 6u) & 1023u) / 1023.0;
                        let v10 = f32((uv16.y >> 6u) & 1023u) / 1023.0;
                        let y709 = max(y10 - conv.y_offset, 0.0) * conv.y_scale;
                        let u = (u10 - conv.c_offset) * conv.c_scale;
                        let v = (v10 - conv.c_offset) * conv.c_scale;
                        let r = y709 + 1.5748 * v;
                        let g = y709 - 0.1873 * u - 0.4681 * v;
                        let b = y709 + 1.8556 * u;
                        return vec4<f32>(r,g,b,1.0);
                    }
                "#;
                let module = device.create_shader_module(eframe::wgpu::ShaderModuleDescriptor { label: Some("p010_uint_shader"), source: eframe::wgpu::ShaderSource::Wgsl(shader_src.into()) });
                let tex_bgl = device.create_bind_group_layout(&eframe::wgpu::BindGroupLayoutDescriptor { label: Some("p010_uint_tex_bgl"), entries: &[eframe::wgpu::BindGroupLayoutEntry { binding: 0, visibility: eframe::wgpu::ShaderStages::FRAGMENT, ty: eframe::wgpu::BindingType::Texture { multisampled: false, view_dimension: eframe::wgpu::TextureViewDimension::D2, sample_type: eframe::wgpu::TextureSampleType::Uint }, count: None }, eframe::wgpu::BindGroupLayoutEntry { binding: 1, visibility: eframe::wgpu::ShaderStages::FRAGMENT, ty: eframe::wgpu::BindingType::Texture { multisampled: false, view_dimension: eframe::wgpu::TextureViewDimension::D2, sample_type: eframe::wgpu::TextureSampleType::Uint }, count: None }] });
                let uniform_bgl = device.create_bind_group_layout(&eframe::wgpu::BindGroupLayoutDescriptor { label: Some("p010_uint_uniform_bgl"), entries: &[eframe::wgpu::BindGroupLayoutEntry { binding: 0, visibility: eframe::wgpu::ShaderStages::FRAGMENT, ty: eframe::wgpu::BindingType::Buffer { ty: eframe::wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None }] });
                let pl = device.create_pipeline_layout(&eframe::wgpu::PipelineLayoutDescriptor { label: Some("p010_uint_pl"), bind_group_layouts: &[&tex_bgl, &uniform_bgl], push_constant_ranges: &[] });
                let pipeline = device.create_render_pipeline(&eframe::wgpu::RenderPipelineDescriptor { label: Some("p010_uint_pipeline"), layout: Some(&pl), vertex: eframe::wgpu::VertexState { module: &module, entry_point: "vs_main", compilation_options: eframe::wgpu::PipelineCompilationOptions::default(), buffers: &[] }, fragment: Some(eframe::wgpu::FragmentState { module: &module, entry_point: "fs_main", compilation_options: eframe::wgpu::PipelineCompilationOptions::default(), targets: &[Some(eframe::wgpu::ColorTargetState { format: eframe::wgpu::TextureFormat::Bgra8Unorm, blend: Some(eframe::wgpu::BlendState::ALPHA_BLENDING), write_mask: eframe::wgpu::ColorWrites::ALL })] }), primitive: eframe::wgpu::PrimitiveState::default(), depth_stencil: None, multisample: eframe::wgpu::MultisampleState::default(), multiview: None, cache: None });
                resources.insert(P010UintResources { pipeline, tex_bgl, uniform_bgl });
            }
            // Create P010 uint bind groups
            let view_y = self.y_tex.create_view(&eframe::wgpu::TextureViewDescriptor::default());
            let view_uv = self.uv_tex.create_view(&eframe::wgpu::TextureViewDescriptor::default());
            let tex_layout = &resources.get::<P010UintResources>().unwrap().tex_bgl;
            let tbg = device.create_bind_group(&eframe::wgpu::BindGroupDescriptor { label: Some("p010_uint_tex_bg"), layout: tex_layout, entries: &[eframe::wgpu::BindGroupEntry { binding: 0, resource: eframe::wgpu::BindingResource::TextureView(&view_y) }, eframe::wgpu::BindGroupEntry { binding: 1, resource: eframe::wgpu::BindingResource::TextureView(&view_uv) }] });
            resources.insert(P010UintTexBind(tbg));
            // Upload conv uniform
            // Use limited-range conversion for P010 uint (FFmpeg typically outputs limited-range)
            let (y_off, y_scale, c_off, c_scale) = (64.0/1023.0, 1.0/876.0, 512.0/1023.0, 1.0/896.0);
            #[repr(C)]
            #[derive(Clone, Copy)]
            struct ConvStd { y_offset: f32, y_scale: f32, c_offset: f32, c_scale: f32, _pad: [f32;2] }
            let conv = ConvStd { y_offset: y_off, y_scale, c_offset: c_off, c_scale, _pad: [0.0;2] };
            let ubuf = device.create_buffer(&eframe::wgpu::BufferDescriptor { label: Some("p010_uint_ubo"), size: std::mem::size_of::<ConvStd>() as u64, usage: eframe::wgpu::BufferUsages::UNIFORM | eframe::wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
            let bytes: &[u8] = unsafe { std::slice::from_raw_parts((&conv as *const ConvStd) as *const u8, std::mem::size_of::<ConvStd>()) };
            queue.write_buffer(&ubuf, 0, bytes);
            let uniform_layout = &resources.get::<P010UintResources>().unwrap().uniform_bgl;
            let ubg = device.create_bind_group(&eframe::wgpu::BindGroupDescriptor { label: Some("p010_uint_conv_bg"), layout: uniform_layout, entries: &[eframe::wgpu::BindGroupEntry { binding: 0, resource: eframe::wgpu::BindingResource::Buffer(eframe::wgpu::BufferBinding { buffer: &ubuf, offset: 0, size: None }) }] });
            resources.insert(P010UintConvBind(ubg));
            return Vec::new();
        }

        // Float NV12/P010 bind groups and uniform
        // Always refresh to avoid stale texture bindings during playback/scrub
        let y_id = Arc::as_ptr(&self.y_tex) as usize;
        let uv_id = Arc::as_ptr(&self.uv_tex) as usize;
        let view_y = self.y_tex.create_view(&eframe::wgpu::TextureViewDescriptor::default());
        let view_uv = self.uv_tex.create_view(&eframe::wgpu::TextureViewDescriptor::default());
        let (nv_bgl, nv_samp) = {
            let r = resources.get::<Nv12Resources>().unwrap();
            (&r.bind_group_layout, &r.sampler)
        };
        // Preview uniforms (w,h,mode)
        let mode_u32: u32 = match self.mode { PreviewShaderMode::Solid => 0, PreviewShaderMode::ShowY => 1, PreviewShaderMode::UvDebug => 2, PreviewShaderMode::Nv12 => 3 };
        let uni = PreviewUniforms { w: self.w as f32, h: self.h as f32, mode: mode_u32, _pad: 0 };
        let ubuf2 = device.create_buffer(&eframe::wgpu::BufferDescriptor {
            label: Some("preview_uniforms"),
            size: std::mem::size_of::<PreviewUniforms>() as u64,
            usage: eframe::wgpu::BufferUsages::UNIFORM | eframe::wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&ubuf2, 0, bytemuck::bytes_of(&uni));
        let bind = device.create_bind_group(&eframe::wgpu::BindGroupDescriptor {
            label: Some("preview_nv12_bg"),
            layout: nv_bgl,
            entries: &[
                eframe::wgpu::BindGroupEntry { binding: 0, resource: eframe::wgpu::BindingResource::Sampler(nv_samp) },
                eframe::wgpu::BindGroupEntry { binding: 1, resource: eframe::wgpu::BindingResource::TextureView(&view_y) },
                eframe::wgpu::BindGroupEntry { binding: 2, resource: eframe::wgpu::BindingResource::TextureView(&view_uv) },
                eframe::wgpu::BindGroupEntry { binding: 3, resource: eframe::wgpu::BindingResource::Buffer(eframe::wgpu::BufferBinding { buffer: &ubuf2, offset: 0, size: None }) },
            ],
        });
        tracing::debug!("NV12 bind-group refreshed ({}x{} / {}x{})", self.w, self.h, (self.w + 1)/2, (self.h + 1)/2);
        resources.insert(Nv12BindGroup { bind, y_id, uv_id });
        // BT.709 limited-range conversion parameters
        let (y_bias, y_scale, uv_bias, uv_scale) = match self.fmt {
            YuvPixFmt::Nv12 => (16.0/255.0, 255.0/219.0, 128.0/255.0, 255.0/224.0),
            YuvPixFmt::P010 => (64.0/1023.0, 1023.0/876.0, 512.0/1023.0, 1023.0/896.0),
        };
        #[repr(C)]
        #[derive(Clone, Copy)]
        struct ConvStd { y_bias: f32, y_scale: f32, uv_bias: f32, uv_scale: f32 }
        let conv = ConvStd { y_bias, y_scale, uv_bias, uv_scale };
        let ubuf = device.create_buffer(&eframe::wgpu::BufferDescriptor { label: Some("yuv_conv_ubo"), size: std::mem::size_of::<ConvStd>() as u64, usage: eframe::wgpu::BufferUsages::UNIFORM | eframe::wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let bytes: &[u8] = unsafe { std::slice::from_raw_parts((&conv as *const ConvStd) as *const u8, std::mem::size_of::<ConvStd>()) };
        queue.write_buffer(&ubuf, 0, bytes);
        let conv_layout = &resources.get::<Nv12Resources>().unwrap().uniform_bgl;
        let ubg = device.create_bind_group(&eframe::wgpu::BindGroupDescriptor { label: Some("yuv_conv_bg"), layout: conv_layout, entries: &[eframe::wgpu::BindGroupEntry { binding: 0, resource: eframe::wgpu::BindingResource::Buffer(eframe::wgpu::BufferBinding { buffer: &ubuf, offset: 0, size: None }) }] });
        resources.insert(ConvBindGroup(ubg));
        Vec::new()
    }

    fn paint(
        &self,
        _info: egui::PaintCallbackInfo,
        render_pass: &mut eframe::wgpu::RenderPass<'static>,
        resources: &eframe::egui_wgpu::CallbackResources,
    ) {
        if self.use_uint {
            let res = resources.get::<P010UintResources>().expect("p010 uint resources");
            let tbg = resources.get::<P010UintTexBind>().expect("p010 uint tex bg");
            let ubg = resources.get::<P010UintConvBind>().expect("p010 uint conv bg");
            render_pass.set_pipeline(&res.pipeline);
            render_pass.set_bind_group(0, &tbg.0, &[]);
            render_pass.set_bind_group(1, &ubg.0, &[]);
            render_pass.draw(0..3, 0..1);
        } else {
            let res = resources.get::<Nv12Resources>().expect("nv12 resources");
            let bg = resources.get::<Nv12BindGroup>().expect("nv12 bind group");
            let ubg = resources.get::<ConvBindGroup>().expect("conv bind group");
            // Validate presence before use
            assert!(resources.get::<Nv12BindGroup>().is_some(), "missing NV12 tex bind group");
            assert!(resources.get::<ConvBindGroup>().is_some(), "missing conv bind group");
            // Single pipeline; shader selects the mode via uniform
            render_pass.set_pipeline(&res.pipeline_nv12);
            render_pass.set_bind_group(0, &bg.bind, &[]);
            render_pass.set_bind_group(1, &ubg.0, &[]);
            render_pass.draw(0..3, 0..1);
        }
    }
}

struct ConvBindGroup(eframe::wgpu::BindGroup);

fn find_jpeg_frame(buf: &[u8]) -> Option<(usize, usize)> {
    // SOI 0xFFD8, EOI 0xFFD9
    let mut start = None;
    for i in 0..buf.len().saturating_sub(1) {
        if start.is_none() && buf[i] == 0xFF && buf[i+1] == 0xD8 { start = Some(i); }
        if let Some(s) = start {
            if buf[i] == 0xFF && buf[i+1] == 0xD9 { return Some((s, i+2)); }
        }
    }
    None
}

fn decode_to_color_image(bytes: &[u8]) -> Option<egui::ColorImage> {
    let img = image::load_from_memory(bytes).ok()?.to_rgba8();
    let (w,h) = img.dimensions();
    let data = img.into_raw();
    Some(egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &data))
}

    // Optimized video frame decode at native size (no scaling; GPU handles fit)
fn decode_video_frame_optimized(path: &str, t_sec: f64, w: u32, h: u32) -> Option<egui::ColorImage> {
    // Decode one frame at requested size to match GPU upload
    let frame_bytes = (w as usize) * (h as usize) * 4;
    let out = std::process::Command::new("ffmpeg")
        .arg("-ss").arg(format!("{:.3}", t_sec.max(0.0)))
        .arg("-i").arg(path)
        .arg("-frames:v").arg("1")
        .arg("-vf").arg(format!("scale={}x{}:flags=fast_bilinear", w, h))
        .arg("-f").arg("rawvideo")
        .arg("-pix_fmt").arg("rgba")
        .arg("-threads").arg("1")
        .arg("-")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output().ok()?;

    if !out.status.success() { return None; }
    if out.stdout.len() < frame_bytes { return None; }
    Some(egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &out.stdout[..frame_bytes]))
}

// Decode video frame using native decoder
fn decode_video_frame_native(path: &str, t_sec: f64, w: u32, h: u32) -> Option<egui::ColorImage> {
    let config = DecoderConfig {
        hardware_acceleration: true,
        preferred_format: Some(native_decoder::YuvPixFmt::Nv12),
        zero_copy: false, // Phase 1 only
    };
    
    match create_decoder(path, config) {
        Ok(mut decoder) => {
            match decoder.decode_frame(t_sec) {
                Ok(Some(video_frame)) => {
                    // Convert YUV to RGBA for egui::ColorImage
                    let rgba = yuv_to_rgba(&video_frame.y_plane, &video_frame.uv_plane, 
                                          video_frame.width, video_frame.height, video_frame.format);
                    
                    // Scale to requested size if needed
                    if video_frame.width == w && video_frame.height == h {
                        Some(egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &rgba))
                    } else {
                        // Simple nearest-neighbor scaling for now
                        let scaled = scale_rgba_nearest(&rgba, video_frame.width, video_frame.height, w, h);
                        Some(egui::ColorImage::from_rgba_unmultiplied([w as usize, h as usize], &scaled))
                    }
                }
                Ok(None) => {
                    eprintln!("Native decoder: No frame at timestamp {:.3}s", t_sec);
                    None
                }
                Err(e) => {
                    eprintln!("Native decoder error: {}", e);
                    None
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to create native decoder: {}", e);
            None
        }
    }
}

// Convert YUV to RGBA (simple implementation)
fn yuv_to_rgba(y_plane: &[u8], uv_plane: &[u8], width: u32, height: u32, format: native_decoder::YuvPixFmt) -> Vec<u8> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    
    match format {
        native_decoder::YuvPixFmt::Nv12 => {
            // NV12: Y plane + interleaved UV plane
            for y in 0..height as usize {
                for x in 0..width as usize {
                    let y_idx = y * width as usize + x;
                    let uv_idx = (y / 2) * width as usize + (x / 2) * 2;
                    
                    let y_val = y_plane[y_idx] as f32;
                    let u_val = uv_plane[uv_idx] as f32 - 128.0;
                    let v_val = uv_plane[uv_idx + 1] as f32 - 128.0;
                    
                    // YUV to RGB conversion (ITU-R BT.601)
                    let r = (y_val + 1.402 * v_val).clamp(0.0, 255.0) as u8;
                    let g = (y_val - 0.344136 * u_val - 0.714136 * v_val).clamp(0.0, 255.0) as u8;
                    let b = (y_val + 1.772 * u_val).clamp(0.0, 255.0) as u8;
                    
                    let rgba_idx = (y * width as usize + x) * 4;
                    rgba[rgba_idx] = r;
                    rgba[rgba_idx + 1] = g;
                    rgba[rgba_idx + 2] = b;
                    rgba[rgba_idx + 3] = 255; // Alpha
                }
            }
        }
        native_decoder::YuvPixFmt::P010 => {
            // P010: 10-bit YUV (simplified to 8-bit for now)
            for y in 0..height as usize {
                for x in 0..width as usize {
                    let y_idx = y * width as usize + x;
                    let uv_idx = (y / 2) * width as usize + (x / 2) * 2;
                    
                    // Convert 10-bit to 8-bit (shift right by 2)
                    let y_val = (y_plane[y_idx] as f32) * 4.0;
                    let u_val = (uv_plane[uv_idx] as f32) * 4.0 - 128.0;
                    let v_val = (uv_plane[uv_idx + 1] as f32) * 4.0 - 128.0;
                    
                    // YUV to RGB conversion
                    let r = (y_val + 1.402 * v_val).clamp(0.0, 255.0) as u8;
                    let g = (y_val - 0.344136 * u_val - 0.714136 * v_val).clamp(0.0, 255.0) as u8;
                    let b = (y_val + 1.772 * u_val).clamp(0.0, 255.0) as u8;
                    
                    let rgba_idx = (y * width as usize + x) * 4;
                    rgba[rgba_idx] = r;
                    rgba[rgba_idx + 1] = g;
                    rgba[rgba_idx + 2] = b;
                    rgba[rgba_idx + 3] = 255; // Alpha
                }
            }
        }
    }
    
    rgba
}

// Simple nearest-neighbor scaling
fn scale_rgba_nearest(src: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    let mut dst = vec![0u8; (dst_w * dst_h * 4) as usize];
    
    for y in 0..dst_h as usize {
        for x in 0..dst_w as usize {
            let src_x = (x as f32 * src_w as f32 / dst_w as f32) as usize;
            let src_y = (y as f32 * src_h as f32 / dst_h as f32) as usize;
            
            let src_idx = (src_y * src_w as usize + src_x) * 4;
            let dst_idx = (y * dst_w as usize + x) * 4;
            
            if src_idx + 3 < src.len() && dst_idx + 3 < dst.len() {
                dst[dst_idx] = src[src_idx];
                dst[dst_idx + 1] = src[src_idx + 1];
                dst[dst_idx + 2] = src[src_idx + 2];
                dst[dst_idx + 3] = src[src_idx + 3];
            }
        }
    }
    
    dst
}

// Decode a single frame to NV12 or P010 at native size.
fn decode_video_frame_yuv(path: &str, t_sec: f64) -> Option<(YuvPixFmt, Vec<u8>, Vec<u8>, u32, u32)> {
    let info = media_io::probe_media(std::path::Path::new(path)).ok()?;
    let w = info.width?;
    let h = info.height?;
    // Try P010 first
    let out10 = std::process::Command::new("ffmpeg")
        .arg("-ss").arg(format!("{:.3}", t_sec.max(0.0)))
        .arg("-i").arg(path)
        .arg("-frames:v").arg("1")
        .arg("-f").arg("rawvideo")
        .arg("-pix_fmt").arg("p010le")
        .arg("-threads").arg("1")
        .arg("-")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output().ok()?;
    if out10.status.success() {
        let exp10 = (w as usize) * (h as usize) * 3; // Y:2 bytes * w*h ; UV: w*h bytes (2x16-bit at half res)
        if out10.stdout.len() >= exp10 {
            let y_bytes = (w as usize) * (h as usize) * 2;
            let y = out10.stdout[..y_bytes].to_vec();
            let uv = out10.stdout[y_bytes..y_bytes + (exp10 - y_bytes)].to_vec();
            return Some((YuvPixFmt::P010, y, uv, w, h));
        }
    }
    // Fallback NV12
    let expected = (w as usize) * (h as usize) + (w as usize) * (h as usize) / 2;
    let out = std::process::Command::new("ffmpeg")
        .arg("-ss").arg(format!("{:.3}", t_sec.max(0.0)))
        .arg("-i").arg(path)
        .arg("-frames:v").arg("1")
        .arg("-f").arg("rawvideo")
        .arg("-pix_fmt").arg("nv12")
        .arg("-threads").arg("1")
        .arg("-")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output().ok()?;
    if !out.status.success() || out.stdout.len() < expected { return None; }
    let y_size = (w as usize) * (h as usize);
    let y = out.stdout[..y_size].to_vec();
    let uv = out.stdout[y_size..y_size + (expected - y_size)].to_vec();
    Some((YuvPixFmt::Nv12, y, uv, w, h))
}

fn decode_video_frame_nv12_only(path: &str, t_sec: f64) -> Option<(YuvPixFmt, Vec<u8>, Vec<u8>, u32, u32)> {
    let info = media_io::probe_media(std::path::Path::new(path)).ok()?;
    let w = info.width?; let h = info.height?;
    let expected = (w as usize) * (h as usize) + (w as usize) * (h as usize) / 2;
    let out = std::process::Command::new("ffmpeg")
        .arg("-ss").arg(format!("{:.3}", t_sec.max(0.0)))
        .arg("-i").arg(path)
        .arg("-frames:v").arg("1")
        .arg("-f").arg("rawvideo")
        .arg("-pix_fmt").arg("nv12")
        .arg("-threads").arg("1")
        .arg("-")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output().ok()?;
    if !out.status.success() || out.stdout.len() < expected { return None; }
    let y_size = (w as usize) * (h as usize);
    let y = out.stdout[..y_size].to_vec();
    let uv = out.stdout[y_size..y_size + (expected - y_size)].to_vec();
    Some((YuvPixFmt::Nv12, y, uv, w, h))
}

pub(crate) fn device_supports_16bit_norm(rs: &eframe::egui_wgpu::RenderState) -> bool {
    rs.device.features().contains(eframe::wgpu::Features::TEXTURE_FORMAT_16BIT_NORM)
}

fn align_to(v: usize, align: usize) -> usize { ((v + align - 1) / align) * align }

#[derive(Clone)]
struct Nv12Frame { fmt: YuvPixFmt, y: Vec<u8>, uv: Vec<u8>, w: u32, h: u32 }

// Using media_io::YuvPixFmt

// Optimized image decoding
fn decode_image_optimized(path: &str, w: u32, h: u32) -> Option<egui::ColorImage> {
    // For images, use the image crate directly for better performance
    let img = image::open(path).ok()?;
    let resized = img.resize(w, h, image::imageops::FilterType::Lanczos3);
    let rgba = resized.to_rgba8();
    let (width, height) = rgba.dimensions();
    
    Some(egui::ColorImage::from_rgba_unmultiplied(
        [width as usize, height as usize], 
        &rgba.into_raw()
    ))
}

// LRU eviction for frame cache
fn evict_lru_frames(cache: &mut HashMap<FrameCacheKey, CachedFrame>, count: usize) {
    if cache.len() <= count { return; }
    
    // Collect frames with their last access times
    let mut frames_with_time: Vec<(FrameCacheKey, std::time::Instant)> = cache
        .iter()
        .map(|(key, frame)| (key.clone(), frame.last_access))
        .collect();
    
    // Sort by last access time (oldest first)
    frames_with_time.sort_by_key(|(_, time)| *time);
    
    // Remove the oldest frames
    for (key, _) in frames_with_time.into_iter().take(count) {
        cache.remove(&key);
    }
}

fn grab_frame_at(path: &str, size: (u32,u32), t_sec: f64) -> Option<egui::ColorImage> {
    let (w,h) = size;
    decode_video_frame_optimized(path, t_sec, w, h)
}

// Efficient frame cache key
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct FrameCacheKey {
    pub(crate) path: String,
    pub(crate) time_sec: u32, // Rounded to nearest 0.1 second for cache efficiency
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl FrameCacheKey {
    pub(crate) fn new(path: &str, time_sec: f64, width: u32, height: u32) -> Self {
        Self {
            path: path.to_string(),
            time_sec: (time_sec * 10.0).round() as u32, // 0.1 second precision
            width,
            height,
        }
    }
}

// Cached frame with metadata
#[derive(Clone)]
struct CachedFrame {
    pub(crate) image: egui::ColorImage,
    pub(crate) decoded_at: std::time::Instant,
    pub(crate) access_count: u32,
    pub(crate) last_access: std::time::Instant,
}

// Frame buffer used by the preview scheduler (kept for compatibility)
struct FrameBuffer {
    pub(crate) pts: f64,
    pub(crate) w: u32,
    pub(crate) h: u32,
    pub(crate) bytes: Vec<u8>,
}

// (removed legacy standalone WGPU context to avoid mixed versions)
