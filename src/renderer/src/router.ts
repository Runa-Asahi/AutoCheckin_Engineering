import { createRouter, createWebHashHistory } from 'vue-router'
import TaskListView from './views/TaskListView.vue'
import TaskCreateView from './views/TaskCreateView.vue'
import TaskDetailView from './views/TaskDetailView.vue'
import SettingsView from './views/SettingsView.vue'
import StatisticsView from './views/StatisticsView.vue'
import AIGuideView from './views/AIGuideView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: TaskListView },
    { path: '/tasks/new', component: TaskCreateView },
    { path: '/tasks/:id', component: TaskDetailView },
    { path: '/settings', component: SettingsView },
    { path: '/statistics', component: StatisticsView },
    { path: '/ai-guide', component: AIGuideView },
  ],
})
