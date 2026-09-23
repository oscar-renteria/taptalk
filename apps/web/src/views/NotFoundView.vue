<script setup lang="ts">
import { session } from '../session';
</script>

<template>
  <section class="panel" aria-labelledby="not-found-title">
    <p class="eyebrow">TapTalk</p>
    <h1 id="not-found-title">Page not found.</h1>
    <p class="intro">This page does not exist. It may have moved, or the link is incomplete.</p>
    <RouterLink class="btn btn--primary" :to="session.user ? '/practice' : '/login'">
      {{ session.user ? 'Back to practice' : 'Go to login' }}
    </RouterLink>
  </section>
</template>
