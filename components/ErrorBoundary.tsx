import React, { ErrorInfo, ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
}

// FIX: The error "Property 'props' does not exist on type 'ErrorBoundary'" suggests a
// potential type resolution issue with the imported `Component`. Using the fully
// qualified `React.Component` resolves this ambiguity.
class ErrorBoundary extends React.Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(_: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        // You can also log the error to an error reporting service here
    }

    private handleReset = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return <ErrorFallback onReset={this.handleReset} />;
        }

        // The existing code correctly handles an undefined `children` prop. The error was related to the class definition.
        return this.props.children;
    }
}

export default ErrorBoundary;