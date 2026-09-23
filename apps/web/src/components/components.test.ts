// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
  AppButton,
  AppCard,
  AppNav,
  ErrorState,
  LoadingState,
  ProgressIndicator,
  SelectField,
  StatTile,
  StatusMessage,
  TextField,
} from './index';

describe('AppButton', () => {
  it('renders the variant class and defaults to type="button"', () => {
    const button = mount(AppButton, { props: { variant: 'secondary' }, slots: { default: 'Go' } });
    expect(button.classes()).toEqual(['btn', 'btn--secondary']);
    expect(button.attributes('type')).toBe('button');
    expect(button.text()).toBe('Go');
  });

  it('shows the loading label, disables itself, and marks itself busy while loading', async () => {
    const button = mount(AppButton, {
      props: { loading: true, loadingLabel: 'Saving...' },
      slots: { default: 'Save' },
    });
    expect(button.text()).toBe('Saving...');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('aria-busy')).toBe('true');
    await button.setProps({ loading: false });
    expect(button.text()).toBe('Save');
    expect(button.attributes('aria-busy')).toBeUndefined();
  });

  it('can be focused through its exposed method', () => {
    const button = mount(AppButton, { attachTo: document.body, slots: { default: 'Next' } });
    (button.vm as unknown as { focus: () => void }).focus();
    expect(document.activeElement).toBe(button.element);
    button.unmount();
  });
});

describe('TextField', () => {
  it('links the label and supports v-model and passthrough attributes', async () => {
    const field = mount(TextField, {
      props: { id: 'name', label: 'Username', modelValue: 'a', autocomplete: 'username' },
    });
    const input = field.get('input');
    expect(field.get('label').attributes('for')).toBe('name');
    expect(input.attributes('autocomplete')).toBe('username');
    await input.setValue('learner');
    expect(field.emitted('update:modelValue')?.at(-1)).toEqual(['learner']);
  });

  it('describes the input with its hint and error and marks it invalid', () => {
    const field = mount(TextField, {
      props: { id: 'pw', label: 'Password', hint: 'At least 8 characters.', error: 'Too short.' },
    });
    const input = field.get('input');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe('pw-hint pw-error');
    expect(field.get('#pw-error').text()).toBe('Too short.');
  });

  it('omits the error state when valid', () => {
    const input = mount(TextField, { props: { id: 'x', label: 'X' } }).get('input');
    expect(input.attributes('aria-invalid')).toBeUndefined();
    expect(input.attributes('aria-describedby')).toBeUndefined();
  });
});

describe('SelectField', () => {
  it('renders options and updates the model', async () => {
    const field = mount(SelectField, {
      props: {
        id: 'dir',
        label: 'Direction',
        modelValue: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    });
    expect(field.findAll('option').map((option) => option.text())).toEqual(['A', 'B']);
    await field.get('select').setValue('b');
    expect(field.emitted('update:modelValue')?.at(-1)).toEqual(['b']);
  });
});

describe('StatusMessage', () => {
  it.each([
    ['success', 'status'],
    ['warning', 'status'],
    ['info', 'status'],
    ['error', 'alert'],
  ] as const)('uses the %s tone with role %s', (tone, role) => {
    const message = mount(StatusMessage, { props: { tone, message: 'Done.' } });
    expect(message.attributes('data-tone')).toBe(tone);
    expect(message.attributes('role')).toBe(role);
    expect(message.text()).toBe('Done.');
  });

  it('accepts slot content', () => {
    expect(mount(StatusMessage, { slots: { default: '<em>Hi</em>' } }).html()).toContain(
      '<em>Hi</em>',
    );
  });
});

describe('ProgressIndicator', () => {
  it('exposes progress to assistive technology and clamps its value', async () => {
    const progress = mount(ProgressIndicator, {
      props: { value: 3, max: 10, label: 'Question 4 of 10' },
    });
    const bar = progress.get('[role="progressbar"]');
    expect(bar.attributes()).toMatchObject({
      'aria-valuenow': '3',
      'aria-valuemax': '10',
      'aria-valuetext': 'Question 4 of 10',
    });
    expect(progress.get('.progress__bar').attributes('style')).toContain('width: 30%');
    await progress.setProps({ value: 99 });
    expect(bar.attributes('aria-valuenow')).toBe('10');
  });
});

describe('state components', () => {
  it('announces loading politely', () => {
    const loading = mount(LoadingState, { props: { label: 'Loading your progress...' } });
    expect(loading.attributes('role')).toBe('status');
    expect(loading.text()).toBe('Loading your progress...');
  });

  it('shows an error with a retry action', async () => {
    const error = mount(ErrorState, { props: { message: 'Could not load.' } });
    expect(error.get('[role="alert"]').text()).toBe('Could not load.');
    await error.get('button').trigger('click');
    expect(error.emitted('retry')).toHaveLength(1);
  });
});

describe('layout components', () => {
  it('renders a stat tile and a card element of the requested type', () => {
    expect(mount(StatTile, { props: { value: 42, label: 'points' } }).text()).toBe('42 points');
    expect(mount(AppCard, { props: { as: 'form' } }).element.tagName).toBe('FORM');
  });

  it('renders router links and marks the active one as the current page', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: ['/practice', '/progress'].map((path) => ({
        path,
        component: { template: '<p />' },
      })),
    });
    await router.push('/progress');
    const nav = mount(AppNav, {
      global: { plugins: [router] },
      props: {
        label: 'Main navigation',
        items: [
          { to: '/practice', label: 'Practice' },
          { to: '/progress', label: 'Progress' },
        ],
      },
    });
    expect(nav.get('nav').attributes('aria-label')).toBe('Main navigation');
    const [practice, progress] = nav.findAll('a');
    expect(practice?.attributes('href')).toBe('/practice');
    expect(practice?.attributes('aria-current')).toBeUndefined();
    expect(progress?.attributes('aria-current')).toBe('page');
  });
});
