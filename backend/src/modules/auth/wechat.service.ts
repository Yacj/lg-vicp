export interface WechatIdentity {
  openid: string;
  unionid?: string;
}

export interface WechatAuthProvider {
  exchangeCode(code: string): Promise<WechatIdentity>;
}

export function createWechatAuthProvider(): WechatAuthProvider | null {
  return null;
}
