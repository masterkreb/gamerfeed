import React, { useState, useRef, useEffect, useCallback, memo, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Article, ViewMode } from '../types';
import { StarIcon, MoreIcon, CopyIcon, BanIcon, ShareIcon, ArrowLeftIcon, TwitterIcon, FacebookIcon, RedditIcon, WhatsAppIcon, EmailIcon } from './Icons';


interface ArticleCardProps {
    article: Article;
    viewMode: ViewMode;
    isFavorite: boolean;
    onToggleFavorite: (id: string) => void;
    onMuteSource: (source: string) => void;
}


const formatPublicationDate = (date: string, t: any): string => {
    const articleDate = new Date(date);
    const now = new Date();

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const articleDay = new Date(articleDate.getFullYear(), articleDate.getMonth(), articleDate.getDate());

    const timeString = articleDate.toLocaleTimeString(navigator.language, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    if (articleDay.getTime() === today.getTime()) {
        return t('time.today', { time: timeString });
    }

    if (articleDay.getTime() === yesterday.getTime()) {
        return t('time.yesterday', { time: timeString });
    }

    return articleDate.toLocaleDateString(navigator.language, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
};


const LanguageTag: React.FC<{ language: 'de' | 'en' }> = ({ language }) => {
    return (
        <span className="uppercase text-xs font-bold px-2 py-1 rounded bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300">
            {language}
        </span>
    );
};

interface MoreOptionsMenuProps {
    title: string;
    source: string;
    link: string;
    onMuteSource: (source: string) => void;
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    buttonClassName?: string;
}

const MoreOptionsMenu: React.FC<MoreOptionsMenuProps> = ({ title, source, link, onMuteSource, isOpen, setIsOpen, buttonClassName }) => {
    const { t } = useTranslation();
    const [menuView, setMenuView] = useState<'main' | 'share'>('main');
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
    const [startAnimation, setStartAnimation] = useState(false);
    const [menuPosition, setMenuPosition] = useState<'bottom' | 'top'>('bottom');

    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const firstButtonRef = useRef<HTMLButtonElement>(null);
    const lastButtonRef = useRef<HTMLAnchorElement | HTMLButtonElement>(null);

    const closeMenu = useCallback(() => {
        setIsOpen(false);
    }, [setIsOpen]);

    // Calculate menu position when opening
    useEffect(() => {
        if (isOpen && triggerRef.current) {
            const triggerRect = triggerRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const menuHeight = 250;
            const spaceBelow = viewportHeight - triggerRect.bottom;

            if (spaceBelow < menuHeight && triggerRect.top > menuHeight) {
                setMenuPosition('top');
            } else {
                setMenuPosition('bottom');
            }
        }
    }, [isOpen]);

    // Focus trap and keyboard handling
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => firstButtonRef.current?.focus(), 50);

            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    closeMenu();
                    triggerRef.current?.focus();
                }

                if (e.key === 'Tab') {
                    const activeElement = document.activeElement;

                    if (e.shiftKey) {
                        if (activeElement === firstButtonRef.current) {
                            e.preventDefault();
                            lastButtonRef.current?.focus();
                        }
                    } else {
                        if (activeElement === lastButtonRef.current) {
                            e.preventDefault();
                            firstButtonRef.current?.focus();
                        }
                    }
                }
            };

            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [isOpen, closeMenu, menuView]);

    // Animation timing
    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setStartAnimation(true), 10);
            return () => clearTimeout(timer);
        } else {
            setStartAnimation(false);
        }
    }, [isOpen]);

    // Reset state after close
    useEffect(() => {
        if (!isOpen) {
            const timer = setTimeout(() => {
                setCopyStatus('idle');
                setMenuView('main');
            }, 200);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    const handleShare = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const shareData = { title, text: title, url: link };

        if (navigator.share) {
            try {
                await navigator.share(shareData);
                closeMenu();
            } catch (err) {
                console.error("Share failed:", err);
            }
        } else {
            setMenuView('share');
        }
    };

    const handleCopy = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (copyStatus === 'copied') return;
        navigator.clipboard.writeText(link).then(() => {
            setCopyStatus('copied');
        });
    };

    const handleMute = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onMuteSource(source);
        closeMenu();
    };

    const encodedLink = encodeURIComponent(link);
    const encodedTitle = encodeURIComponent(title);

    const shareOptions = [
        { name: t('share.x'), icon: <TwitterIcon className="w-5 h-5"/>, url: `https://x.com/intent/post?url=${encodedLink}&text=${encodedTitle}` },
        { name: t('share.facebook'), icon: <FacebookIcon className="w-5 h-5"/>, url: `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}` },
        { name: t('share.reddit'), icon: <RedditIcon className="w-5 h-5"/>, url: `https://www.reddit.com/submit?url=${encodedLink}&title=${encodedTitle}` },
        { name: t('share.whatsapp'), icon: <WhatsAppIcon className="w-5 h-5"/>, url: `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedLink}` },
        { name: t('share.email'), icon: <EmailIcon className="w-5 h-5"/>, url: `mailto:?subject=${encodedTitle}&body=${encodedLink}` },
    ];


    return (
        <>
            {isOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50"
                    aria-hidden="true"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        closeMenu();
                    }}
                />
            )}
            <div ref={menuRef} className="relative">
                <button
                    ref={triggerRef}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsOpen(!isOpen); }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsOpen(true);
                        }
                    }}
                    className={`${buttonClassName || "p-2 rounded-full transition-colors duration-200 text-slate-400 bg-black/30 hover:text-white"} ${isOpen ? 'z-50' : ''}`}
                    aria-label={t('article.moreOptions')}
                    aria-haspopup="true"
                    aria-expanded={isOpen}
                >
                    <MoreIcon className="w-5 h-5" />
                </button>
                <div
                    className={`
                        fixed bottom-0 left-0 right-0 z-50
                        md:absolute 
                        ${menuPosition === 'top' ? 'md:bottom-full md:mb-2' : 'md:top-full md:mt-2'}
                        md:right-0 md:left-auto
                        md:w-56
                        transition-all ease-in-out
                        duration-300 md:duration-150 
                        
                        ${startAnimation ? 'translate-y-0' : 'translate-y-full'}
                        md:origin-top-right md:transform-none 
                        ${startAnimation ? 'md:opacity-100 md:scale-100' : 'md:opacity-0 md:scale-95'}
                        ${!isOpen ? 'pointer-events-none' : ''}
                    `}
                    role="dialog"
                    aria-modal="true"
                    aria-hidden={!isOpen}
                >
                    <div
                        className="
                            bg-white dark:bg-zinc-800 rounded-t-2xl
                            md:dark:bg-zinc-700 md:rounded-lg md:shadow-xl
                            md:ring-1 md:ring-black/5
                            pb-[env(safe-area-inset-bottom)] md:pb-0
                        "
                    >
                        <div className="md:hidden text-center text-sm font-semibold text-slate-500 dark:text-zinc-400 border-b border-slate-200 dark:border-zinc-700 py-3">
                            {t('article.articleOptions')}
                        </div>

                        <div className="relative overflow-hidden">
                            {/* Main Menu */}
                            <div className={`transition-all duration-300 ease-in-out ${menuView === 'main' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 absolute pointer-events-none'}`}>
                                <div className="divide-y divide-slate-200 dark:divide-zinc-600">
                                    <div className="p-2 md:p-1">
                                        <button
                                            ref={firstButtonRef}
                                            onClick={handleShare}
                                            tabIndex={isOpen && menuView === 'main' ? 0 : -1}
                                            className="w-full flex items-center gap-3 text-left px-3 py-3 text-base md:text-sm text-slate-700 dark:text-zinc-300 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-zinc-600 dark:hover:text-white rounded-md transition-colors"
                                        >
                                            <ShareIcon className="w-5 h-5 md:w-4 md:h-4" /> {t('article.share')}
                                        </button>
                                    </div>
                                    <div className="p-2 md:p-1">
                                        <button
                                            onClick={handleCopy}
                                            disabled={copyStatus === 'copied'}
                                            tabIndex={isOpen && menuView === 'main' ? 0 : -1}
                                            className="w-full flex items-center gap-3 text-left px-3 py-3 text-base md:text-sm text-slate-700 dark:text-zinc-300 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-zinc-600 dark:hover:text-white rounded-md transition-colors disabled:opacity-75"
                                        >
                                            <CopyIcon className="w-5 h-5 md:w-4 md:h-4" /> {copyStatus === 'copied' ? t('article.copied') : t('article.copyLink')}
                                        </button>
                                    </div>
                                    <div className="p-2 md:p-1">
                                        <button
                                            ref={menuView === 'main' ? lastButtonRef as React.RefObject<HTMLButtonElement> : null}
                                            onClick={handleMute}
                                            tabIndex={isOpen && menuView === 'main' ? 0 : -1}
                                            className="w-full flex items-center gap-3 text-left px-3 py-3 text-base md:text-sm text-slate-700 dark:text-zinc-300 hover:text-white hover:bg-red-500 dark:hover:text-white dark:hover:bg-red-600 rounded-md transition-colors"
                                        >
                                            <BanIcon className="w-5 h-5 md:w-4 md:h-4" /> {t('article.mute', { source })}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Share Submenu */}
                            <div className={`transition-all duration-300 ease-in-out ${menuView === 'share' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 absolute top-0 pointer-events-none'}`}>
                                <div className="divide-y divide-slate-200 dark:divide-zinc-600">
                                    <div className="p-2 md:p-1">
                                        <button
                                            ref={menuView === 'share' ? firstButtonRef : null}
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuView('main'); }}
                                            tabIndex={isOpen && menuView === 'share' ? 0 : -1}
                                            className="w-full flex items-center gap-3 text-left px-3 py-3 text-base md:text-sm font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-zinc-600 dark:hover:text-white rounded-md transition-colors"
                                        >
                                            <ArrowLeftIcon className="w-5 h-5 md:w-4 md:h-4" /> {t('article.back')}
                                        </button>
                                    </div>
                                    {shareOptions.map((opt, index) => (
                                        <div className="p-2 md:p-1" key={opt.name}>
                                            <a
                                                ref={menuView === 'share' && index === shareOptions.length - 1 ? lastButtonRef as React.RefObject<HTMLAnchorElement> : null}
                                                href={opt.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                tabIndex={isOpen && menuView === 'share' ? 0 : -1}
                                                className="w-full flex items-center gap-3 text-left px-3 py-3 text-base md:text-sm text-slate-700 dark:text-zinc-300 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-zinc-600 dark:hover:text-white rounded-md transition-colors"
                                            >
                                                <span className="w-5 flex justify-center md:w-4">{opt.icon}</span> {opt.name}
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};


const ArticleCardComponent = forwardRef<HTMLElement, ArticleCardProps>(({ article, viewMode, isFavorite, onToggleFavorite, onMuteSource }, ref) => {
    const { t } = useTranslation();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [allowCardOverflow, setAllowCardOverflow] = useState(false);
    const menuTimerRef = useRef<number | null>(null);
    const [isAnimatingFavorite, setIsAnimatingFavorite] = useState(false);
    const prevIsFavorite = useRef(isFavorite);

    useEffect(() => {
        if (isMenuOpen) {
            // FIX: Calculate scrollbar width before hiding it to prevent content shift
            const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
            document.documentElement.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
            document.body.classList.add('body-no-scroll');
        } else {
            document.body.classList.remove('body-no-scroll');
            document.documentElement.style.setProperty('--scrollbar-width', '0px');
        }

        return () => {
            document.body.classList.remove('body-no-scroll');
            document.documentElement.style.setProperty('--scrollbar-width', '0px');
        };
    }, [isMenuOpen]);

    useEffect(() => {
        if (isFavorite && !prevIsFavorite.current) {
            setIsAnimatingFavorite(true);
            const timer = setTimeout(() => setIsAnimatingFavorite(false), 300);
            return () => clearTimeout(timer);
        }
        prevIsFavorite.current = isFavorite;
    }, [isFavorite]);


    const cardBaseClasses = "bg-white dark:bg-zinc-800 rounded-xl shadow-md hover:shadow-xl border border-slate-200 dark:border-zinc-700";

    const handleSetIsMenuOpen = useCallback((open: boolean) => {
        if (menuTimerRef.current) {
            clearTimeout(menuTimerRef.current);
            menuTimerRef.current = null;
        }

        if (open) {
            setAllowCardOverflow(true);
            setIsMenuOpen(true);
        } else {
            setIsMenuOpen(false);
            menuTimerRef.current = window.setTimeout(() => {
                setAllowCardOverflow(false);
            }, 300);
        }
    }, []);

    if (viewMode === 'grid') {
        const favoriteActiveClass = 'bg-yellow-400 text-yellow-900 hover:bg-yellow-500 dark:bg-yellow-500 dark:text-yellow-950 dark:hover:bg-yellow-400';
        const favoriteInactiveClass = 'bg-slate-100 dark:bg-zinc-700 text-slate-400 hover:text-yellow-400 hover:bg-slate-200 dark:hover:bg-zinc-600';
        const moreButtonClass = "p-3 rounded-full transition-all duration-200 bg-slate-100 dark:bg-zinc-700 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-600";

        return (
            <a ref={ref as React.ForwardedRef<HTMLAnchorElement>} href={article.link} target="_blank" rel="noopener noreferrer" className={`group ${cardBaseClasses} flex flex-col relative ${allowCardOverflow ? '!overflow-visible z-30' : 'overflow-hidden'} transition-shadow duration-300`}>
                <div className="relative overflow-hidden rounded-t-xl backface-hidden will-change-transform">
                    <img src={article.imageUrl} alt={article.title} className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-500 transform-gpu" loading="lazy" decoding="async" />
                    <div className="absolute top-3 left-3">
                        <LanguageTag language={article.language} />
                    </div>
                    <div className="absolute bottom-0 left-0 bg-indigo-500 text-white px-2 py-1 text-xs font-bold rounded-tr-lg">{article.source}</div>
                </div>
                <div className="p-4 flex flex-col flex-grow">
                    <h3 className="text-lg font-semibold mb-2 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">{article.title}</h3>
                    <p className="text-sm text-slate-600 dark:text-zinc-400 flex-grow line-clamp-3">{article.summary}</p>
                    <div className="mt-auto pt-4 flex justify-between items-center">
                        <p className="text-sm text-slate-500 dark:text-zinc-400">{formatPublicationDate(article.publicationDate, t)}</p>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={(e) => { e.preventDefault(); onToggleFavorite(article.id); }}
                                className={`p-3 rounded-full transition-all duration-200 ${isFavorite ? favoriteActiveClass : favoriteInactiveClass}`}
                                aria-label={isFavorite ? t('article.removeFromFavorites') : t('article.addToFavorites')}
                            >
                                <StarIcon className={`w-5 h-5 ${isAnimatingFavorite ? 'animate-pop-in' : ''}`} />
                            </button>
                            <MoreOptionsMenu
                                title={article.title}
                                source={article.source}
                                link={article.link}
                                onMuteSource={onMuteSource}
                                isOpen={isMenuOpen}
                                setIsOpen={handleSetIsMenuOpen}
                                buttonClassName={moreButtonClass}
                            />
                        </div>
                    </div>
                </div>
            </a>
        );
    }

    if (viewMode === 'list') {
        const favoriteActiveClass = 'bg-yellow-400 text-yellow-900 hover:bg-yellow-500 dark:bg-yellow-500 dark:text-yellow-950 dark:hover:bg-yellow-400';
        const favoriteInactiveClass = 'bg-slate-100 dark:bg-zinc-700 text-slate-400 hover:text-yellow-400 hover:bg-slate-200 dark:hover:bg-zinc-600';
        const moreButtonClass = "p-3 rounded-full transition-all duration-200 bg-slate-100 dark:bg-zinc-700 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-600";
        return (
            <a
                ref={ref as React.ForwardedRef<HTMLAnchorElement>}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className={`group ${cardBaseClasses} flex flex-col md:flex-row items-center relative ${allowCardOverflow ? '!overflow-visible z-30' : 'overflow-hidden'} transition-shadow duration-300`}
            >
                <div className="relative w-full md:w-1/4 lg:w-1/5 h-44 flex-shrink-0 rounded-t-xl md:rounded-l-xl md:rounded-r-none overflow-hidden backface-hidden will-change-transform">
                    <img
                        src={article.imageUrl}
                        alt={article.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 transform-gpu"
                        loading="lazy"
                        decoding="async"
                    />
                </div>
                <div className="p-4 flex-grow w-full md:w-3/4 lg:w-4/5 flex flex-col">
                    <div className="flex justify-between items-start mb-2 gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 px-2 py-1 text-xs font-bold rounded flex-shrink-0">
                                {article.source}
                            </span>
                            <LanguageTag language={article.language} />
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={(e) => { e.preventDefault(); onToggleFavorite(article.id); }}
                                className={`p-3 rounded-full transition-all duration-200 ${isFavorite ? favoriteActiveClass : favoriteInactiveClass}`}
                                aria-label={isFavorite ? t('article.removeFromFavorites') : t('article.addToFavorites')}
                            >
                                <StarIcon className={`w-5 h-5 ${isAnimatingFavorite ? 'animate-pop-in' : ''}`} />
                            </button>
                            <MoreOptionsMenu
                                title={article.title}
                                source={article.source}
                                link={article.link}
                                onMuteSource={onMuteSource}
                                isOpen={isMenuOpen}
                                setIsOpen={handleSetIsMenuOpen}
                                buttonClassName={moreButtonClass}
                            />
                        </div>
                    </div>
                    <h3 className="text-xl font-bold mb-2 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">
                        {article.title}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-zinc-400 line-clamp-2 flex-grow">
                        {article.summary}
                    </p>
                    <div className="mt-auto pt-2">
                        <span className="text-sm text-slate-500 dark:text-zinc-400 flex-shrink-0">
                            {formatPublicationDate(article.publicationDate, t)}
                        </span>
                    </div>
                </div>
            </a>
        );
    }

    if (viewMode === 'compact') {
        const favoriteActiveClass = 'bg-yellow-400 text-yellow-900 hover:bg-yellow-500 dark:bg-yellow-500 dark:text-yellow-950 dark:hover:bg-yellow-400';
        const favoriteInactiveClass = 'text-slate-400 hover:text-yellow-400 hover:bg-slate-200 dark:hover:bg-zinc-700';
        const moreButtonClass = 'p-3 rounded-full transition-all duration-200 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700';

        return (
            <a
                ref={ref as React.ForwardedRef<HTMLAnchorElement>}
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className={`group ${cardBaseClasses} p-3 flex items-center justify-between gap-4 even:bg-slate-100 dark:even:bg-zinc-900/20 relative ${allowCardOverflow ? '!overflow-visible z-30' : ''} transition-shadow duration-200`}
            >
                <div className="flex-grow overflow-hidden">
                    <h3 className="text-md font-semibold line-clamp-3 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">
                        {article.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400 mt-1">
                        <span className="font-medium text-slate-700 dark:text-zinc-300 flex-shrink-0">{formatPublicationDate(article.publicationDate, t)}</span>
                        <span className="text-slate-500 dark:text-zinc-400">·</span>
                        <span className="truncate">{article.source}</span>
                        <span className="text-slate-500 dark:text-zinc-400">·</span>
                        <span className="uppercase">{article.language}</span>
                    </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            onToggleFavorite(article.id);
                        }}
                        className={`p-3 rounded-full transition-all duration-200 ${isFavorite ? favoriteActiveClass : favoriteInactiveClass}`}
                        aria-label={isFavorite ? t('article.removeFromFavorites') : t('article.addToFavorites')}
                    >
                        <StarIcon className={`w-5 h-5 ${isAnimatingFavorite ? 'animate-pop-in' : ''}`} />
                    </button>
                    <MoreOptionsMenu
                        title={article.title}
                        source={article.source}
                        link={article.link}
                        onMuteSource={onMuteSource}
                        isOpen={isMenuOpen}
                        setIsOpen={handleSetIsMenuOpen}
                        buttonClassName={moreButtonClass}
                    />
                </div>
            </a>
        );
    }

    return null;
});

ArticleCardComponent.displayName = 'ArticleCard';

const propsAreEqual = (prevProps: Readonly<ArticleCardProps>, nextProps: Readonly<ArticleCardProps>) => {
    return (
        prevProps.isFavorite === nextProps.isFavorite &&
        prevProps.viewMode === nextProps.viewMode &&
        prevProps.article.id === nextProps.article.id &&
        prevProps.article.imageUrl === nextProps.article.imageUrl &&
        prevProps.article.title === nextProps.article.title
    );
};

export const ArticleCard = memo(ArticleCardComponent, propsAreEqual) as typeof ArticleCardComponent;