// Configure Docker host for testcontainers (Colima support)
const os = require('os');
const { existsSync } = require('fs');

if (!process.env.DOCKER_HOST) {
  const colimaSocket = `${os.homedir()}/.colima/default/docker.sock`;
  if (existsSync(colimaSocket)) {
    process.env.DOCKER_HOST = `unix://${colimaSocket}`;
    // Ryuk (the testcontainers resource reaper) has known issues with Colima.
    process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
  }
}
