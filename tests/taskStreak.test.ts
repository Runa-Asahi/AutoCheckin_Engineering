import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import nock from 'nock'
import { AdapterSchema } from '../src/shared/schemas.js'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '', getAppPath: () => process.cwd() } }))

const adapter = AdapterSchema.parse({
  site_id: 'streak', site_name: 'Streak', site_url: 'https://checkin.test', engine_type: 'http', login_type: 'cookie',
  request: { method: 'POST', url: 'https://checkin.test/daily' },
  success_rules: [{ type: 'json_path', value: { path: 'message', equals: '签到成功' } }],
  cookie_domains: ['checkin.test'],
})

describe('timezone-aware consecutive days', () => {
  const directories: string[] = []
  afterEach(async () => {
    nock.cleanAll()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('increments across Shanghai midnight even when both instants share a UTC date', async () => {
    const { AppDatabase } = await import('../src/main/database/index.js')
    const { CredentialEncryptor } = await import('../src/main/security/crypto.js')
    const { TaskService } = await import('../src/main/services/taskService.js')
    const directory = await mkdtemp(join(tmpdir(), 'autocheckin-streak-'))
    directories.push(directory)
    const db = new AppDatabase(join(directory, 'streak.db'))
    const clock = { value: '2026-10-13T15:00:00.000Z', now() { return new Date(this.value) } }
    const tasks = new TaskService(db, new CredentialEncryptor(Buffer.alloc(32, 7)), { get: () => adapter } as never, directory, () => undefined, () => 'Asia/Shanghai', () => clock.now())
    const task = tasks.create({ siteId: 'streak', siteName: 'Streak', engineType: 'http', loginType: 'cookie', adapterId: 'streak', schedule: '0 8 * * *', enabled: true, priority: 0, config: {} })
    nock('https://checkin.test').post('/daily').reply(200, { message: '签到成功' })
    await tasks.execute(task.id)
    expect(tasks.get(task.id).task.consecutive_days).toBe(1)
    clock.value = '2026-10-13T16:30:00.000Z'
    nock('https://checkin.test').post('/daily').reply(200, { message: '签到成功' })
    await tasks.execute(task.id)
    expect(tasks.get(task.id).task.consecutive_days).toBe(2)
    clock.value = '2026-10-13T18:00:00.000Z'
    nock('https://checkin.test').post('/daily').reply(200, { message: '签到成功' })
    await tasks.execute(task.id, { skipIfBusy: false })
    expect(tasks.get(task.id).task.consecutive_days).toBe(2)
    db.close()
  })
})
