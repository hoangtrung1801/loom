/**
 * Compares dotted versions ("0.54.11" vs "0.55"), ignoring any suffix after a dash. Returns -1, 0 or 1.
 */
export const compareVersions = (a: string, b: string): number => {
	const parse = (v: string) => String(v || '').split('-')[0].split('.').map(it => parseInt(it, 10) || 0);
	const pa = parse(a);
	const pb = parse(b);
	const len = Math.max(pa.length, pb.length);

	for (let i = 0; i < len; i++) {
		const x = pa[i] || 0;
		const y = pb[i] || 0;

		if (x != y) {
			return x < y ? -1 : 1;
		};
	};
	return 0;
};
