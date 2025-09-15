// Transform shader for 2D transformations (scale, rotate, translate)
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) tex_coords: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
}

struct TransformUniforms {
    matrix: mat4x4<f32>,
    opacity: f32,
    _padding: vec3<f32>,
}

@group(0) @binding(0)
var input_texture: texture_2d<f32>;
@group(0) @binding(1)
var input_sampler: sampler;

@group(1) @binding(0)
var<uniform> uniforms: TransformUniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    // Apply transformation matrix to vertex position
    let transformed = uniforms.matrix * vec4<f32>(input.position, 0.0, 1.0);
    out.clip_position = transformed;
    out.tex_coords = input.tex_coords;
    
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(input_texture, input_sampler, input.tex_coords);
    return vec4<f32>(color.rgb, color.a * uniforms.opacity);
}
