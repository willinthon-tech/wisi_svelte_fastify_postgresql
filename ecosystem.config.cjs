module.exports = {
  apps: [
    {
      name: 'wisi-backend',
      script: 'src/server.js',
      cwd: './backend-fastify',
      node_args: '--max-old-space-size=4096',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '4G',
      env: {
        NODE_ENV: 'production',
        PORT: 3030
      }
    }
  ]
};
