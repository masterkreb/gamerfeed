import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-sm border-t border-slate-200 dark:border-zinc-800 mt-8">
      <div className="container mx-auto px-4 md:px-6 py-6 text-center text-sm text-slate-500 dark:text-zinc-400">
        <p>&copy; {new Date().getFullYear()} GamerFeed. All rights reserved.</p>
        <p className="mt-1">
          Made with ❤️ for gaming enthusiasts. News sourced from various public RSS feeds.
        </p>
      </div>
    </footer>
  );
};