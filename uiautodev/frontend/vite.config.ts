import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import devtoolsJson from 'vite-plugin-devtools-json';

// 🔧 Configures the dev server to proxy /api requests to FastAPI (running on 20242)
export default defineConfig({
	plugins: [
		sveltekit(),
		devtoolsJson()
	],

	server: {
		host: 'localhost',
		port: 5173, // Feel free to change if needed

		proxy: {
			// Anything hitting /api/* gets sent to FastAPI at 127.0.0.1:20242
			'/api': {
				target: 'http://127.0.0.1:20242',
				changeOrigin: true,
				rewrite: (path) => path // no path rewrite needed
			}
		}
	}
});

