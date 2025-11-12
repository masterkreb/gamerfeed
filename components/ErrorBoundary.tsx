import React, { ErrorInfo, ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
    // ✅ FIX: Explizite Props-Deklaration erzwingt TypeScript-Typerkennung
    public readonly props: Readonly<Props>;

    public state: State = {
        hasError: false
    };

    constructor(props: Props) {
        super(props);
        this.props = props; // ✅ Props explizit zuweisen
    }

    public static getDerivedStateFromError(_: Error): State {
        return { hasError: true };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    private handleReset = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return <ErrorFallback onReset={this.handleReset} />;
        }

        return <>{this.props.children}</>; // ✅ Fragment-Lösung
    }
}

export default ErrorBoundary;