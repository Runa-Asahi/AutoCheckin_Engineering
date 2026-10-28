<script setup lang="ts">
import { ICONS, type IconName } from './icons'
defineProps<{ name: IconName; size?: number }>()
</script>
<template>
  <svg :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true" class="icon"><path :d="ICONS[name]" fill="currentColor" /></svg>
</template>
