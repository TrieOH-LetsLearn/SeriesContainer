/**
 * spoiler-image — Sätteri plugins (Astro 7 Markdown processor)
 *
 * Images marked with the `!sp` prefix render behind a spoiler: heavily
 * blurred with a crossed-eye pill in the middle; clicking shows the image,
 * clicking again hides it. Zero JS — a <details> toggle does both states.
 *
 *   ![finished circuit](/assets/result.png)        → normal image
 *   !sp[finished circuit](/assets/result.png)      → spoiler image
 *
 * How the syntax parses: CommonMark sees `!sp[alt](url)` as literal text
 * "!sp" followed by a LINK to the image (a bang must sit directly before
 * `[` to start an image). The mdast phase therefore normalizes the pattern:
 * it strips the "!sp" marker from the preceding text node and rewrites the
 * link (or a directly following image, as in `!sp![alt](url)`) into an
 * image node carrying the spoiler mark in its `title`. The hast phase then
 * wraps marked images in the toggle structure, exactly the way the
 * code-reveal plugin wraps <pre>.
 *
 * Images live in the content folder's `assets/` directory and are
 * referenced as `/assets/<file>`; the content-assets integration in
 * astro.config.mjs serves them in dev and copies them into the build. The
 * hast phase prefixes them with the deploy base (ASTRO_BASE) so they work
 * under `/learn` too. (Plain relative images like `./pic.png` also work —
 * Astro resolves and optimizes those itself.)
 */
const SPOILER_MARK = 'spoiler';
const MARKER_RE = /!sp\s*$/;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)(?:$|[?#])/i;

/** Deploy base ('' locally, '/learn' in CI builds). */
const BASE = (process.env.ASTRO_BASE ?? '').replace(/\/+$/, '');

// --- mdast phase: normalize `!sp[alt](url)` into a marked image node -------

/** The preceding sibling must be a text node ending with the marker. */
function markerBefore(node, ctx) {
	const parent = ctx.parent(node);
	const idx = parent ? ctx.indexOf(node) : undefined;
	if (parent === undefined || idx === undefined || idx === 0) return null;
	const prev = parent.children[idx - 1];
	if (!prev || prev.type !== 'text' || !MARKER_RE.test(prev.value)) return null;
	return prev;
}

/** Strip the marker from the text node (removing it when nothing is left). */
function stripMarker(prev, ctx) {
	const rest = prev.value.replace(MARKER_RE, '');
	if (rest.trim()) ctx.setProperty(prev, 'value', rest);
	else ctx.removeNode(prev);
}

export const spoilerImageMdastPlugin = {
	name: 'spoiler-image-mdast',
	image(node, ctx) {
		const prev = markerBefore(node, ctx);
		if (!prev) return;
		stripMarker(prev, ctx);
		ctx.setProperty(node, 'title', SPOILER_MARK);
	},
	link(node, ctx) {
		if (!IMAGE_EXT_RE.test(node.url ?? '')) return;
		const prev = markerBefore(node, ctx);
		if (!prev) return;
		stripMarker(prev, ctx);
		// A link to an image preceded by "!sp" becomes a marked image; the
		// link text becomes its alt.
		ctx.replaceNode(node, {
			type: 'image',
			url: node.url,
			alt: ctx.textContent(node),
			title: SPOILER_MARK,
		});
	},
};

// --- hast phase: wrap marked images in the spoiler toggle -------------------

const el = (tagName, properties, children) => ({
	type: 'element',
	tagName,
	properties: properties ?? {},
	children,
});
const text = (value) => ({ type: 'text', value });

const svg = (paths, extra = {}) =>
	el(
		'svg',
		{
			xmlns: 'http://www.w3.org/2000/svg',
			width: 24,
			height: 24,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			'aria-hidden': 'true',
			...extra,
		},
		paths.map((d) =>
			d.shape === 'circle'
				? el('circle', { cx: d.cx, cy: d.cy, r: d.r }, [])
				: el('path', { d: d.d }, []),
		),
	);

const EYE = [
	{ d: 'M2.062 12.348a1 1 0 0 1 0-.699 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .699 10.75 10.75 0 0 1-19.876 0' },
	{ shape: 'circle', cx: 12, cy: 12, r: 3 },
];
const EYE_OFF = [
	{ d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .654 10.747 10.747 0 0 1-1.044 1.861 1 1 0 0 1-.575.34' },
	{ d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' },
	{ d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.654 10.75 10.75 0 0 1 4.446-5.143' },
	{ d: 'm2 2 20 20' },
];

/** Prefix content-asset paths with the deploy base; leave everything else. */
function assetSrc(src) {
	if (BASE && typeof src === 'string' && src.startsWith('/assets/')) return BASE + src;
	return src;
}

function spoilerDetails(imgNode) {
	// Rebuild the <img> without the internal spoiler title and with the
	// base-prefixed src; everything else (alt, dimensions…) is kept.
	const { src, alt, title: _title, ...rest } = imgNode.properties ?? {};
	const img = el(
		'img',
		{
			...rest,
			src: assetSrc(src),
			alt: alt ?? '',
			loading: 'lazy',
			decoding: 'async',
		},
		imgNode.children ?? [],
	);

	const pill = el('span', { className: ['spoiler-image__pill'] }, [
		svg(EYE_OFF, { className: 'spoiler-image__icon spoiler-image__icon--off' }),
		svg(EYE, { className: 'spoiler-image__icon spoiler-image__icon--on' }),
		el('span', { className: ['spoiler-image__label', 'spoiler-image__label--show'] }, [
			text('Show image'),
		]),
		el('span', { className: ['spoiler-image__label', 'spoiler-image__label--hide'] }, [
			text('Hide image'),
		]),
	]);

	return el('details', { className: ['spoiler-image'] }, [
		el('summary', { className: ['spoiler-image__toggle'], 'aria-label': 'Reveal spoiler image' }, [
			pill,
		]),
		el('div', { className: ['spoiler-image__body'] }, [img]),
	]);
}

export const spoilerImageHastPlugin = {
	name: 'spoiler-image',
	element: {
		filter: ['img'],
		visit(node, ctx) {
			// Always fix up content-asset paths for the deploy base.
			const src = node.properties?.src;
			if (typeof src === 'string' && src.startsWith('/assets/') && BASE) {
				ctx.setProperty(node, 'src', assetSrc(src));
			}
			if (node.properties?.title !== SPOILER_MARK) return;
			return spoilerDetails(node);
		},
	},
};
