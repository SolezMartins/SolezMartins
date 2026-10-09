import pino from 'pino';
/** Structured JSON logs. Secrets are redacted; request URLs are logged without their query string (the WebSocket token lives there). */
export const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: ['req.headers.authorization', '*.token', '*.jwt', '*.apiKey', '*.password', '*.authorization'], censor: '[redacted]' },
  serializers: { req: (r: any) => ({ method: r.method, url: String(r.url).split('?')[0], remoteAddress: r.ip }), res: (r: any) => ({ statusCode: r.statusCode }), err: pino.stdSerializers.err },
});
export const child = (component: string) => log.child({ component });
process.on('unhandledRejection', e => log.error({ err: e }, 'unhandledRejection'));
process.on('uncaughtException', e => { log.fatal({ err: e }, 'uncaughtException'); process.exit(1); });
