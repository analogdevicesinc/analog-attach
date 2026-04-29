import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

import type { Plugin } from 'vite';

// Plugin to watch workspace dependencies and trigger HMR
function watchWorkspaceDeps(): Plugin {
  return {
    name: 'watch-workspace-deps',
    configureServer(server) {
      const hdsReactDistributionPath = path.resolve(__dirname, '../hds-react/dist');

      // Watch the hds-react dist folder
      server.watcher.add(hdsReactDistributionPath + '/**/*');

      server.watcher.on('change', (file) => {
        if (file.includes('hds-react/dist')) {
          console.log('hds-react changed, triggering full reload...');
          server.ws.send({
            type: 'full-reload',
            path: '*'
          });
        }
      });
    },
  };
}

// Plugin to serve codicons from node_modules during dev (like the extension does)
function serveCodeicons(): Plugin {
  return {
    name: 'serve-codicons',
    configureServer(server) {
      const codiconsPath = path.resolve(__dirname, '../../node_modules/@vscode/codicons/dist');
      
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith('/codicons/')) {
          // Strip query parameters from the URL
          const urlWithoutQuery = request.url.split('?')[0];
          const filePath = path.join(codiconsPath, urlWithoutQuery.replace('/codicons/', ''));
          
          if (fs.existsSync(filePath)) {
            const extension = path.extname(filePath);
            const contentTypes: Record<string, string> = {
              '.css': 'text/css; charset=utf-8',
              '.ttf': 'font/ttf',
              '.woff': 'font/woff',
              '.woff2': 'font/woff2',
            };
            
            // Set proper headers for fonts
            response.setHeader('Content-Type', contentTypes[extension] || 'application/octet-stream');
            response.setHeader('Access-Control-Allow-Origin', '*');
            response.setHeader('Cache-Control', 'public, max-age=31536000');
            
            // Read and send the file
            const fileContent = fs.readFileSync(filePath);
            response.end(fileContent);
          } else {
            console.log(`Codicon file not found: ${filePath}`);
            next();
          }
        } else {
          next();
        }
      });
    },
  };
}

// Plugin to copy codicons to dist folder during build
function copyCodeicons(): Plugin {
  return {
    name: 'copy-codicons',
    closeBundle() {
      const codiconsSource = path.resolve(__dirname, '../../node_modules/@vscode/codicons/dist');
      const distributionPath = path.resolve(__dirname, 'dist/codicons');
      
      // Create codicons directory in dist
      if (!fs.existsSync(distributionPath)) {
        fs.mkdirSync(distributionPath, { recursive: true });
      }
      
      // Copy codicon.css and codicon.ttf
      const filesToCopy = ['codicon.css', 'codicon.ttf'];
      for (const file of filesToCopy) {
        const sourcePath = path.join(codiconsSource, file);
        const destinationPath = path.join(distributionPath, file);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, destinationPath);
          console.log(`Copied ${file} to dist/codicons/`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), watchWorkspaceDeps(), serveCodeicons(), copyCodeicons()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'index.css' || assetInfo.name?.endsWith('.css')) {
            return 'webview.css';
          }
          return assetInfo.name || 'assets/[name].[ext]';
        },
      },
    },
  },
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Alias for codicons in dev mode
      '/codicons': path.resolve(__dirname, '../../node_modules/@vscode/codicons/dist'),
      // Alias for webview-playground from workspace root
      '/node_modules/@vscode-elements/webview-playground': path.resolve(__dirname, '../../node_modules/@vscode-elements/webview-playground'),
    },
  },
  optimizeDeps: {
    // Don't pre-bundle workspace dependencies
    exclude: ['hds-react'],
  },
  server: {
    port: 3000,
    fs: {
      // Allow serving files from the codicons directory
      allow: ['..', '../..'],
    },
  },
});

