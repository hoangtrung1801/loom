import React, { Component, ReactNode } from 'react';
import { Label } from 'Component';

interface Props {
	pluginId: string;
	children: ReactNode;
};

interface State {
	error: Error | null;
};

/**
 * Keeps a throwing plugin view or settings tab from taking the page down with it.
 */
class PluginErrorBoundary extends Component<Props, State> {

	state: State = {
		error: null,
	};

	static getDerivedStateFromError (error: Error): State {
		return { error };
	};

	componentDidCatch (error: Error, info: React.ErrorInfo) {
		console.error(`[Plugin] ${this.props.pluginId}: render failed`, error, info);
	};

	render () {
		const { error } = this.state;

		if (!error) {
			return this.props.children;
		};

		return (
			<div className="pluginError">
				<Label text={U.String.sprintf(translate('pluginViewError'), error.message)} />
			</div>
		);
	};

};

export default PluginErrorBoundary;
