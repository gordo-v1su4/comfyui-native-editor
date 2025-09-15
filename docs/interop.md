# Skia + wgpu Interop Design

Goals: draw Skia overlays in the same GPU pipeline as video compositing with minimal copies. Priority order: Metal → D3D12 → Vulkan. Fallback: one extra composite pass.

## Rendering Order
- Video compositing (wgpu)
- Skia overlays (Skia)
- Final composite and present

## Capability Probe
- Backend (Metal/D3D12/Vulkan)
- Surface format: prefer BGRA8UnormSrgb
- Sample count: 1
- Try native interop; on failure enable fallback

## Metal (Priority 1)
- Format: MTLPixelFormatBGRA8Unorm_sRGB
- Create `GrDirectContext` via `skia-safe` Metal backend
- Wrap wgpu’s `MTLTexture` as Skia `mtl::BackendRenderTarget`
- Sync: command buffer boundaries and/or shared events
- Fallback: Skia renders to its own texture; wgpu composites both

## D3D12 (Priority 2)
- Wrap `ID3D12Resource` as Skia `d3d::BackendRenderTarget`
- Sync with `ID3D12Fence`; resource state transitions between RENDER_TARGET and PIXEL_SHADER_RESOURCE
- Fallback: offscreen + composite pass

## Vulkan (Priority 3)
- Wrap `VkImage` as Skia `vk::BackendRenderTarget`
- Sync: export/import semaphores; handle image layout transitions
- Fallback: offscreen + composite pass

## Safety/Versioning
- Interop behind `unsafe-interop` feature
- Pin tested wgpu + Skia versions
- Diagnostics HUD in dev builds: interop mode, frame time

## Text/Vector Stack
- Skia Paragraph for shaping, font fallback from system
- Atlas for labels/ticks, instanced draws to minimize state changes
