// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { exerciseInputAttrs } from './components/exerciseInput';
import TextField from './components/TextField.vue';

const attrsOf = (wrapper: ReturnType<typeof mount>) => {
  const el = wrapper.get('input').element as HTMLInputElement;
  return {
    autocomplete: el.getAttribute('autocomplete'),
    autocorrect: el.getAttribute('autocorrect'),
    autocapitalize: el.getAttribute('autocapitalize'),
    spellcheck: el.getAttribute('spellcheck'),
    inputmode: el.getAttribute('inputmode'),
  };
};

describe('exercise inputs opt out of automatic spelling assistance', () => {
  it('marks a language-learning field so the browser and OS do not help', () => {
    const wrapper = mount(TextField, {
      props: { id: 'answer', label: 'Your answer', exercise: true },
    });
    expect(attrsOf(wrapper)).toEqual({
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      inputmode: 'text',
    });
  });

  it('renders spellcheck as a real boolean, not the string "true"', () => {
    // spellcheck is a DOM property, so binding the string "false" would coerce
    // to true and switch checking on. The attribute must be exactly "false".
    expect(exerciseInputAttrs.spellcheck).toBe(false);
    const wrapper = mount(TextField, { props: { id: 'a', label: 'L', exercise: true } });
    expect(wrapper.get('input').attributes('spellcheck')).toBe('false');
  });

  it('uses the valid autocapitalize value rather than the invalid "off"', () => {
    expect(exerciseInputAttrs.autocapitalize).toBe('none');
  });

  it('leaves ordinary fields such as username and password untouched', () => {
    for (const id of ['username', 'password', 'session-length']) {
      const wrapper = mount(TextField, { props: { id, label: 'L' } });
      const attrs = attrsOf(wrapper);
      expect(attrs.autocomplete, id).toBeNull();
      expect(attrs.autocorrect, id).toBeNull();
      expect(attrs.autocapitalize, id).toBeNull();
      expect(attrs.spellcheck, id).toBeNull();
    }
  });

  it('still lets a caller override a default for one specific field', () => {
    const wrapper = mount(TextField, {
      props: { id: 'c', label: 'L', exercise: true },
      attrs: { inputmode: 'numeric' },
    });
    expect(wrapper.get('input').attributes('inputmode')).toBe('numeric');
  });

  it('keeps the label, hint, and error wiring intact', () => {
    const wrapper = mount(TextField, {
      props: { id: 'd', label: 'Your answer', hint: 'Type the word', exercise: true },
    });
    expect(wrapper.get('label').text()).toBe('Your answer');
    expect(wrapper.get('.field__hint').text()).toBe('Type the word');
    expect(wrapper.get('input').attributes('id')).toBe('d');
    // aria-describedby still points at the hint, so the hint stays announced.
    expect(wrapper.get('input').attributes('aria-describedby')).toBe('d-hint');
  });
});
