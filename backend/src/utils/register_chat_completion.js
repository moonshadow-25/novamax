import { registerChatCompletionService, stopServiceRegistration } from './serviceRegistrar.js';

/**
 * CLI 脚本：向 NovaAirouter 网关注册本机 Chat Completion 服务。
 *
 * 用法：
 *   node register_chat_completion.js <port>
 *
 * 脚本会在接收到 SIGINT/SIGTERM 时主动注销服务，避免网关保留无效注册。
 */
const port = Number(process.argv[2]);
if (!port) {
  console.error('Usage: node register_chat_completion.js <port>');
  process.exit(1);
}

async function shutdown() {
  console.log('\nDeregistering Chat Completion service...');
  await stopServiceRegistration(port, false);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`Registering Chat Completion endpoint on port ${port}...`);
registerChatCompletionService(port)
  .then((info) => {
    if (!info) {
      console.error('Failed to register Chat Completion service');
      process.exit(1);
    }
    console.log('Service registered successfully');
    console.log('Press Ctrl+C to stop and deregister');
  })
  .catch((error) => {
    console.error(`Failed to register Chat Completion service: ${error.message}`);
    process.exit(1);
  });
