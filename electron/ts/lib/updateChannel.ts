/**
 * Maps Loom's channel setting to what electron-updater's GitHub provider needs.
 *
 * Every Loom release is published as a GitHub pre-release (the builds are unsigned), and the provider
 * ignores pre-releases unless `allowPrerelease` is on. With it on, an explicit channel of "latest"
 * matches no release at all (the provider only follows alpha/beta/custom tags in that case), so the
 * default channel has to be passed as null, which makes it take the newest release and read
 * latest*.yml from it. alpha and beta keep their names.
 */
export const updaterChannel = (channel: string): string | null => {
	const value = String(channel || '').trim();
	return (!value || (value === 'latest')) ? null : value;
};
