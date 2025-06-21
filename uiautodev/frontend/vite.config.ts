// uiautodev/frontend/vite.config.ts
import path from 'path';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import devtoolsJson from 'vite-plugin-devtools-json';

export default defineConfig({
  plugins: [
    sveltekit(),
    devtoolsJson(),
  ],

  resolve: {
    alias: [
      // Make "import CodeMirror from 'codemirror'" point at the UMD build
      {
        find: /^codemirror$/,
        replacement: path.resolve(
          __dirname,
          'node_modules/codemirror/lib/codemirror.js'
        ),
      },
      // Allow deep imports: mode/, keymap/, addon/, etc.
      {
        find: /^codemirror\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          'node_modules/codemirror/$1'
        ),
      },
    ],
  },

  optimizeDeps: {
    // Force Vite to pre-bundle these so the scanner sees them
    include: [
      'codemirror',
      'codemirror/mode/python/python.js',
      'codemirror/keymap/vim.js',
      'codemirror/addon/hint/show-hint.js',
      'codemirror/addon/hint/anyword-hint.js',
      'codemirror/addon/selection/active-line.js',
      'codemirror/addon/edit/matchbrackets.js',
    ],
  },

  ssr: {
    // In case you ever server-render, bundle CodeMirror rather than externalizing it
    noExternal: ['codemirror'],
  },

  server: {
    host: 'localhost',
    port: 5173,

    proxy: {
      // Proxy all /api/* to your FastAPI backend
      '/api': {
        target: 'http://127.0.0.1:20242',
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
  },
});

