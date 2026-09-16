import { header } from '../components/header/header';
import { main } from '../components/main/main';
import { footer } from '../components/footer/footer';

// import { runFullPortfolioAnalysis } from './modules/cli-interface/cli-interface';

/** Проверка поддержки WebP */
function isWebp(): void {
  function testWebP(callback: (support: boolean) => void): void {
    const webP = new Image();
    webP.onload = webP.onerror = function (): void {
      callback(webP.height === 2);
    };
    webP.src =
      'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
  }

  testWebP(function (support: boolean): void {
    const className = support === true ? 'webp' : 'no-webp';
    document.documentElement.classList.add(className);
  });
}

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


// runFullPortfolioAnalysis();
