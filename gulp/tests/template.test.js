import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '../../gulp.config.js';
import fs from 'fs';
import path from 'path';

describe('Проверка готовности и чистоты Второго шаблона (gulp-template_v2.0)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('1. Конфигурация путей gulp.config.js должна успешно считываться', () => {
    expect(config.srcFolder).toBe('src');
    expect(config.buildFolder).toBe('dist');
  });

  it('2. Базовая модульная структура (H-M-F) должна физически присутствовать на диске', () => {
    const componentsDir = path.join(config.srcFolder, 'components');

    // Проверяем наличие ядра Header, Main, Footer
    expect(fs.existsSync(path.join(componentsDir, 'header'))).toBe(true);
    expect(fs.existsSync(path.join(componentsDir, 'main'))).toBe(true);
    expect(fs.existsSync(path.join(componentsDir, 'footer'))).toBe(true);
  });

  it('3. Файлы фантомного контента старого блога должны быть полностью стёрты', () => {
    const contentDir = path.join(config.srcFolder, 'content');
    // Гарантируем, что папки со старыми статьями не существуют в чистом шаблоне
    expect(fs.existsSync(path.join(contentDir, 'work'))).toBe(false);
    expect(fs.existsSync(path.join(contentDir, 'poems'))).toBe(false);
  });
});
