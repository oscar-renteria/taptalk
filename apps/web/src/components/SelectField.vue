<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  id: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}>();
const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="field">
    <label :for="props.id">{{ props.label }}</label>
    <select :id="props.id" v-model="model" v-bind="$attrs">
      <option v-for="option in props.options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </div>
</template>
