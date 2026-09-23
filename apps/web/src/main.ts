import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { createAppRouter, installSessionExpiry } from './router';
import './style.css';

const router = createAppRouter();
installSessionExpiry(router);

registerSW({ immediate: true });
createApp(App).use(router).mount('#app');
