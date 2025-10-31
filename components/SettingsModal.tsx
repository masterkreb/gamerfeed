import React, { useMemo, useEffect, useRef } from 'react';
import { CloseIcon, ResetIcon } from './Icons';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  allSources: { name: string; language: 'de' | 'en' }[];
  mutedSources: string[];
  setMutedSources: React.Dispatch<React.SetStateAction<string[]>>;
}

const SourceCheckbox: React.FC<{
  sourceName: string;
  isMuted: boolean;
  onToggle: (sourceName: string) => void;
}> = ({ sourceName, isMuted, onToggle }) => (
  <label className="flex items-center gap-3 p-3 rounded-lg bg-white dark:bg-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-700/50 transition-all duration-200 cursor-pointer">
    <input
      type="checkbox"
      checked={isMuted}
      onChange={() => onToggle(sourceName)}
      className="h-5 w-5 rounded border-slate-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500 bg-slate-100 dark:bg-zinc-700"
    />
    <span className="font-medium">{sourceName}</span>
  </label>
);

const LanguageSourceGroup: React.FC<{
  title: string;
  sources: { name: string; language: 'de' | 'en' }[];
  mutedSources: string[];
  onToggleSource: (sourceName: string) => void;
  onToggleLanguage: (language: 'de' | 'en', shouldMute: boolean) => void;
}> = ({ title, sources, mutedSources, onToggleSource, onToggleLanguage }) => {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const language = sources[0]?.language;

  const mutedCount = useMemo(
    () => sources.filter(s => mutedSources.includes(s.name)).length,
    [sources, mutedSources]
  );

  const allForLangMuted = sources.length > 0 && mutedCount === sources.length;
  const someForLangMuted = mutedCount > 0 && !allForLangMuted;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someForLangMuted;
    }
  }, [someForLangMuted]);

  const handleToggle = () => {
    if (!language) return;
    // If all are muted, unmute them. Otherwise, mute them all.
    onToggleLanguage(language, !allForLangMuted);
  };

  return (
    <section>
      <label className="flex items-center gap-3 p-3 mb-2 rounded-lg bg-slate-200/50 dark:bg-zinc-800/50 cursor-pointer">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={allForLangMuted}
          onChange={handleToggle}
          className="h-5 w-5 rounded border-slate-400 dark:border-zinc-500 text-indigo-600 focus:ring-indigo-500 bg-slate-100 dark:bg-zinc-700"
        />
        <h4 className="font-semibold uppercase text-slate-600 dark:text-zinc-300 tracking-wider">
          {title}
        </h4>
      </label>
      <div className="space-y-2 pl-2">
        {sources.map(source => (
          <SourceCheckbox
            key={source.name}
            sourceName={source.name}
            isMuted={mutedSources.includes(source.name)}
            onToggle={onToggleSource}
          />
        ))}
      </div>
    </section>
  );
};


export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  allSources,
  mutedSources,
  setMutedSources,
}) => {
  if (!isOpen) return null;

  const handleToggleSource = (sourceName: string) => {
    setMutedSources(prev =>
      prev.includes(sourceName) ? prev.filter(s => s !== sourceName) : [...prev, sourceName]
    );
  };

  const handleToggleLanguage = (language: 'de' | 'en', shouldMute: boolean) => {
    const languageSourceNames = allSources
      .filter(s => s.language === language)
      .map(s => s.name);
    
    if (shouldMute) {
      setMutedSources(prev => [...new Set([...prev, ...languageSourceNames])]);
    } else {
      setMutedSources(prev => prev.filter(s => !languageSourceNames.includes(s)));
    }
  };
  
  const germanSources = useMemo(() => 
    allSources.filter(s => s.language === 'de').sort((a, b) => a.name.localeCompare(b.name)),
    [allSources]
  );
  
  const englishSources = useMemo(() => 
    allSources.filter(s => s.language === 'en').sort((a, b) => a.name.localeCompare(b.name)),
    [allSources]
  );


  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-slate-100 dark:bg-zinc-900 rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-zinc-800 flex-shrink-0">
          <h2 id="settings-modal-title" className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
            aria-label="Close settings"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 flex-grow overflow-y-auto">
          <div className="mb-2">
            <h3 className="font-semibold text-slate-800 dark:text-zinc-200">Manage Feed Sources</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
            Check a source to hide it from your feed and the filter menu.
          </p>
          <div className="space-y-6">
            {allSources.length > 0 ? (
                <>
                  {germanSources.length > 0 && (
                     <LanguageSourceGroup 
                        title="German Sources"
                        sources={germanSources}
                        mutedSources={mutedSources}
                        onToggleSource={handleToggleSource}
                        onToggleLanguage={handleToggleLanguage}
                     />
                  )}
                   {englishSources.length > 0 && (
                     <LanguageSourceGroup 
                        title="English Sources"
                        sources={englishSources}
                        mutedSources={mutedSources}
                        onToggleSource={handleToggleSource}
                        onToggleLanguage={handleToggleLanguage}
                     />
                  )}
                </>
            ) : (
                <p className="text-sm text-center text-slate-500 dark:text-zinc-400 py-4">No sources loaded yet.</p>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 p-4 border-t border-slate-200 dark:border-zinc-800 flex justify-between items-center bg-slate-100 dark:bg-zinc-900 rounded-b-2xl">
            <button
                onClick={() => setMutedSources([])}
                disabled={mutedSources.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border-2 bg-slate-200 dark:bg-zinc-700 border-transparent text-slate-600 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Unmute all sources"
            >
                <ResetIcon className="w-5 h-5" />
                <span>Unmute All</span>
            </button>
            <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900"
            >
                Done
            </button>
        </div>
      </div>
    </>
  );
};