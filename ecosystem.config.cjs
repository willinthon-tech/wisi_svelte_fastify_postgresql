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
    },
    {
      name: 'wisi-ai-engine',
      script: 'server.py',
      cwd: './ai-engine',
      interpreter: 'C:\\Users\\antho\\Downloads\\ia_wisi_space\\.venv\\Scripts\\python.exe',
      autorestart: true,
      watch: false,
      env: {
        PYTHONUNBUFFERED: '1',
        WISI_API_URL: 'http://127.0.0.1:3030/api/cecom'
      }
    }
  ]
};
