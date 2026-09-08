/**
 * letslearn-edge — the trieoh.com/learn micro-frontend.
 *
 * The Lets Learn platform builds into `dist/` with Astro base `/learn`, so
 * every link and asset in the HTML points at /learn/... This worker maps the
 * trieoh.com/learn* path space onto the Cloudflare Pages deployment (whose
 * files live at the root of letslearn-1kx.pages.dev): the /learn prefix is
 * stripped before the upstream fetch.
 */

const ORIGIN = 'https://letslearn-1kx.pages.dev';

export default {
	async fetch(request) {
		const url = new URL(request.url);

		// Only this path space belongs to us.
		if (url.pathname !== '/learn' && !url.pathname.startsWith('/learn/')) {
			return new Response('Not found', { status: 404 });
		}
		// /learn/ai/... → /ai/...   |   /learn (or /learn/) → /
		const upstreamPath =
			url.pathname === '/learn' || url.pathname === '/learn/'
				? '/'
				: url.pathname.slice('/learn'.length);

		const method = request.method;
		const init = {
			method,
			headers: new Headers(request.headers),
			redirect: 'follow',
		};
		init.headers.delete('host');
		if (!['GET', 'HEAD'].includes(method)) {
			init.body = request.body;
		}

		const upstream = await fetch(`${ORIGIN}${upstreamPath}${url.search}`, init);
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: upstream.headers,
		});
	},
};
