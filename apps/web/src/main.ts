import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { i18n } from './i18n';
import { setupPwa } from './pwa';
import { createAppRouter, installSessionExpiry } from './router';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/instrument-sans';
import './style.css';

const router = createAppRouter();
installSessionExpiry(router);

setupPwa(registerSW);
createApp(App).use(i18n).use(router).mount('#app');
