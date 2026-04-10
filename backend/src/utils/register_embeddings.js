import { registerEmbeddingsService, stopServiceRegistration } from './serviceRegistrar.js';

/**
 * CLI 脚本：向 NovaAirouter 网关注册本机 Embeddings 服务。
 *
 * 用法：
 *   node register_embeddings.js <port>
 *
 * 脚本会在接收到 SIGINT/SIGTERM 时主动注销服务，避免网关保留无效注册。
 */
const port = Number(process.argv[2]);
if (!port) {
  console.error('Usage: node register_embeddings.js <port>');
  process.exit(1);
}

async function shutdown() {
  console.log('\nDeregistering Embeddings service...');
  await stopServiceRegistration(port, true);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`Registering Embeddings endpoint on port ${port}...`);
registerEmbeddingsService(port)
  .then((info) => {
    if (!info) {
      console.error('Failed to register Embeddings service');
      process.exit(1);
    }
    console.log('Service registered successfully');
    console.log('Press Ctrl+C to stop and deregister');
  })
  .catch((error) => {
    console.error(`Failed to register Embeddings service: ${error.message}`);
    process.exit(1);
  });
