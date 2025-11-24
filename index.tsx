import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n'; // i18n Konfiguration laden - WICHTIG!

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// Hilfsfunktion zum Escapen von Anführungszeichen in HTML-Attributen
const escapeHtmlAttr = (str: string): string => {
    return str.replace(/"/g, '&quot;');
};