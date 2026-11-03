#!/usr/bin/env node
/**
 * Merges the per-architecture macOS update metadata into the single latest-mac.yml that
 * electron-updater reads.
 *
 * The arm64 and x64 macOS jobs each produce a latest-mac.yml listing only their own files, and one
 * would overwrite the other in the release. electron-updater picks the right file for the machine
 * from the merged `files` list (arm64 files for Apple silicon, the rest for Intel).
 *
 *   node scripts/merge-update-metadata.js <out.yml> <in.yml> [<in.yml>...]
 *
 * No dependencies: the release job has no node_modules. It reads only the shape electron-builder
 * writes and throws on anything else, so a malformed feed fails the build instead of shipping.
 */
const fs = require('fs');

const unquote = (v) => String(v).replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

/** Parses a latest*.yml written by electron-builder: scalar keys plus a `files` list of flat objects. */
const parse = (text) => {
	const doc = { files: [] };
	let inFiles = false;
	let item = null;

	String(text).split(/\r?\n/).forEach((line, i) => {
		if (!line.trim()) {
			return;
		};

		const fail = () => { throw new Error(`unexpected line ${i + 1}: ${line}`); };
		let m;

		if ((m = line.match(/^(\w+):\s*(.*)$/))) {
			item = null;
			inFiles = (m[1] === 'files') && !m[2];
			if (m[1] === 'files') {
				if (m[2]) {
					fail();
				};
			} else {
				doc[m[1]] = m[2];
			};
		} else
		if (inFiles && (m = line.match(/^ {2}- (\w+):\s*(.*)$/))) {
			item = { [m[1]]: m[2] };
			doc.files.push(item);
		} else
		if (inFiles && item && (m = line.match(/^ {4}(\w+):\s*(.*)$/))) {
			item[m[1]] = m[2];
		} else {
			fail();
		};
	});

	if (!doc.version || !doc.files.length || doc.files.some(it => !it.url || !it.sha512)) {
		throw new Error('missing version or files (url, sha512)');
	};
	return doc;
};

const stringify = (doc) => {
	const out = [ `version: ${doc.version}`, 'files:' ];

	doc.files.forEach((file) => {
		Object.keys(file).forEach((key, i) => out.push(`${i ? '    ' : '  - '}${key}: ${file[key]}`));
	});

	[ 'path', 'sha512', 'releaseDate' ].forEach((key) => {
		if (doc[key] !== undefined) {
			out.push(`${key}: ${doc[key]}`);
		};
	});
	return out.join('\n') + '\n';
};

/** One document from several: files joined (first occurrence of a url wins), newest release date kept. */
const merge = (docs) => {
	if (!docs.length) {
		throw new Error('nothing to merge');
	};

	const version = docs[0].version;
	if (docs.some(it => it.version !== version)) {
		throw new Error(`versions differ: ${docs.map(it => it.version).join(', ')}`);
	};

	const files = [];
	docs.forEach(d => d.files.forEach((f) => {
		if (!files.some(it => it.url === f.url)) {
			files.push(f);
		};
	}));

	// The top-level path/sha512 are the pre-"files" fields; point them at a non-arm64 file for old clients
	const legacy = docs.find(it => !unquote(it.path || '').includes('arm64')) || docs[0];
	const dates = docs.map(it => unquote(it.releaseDate || '')).filter(Boolean).sort();

	const out = { version, files, path: legacy.path, sha512: legacy.sha512 };
	if (dates.length) {
		out.releaseDate = `'${dates[dates.length - 1]}'`;
	};
	return out;
};

const mergeText = (texts) => stringify(merge(texts.map(parse)));

if (require.main === module) {
	const [ out, ...inputs ] = process.argv.slice(2);

	if (!out || !inputs.length) {
		console.error('usage: merge-update-metadata.js <out.yml> <in.yml> [<in.yml>...]');
		process.exit(2);
	};

	try {
		fs.writeFileSync(out, mergeText(inputs.map(file => fs.readFileSync(file, 'utf8'))));
		console.log(`wrote ${out} from ${inputs.join(', ')}`);
	} catch (e) {
		console.error(`merge-update-metadata: ${e.message}`);
		process.exit(1);
	};
};

module.exports = { parse, stringify, merge, mergeText };
