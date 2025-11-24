import React from 'react';
import { ResetIcon } from './Icons';

export const ErrorFallback: React.FC<{ onReset: () => void }> = ({ onReset }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-200 p-4 text-center">
      <div className="max-w-md w-full">
        <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/50 mb-6">
          <svg className="h-10 w-10 text-red-600 dark:text-red-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-red-600 dark:text-red-400">Oops! Something went wrong.</h1>
        <p className="mt-4 text-slate-600 dark:text-zinc-400">
          An unexpected error occurred which prevented the application from loading correctly. You can try to refresh the page to resolve the issue.
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-zinc-500">
          If the problem persists, please check back later.
        </p>
        <div className="mt-8">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 px-6 py-3 border border-transparent text-md font-medium rounded-lg shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900 transition-all transform hover:-translate-y-0.5 hover:scale-105 active:scale-100 active:translate-y-0"
          >
            <ResetIcon className="w-5 h-5" />
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  );
};