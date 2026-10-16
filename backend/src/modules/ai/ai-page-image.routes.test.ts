import 'dotenv/config';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
const mocks=vi.hoisted(()=>({authorize:vi.fn(),image:vi.fn()}));
vi.mock('../knowledge/knowledge-wiki-read.service.js',()=>({resolveSourceDetail:mocks.authorize}));
vi.mock('../knowledge/knowledge-page-image.js',()=>({readPageImageBytes:mocks.image}));
import { aiKnowledgeRoutes } from './ai-knowledge.routes.js';
const pageId='10000000-0000-4000-8000-000000000001';
describe('原图字节接口复用来源授权',()=>{
  it('授权拒绝时绝不读取对象或返回图片，含撤销/越权场景',async()=>{
    mocks.authorize.mockRejectedValueOnce(new Error('来源不可读'));mocks.image.mockClear();
    const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate',async(request:any)=>{request.currentUser={id:'user',clientType:'C_APP'}});
    await app.register(aiKnowledgeRoutes,{prefix:'/api/v1/ai/knowledge'});
    const response=await app.inject({url:`/api/v1/ai/knowledge/pages/${pageId}/image`});
    expect(response.statusCode).toBe(500);expect(mocks.image).not.toHaveBeenCalled();await app.close();
  });
  it('每次重新授权，版本条件透传，PNG原字节内联且不缓存',async()=>{
    mocks.authorize.mockResolvedValue({});const bytes=Buffer.from([137,80,78,71]);mocks.image.mockResolvedValue({bytes,contentType:'image/png'});
    const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate',async(request:any)=>{request.currentUser={id:'user',clientType:'C_APP'}});
    await app.register(aiKnowledgeRoutes,{prefix:'/api/v1/ai/knowledge'});
    const response=await app.inject({url:`/api/v1/ai/knowledge/pages/${pageId}/image?confirmedRevision=${'a'.repeat(24)}`});
    expect(mocks.image).toHaveBeenLastCalledWith(expect.anything(),pageId,'a'.repeat(24));expect(response.rawPayload).toEqual(bytes);
    expect(response.headers['content-type']).toBe('image/png');expect(response.headers['content-disposition']).toBe('inline');expect(response.headers['cache-control']).toContain('no-store');await app.close();
  });
});
