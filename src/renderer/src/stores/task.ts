import { defineStore } from 'pinia'
import type { CreateTaskInput, TaskListQuery } from '../../../shared/schemas'
import type { AdapterSummary, Task } from '../../../shared/types'

export const useTaskStore = defineStore('task', {
  state: () => ({ tasks: [] as Task[], adapters: [] as AdapterSummary[], loading: false, query: { status: 'all', search: '', sortBy: 'created_at', sortOrder: 'desc' } as TaskListQuery }),
  actions: {
    async fetchTasks(): Promise<void> { this.loading = true; try { this.tasks = await window.api.task.list({ status: this.query.status, search: this.query.search, sortBy: this.query.sortBy, sortOrder: this.query.sortOrder }) } finally { this.loading = false } },
    async fetchAdapters(): Promise<void> { this.adapters = await window.api.adapter.list() },
    async createTask(input: CreateTaskInput): Promise<Task> { const task = await window.api.task.create(input); await this.fetchTasks(); return task },
    async executeTask(id: string): Promise<void> { await window.api.task.execute(id); await this.fetchTasks() },
    async deleteTask(id: string): Promise<void> { await window.api.task.delete(id); await this.fetchTasks() },
    bindStatus(): () => void { return window.api.task.onStatusChange((updated) => { const i = this.tasks.findIndex((task) => task.id === updated.id); if (i >= 0) this.tasks[i] = updated }) },
  },
})
