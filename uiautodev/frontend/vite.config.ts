// uiautodev/frontend/vite.config.ts
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import devtoolsJson from 'vite-plugin-devtools-json';

export default defineConfig({
	plugins: [
        sveltekit(),
        devtoolsJson()
    ],

	// The special alias, optimizeDeps, and ssr sections for the old
	// 'codemirror' package have been removed. The new @codemirror/*
	// packages are standard ESM and don't require this handling.

	server: {
		host: 'localhost',
		port: 5173,

		proxy: {
			// Proxy all /api/* to your FastAPI backend
			'/api': {
				target: 'http://127.0.0.1:20242',
				changeOrigin: true,
				rewrite: (path) => path
			}
		}
	}
});
