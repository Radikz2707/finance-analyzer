/**
 * Единая точка экспорта конфигурационных модулей (src/js/config).
 *
 * Безопасна для браузерного бандла: env-validation не импортирует
 * dotenv/fs и не выполняет side-effect'ов при импорте.
 */
export {
  ENV_SCHEMA,
  ENV_FIX_HINT,
  assertEnvValid,
  validateEnv,
  type EnvKeySpec,
  type EnvValueFormat,
  type EnvValidationIssue,
  type EnvValidationResult,
} from './env-validation.js';
export { PortfolioConfig } from './portfolio-config.js';
