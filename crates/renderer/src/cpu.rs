use anyhow::{anyhow, Result};

use crate::{ColorSpace, PixelFormat};

pub fn convert_yuv_to_rgba(
    pixel_format: PixelFormat,
    color_space: ColorSpace,
    width: u32,
    height: u32,
    y_plane: &[u8],
    uv_plane: &[u8],
) -> Result<Vec<u8>> {
    match color_space {
        ColorSpace::Rec709 => {}
        _ => return Err(anyhow!("unsupported color space {:?}", color_space)),
    }

    match pixel_format {
        PixelFormat::Nv12 => convert_nv12(width, height, y_plane, uv_plane),
        PixelFormat::P010 => convert_p010(width, height, y_plane, uv_plane),
        _ => Err(anyhow!("unsupported pixel format {:?}", pixel_format)),
    }
}

fn convert_nv12(width: u32, height: u32, y_plane: &[u8], uv_plane: &[u8]) -> Result<Vec<u8>> {
    let expected_y = (width as usize) * (height as usize);
    let expected_uv = (width as usize) * (height as usize) / 2;
    if y_plane.len() != expected_y {
        return Err(anyhow!(
            "nv12 y-plane size mismatch: expected {}, got {}",
            expected_y,
            y_plane.len()
        ));
    }
    if uv_plane.len() != expected_uv {
        return Err(anyhow!(
            "nv12 uv-plane size mismatch: expected {}, got {}",
            expected_uv,
            uv_plane.len()
        ));
    }

    let mut out = vec![0u8; expected_y * 4];
    let width_usize = width as usize;
    let height_usize = height as usize;

    for y in 0..height_usize {
        for x in 0..width_usize {
            let y_idx = y * width_usize + x;
            let uv_row = y / 2;
            let uv_col = x / 2;
            let uv_idx = uv_row * width_usize + uv_col * 2;

            let y_sample = y_plane[y_idx] as f32 / 255.0;
            let u_sample = uv_plane[uv_idx] as f32 / 255.0;
            let v_sample = uv_plane[uv_idx + 1] as f32 / 255.0;

            let y = (y_sample - 16.0 / 255.0) * (255.0 / 219.0);
            let u = (u_sample - 128.0 / 255.0) * (255.0 / 224.0);
            let v = (v_sample - 128.0 / 255.0) * (255.0 / 224.0);

            let r = clamp01(y + 1.5748 * v);
            let g = clamp01(y - 0.1873 * u - 0.4681 * v);
            let b = clamp01(y + 1.8556 * u);

            let base = y_idx * 4;
            out[base] = (r * 255.0).round().clamp(0.0, 255.0) as u8;
            out[base + 1] = (g * 255.0).round().clamp(0.0, 255.0) as u8;
            out[base + 2] = (b * 255.0).round().clamp(0.0, 255.0) as u8;
            out[base + 3] = 255;
        }
    }

    Ok(out)
}

fn convert_p010(width: u32, height: u32, y_plane: &[u8], uv_plane: &[u8]) -> Result<Vec<u8>> {
    let samples = (width as usize) * (height as usize);
    let expected_y = samples * 2; // 16-bit per sample
    let expected_uv = samples * 2 / 2; // 4 bytes per 2 pixels => width*height
    if y_plane.len() != expected_y {
        return Err(anyhow!(
            "p010 y-plane size mismatch: expected {}, got {}",
            expected_y,
            y_plane.len()
        ));
    }
    if uv_plane.len() != expected_uv {
        return Err(anyhow!(
            "p010 uv-plane size mismatch: expected {}, got {}",
            expected_uv,
            uv_plane.len()
        ));
    }

    let mut out = vec![0u8; samples * 4];
    let width_usize = width as usize;
    let height_usize = height as usize;

    for y in 0..height_usize {
        for x in 0..width_usize {
            let y_idx = y * width_usize + x;
            let y_byte = y_idx * 2;
            let y16 = u16::from_le_bytes([y_plane[y_byte], y_plane[y_byte + 1]]);
            let y10 = ((y16 >> 6) & 0x03FF) as f32 / 1023.0;

            let uv_row = y / 2;
            let uv_col = x / 2;
            let uv_byte = (uv_row * width_usize + uv_col * 2) * 2;
            let u16 = u16::from_le_bytes([uv_plane[uv_byte], uv_plane[uv_byte + 1]]);
            let v16 = u16::from_le_bytes([uv_plane[uv_byte + 2], uv_plane[uv_byte + 3]]);
            let u10 = ((u16 >> 6) & 0x03FF) as f32 / 1023.0;
            let v10 = ((v16 >> 6) & 0x03FF) as f32 / 1023.0;

            let y = (y10 - 64.0 / 1023.0) * (1023.0 / 876.0);
            let u = (u10 - 512.0 / 1023.0) * (1023.0 / 896.0);
            let v = (v10 - 512.0 / 1023.0) * (1023.0 / 896.0);

            let r = clamp01(y + 1.5748 * v);
            let g = clamp01(y - 0.1873 * u - 0.4681 * v);
            let b = clamp01(y + 1.8556 * u);

            let base = y_idx * 4;
            out[base] = (r * 255.0).round().clamp(0.0, 255.0) as u8;
            out[base + 1] = (g * 255.0).round().clamp(0.0, 255.0) as u8;
            out[base + 2] = (b * 255.0).round().clamp(0.0, 255.0) as u8;
            out[base + 3] = 255;
        }
    }

    Ok(out)
}

fn clamp01(value: f32) -> f32 {
    value.max(0.0).min(1.0)
}
