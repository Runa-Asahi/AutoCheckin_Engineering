import type { AppDatabase } from '../database/index.js'
import type { StatisticsOverview } from '../../shared/types.js'

export class StatisticsService {
  constructor(private readonly db: AppDatabase) {}
  overview(): StatisticsOverview {
    const totals = this.db.sqlite.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success FROM execution_logs`).get() as { total: number; success: number | null }
    const active = this.db.sqlite.prepare(`SELECT COUNT(*) count FROM tasks WHERE enabled=1`).get() as { count: number }
    const trendRows = this.db.sqlite.prepare(`SELECT substr(executed_at,1,10) date, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM execution_logs WHERE executed_at >= ? GROUP BY substr(executed_at,1,10) ORDER BY date`).all(new Date(Date.now() - 29 * 86_400_000).toISOString()) as Array<{ date: string; success: number; failed: number }>
    const trendMap = new Map(trendRows.map((row) => [row.date, row]))
    const trends = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.now() - (29 - index) * 86_400_000).toISOString().slice(0, 10)
      return trendMap.get(date) ?? { date, success: 0, failed: 0 }
    })
    const taskRates = this.db.sqlite.prepare(`SELECT t.id taskId,t.site_name siteName,t.account_label accountLabel,COUNT(l.id) total,SUM(CASE WHEN l.status='success' THEN 1 ELSE 0 END) success FROM tasks t LEFT JOIN execution_logs l ON l.task_id=t.id GROUP BY t.id ORDER BY total DESC`).all() as StatisticsOverview['taskRates']
    for (const item of taskRates) { item.success = Number(item.success ?? 0); item.total = Number(item.total); item.rate = item.total ? Math.round(item.success / item.total * 100) : 0 }
    const leaderboard = this.db.sqlite.prepare(`SELECT id taskId,site_name siteName,account_label accountLabel,consecutive_days consecutiveDays FROM tasks ORDER BY consecutive_days DESC,site_name LIMIT 10`).all() as StatisticsOverview['leaderboard']
    const totalRuns = Number(totals.total ?? 0), successRuns = Number(totals.success ?? 0)
    return { totalRuns, successRuns, successRate: totalRuns ? Math.round(successRuns / totalRuns * 100) : 0, activeTasks: Number(active.count), trends, taskRates, leaderboard }
  }
}
