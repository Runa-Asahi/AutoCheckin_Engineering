import { afterEach, describe, expect, it } from 'vitest'
import nock from 'nock'
import { HttpEngine } from '../src/main/engine/httpEngine.js'
import { AdapterSchema } from '../src/shared/schemas.js'

describe('HttpEngine integration', () => {
  afterEach(() => nock.cleanAll())
  it('sends cookies, parses response and returns refreshed cookies', async () => {
    nock('https://checkin.test', { reqheaders: { cookie: 'session=old' } }).post('/daily').reply(200, { message: '签到成功' }, { 'Set-Cookie': 'session=new; Path=/; HttpOnly' })
    const adapter = AdapterSchema.parse({ site_id:'test',site_name:'Test',site_url:'https://checkin.test',engine_type:'http',login_type:'cookie',request:{method:'POST',url:'https://checkin.test/daily'},success_rules:[{type:'json_path',value:{path:'message',equals:'签到成功'}}],cookie_domains:['checkin.test'] })
    const result = await new HttpEngine().execute({ adapter, variables: {}, cookieHeader: 'session=old' })
    expect(result.success).toBe(true)
    expect(result.setCookies[0]).toContain('session=new')
  })
})
