/* OSS 连通性自检：从 .env 读取配置，检查 bucket、读写冒烟、签名直传、CORS 规则。无凭据硬编码。 */
import { readFileSync } from "node:fs";
import OSS from "ali-oss";

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const getEnv = (key) => {
  const line = envText.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.split("=", 2)[1] : undefined;
};

const provider = getEnv("STORAGE_PROVIDER");
const bucket = getEnv("STORAGE_BUCKET");
if (provider !== "oss") {
  console.log(`STORAGE_PROVIDER=${provider}，非 OSS 模式，跳过自检。`);
  process.exit(0);
}

const client = new OSS({
  region: getEnv("OSS_REGION"),
  accessKeyId: getEnv("STORAGE_ACCESS_KEY"),
  accessKeySecret: getEnv("STORAGE_SECRET_KEY"),
  bucket,
  endpoint: getEnv("OSS_ENDPOINT") || undefined,
  internal: getEnv("OSS_INTERNAL") === "true",
});
console.log(`模式: oss | region=${getEnv("OSS_REGION")} | bucket=${bucket} | endpoint=${getEnv("OSS_ENDPOINT") || "（自动）"}`);

let bucketReady = false;
try {
  const info = await client.getBucketInfo(bucket);
  console.log(`bucket 信息: 是（区域 ${info.bucket.Location}）`);
  bucketReady = true;
} catch (e) {
  if (e.code === "NoSuchBucket") {
    console.log("bucket 不存在：请确认桶名与所在区域（当前配置 cn-beijing）。");
    process.exit(0);
  }
  if (e.code === "AccessDenied") {
    console.log("bucket 管理接口无权限（GetBucketInfo AccessDenied，不影响对象级读写，继续冒烟验证）");
  } else {
    console.log(`连接失败：${e.code ?? e.message}`);
    process.exit(1);
  }
}

// 服务端读写冒烟
const key = `__oss-verify-${Date.now()}.txt`;
const payload = Buffer.from("lg-vicp oss verify ok\n");
try {
  await client.put(key, payload, { headers: { "Content-Type": "text/plain" } });
  const got = await client.get(key);
  const head = await client.head(key);
  console.log(`服务端读写: ${Buffer.from(got.content).toString() === payload.toString() ? "OK" : "内容不一致"}（head 长度 ${Number(head.res.headers["content-length"])}）`);
  await client.delete(key);
  bucketReady = true;
} catch (e) {
  console.log(`服务端读写失败：${e.code ?? e.message}（请检查 AK 是否具备该 bucket 的 PutObject/GetObject/DeleteObject 权限，或确认桶确实在华北2 北京）`);
}

// 签名 URL 直传（模拟前端 presigned PUT）
const signKey = `__oss-verify-signed-${Date.now()}.txt`;
try {
  const url = client.signatureUrl(signKey, { method: "PUT", expires: 300, "Content-Type": "text/plain" });
  const putRes = await fetch(url, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "signed put ok" });
  if (putRes.ok) {
    const got = await client.get(signKey);
    console.log(`签名 URL 直传: OK（读回 ${Buffer.from(got.content).toString() === "signed put ok" ? "一致" : "不一致"}）`);
    await client.delete(signKey);
  } else {
    console.log(`签名 URL 直传失败：HTTP ${putRes.status}`);
  }
} catch (e) {
  console.log(`签名 URL 直传失败：${e.code ?? e.message}`);
}

// CORS（浏览器直传/预览必须）
try {
  const cors = await client.getBucketCORS(bucket);
  const rules = cors.rules ?? [];
  console.log(`CORS 规则: ${rules.length > 0 ? rules.map((r) => `${(r.allowedOrigin ?? []).join(",")} [${(r.allowedMethod ?? []).join(",")}]`).join("；") : "未配置"}`);
  if (rules.length === 0) {
    console.log("提示：浏览器端直传与预览需要 CORS 规则（AllowedOrigin *，AllowedMethod GET/PUT/HEAD，AllowedHeader *，ExposeHeader ETag）。");
  }
} catch (e) {
  if (e.code === "AccessDenied") {
    console.log("读取 CORS 无权限，尝试写入标准 CORS 规则…");
    try {
      await client.putBucketCORS(bucket, [{
        allowedOrigin: ["*"],
        allowedMethod: ["PUT", "GET", "HEAD"],
        allowedHeader: ["*"],
        exposeHeader: ["ETag", "Content-Length", "Content-Type"],
        maxAgeSeconds: 600,
      }]);
      console.log("CORS 规则写入: OK（AllowedOrigin * / PUT+GET+HEAD / AllowedHeader *）");
    } catch (e2) {
      console.log(`CORS 规则写入失败：${e2.code ?? e2.message}`);
      console.log("请甲方在 OSS 控制台 → 该 bucket → 数据安全 → CORS 添加规则：来源 *，允许方法 PUT/GET/HEAD，允许 Headers *，暴露 Headers ETag。");
    }
  } else {
    console.log(`读取 CORS 失败：${e.code ?? e.message}`);
  }
}

console.log("DONE");