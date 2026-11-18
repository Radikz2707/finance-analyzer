/**
 * Идентификатор сборки для отчётов.
 *
 * Нужен, чтобы по сгенерированному HTML/MD можно было однозначно понять,
 * какой код его построил: версия пакета + коммит + время сборки.
 * Все значения берутся из окружения; при отсутствии — безопасные заглушки,
 * чтобы отчёт не падал и не показывал пустой build-id.
 */

/** Собрать идентификатор текущей сборки. */
export function getBuildId(): string {
  const version = process.env.npm_package_version ?? '1.0.1';
  const commit = process.env.GIT_COMMIT ?? process.env.BUILD_COMMIT ?? 'dev';
  const builtAt = process.env.BUILD_TIME ?? new Date().toISOString();
  return `${version}+${commit}.${builtAt}`;
}
