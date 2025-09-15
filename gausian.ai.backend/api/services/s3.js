// api/services/s3.js
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.S3_BUCKET || null;
const ENDPOINT = process.env.S3_ENDPOINT || null; // e.g., https://s3.us-east-1.amazonaws.com or MinIO endpoint
const FORCE_PATH_STYLE = /^true$/i.test(process.env.S3_FORCE_PATH_STYLE || "false");
const PUBLIC_BASE = process.env.S3_PUBLIC_URL_BASE || null; // override for public URL base
const ACL = process.env.S3_ACL || "public-read"; // set bucket policy accordingly
const PRESIGN_EXPIRES = Number(process.env.S3_PRESIGN_EXPIRES || 3600); // 1h default

let _client = null;
export function getS3Client() {
  // Clear cache to ensure fresh client with updated endpoint
  _client = null;
  if (_client) return _client;
  
  // Backblaze B2 specific configuration
  const isBackblaze = ENDPOINT && ENDPOINT.includes('backblazeb2.com');
  
  // Ensure endpoint has proper protocol
  let endpoint = ENDPOINT;
  if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = `https://${endpoint}`;
  }
  
  _client = new S3Client({
    region: REGION,
    endpoint: endpoint || undefined,
    forcePathStyle: isBackblaze ? true : FORCE_PATH_STYLE, // Backblaze requires path-style
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
    // Backblaze B2 specific settings
    ...(isBackblaze && {
      maxAttempts: 3,
      retryMode: 'adaptive',
    }),
  });
  return _client;
}

export async function uploadBufferToS3({ key, body, contentType }) {
  if (!BUCKET) throw new Error("S3_BUCKET not configured");
  const client = getS3Client();
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || "application/octet-stream",
    ACL,
  });
  await client.send(cmd);
  return {
    bucket: BUCKET,
    key,
    remote_url: publicUrlForKey(key),
  };
}

export function publicUrlForKey(key) {
  // If overridden by env
  if (PUBLIC_BASE) return `${PUBLIC_BASE.replace(/\/$/, "")}/${encodeKey(key)}`;
  
  // Backblaze B2 specific handling
  const isBackblaze = ENDPOINT && ENDPOINT.includes('backblazeb2.com');
  if (isBackblaze) {
    // Backblaze B2 uses a different URL format: https://f005.backblazeb2.com/file/{bucket}/{key}
    const backblazeEndpoint = ENDPOINT.replace('s3.', '').replace('/s3/', '/file/');
    return `${backblazeEndpoint}/${BUCKET}/${encodeKey(key)}`;
  }
  
  // If custom endpoint and path-style
  if (ENDPOINT && FORCE_PATH_STYLE) {
    return `${ENDPOINT.replace(/\/$/, "")}/${encodeURIComponent(BUCKET)}/${encodeKey(key)}`;
  }
  
  // Default AWS virtual-hosted-style URL
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${encodeKey(key)}`;
}

function encodeKey(k) {
  return String(k).split("/").map(encodeURIComponent).join("/");
}

export function isS3Configured() {
  return !!BUCKET;
}

export async function presignPutUrl({ key, contentType, expiresIn = PRESIGN_EXPIRES }) {
  if (!BUCKET) throw new Error("S3_BUCKET not configured");
  const client = getS3Client();
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType || undefined, ACL });
  const url = await getSignedUrl(client, cmd, { expiresIn });
  return { url, key, method: "PUT", headers: contentType ? { "content-type": contentType } : {} };
}

export async function presignGetUrl({ key, expiresIn = PRESIGN_EXPIRES }) {
  if (!BUCKET) throw new Error("S3_BUCKET not configured");
  
  try {
    const client = getS3Client();
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    
    console.log(`[S3] Generating presigned URL for key: ${key}`);
    console.log(`[S3] Bucket: ${BUCKET}, Region: ${REGION}, Endpoint: ${ENDPOINT}`);
    
    const url = await getSignedUrl(client, cmd, { expiresIn });
    
    console.log(`[S3] Successfully generated presigned URL: ${url.substring(0, 100)}...`);
    return { url, key, expiresIn };
  } catch (error) {
    console.error(`[S3] Failed to generate presigned URL for key: ${key}`, error);
    throw new Error(`Presigned URL generation failed: ${error.message}`);
  }
}
