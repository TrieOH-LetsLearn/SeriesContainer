/**
 * code-reveal — Sätteri plugins (Astro 7 Markdown processor)
 *
 * Reference code is hidden behind a <details class="code-reveal"> toggle
 * (zero JS to reveal; only the copy button is wired client-side).
 *
 * Default: only the LAST code block in a document is treated as the
 * reference answer and hidden. Earlier blocks stay visible, so illustrative
 * or setup code is not locked behind the toggle.
 *
 * Per-block override via the fence info string:
 *   ```python keep      → always visible (not the answer)
 *   ```python reveal    → always hidden (e.g. several answer blocks)
 *
 * Decisions are made in the mdast phase (where the fence `meta` lives) and
 * passed to the hast phase through Sätteri's shared per-document data bag,
 * because the highlighted <pre> node no longer carries position or meta.
 */
const DECISIONS = 'code-reveal/decisions';
const INDEX = 'code-reveal/index';

export const codeRevealMdastPlugin = {
	name: 'code-reveal-mdast',
	before(_root, ctx) {
		ctx.data[DECISIONS] = [];
	},
	code(node, ctx) {
		const meta = node.meta ?? '';
		const decisions = ctx.data[DECISIONS];
		if (/\bkeep\b/i.test(meta)) decisions.push(false);
		else if (/\breveal\b/i.test(meta)) decisions.push(true);
		else decisions.push(null); // deferred: only the last block in the doc
	},
	after(_root, ctx) {
		const decisions = ctx.data[DECISIONS];
		const last = decisions.length - 1;
		for (let i = 0; i < decisions.length; i++) {
			if (decisions[i] === null) decisions[i] = i === last;
		}
	},
};

export const codeRevealHastPlugin = {
	name: 'code-reveal',
	element: {
		filter: ['pre'],
		visit(node, ctx) {
			const decisions = ctx.data[DECISIONS];
			if (!decisions) {
				throw new Error(
					'code-reveal: hast phase ran without the mdast phase — both plugins must be registered together',
				);
			}
			const i = ctx.data[INDEX] ?? 0;
			ctx.data[INDEX] = i + 1;
			return !decisions[i] ? undefined : wrapPre(node);
		},
	},
};

function wrapPre(preNode) {
	const text = (value) => ({ type: 'text', value });
	const el = (tagName, properties, children) => ({
		type: 'element',
		tagName,
		properties: properties ?? {},
		children,
	});

	const label = el(
		'span',
		{ className: ['code-reveal__label'] },
		[
			text('Reference code'),
			el('span', { className: ['code-reveal__hint'] }, [text(' (try it yourself first)')]),
		],
	);

	const copyBtn = el('button', { type: 'button', className: ['code-reveal__copy'] }, [text('Copy')]);

	const summary = el('summary', { className: ['code-reveal__summary'] }, [label, copyBtn]);
	const body = el('div', { className: ['code-reveal__body'] }, [preNode]);
	return el('details', { className: ['code-reveal'] }, [summary, body]);
}
