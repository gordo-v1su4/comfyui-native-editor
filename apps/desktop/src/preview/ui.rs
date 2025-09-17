use std::sync::Arc;

use eframe::{egui, egui_wgpu};

use crate::decode::{DecodeCmd, FramePayload, PlayState, VideoProps};
use crate::preview::{visual_source_at, PreviewShaderMode, PreviewState, PreviewYuvCallback};
use crate::preview::state::device_supports_16bit_norm;
use crate::App;
use media_io::YuvPixFmt;

impl App {
    pub(crate) fn render_cpu_frame(
        &mut self,
        rs: &eframe::egui_wgpu::RenderState,
        rect: egui::Rect,
        props: &VideoProps,
        y: &Arc<[u8]>,
        uv: &Arc<[u8]>,
    ) -> Option<egui::PaintCallback> {
        let (fmt, ytex, uvtex) = self
            .preview
            .present_yuv_from_bytes(rs, props.fmt, y.as_ref(), uv.as_ref(), props.w, props.h)?;
        let use_uint = matches!(fmt, YuvPixFmt::P010) && !device_supports_16bit_norm(rs);
        Some(egui_wgpu::Callback::new_paint_callback(
            rect,
            PreviewYuvCallback { y_tex: ytex, uv_tex: uvtex, fmt, use_uint, w: props.w, h: props.h, mode: self.preview.shader_mode },
        ))
    }

    pub(crate) fn preview_ui(&mut self, ctx: &egui::Context, frame: &eframe::Frame, ui: &mut egui::Ui) {
        // Determine current visual source at playhead (lock to exact frame)
        let fps = self.seq.fps.num.max(1) as f64 / self.seq.fps.den.max(1) as f64;
        let t_playhead = self.playback_clock.now();
        let playhead_frame = if self.engine.state == PlayState::Playing {
            (t_playhead * fps).floor() as i64
        } else {
            (t_playhead * fps).round() as i64
        };
        self.playhead = playhead_frame;
        let target_ts = (playhead_frame as f64) / fps;
        let source = visual_source_at(&self.seq.graph, self.playhead);

        // Debug: shader mode toggle for YUV preview
        ui.horizontal(|ui| {
            ui.label("Shader:");
            let mode = &mut self.preview.shader_mode;
            let solid = matches!(*mode, PreviewShaderMode::Solid);
            if ui.selectable_label(solid, "Solid").clicked() { *mode = PreviewShaderMode::Solid; ctx.request_repaint(); }
            let showy = matches!(*mode, PreviewShaderMode::ShowY);
            if ui.selectable_label(showy, "Y").clicked() { *mode = PreviewShaderMode::ShowY; ctx.request_repaint(); }
            let uvd = matches!(*mode, PreviewShaderMode::UvDebug);
            if ui.selectable_label(uvd, "UV").clicked() { *mode = PreviewShaderMode::UvDebug; ctx.request_repaint(); }
            let nv12 = matches!(*mode, PreviewShaderMode::Nv12);
            if ui.selectable_label(nv12, "NV12").clicked() { *mode = PreviewShaderMode::Nv12; ctx.request_repaint(); }
        });
        // Hotkeys 1/2/3
        if ui.input(|i| i.key_pressed(egui::Key::Num1)) { self.preview.shader_mode = PreviewShaderMode::Solid; ctx.request_repaint(); }
        if ui.input(|i| i.key_pressed(egui::Key::Num2)) { self.preview.shader_mode = PreviewShaderMode::ShowY; ctx.request_repaint(); }
        if ui.input(|i| i.key_pressed(egui::Key::Num3)) { self.preview.shader_mode = PreviewShaderMode::UvDebug; ctx.request_repaint(); }
        if ui.input(|i| i.key_pressed(egui::Key::Num4)) { self.preview.shader_mode = PreviewShaderMode::Nv12; ctx.request_repaint(); }

        // Layout: reserve a 16:9 box or fit available space
        let avail = ui.available_size();
        let mut w = avail.x.max(320.0);
        let mut h = (w * 9.0 / 16.0).round();
        if h > avail.y { h = avail.y; w = (h * 16.0 / 9.0).round(); }
        let desired = (w as u32, h as u32);

        // Playback progression handled by PlaybackClock (no speed-up)

        // Draw
        let (rect, _resp) = ui.allocate_exact_size(egui::vec2(w, h), egui::Sense::hover());
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 4.0, egui::Color32::from_rgb(12, 12, 12));
        
        // Use persistent decoder with prefetch
        // Solid/text generators fallback
        if let Some(src) = source.as_ref() {
            if src.path.starts_with("solid:") {
                let hex = src.path.trim_start_matches("solid:");
                let color = crate::timeline::ui::parse_hex_color(hex).unwrap_or(egui::Color32::from_rgb(80, 80, 80));
                painter.rect_filled(rect, 4.0, color);
                return;
            }
            if src.path.starts_with("text://") {
                painter.rect_filled(rect, 4.0, egui::Color32::from_rgb(20, 20, 20));
                painter.text(
                    rect.center(),
                    egui::Align2::CENTER_CENTER,
                    "Text Generator",
                    egui::FontId::proportional(24.0),
                    egui::Color32::WHITE,
                );
                return;
            }
        }

        let Some(src) = source else {
            painter.text(rect.center(), egui::Align2::CENTER_CENTER, "No Preview", egui::FontId::proportional(16.0), egui::Color32::GRAY);
            return;
        };
        let Some(rs) = frame.wgpu_render_state() else {
            painter.text(rect.center(), egui::Align2::CENTER_CENTER, "No WGPU state", egui::FontId::proportional(16.0), egui::Color32::GRAY);
            return;
        };

        let (active_path, media_t) = self
            .active_video_media_time_graph(t_playhead)
            .unwrap_or_else(|| (src.path.clone(), t_playhead));
        self.engine.target_pts = media_t;
        self.decode_mgr.ensure_worker(&active_path);

        // Debounce decode commands
        let fps_seq = (self.seq.fps.num.max(1) as f64) / (self.seq.fps.den.max(1) as f64);
        let seek_bucket = (media_t * fps_seq).round() as i64;
        let k = match self.engine.state {
            PlayState::Playing => (self.engine.state, active_path.clone(), None),
            _ => (self.engine.state, active_path.clone(), Some(seek_bucket)),
        };
        if self.last_sent != Some(k.clone()) {
            match self.engine.state {
                PlayState::Playing => {
                    let _ = self.decode_mgr.send_cmd(&active_path, DecodeCmd::Play { start_pts: media_t, rate: self.engine.rate });
                }
                PlayState::Scrubbing | PlayState::Seeking | PlayState::Paused => {
                    let _ = self.decode_mgr.send_cmd(&active_path, DecodeCmd::Seek { target_pts: media_t });
                }
            }
            if self.engine.state == PlayState::Scrubbing { ctx.request_repaint(); }
            self.last_sent = Some(k);
        }

        // Drain worker and pick latest frame
        let newest = self.decode_mgr.take_latest(&active_path);
        let tol = {
            let fps = (self.seq.fps.num.max(1) as f64) / (self.seq.fps.den.max(1) as f64);
            let frame_dur = if fps > 0.0 { 1.0 / fps } else { 1.0 / 30.0 };
            (0.5 * frame_dur).max(0.012)
        };
        let picked = if matches!(self.engine.state, PlayState::Playing) {
            newest
        } else {
            newest.filter(|f| (f.pts - media_t).abs() <= tol)
        };

        if let Some(frame_out) = picked {
            if let FramePayload::Cpu { y, uv } = &frame_out.payload {
                if let Some(cb) = self.render_cpu_frame(rs, rect, &frame_out.props, y, uv) {
                    ui.painter().add(cb);
                }
            }
        } else if let Some((fmt, y_tex, uv_tex)) = self.preview.current_plane_textures() {
            let use_uint = matches!(fmt, YuvPixFmt::P010) && !device_supports_16bit_norm(rs);
            let cb = egui_wgpu::Callback::new_paint_callback(
                rect,
                PreviewYuvCallback { y_tex, uv_tex, fmt, use_uint, w: self.preview.y_size.0, h: self.preview.y_size.1, mode: self.preview.shader_mode },
            );
            ui.painter().add(cb);
        } else {
            painter.text(rect.center(), egui::Align2::CENTER_CENTER, "Waiting for frame…", egui::FontId::proportional(16.0), egui::Color32::GRAY);
        }
    }
}
