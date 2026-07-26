export interface OcrPage {
  page: number;
  text: string;
  confidence?: number;
}

export interface OcrResult {
  pages: OcrPage[];
  provider: string;
}

export interface OcrProvider {
  recognize(input: { file: Buffer; mimeType: string; fileName: string }): Promise<OcrResult>;
}

export class OcrNotConfiguredProvider implements OcrProvider {
  async recognize(): Promise<OcrResult> {
    throw new Error("OCR 服务尚未配置");
  }
}
