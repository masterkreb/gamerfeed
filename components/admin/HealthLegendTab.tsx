import React from 'react';
import { CheckCircleIcon, WarningIcon, XCircleIcon, QuestionMarkCircleIcon, LoadingSpinner } from '../Icons';

const LegendItem: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
}> = ({ icon, title, description }) => (
    <div className="flex items-start gap-4 p-4 rounded-lg bg-slate-50 dark:bg-zinc-800/50">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
            <h4 className="font-semibold text-slate-800 dark:text-zinc-200">{title}</h4>
            <p className="text-sm text-slate-600 dark:text-zinc-400">{description}</p>
        </div>
    </div>
);

const ErrorCodeItem: React.FC<{
    code: string;
    meaning: string;
    details: string;
}> = ({ code, meaning, details }) => (
    <div className="p-4 border-l-4 border-slate-300 dark:border-zinc-600 bg-slate-50 dark:bg-zinc-800/50 rounded-r-lg">
        <h4 className="font-mono font-bold text-slate-800 dark:text-zinc-200">
            <span className="text-red-500">{code}</span> - {meaning}
        </h4>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">{details}</p>
    </div>
);


export const HealthLegendTab: React.FC = () => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <section className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6">
                <h3 className="text-xl font-bold mb-4">Status Icon Legend</h3>
                <div className="space-y-4">
                    <LegendItem
                        icon={<CheckCircleIcon className="w-6 h-6 text-green-500" />}
                        title="OK"
                        description="The feed URL was reached, the XML was parsed successfully, and the image from the first article was accessible."
                    />
                    <LegendItem
                        icon={<WarningIcon className="w-6 h-6 text-amber-500" />}
                        title="Warning"
                        description="The feed is accessible, but there's a potential issue. This could mean the feed is empty, an image couldn't be found (using a placeholder), or the image requires special scraping which cannot be live-checked."
                    />
                    <LegendItem
                        icon={<XCircleIcon className="w-6 h-6 text-red-500" />}
                        title="Error"
                        description="A critical failure occurred. This could be an unreachable feed URL, broken XML, or a dead image link from the first article. The details column provides more specific information."
                    />
                    <LegendItem
                        icon={<LoadingSpinner className="w-5 h-5 text-indigo-500" />}
                        title="Checking"
                        description="A health check is currently in progress for this feed."
                    />
                    <LegendItem
                        icon={<QuestionMarkCircleIcon className="w-6 h-6 text-slate-400" />}
                        title="Unknown"
                        description="The health status for this feed has not been checked yet."
                    />
                </div>
            </section>
            <section className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6">
                <h3 className="text-xl font-bold mb-4">Common Error Explanations</h3>
                <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
                    When a feed or image check fails, it often returns a standard HTTP status code. Here are some of the most common ones you might see in the 'Details' column.
                </p>
                <div className="space-y-4">
                    <ErrorCodeItem
                        code="403 Forbidden"
                        meaning="Access Denied"
                        details="The server understood the request but refuses to authorize it. This often happens when a feed or image host has hotlink protection or requires a specific user agent to be accessed."
                    />
                    <ErrorCodeItem
                        code="404 Not Found"
                        meaning="Resource Does Not Exist"
                        details="The requested feed URL or image URL does not exist on the server. The link is likely broken or has been moved."
                    />
                    <ErrorCodeItem
                        code="500 Internal Server Error"
                        meaning="Server Problem"
                        details="Something went wrong on the website's server. This is not a problem with our app, but an issue with the source itself. It's usually temporary."
                    />
                    <ErrorCodeItem
                        code="CORS Error"
                        meaning="Cross-Origin Request Blocked"
                        details="The browser blocked the request for security reasons. Our proxy services attempt to fix this, but some servers are too restrictive. If all proxies fail with CORS errors, the feed cannot be checked."
                    />
                </div>
            </section>
        </div>
    );
};
