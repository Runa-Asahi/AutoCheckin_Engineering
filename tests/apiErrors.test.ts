import axios from 'axios'
import { describe, expect, it } from 'vitest'
import { toFriendlyApiError } from '../src/main/ai/apiErrors.js'

function axiosError(status?: number, code?: string) {
  return new axios.AxiosError('failure', code, undefined, undefined, status ? { status, statusText: '', headers: {}, config: {} as never, data: {} } : undefined)
}

describe('friendly API errors', () => {
  it.each([
    [401, 'API Key 可能填错了或已失效，请核对一下哦～'],
    [404, '找不到接口或模型。如果是中转站，请确认 Base URL 后面是否需要加上 /v1？'],
    [429, '余额不足或请求太频繁了，稍后再试或检查额度吧。'],
  ])('translates HTTP %s', (status, message) => expect(toFriendlyApiError(axiosError(status as number)).message).toBe(message))
  it('translates network and timeout failures', () => {
    expect(toFriendlyApiError(axiosError(undefined, 'ERR_NETWORK')).message).toContain('网络连接失败')
    expect(toFriendlyApiError(new Error('Request timeout')).message).toContain('网络连接失败')
  })
})
