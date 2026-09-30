<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" class="tool-icon-svg"
       fill="none" stroke="currentColor" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       v-html="paths" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TOOL_ICON_PATHS } from './tool-icons'

const props = withDefaults(defineProps<{ name?: string; size?: number }>(), { size: 16 })

const paths = computed(() => TOOL_ICON_PATHS[props.name ?? ''] ?? '')
</script>
