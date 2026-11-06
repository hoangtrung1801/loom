const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Fractional indexing: returns a string strictly between a and b (lexicographic order),
 * so concurrent reorders never collide and no sibling needs rewriting.
 */
const midpoint = (a: string, b: string | null): string => {
	if (b !== null) {
		let n = 0;
		while ((a[n] || '0') === b[n]) {
			n++;
		};

		if (n > 0) {
			return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
		};
	};

	const da = a ? DIGITS.indexOf(a[0]) : 0;
	const db = (b !== null) ? DIGITS.indexOf(b[0]) : DIGITS.length;

	if ((db - da) > 1) {
		return DIGITS[Math.round((da + db) / 2)];
	};

	if (b && (b.length > 1)) {
		return b.slice(0, 1);
	};

	return DIGITS[da] + midpoint(a.slice(1), null);
};

export const between = (a: string | null, b: string | null): string => {
	return midpoint(a || '', b || null);
};

export const compareZ = (a: { z: string, id: string }, b: { z: string, id: string }): number => {
	if (a.z < b.z) {
		return -1;
	};
	if (a.z > b.z) {
		return 1;
	};
	return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
};
