import axios from 'axios'

export class FriendlyApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message)
    this.name = 'FriendlyApiError'
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  401: 'API Key 可能填错了或已失效，请核对一下哦～',
  404: '找不到接口或模型。如果是中转站，请确认 Base URL 后面是否需要加上 /v1？',
  429: '余额不足或请求太频繁了，稍后再试或检查额度吧。',
}

const NETWORK_MESSAGE = '网络连接失败，请检查此接口是否需要开启魔法（VPN），或者中转服务器是否宕机。'

export function toFriendlyApiError(error: unknown): FriendlyApiError {
  if (error instanceof FriendlyApiError) return error

  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status && STATUS_MESSAGES[status]) return new FriendlyApiError(STATUS_MESSAGES[status], status, error.code)
    if (!error.response || ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK', 'ECONNREFUSED', 'ENOTFOUND'].includes(error.code ?? '')) {
      return new FriendlyApiError(NETWORK_MESSAGE, status, error.code)
    }
    const detail = extractProviderMessage(error.response?.data)
    return new FriendlyApiError(`接口请求失败：${detail || `HTTP ${status ?? '未知错误'}`}`, status, error.code)
  }

  const message = error instanceof Error ? error.message : String(error)
  if (/network error|timeout|timed out|econnrefused|enotfound|socket hang up/i.test(message)) {
    return new FriendlyApiError(NETWORK_MESSAGE)
  }
  return new FriendlyApiError(message || '接口请求失败，请稍后重试。')
}

function extractProviderMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const payload = data as { error?: { message?: unknown } | string; message?: unknown }
  if (typeof payload.error === 'string') return payload.error
  if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') return payload.error.message
  return typeof payload.message === 'string' ? payload.message : ''
}
