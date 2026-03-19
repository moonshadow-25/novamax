/**
 * 全局日志收集器
 * 拦截 console.log/warn/error，存入内存环形缓冲区
 */
class LogCollector {
  constructor(maxSize = 500) {
    this.logs = [];
    this.maxSize = maxSize;
    this._intercept();
  }

  _intercept() {
    const orig = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };

    const capture = (level, origFn) => (...args) => {
      origFn(...args);
      const message = args.map(a =>
        typeof a === 'string' ? a : (a instanceof Error ? a.stack || a.message : JSON.stringify(a))
      ).join(' ');
      this.logs.push({ timestamp: Date.now(), level, message });
      if (this.logs.length > this.maxSize) {
        this.logs.shift();
      }
    };

    console.log = capture('info', orig.log);
    console.warn = capture('warn', orig.warn);
    console.error = capture('error', orig.error);
  }

  getLogs(limit = 200, level = 'all') {
    let result = this.logs;
    if (level && level !== 'all') {
      result = result.filter(l => l.level === level);
    }
    return result.slice(-limit);
  }

  clear() {
    this.logs = [];
  }
}

export default new LogCollector();
