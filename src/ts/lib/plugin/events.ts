import type { EventName } from './types';

type Handler = (...args: any[]) => void;

/**
 * Tiny emitter. The app emits from a few obvious hook points, plugins subscribe through Plugin.registerEvent.
 */
class PluginEvents {

	handlers: Map<string, Set<Handler>> = new Map();

	on (name: EventName, cb: Handler): () => void {
		if (!this.handlers.has(name)) {
			this.handlers.set(name, new Set());
		};

		this.handlers.get(name).add(cb);
		return () => this.handlers.get(name)?.delete(cb);
	};

	emit (name: EventName, ...args: any[]): void {
		Array.from(this.handlers.get(name) || []).forEach(cb => {
			try {
				cb(...args);
			} catch (e) {
				console.error(`[Plugin] event "${name}" handler failed`, e);
			};
		});
	};

	clear (): void {
		this.handlers.clear();
	};

};

export const pluginEvents = new PluginEvents();
export const emitPluginEvent = (name: EventName, ...args: any[]) => pluginEvents.emit(name, ...args);
