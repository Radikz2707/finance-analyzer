import { header } from '../components/header/header';
import { main } from '../components/main/main';
import { footer } from '../components/footer/footer';
import { isWebp } from './modules/isWebp';

// Инициализация компонентов
const initApp = () => {
  document.body.classList.add('_js-ready');
  isWebp();
  header();
  main();
  footer();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

console.log('🚀 Radik.Dev: TypeScript успешно инициализирован');
