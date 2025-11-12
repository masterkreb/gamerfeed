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
                <h3 className="text-xl font-bold mb-4">Backend Status Legend</h3>
                <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
                    The health status is now based entirely on the result of the last automated backend script (GitHub Action). It reflects what is actually live on the site, not a live check from your browser.
                </p>
                <div className="space-y-4">
                    <LegendItem
                        icon={<CheckCircleIcon className="w-6 h-6 text-green-500" />}
                        title="OK"
                        description="The backend script successfully fetched the feed, AND its articles are present in the live `news-cache.json` file. The feed is working correctly."
                    />
                    <LegendItem
                        icon={<WarningIcon className="w-6 h-6 text-amber-500" />}
                        title="Warning"
                        description="The backend script successfully fetched the feed, but NO articles from it are in the live cache. This usually means the feed was valid but empty, or all its articles were too old to be included."
                    />
                    <LegendItem
                        icon={<XCircleIcon className="w-6 h-6 text-red-500" />}
                        title="Error"
                        description="A critical failure occurred during the backend process. This means the script could not fetch or parse the feed XML. The details column provides the specific error message from the server."
                    />
                    <LegendItem
                        icon={<LoadingSpinner className="w-5 h-5 text-indigo-500" />}
                        title="Checking"
                        description="The admin panel is currently fetching the latest status reports from the backend-generated files (`feed-health-status.json` and `news-cache.json`)."
                    />
                    <LegendItem
                        icon={<QuestionMarkCircleIcon className="w-6 h-6 text-slate-400" />}
                        title="Unknown"
                        description="The health status for this feed has not been checked yet, or the status report could not be loaded."
                    />
                </div>
            </section>
            <section className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6">
                <h3 className="text-xl font-bold mb-4">Common Backend Error Explanations</h3>
                <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
                    When a feed check fails, it's often due to an issue with the feed provider's server. The backend script will report these issues. Here are some common ones you might see.
                </p>
                <div className="space-y-4">
                    <ErrorCodeItem
                        code="Failed to parse XML"
                        meaning="Invalid Feed Format"
                        details="The backend was able to download the feed, but the content was not valid XML. This often indicates the feed URL is broken or pointing to a non-feed webpage."
                    />
                    <ErrorCodeItem
                        code="Fetch failed"
                        meaning="Unreachable URL"
                        details="The backend server could not reach the feed's URL. This could be due to a server timeout, a DNS issue, or the feed's server actively blocking requests from the script's host."
                    />
                    <ErrorCodeItem
                        code="Status 403 / 404 / 500"
                        meaning="Server Errors"
                        details="The feed's server responded with a standard HTTP error code. 403 means access is forbidden, 404 means the URL does not exist, and 500+ errors indicate a problem on the source's server."
                    />
                    <ErrorCodeItem
                        code="Not processed"
                        meaning="Script Failure"
                        details="If a feed is marked as not processed, it means the entire backend script may have failed before it could even attempt to fetch this specific feed. Check the GitHub Action logs for fatal errors."
                    />
                </div>
            </section>
        </div>
    );
};