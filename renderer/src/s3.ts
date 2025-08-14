import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export const s3 = new S3Client({});

export async function s3GetBuffer(bucket: string, key: string): Promise<Buffer> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await obj.Body!.transformToByteArray();
  return Buffer.from(bytes);
}
