// Blending shader with multiple blend modes
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) tex_coords: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
}

struct BlendUniforms {
    opacity: f32,
    blend_mode: u32,
    _padding: vec2<f32>,
}

@group(0) @binding(0)
var base_texture: texture_2d<f32>;
@group(0) @binding(1)
var overlay_texture: texture_2d<f32>;
@group(0) @binding(2)
var texture_sampler: sampler;

@group(1) @binding(0)
var<uniform> uniforms: BlendUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = vec4<f32>(input.position, 0.0, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

fn blend_normal(base: vec3<f32>, overlay: vec3<f32>) -> vec3<f32> {
    return overlay;
}

fn blend_multiply(base: vec3<f32>, overlay: vec3<f32>) -> vec3<f32> {
    return base * overlay;
}

fn blend_screen(base: vec3<f32>, overlay: vec3<f32>) -> vec3<f32> {
    return 1.0 - (1.0 - base) * (1.0 - overlay);
}

fn blend_overlay(base: vec3<f32>, overlay: vec3<f32>) -> vec3<f32> {
    let result = select(
        2.0 * base * overlay,
        1.0 - 2.0 * (1.0 - base) * (1.0 - overlay),
        base < 0.5
    );
    return result;
}

fn blend_soft_light(base: vec3<f32>, overlay: vec3<f32>) -> vec3<f32> {
    let result = select(
        base - (1.0 - 2.0 * overlay) * base * (1.0 - base),
        base + (2.0 * overlay - 1.0) * (sqrt(base) - base),
        overlay < 0.5
    );
    return result;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let base = textureSample(base_texture, texture_sampler, input.tex_coords);
    let overlay = textureSample(overlay_texture, texture_sampler, input.tex_coords);
    
    var blended: vec3<f32>;
    
    switch uniforms.blend_mode {
        case 0u: { // Normal
            blended = blend_normal(base.rgb, overlay.rgb);
        }
        case 1u: { // Multiply
            blended = blend_multiply(base.rgb, overlay.rgb);
        }
        case 2u: { // Screen
            blended = blend_screen(base.rgb, overlay.rgb);
        }
        case 3u: { // Overlay
            blended = blend_overlay(base.rgb, overlay.rgb);
        }
        case 4u: { // Soft Light
            blended = blend_soft_light(base.rgb, overlay.rgb);
        }
        default: {
            blended = blend_normal(base.rgb, overlay.rgb);
        }
    }
    
    // Apply opacity and alpha blending
    let final_alpha = overlay.a * uniforms.opacity;
    let result = mix(base.rgb, blended, final_alpha);
    
    return vec4<f32>(result, max(base.a, final_alpha));
}
