import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { transcribeVoice, type BaiduAsrFormat } from "../../services/asr/baidu-asr.js";

const transcribeVoiceBodySchema = z.object({
  /** 音频二进制内容的 base64 编码 */
  speech: z.string().min(1, "音频数据不能为空"),
  /** 音频格式：小程序 aac 对应 m4a，App 端为 wav */
  format: z.enum(["m4a", "wav"], "不支持的音频格式"),
  /** 采样率固定 16000 */
  rate: z.literal(16000, "采样率必须为 16000"),
  /** 声道数固定 1 */
  channel: z.literal(1, "声道数必须为 1"),
  durationMs: z.number().int().positive().max(60_000, "音频时长不能超过 60 秒").optional(),
});

/** 60 秒音频各格式的字节上限（base64 解码后）：m4a 约 360KB、wav 约 1.92MB */
const MAX_AUDIO_BYTES: Record<BaiduAsrFormat, number> = {
  m4a: 512 * 1024,
  wav: 2_000_000,
};

export async function aiVoiceRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/voice/transcribe", {
    preHandler: [app.authenticate],
    bodyLimit: 5 * 1024 * 1024,
    schema: {
      tags: ["共用 / AI对话"],
      summary: "语音转文字",
      body: transcribeVoiceBodySchema,
    },
  }, async (request) => {
    const user = getCurrentUser(request);
    const { speech, format } = request.body;

    const audio = Buffer.from(speech, "base64");
    if (audio.byteLength === 0) {
      throw new ForbiddenError("音频数据不能为空");
    }
    if (audio.byteLength > MAX_AUDIO_BYTES[format]) {
      throw new ForbiddenError("音频时长不能超过 60 秒");
    }

    const text = await transcribeVoice(app, { audio, format, cuid: user.id });
    return ok(request, { text });
  });
}