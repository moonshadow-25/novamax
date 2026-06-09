class EventBus {
  constructor() {
    this.clients = new Map(); // res → { backpressureCount: number }
    this.maxClients = 20;
    // 每 30s 发送心跳并检测死连接
    this._heartbeatTimer = setInterval(() => this._heartbeat(), 30000);
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  _heartbeat() {
    for (const [res, meta] of this.clients) {
      try {
        // 底层 socket 已销毁
        if (res.socket && res.socket.destroyed) {
          this.clients.delete(res);
          continue;
        }
        // 响应已结束（正常关闭或异常）
        if (res.writableEnded || res.finished) {
          this.clients.delete(res);
          continue;
        }

        const ok = res.write(': ping\n\n');

        if (!ok) {
          // 内核缓冲区满，客户端可能已死
          meta.backpressureCount++;
          // 连续 3 次心跳（90s）写入缓冲区满 → 判定为死连接，强制关闭
          if (meta.backpressureCount >= 3) {
            try { res.end(); } catch (e) { /* ignore */ }
            this.clients.delete(res);
          }
        } else {
          meta.backpressureCount = 0;
        }
      } catch (e) {
        this.clients.delete(res);
      }
    }
  }

  addClient(res) {
    // 超过最大连接数时，关闭最旧的连接
    if (this.clients.size >= this.maxClients) {
      const oldest = this.clients.keys().next().value;
      if (oldest) {
        try { oldest.end(); } catch (e) { /* ignore */ }
        this.clients.delete(oldest);
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write('data: {"type":"connected"}\n\n');

    this.clients.set(res, { backpressureCount: 0 });

    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  broadcast(event, data = {}) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [res, meta] of this.clients) {
      try {
        if (res.socket && res.socket.destroyed) {
          this.clients.delete(res);
          continue;
        }
        if (res.writableEnded || res.finished) {
          this.clients.delete(res);
          continue;
        }

        const ok = res.write(message);

        if (!ok) {
          // 累积背压计数，心跳检测时会判断是否死连接
          meta.backpressureCount++;
          res.once('drain', () => {
            meta.backpressureCount = 0;
          });
        } else {
          meta.backpressureCount = 0;
        }
      } catch (e) {
        this.clients.delete(res);
      }
    }
  }
}

export default new EventBus();
