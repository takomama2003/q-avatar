<script setup lang="ts" generic="T extends string">
// 一组单选小标签（表情、姿势、背景、比例等）。按下的那个标为 aria-pressed。
defineProps<{ label: string; options: ReadonlyArray<{ id: T; name: string; swatch?: string }>; modelValue: T; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div class="chip-group" role="group" :aria-label="label">
    <button v-for="option in options" :key="option.id" type="button" class="chip" :class="{ selected: modelValue === option.id }" :aria-pressed="modelValue === option.id" :disabled="disabled" @click="emit('update:modelValue', option.id)">
      <span v-if="option.swatch" class="chip-swatch" :class="{ checker: option.swatch === 'transparent' }" :style="option.swatch === 'transparent' ? undefined : { background: option.swatch }" aria-hidden="true"></span>
      {{ option.name }}
    </button>
  </div>
</template>
