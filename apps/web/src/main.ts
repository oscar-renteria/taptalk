import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { setupPwa } from './pwa';
import { createAppRouter, installSessionExpiry } from './router';
import './style.css';

const router = createAppRouter();
installSessionExpiry(router);

setupPwa(registerSW);
createApp(App).use(router).mount('#app');
