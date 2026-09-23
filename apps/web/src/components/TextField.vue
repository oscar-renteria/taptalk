<script setup lang="ts">
import { computed, ref } from 'vue';

defineOptions({ inheritAttrs: false });

// Label, hint, and error are wired to the input with aria-describedby and aria-invalid. Other
// attributes (autocomplete, inputmode, min, ...) pass through to the input element.
const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    type?: string;
    hint?: string;
    error?: string;
    // Extra element ids that describe the input, for example the question it answers.
    describedby?: string;
  }>(),
  { type: 'text', hint: '', error: '', describedby: '' },
);
const model = defineModel<string | number>({ default: '' });
const input = ref<HTMLInputElement | null>(null);
const describedBy = computed(
  () =>
    [props.describedby, props.hint && `${props.id}-hint`, props.error && `${props.id}-error`]
      .filter(Boolean)
      .join(' ') || undefined,
);

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="field">
    <label :for="props.id">{{ props.label }}</label>
    <div class="field__control">
      <input
        :id="props.id"
        ref="input"
        v-model="model"
        v-bind="$attrs"
        :type="props.type"
        :aria-invalid="props.error ? 'true' : undefined"
        :aria-describedby="describedBy"
      />
      <slot name="after" />
    </div>
    <p v-if="props.hint" :id="`${props.id}-hint`" class="field__hint">{{ props.hint }}</p>
    <p v-if="props.error" :id="`${props.id}-error`" class="field__error">{{ props.error }}</p>
  </div>
</template>
