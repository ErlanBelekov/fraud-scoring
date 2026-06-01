export default async function globalTeardown(): Promise<void> {
  const c = (globalThis as any).__TEST_CONTAINERS__;
  if (!c) return;
  await c.redisC.stop();
  await c.pgC.stop();
}
