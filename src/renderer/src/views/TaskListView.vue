<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { explainBrowserFailure } from '../../../shared/browserFailure'
import { Plus, Search, VideoPlay, Edit, Delete, Calendar } from '@element-plus/icons-vue'
import { useTaskStore } from '../stores/task'
import type { Task } from '../../../shared/types'
import { presentSchedule } from '../../../shared/scheduleView'

const store = useTaskStore(), router = useRouter(), executing = ref(''), editVisible = ref(false)
const editForm = reactive({ id: '', accountLabel: '', schedule: '', enabled: true })
let unbind: (() => void) | undefined
const counts = computed(() => ({ all: store.tasks.length, success: store.tasks.filter(t=>presentSchedule(t).tone==='success').length, failed: store.tasks.filter(t=>presentSchedule(t).tone==='failed').length, pending: store.tasks.filter(t=>presentSchedule(t).tone==='pending' || presentSchedule(t).tone==='running').length }))
const timeText = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '尚未执行'
async function refresh(){ await store.fetchTasks() }
async function execute(task: Task){ executing.value=task.id; try{ const result=await window.api.task.execute(task.id); const message=explainBrowserFailure(result.message); result.success?ElMessage.success(message):ElMessage.warning(message); await refresh() }finally{executing.value=''} }
async function remove(task: Task){ await ElMessageBox.confirm(`确定删除“${task.site_name}${task.account_label ? ` · ${task.account_label}` : ''}”吗？此操作也会删除其执行记录。`,'删除任务',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消'}); await store.deleteTask(task.id); ElMessage.success('任务已删除') }
function openEdit(task: Task){ Object.assign(editForm,{id:task.id,accountLabel:task.account_label??'',schedule:task.schedule,enabled:Boolean(task.enabled)}); editVisible.value=true }
async function saveEdit(){ await window.api.task.update(editForm.id,{accountLabel:editForm.accountLabel,schedule:editForm.schedule,enabled:editForm.enabled}); editVisible.value=false; await refresh(); ElMessage.success('任务已更新') }
watch(()=>[store.query.status,store.query.search,store.query.sortBy,store.query.sortOrder],refresh,{deep:true})
onMounted(async()=>{ await refresh(); unbind=store.bindStatus() }); onBeforeUnmount(()=>unbind?.())
</script>

<template>
  <div class="page">
    <header class="page-header"><div><h1>签到任务</h1><p>集中管理所有网站的自动签到任务与运行状态。</p></div><el-button class="primary-button" type="primary" :icon="Plus" @click="router.push('/tasks/new')">添加任务</el-button></header>
    <section class="summary-grid">
      <div class="summary-card"><span>全部任务</span><strong>{{ counts.all }}</strong><i class="blue"></i></div>
      <div class="summary-card"><span>运行成功</span><strong>{{ counts.success }}</strong><i class="green"></i></div>
      <div class="summary-card"><span>需要关注</span><strong>{{ counts.failed }}</strong><i class="red"></i></div>
      <div class="summary-card"><span>等待执行</span><strong>{{ counts.pending }}</strong><i class="gray"></i></div>
    </section>
    <section class="panel task-panel">
      <div class="toolbar">
        <el-tabs v-model="store.query.status" class="filter-tabs"><el-tab-pane label="全部" name="all"/><el-tab-pane label="成功" name="success"/><el-tab-pane label="失败" name="failed"/><el-tab-pane label="待执行" name="pending"/></el-tabs>
        <div class="toolbar-right"><el-input v-model="store.query.search" clearable :prefix-icon="Search" placeholder="搜索网站" style="width:210px"/><el-select v-model="store.query.sortBy" style="width:150px"><el-option label="按创建时间" value="created_at"/><el-option label="按最近执行" value="last_run_at"/><el-option label="按连续天数" value="consecutive_days"/></el-select></div>
      </div>
      <el-table v-if="store.tasks.length" v-loading="store.loading" :data="store.tasks" @row-click="(row:Task)=>router.push(`/tasks/${row.id}`)">
        <el-table-column label="网站" min-width="205"><template #default="{row}"><div class="site-cell"><div class="site-avatar">{{ row.site_name.slice(0,1).toUpperCase() }}</div><div><strong>{{ row.site_name }}</strong><span>{{ row.engine_type.toUpperCase() }} · {{ row.account_label || '默认账户' }}</span></div></div></template></el-table-column>
        <el-table-column label="状态" width="140"><template #default="{row}"><span class="status-pill" :class="`status-${presentSchedule(row).tone}`">{{ presentSchedule(row).label }}</span></template></el-table-column>
        <el-table-column label="上次执行" width="145"><template #default="{row}"><span class="cell-main">{{ timeText(row.last_run_at) }}</span></template></el-table-column>
        <el-table-column label="连续签到" width="115"><template #default="{row}"><span class="streak"><b>{{ row.consecutive_days }}</b> 天</span></template></el-table-column>
        <el-table-column label="计划" width="130"><template #default="{row}"><span class="cron"><el-icon><Calendar/></el-icon>{{ row.schedule }}</span></template></el-table-column>
        <el-table-column label="操作" width="210" align="right"><template #default="{row}"><div @click.stop><el-button text :icon="VideoPlay" :loading="executing===row.id" @click="execute(row)">执行</el-button><el-button text :icon="Edit" @click="openEdit(row)"/><el-button text type="danger" :icon="Delete" @click="remove(row)"/></div></template></el-table-column>
      </el-table>
      <div v-else-if="!store.loading" class="empty-state"><div class="empty-icon"><el-icon><Calendar/></el-icon></div><h3>还没有签到任务</h3><p>添加第一个网站，AutoCheckin 会按计划在本地自动执行。</p><el-button class="primary-button" type="primary" :icon="Plus" @click="router.push('/tasks/new')">添加第一个任务</el-button></div>
    </section>
    <el-dialog v-model="editVisible" title="编辑任务" width="460px"><el-form label-position="top"><el-form-item label="账户备注"><el-input v-model="editForm.accountLabel" placeholder="例如：主账号"/></el-form-item><el-form-item label="Cron 计划"><el-input v-model="editForm.schedule"/></el-form-item><el-form-item label="启用任务"><el-switch v-model="editForm.enabled"/></el-form-item></el-form><template #footer><el-button @click="editVisible=false">取消</el-button><el-button type="primary" @click="saveEdit">保存</el-button></template></el-dialog>
  </div>
</template>

<style scoped>
.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.summary-card{position:relative;background:#fff;border:1px solid #e4e9f2;border-radius:13px;padding:17px 19px;overflow:hidden}.summary-card span{display:block;color:#8490a4;font-size:11px}.summary-card strong{display:block;font-size:25px;margin-top:7px}.summary-card i{position:absolute;right:15px;top:19px;width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 6px rgba(0,0,0,.035)}.blue{background:#4776ec}.green{background:#28b88a}.red{background:#df5f65}.gray{background:#a4adbb}.task-panel{overflow:hidden}.toolbar{height:70px;padding:0 19px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #edf0f5}.filter-tabs{height:70px}.filter-tabs :deep(.el-tabs__header){margin:0}.filter-tabs :deep(.el-tabs__nav-wrap::after){display:none}.filter-tabs :deep(.el-tabs__item){height:70px;font-size:13px}.toolbar-right{display:flex;gap:9px}.site-cell{display:flex;align-items:center;gap:12px}.site-avatar{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(145deg,#edf2ff,#e2eaff);color:#3d68d8;font-weight:750}.site-cell strong{display:block;font-size:13px}.site-cell span{display:block;color:#929daf;font-size:10px;margin-top:4px}.cell-main{font-size:12px;color:#667287}.streak b{font-size:16px;color:#2b56c3}.streak{font-size:11px;color:#8994a7}.cron{display:flex;align-items:center;gap:5px;color:#707d91;font-size:11px}
</style>
