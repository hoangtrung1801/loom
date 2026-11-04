/**
 * Injects a <style data-plugin="id"> element and returns the function that removes it.
 */
export const injectStyle = (id: string, css: string): (() => void) => {
	if ((typeof document == 'undefined') || !css) {
		return () => {};
	};

	const el = document.createElement('style');

	el.setAttribute('data-plugin', id);
	el.textContent = css;
	document.head.appendChild(el);

	return () => el.remove();
};
