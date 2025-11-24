import type { FeedSource } from '../types';

/**
 * This is the initial set of feeds that will be loaded into the user's
 * local storage on their first visit. After that, the list of feeds
 * will be managed entirely through the Admin Panel.
 */
export const INITIAL_FEEDS: FeedSource[] = [
    // Primary Feeds (15 min update interval)
    { id: '4p', url: 'https://www.4p.de/feed', name: '4P', language: 'de', priority: 'primary', update_interval: 15 },
    { id: 'game-informer', url: 'https://gameinformer.com/rss.xml', name: 'Game Informer', language: 'en', priority: 'primary', update_interval: 15 },
    { id: 'gamepro', url: 'https://www.gamepro.de/rss/gamepro.rss', name: 'GamePro', language: 'de', priority: 'primary', update_interval: 15 },
    { id: 'gamespot', url: 'https://www.gamespot.com/feeds/mashup', name: 'GameSpot', language: 'en', priority: 'primary', update_interval: 15 },
    { id: 'gamestar', url: 'https://www.gamestar.de/rss/gamestar.rss', name: 'GameStar', language: 'de', priority: 'primary', update_interval: 15 },
    { id: 'gematsu', url: 'https://www.gematsu.com/feed', name: 'Gematsu', language: 'en', priority: 'primary', update_interval: 15, needsScraping: true },
    { id: 'ign-de', url: 'https://de.ign.com/feed.xml', name: 'IGN', language: 'de', priority: 'primary', update_interval: 15 },
    { id: 'kotaku', url: 'https://kotaku.com/rss', name: 'Kotaku', language: 'en', priority: 'primary', update_interval: 15 },
    { id: 'mein-mmo', url: 'https://mein-mmo.de/feed/', name: 'Mein-MMO', language: 'de', priority: 'primary', update_interval: 15 },
    { id: 'pc-gamer', url: 'https://www.pcgamer.com/rss/', name: 'PC Gamer', language: 'en', priority: 'primary', update_interval: 15 },
    { id: 'pc-games', url: 'https://www.pcgames.de/feed.cfm?menu_alias=home', name: 'PC Games', language: 'de', priority: 'primary', update_interval: 15 },
    { id: 'polygon', url: 'https://www.polygon.com/rss/news/index.xml', name: 'Polygon', language: 'en', priority: 'primary', update_interval: 15 },
    // Secondary Feeds (60 min update interval)
    { id: 'buffed', url: 'https://www.buffed.de/feed.cfm', name: 'Buffed', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'computer-bild', url: 'https://www.computerbild.de/rssfeed_2261.html?node=12', name: 'Computer Bild', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'computerbase', url: 'https://www.computerbase.de/rss/news.xml', name: 'ComputerBase', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'destructoid', url: 'https://www.destructoid.com/feed/', name: 'Destructoid', language: 'en', priority: 'secondary', update_interval: 60 },
    { id: 'eurogamer-de', url: 'https://www.eurogamer.de/feed', name: 'Eurogamer', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'gamersglobal', url: 'https://www.gamersglobal.de/feeds/all', name: 'GamersGlobal', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'gamesradar+', url: 'https://www.gamesradar.com/feeds.xml', name: 'GamesRadar+', language: 'en', priority: 'secondary', update_interval: 60 },
    { id: 'gameswelt', url: 'https://www.gameswelt.ch/feeds/artikel/rss.xml', name: 'GamesWelt', language: 'de', priority: 'secondary', update_interval: 60, needsScraping: true },
    { id: 'gameswirtschaft', url: 'https://www.gameswirtschaft.de/feed/', name: 'GamesWirtschaft', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'gamezone', url: 'https://www.gamezone.de/feed.cfm?menu_alias=home/', name: 'GameZone', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'giant-bomb', url: 'https://giantbomb.com/feeds/news', name: 'Giant Bomb', language: 'en', priority: 'secondary', update_interval: 60 },
    { id: 'giga-games', url: 'https://www.giga.de/games/feed/', name: 'GIGA Games', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'golem', url: 'https://rss.golem.de/rss.php?feed=ATOM1.0&tp=games', name: 'Golem', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'heise-online', url: 'https://www.heise.de/rss/heise-atom.xml', name: 'Heise Online', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'jpgames', url: 'https://jpgames.de/feed/', name: 'JPGames', language: 'de', priority: 'secondary', update_interval: 60, needsScraping: true },
    { id: 'nintendo-life', url: 'https://www.nintendolife.com/feeds/latest', name: 'Nintendo Life', language: 'en', priority: 'secondary', update_interval: 60 },
    { id: 'pc-games-hardware', url: 'https://www.pcgameshardware.de/feed.cfm?menu_alias=home', name: 'PC Games Hardware', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'pcgamesn', url: 'https://pcgamesn.com/mainrss.xml', name: 'PCGamesN', language: 'en', priority: 'secondary', update_interval: 60 },
    { id: 'pixelcritics', url: 'https://pixelcritics.com/feed', name: 'PixelCritics', language: 'de', priority: 'secondary', update_interval: 60, needsScraping: true },
    { id: 'play3', url: 'https://www.play3.de/feed/rss/', name: 'Play3', language: 'de', priority: 'secondary', update_interval: 60, needsScraping: true },
    { id: 'playfront', url: 'https://playfront.de/feed/', name: 'PlayFront', language: 'de', priority: 'secondary', update_interval: 60, needsScraping: true },
    { id: 'playstation-blog', url: 'https://blog.playstation.com/feed/', name: 'PlayStation.Blog', language: 'en', priority: 'secondary', update_interval: 60, needsScraping: true },
    { id: 'playstationinfo', url: 'https://www.playstationinfo.de/feed/', name: 'PlayStationInfo', language: 'de', priority: 'secondary', update_interval: 60, needsScraping: true },
    { id: 'rock-paper-shotgun', url: 'https://www.rockpapershotgun.com/feed', name: 'Rock Paper Shotgun', language: 'en', priority: 'secondary', update_interval: 60 },
    { id: 'vg247', url: 'https://vg247.com/feed', name: 'VG247', language: 'en', priority: 'secondary', update_interval: 60 },
    { id: 'video-games-zone', url: 'https://www.videogameszone.de/feed.cfm', name: 'Video Games Zone', language: 'de', priority: 'secondary', update_interval: 60 },
    { id: 'xbox-wire', url: 'https://news.xbox.com/feed/', name: 'Xbox Wire', language: 'en', priority: 'secondary', update_interval: 60 },
    { id: 'xboxdynasty', url: 'https://www.xboxdynasty.de/cip_xd.rss.xml', name: 'XboxDynasty', language: 'de', priority: 'secondary', update_interval: 60, needsScraping: true },
];
