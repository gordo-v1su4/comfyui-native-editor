// YUV to RGB conversion shader
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) tex_coords: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
}

struct ColorUniforms {
    color_matrix: mat4x4<f32>,
    brightness: f32,
    contrast: f32,
    saturation: f32,
    hue: f32,
}

@group(0) @binding(0)
var y_texture: texture_2d<f32>;
@group(0) @binding(1)
var y_sampler: sampler;

@group(1) @binding(0)
var<uniform> uniforms: ColorUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = vec4<f32>(input.position, 0.0, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let y = textureSample(y_texture, y_sampler, input.tex_coords).r;
    
    // For simplicity, this assumes we have Y-only input and converts to grayscale
    // In a full implementation, you would have separate U and V textures
    let yuv = vec3<f32>(y, 0.5, 0.5); // Neutral chroma for grayscale
    
    // Apply YUV to RGB conversion matrix
    let rgb = (uniforms.color_matrix * vec4<f32>(yuv, 1.0)).rgb;
    
    // Apply brightness and contrast
    let adjusted = (rgb - 0.5) * uniforms.contrast + 0.5 + uniforms.brightness;
    
    return vec4<f32>(clamp(adjusted, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
