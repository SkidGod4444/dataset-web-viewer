import { S3Client } from "@aws-sdk/client-s3";

export const R2_BUCKET = process.env.R2_BUCKET ?? "";

const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";

/** Whether all required R2 env vars are present. */
export const r2Configured = Boolean(
  endpoint && accessKeyId && secretAccessKey && R2_BUCKET,
);

/**
 * Cloudflare R2 speaks the S3 API, so we use the AWS S3 client pointed at the
 * R2 endpoint. Region must be "auto" for R2. Credentials stay on the server.
 */
export const r2 = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});
