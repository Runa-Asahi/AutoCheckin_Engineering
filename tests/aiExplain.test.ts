import { describe, expect, it } from 'vitest'
import { CheckinService } from '../src/main/core/service.js'
import { tempStore } from './helpers.js'

describe('AI 解释失败原因', () => {
  it('未开启时给出提示', async () => {
    const { store } = tempStore()
    const id = store.upsertAccount({ platform: 'netease', uid: '1', nickname: 'n', cookies: { MUSIC_U: 'top-secret' }, tasks: {} }).id
    await expect(new CheckinService(store).explainFailure(id)).rejects.toThrow('高级设置')
  })
  it('只发送结果文字，不发送 Cookie', async () => {
    const { store } = tempStore()
    const id = store.upsertAccount({ platform: 'netease', uid: '1', nickname: 'n', cookies: { MUSIC_U: 'top-secret' }, tasks: {} }).id
    store.addRun(id, { at: new Date().toISOString(), date: '2026-10-25', trigger: 'manual', attempt: 1, results: [{ taskId: 'mobile_sign', label: '手机端每日签到', status: 'failed', message: '接口返回成功，但平台状态显示仍未签到' }] })
    store.saveSettings({ ai: { enabled: true, apiKey: 'k' } })
    let sent = ''
    const service = new CheckinService(store, { ai: { generate: async (_c, prompt) => { sent = prompt; return ' 请稍后重试。 ' } } })
    expect(await service.explainFailure(id)).toBe('请稍后重试。')
    expect(sent).toContain('仍未签到')
    expect(sent).not.toContain('top-secret')
  })
})
