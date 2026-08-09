import type {Readable} from "node:stream";
import {GetObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {Upload} from "@aws-sdk/lib-storage";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";

export type ObjectBody = Readable | Uint8Array | Blob | string;

export type ObjectStore = {
  bucket: string;
  put: (key: string, body: ObjectBody, contentType: string) => Promise<void>;
  signedGetUrl: (key: string, expiresInSeconds?: number) => Promise<string>;
};

const required = (name: string) => process.env[name]?.trim();

export const createObjectStoreFromEnv = (): ObjectStore | null => {
  const accountId = required("R2_ACCOUNT_ID");
  const accessKeyId = required("R2_ACCESS_KEY_ID");
  const secretAccessKey = required("R2_SECRET_ACCESS_KEY");
  const bucket = required("R2_BUCKET");
  const configured = [accountId, accessKeyId, secretAccessKey, bucket].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 4) {
    throw new Error("R2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: required("R2_ENDPOINT") ?? `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!},
  });

  return {
    bucket: bucket!,
    async put(key, body, contentType) {
      await new Upload({
        client,
        params: {Bucket: bucket!, Key: key, Body: body, ContentType: contentType},
      }).done();
    },
    signedGetUrl(key, expiresInSeconds = 3600) {
      return getSignedUrl(client, new GetObjectCommand({Bucket: bucket!, Key: key}), {
        expiresIn: expiresInSeconds,
      });
    },
  };
};
