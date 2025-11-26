import React from 'react';
import ReactDOM from 'react-dom/client';
import { AdminPanel } from './components/admin/AdminPanel';
import './i18n'; // i18n Konfiguration laden
import './src/index.css'; // Tailwind CSS

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
    <React.StrictMode>
        <AdminPanel />
    </React.StrictMode>
);