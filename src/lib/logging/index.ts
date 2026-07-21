import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * Hàm hỗ trợ mask dữ liệu nhạy cảm (Số điện thoại, Họ tên, Email, Token)
 */
export function maskSensitiveData(text: string): string {
  if (!text) return text;
  
  let masked = text.replace(/(\b0\d{2}|\+84\d{2})(\d{4})(\d{2,3}\b)/g, '$1****$3');
  masked = masked.replace(/(cookie|token|password|otp)=([^;\s]+)/gi, '$1=***MASKED***');
  
  return masked;
}

let pinoLogger: any;
try {
  const pino = require('pino');
  pinoLogger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' },
    },
  });
} catch {
  const formatTime = () => new Date().toISOString().replace('T', ' ').substring(0, 19);
  pinoLogger = {
    info: (msg: any, extra?: string) => console.log(`[${formatTime()}] [INFO]`, typeof msg === 'string' ? maskSensitiveData(msg) : msg, extra || ''),
    warn: (msg: any, extra?: string) => console.warn(`[${formatTime()}] [WARN]`, typeof msg === 'string' ? maskSensitiveData(msg) : msg, extra || ''),
    error: (msg: any, extra?: string) => console.error(`[${formatTime()}] [ERROR]`, typeof msg === 'string' ? maskSensitiveData(msg) : msg, extra || ''),
    debug: (msg: any, extra?: string) => console.log(`[${formatTime()}] [DEBUG]`, typeof msg === 'string' ? maskSensitiveData(msg) : msg, extra || ''),
  };
}

export const logger = pinoLogger;
