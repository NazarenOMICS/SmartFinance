import type { Upload } from "@smartfinance/contracts";
import { getRuntimeEnv, type ApiBindings } from "../env";

type UploadBucket = NonNullable<ApiBindings["UPLOADS_BUCKET"]>;

function getBucket(env: ApiBindings): UploadBucket | null {
  return env.UPLOADS_BUCKET || null;
}

function storageMode(env: ApiBindings) {
  return getRuntimeEnv(env).UPLOAD_BINARY_STORAGE;
}

export async function storeUploadBinary(
  env: ApiBindings,
  upload: Pick<Upload, "storage_key" | "mime_type">,
  content: Blob | ArrayBuffer,
) {
  if (storageMode(env) !== "r2") {
    return { stored: false as const, reason: "storage_disabled" as const };
  }

  const bucket = getBucket(env);
  if (!bucket) {
    return { stored: false as const, reason: "missing_bucket" as const };
  }

  await bucket.put(upload.storage_key, content, {
    httpMetadata: {
      contentType: upload.mime_type || "application/octet-stream",
    },
  });

  return { stored: true as const };
}

export async function getUploadBinary(env: ApiBindings, storageKey: string) {
  if (storageMode(env) !== "r2") {
    return { found: false as const, reason: "storage_disabled" as const };
  }

  const bucket = getBucket(env);
  if (!bucket) {
    return { found: false as const, reason: "missing_bucket" as const };
  }

  const object = await bucket.get(storageKey);
  if (!object) {
    return { found: false as const, reason: "missing_object" as const };
  }

  return {
    found: true as const,
    object,
  };
}
