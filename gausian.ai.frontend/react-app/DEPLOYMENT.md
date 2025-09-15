# Deployment Guide

## Environment Variables

### For Vercel Frontend Deployment

Set these environment variables in your Vercel dashboard:

```
VITE_API_BASE_URL=https://your-backend-url.ngrok.io
VITE_WS_BASE_URL=https://your-backend-url.ngrok.io
VITE_CLOUDFLARE_TUNNEL_URL=https://your-tunnel-url.trycloudflare.com
```

**Priority Order:**

1. `VITE_API_BASE_URL` - Specific API endpoint (highest priority)
2. `VITE_CLOUDFLARE_TUNNEL_URL` - Cloudflare tunnel URL (fallback)
3. `VITE_WS_BASE_URL` - Specific WebSocket endpoint (for WebSocket connections)
4. `window.location.origin` - Current domain (automatic fallback)
5. `http://localhost:3001` - Development fallback (lowest priority)

### For Local Development

Create a `.env` file in the `react-app` directory:

```
VITE_API_BASE_URL=http://localhost:3001
VITE_WS_BASE_URL=http://localhost:3001
VITE_CLOUDFLARE_TUNNEL_URL=http://localhost:3001
```

## Backend CORS Configuration

Update the CORS origins in `server.js` to include your Vercel domain:

```javascript
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://your-actual-app.vercel.app", // Replace with your actual domain
  "https://*.vercel.app",
];
```

## API Usage

The new `api.js` provides organized API methods:

```javascript
import { projectAPI, videoGenerationAPI, mediaAPI, wsAPI } from "./api";

// Projects
const projects = await projectAPI.getAll();
const project = await projectAPI.create({ name: "My Project" });

// Video Generation
await videoGenerationAPI.generate(projectId, generationData);

// Media
await mediaAPI.uploadVideo(formData);

// WebSocket
const socket = wsAPI.connect(projectId);
```

## Migration from Hardcoded URLs

All components now use the centralized API client instead of hardcoded `http://localhost:3001` URLs. The API client automatically handles:

- Environment-based URL switching
- Error handling
- Request/response formatting
- WebSocket connections
- File uploads

## Cloudflare Tunnel Updates

When your Cloudflare tunnel URL changes:

1. **Update Vercel environment variable**: Change `VITE_CLOUDFLARE_TUNNEL_URL`
2. **Redeploy**: The app will automatically use the new URL
3. **No code changes needed**: All components automatically use the new tunnel URL

## Troubleshooting

1. **CORS Errors**: Ensure your backend CORS configuration includes your Vercel domain
2. **WebSocket Connection**: Verify your tunnel service supports WebSockets
3. **Environment Variables**: Check that Vercel environment variables are set correctly
4. **Backend URL**: Ensure your exposed backend URL is accessible from the internet
5. **Tunnel URL Changes**: Use `VITE_CLOUDFLARE_TUNNEL_URL` for easy tunnel updates
