import { config } from '../gulp.config.js';
import gulp from 'gulp';
import path from 'path';
import ftp from 'vinyl-ftp';
import dotenv from 'dotenv';

dotenv.config();

const { src } = gulp;

export function deploy(done) {
  const ftpConfig = {
    host: process.env.FTP_HOST || 'your-hosting.com',
    user: process.env.FTP_USER || 'your_ftp_username',
    password: process.env.FTP_PASSWORD || 'your_ftp_password',
    remotePath: process.env.FTP_DEST || '/public_html/portfolio',
  };

  const isNotConfigured =
    !process.env.FTP_HOST ||
    process.env.FTP_HOST === 'your-hosting.com' ||
    !process.env.FTP_USER ||
    process.env.FTP_USER === 'your_ftp_username' ||
    !process.env.FTP_PASSWORD ||
    process.env.FTP_PASSWORD === 'your_ftp_password';

  if (isNotConfigured) {
    const yellow = '\x1b[33m';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';

    console.log(
      `\n${yellow}==================================================`,
    );
    console.warn(
      `${bold}⚠️  [DEPLOY WARNING]: FTP-сервер не настроен!${reset}${yellow}`,
    );
    console.warn('Пожалуйста, создайте файл .env и укажите актуальные данные:');
    console.warn('FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_DEST');
    console.log('\nДеплой на удаленный сервер пропущен.');
    console.log(`==================================================\n${reset}`);
    return done();
  }

  console.log('🚀 Начинаю деплой на FTP-сервер...');

  const conn = ftp.create({
    host: ftpConfig.host,
    user: ftpConfig.user,
    password: ftpConfig.password,
    parallel: 10,
    log: console.log,
  });

  return src(path.join(config.buildFolder, '**', '*'), {
    base: config.buildFolder,
    buffer: false,
    encoding: false,
  })
    .pipe(conn.dest(ftpConfig.remotePath))
    .on('error', (err) => {
      console.error('❌ Ошибка деплоя:', err.message);
      done(err);
    })
    .on('end', () => {
      console.log('✅ Проект успешно загружен на FTP-сервер!');
      done();
    });
}

export default deploy;
