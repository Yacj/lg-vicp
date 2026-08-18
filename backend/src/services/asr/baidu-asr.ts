import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { BusinessError, ServiceUnavailableError } from "../../shared/errors.js";

const BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const BAIDU_ASR_URL = "https://vop.baidu.com/pro_api";
const TOKEN_CACHE_KEY = "baidu:asr:access_token";
// 提前 1 小时过期，避免边界时刻拿到即将失效的 token
const TOKEN_CACHE_TTL_BUFFER_SECONDS = 3600;
const ASR_REQUEST_TIMEOUT_MS = 10_000;

/** 百度短语音识别极速版支持的音频格式（dev_pid=80001） */
export type BaiduAsrFormat = "m4a" | "wav";

interface BaiduTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface BaiduAsrResponse {
  err_no: number;
  err_msg: string;
  sn?: string;
  result?: string[];
}

/** 换取并缓存百度 access_token（有效期 30 天，Redis 缓存并留缓冲） */
async function getAccessToken(app: FastifyInstance): Promise<string> {
  const cached = await app.redis.get(TOKEN_CACHE_KEY);
  if (cached) {
    return cached;
  }

  if (!env.BAIDU_ASR_API_KEY || !env.BAIDU_ASR_SECRET_KEY) {
    throw new ServiceUnavailableError("语音识别未配置");
  }

  const url = `${BAIDU_TOKEN_URL}?grant_type=client_credentials`
    + `&client_id=${encodeURIComponent(env.BAIDU_ASR_API_KEY)}`
    + `&client_secret=${encodeURIComponent(env.BAIDU_ASR_SECRET_KEY)}`;

  let data: BaiduTokenResponse;
  try {
    const response = await fetch(url, { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    data = await response.json() as BaiduTokenResponse;
  }
  catch (error) {
    app.log.error({ err: error }, "百度语音 token 获取失败");
    throw new BusinessError("语音识别服务暂时不可用");
  }

  if (!data.access_token) {
    throw new BusinessError("语音识别服务暂时不可用");
  }

  const ttlSeconds = Math.max((data.expires_in ?? 2_592_000) - TOKEN_CACHE_TTL_BUFFER_SECONDS, 60);
  await app.redis.set(TOKEN_CACHE_KEY, data.access_token, "EX", ttlSeconds);
  return data.access_token;
}

/**
 * 调用百度短语音识别极速版（RAW 方式）识别音频，返回识别文本。
 * 识别成功但结果为空时返回空字符串，由调用方提示用户。
 */
export async function transcribeVoice(
  app: FastifyInstance,
  input: { audio: Buffer; format: BaiduAsrFormat; cuid: string },
): Promise<string> {
  const token = await getAccessToken(app);
  const url = `${BAIDU_ASR_URL}?dev_pid=80001`
    + `&cuid=${encodeURIComponent(input.cuid)}`
    + `&token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASR_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": `audio/${input.format};rate=16000` },
      body: input.audio,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as BaiduAsrResponse;
    if (data.err_no !== 0) {
      app.log.warn({ errNo: data.err_no, errMsg: data.err_msg, sn: data.sn }, "百度语音识别失败");
      throw new BusinessError(data.err_msg || "语音识别失败");
    }

    return data.result?.[0] ?? "";
  }
  catch (error) {
    if (error instanceof BusinessError) {
      throw error;
    }
    app.log.error({ err: error }, "百度语音识别请求异常");
    throw new BusinessError("语音识别失败，请重试");
  }
  finally {
    clearTimeout(timeout);
  }
}