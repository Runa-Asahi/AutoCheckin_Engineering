import { describe, expect, it } from 'vitest'
import { eapi, weapi } from '../src/main/core/platforms/neteaseCrypto.js'

// 参考向量由 NeteaseCloudMusicApi 4.32.0 的 util/crypto.js 生成（固定随机密钥为 16 个 'a'）
describe('网易云加密与 NeteaseCloudMusicApi 一致', () => {
  it('weapi', () => {
    expect(weapi({ type: 1, csrf_token: '' }, 'aaaaaaaaaaaaaaaa')).toEqual({ params: '21SF0IqKREf7SWHKv5wwWLHYQteE/USio+MRpyk4cOazg6EgaHCmSpZvJdp7YQYZ', encSecKey: 'd473b9eca232f1b4090dd606b0df86de318748dd2eec307e4ed4345030fc4ee30331e598f41d5a6f5befaab94630ea1a1eda7cfade84fbec1a907913d2e4d2c8744bc572b99a050075e075b4537f645ecfa994f95906c32818e076aeda6bdb906bfa0bb96c4cf4bc3ed6d9ab76cf08441153d9d85e1ea3d78fa8d9210d581cee' })
  })
  it('eapi', () => {
    expect(eapi('/api/point/dailyTask', { type: 0, e_r: false })).toEqual({ params: '04F1A0AB8150EFD085BC839891D19E2E488A2D6C2924C5589260A62E82B1A0D36B405C618B0758328601F00317A18D14FFBC6C60BEEC14874768BE51267FB8AAA2A846563EC5E837A3FFA0BD416A72CAF091AC69B98158BDAF0C4E929D6109C06F98687E2077F8B1189C51A95C6D1233' })
  })
})
