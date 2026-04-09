/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const PROXY_ORIGINAL_URL = env.PROXY_ORIGINAL_URL

		const url = new URL(request.url);
		const originUrl = `${PROXY_ORIGINAL_URL}${url.pathname}${url.search}`;

		const originResponse = await fetch(originUrl, {
			method: request.method,
			headers: request.headers,
		});

		return new Response(originResponse.body, {
			status: originResponse.status,
			headers: originResponse.headers,
		});
	},
} satisfies ExportedHandler<Env>;
