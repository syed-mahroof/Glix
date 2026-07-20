"""
backend/core/badge_constants.py

Single source of truth for all badge slug strings. Imported by
signals.py, tasks.py, and analytics_views.py so that renaming a badge
is a one-line change here rather than a grep-and-replace across the
codebase. The BADGE_META dict drives the frontend's display labels,
icons, and descriptions via the achievements API.
"""

# ─── Episode-count milestones ──────────────────────────────────────────────
BADGE_FIRST_EPISODE = "first_episode"
BADGE_HUNDRED_CLUB = "hundred_club"           # 100 episodes watched
BADGE_FIVE_HUNDRED_EPISODES = "five_hundred_episodes"  # 500 episodes
BADGE_THOUSAND_EPISODES = "thousand_episodes"           # 1 000 episodes

# ─── Binge badges ─────────────────────────────────────────────────────────
BADGE_BINGE_MASTER = "binge_master"           # 10 episodes of one show
BADGE_WEEKEND_BINGE = "weekend_binge"         # 5+ episodes on Sat or Sun
BADGE_SERIES_ADDICT = "series_addict"         # 5+ shows in watchlist

# ─── Time milestones ───────────────────────────────────────────────────────
BADGE_TIME_TITAN = "time_titan"               # 6 000 min (~100 h)
BADGE_HUNDRED_HOURS = "hundred_hours"         # 6 000 min (alias; same threshold)
BADGE_FIVE_HUNDRED_HOURS = "five_hundred_hours"  # 30 000 min
BADGE_THOUSAND_HOURS = "thousand_hours"           # 60 000 min

# ─── Streak badges ────────────────────────────────────────────────────────
BADGE_DAILY_STREAK_7 = "daily_streak_7"       # 7-day watch streak
BADGE_WEEKLY_STREAK_4 = "weekly_streak_4"     # watched every week for 4 weeks
BADGE_MONTHLY_STREAK_3 = "monthly_streak_3"   # watched every month for 3 months

# ─── Genre & content badges ────────────────────────────────────────────────
BADGE_GENRE_COLLECTOR = "genre_collector"     # watched shows in 5+ distinct genres
BADGE_MOVIE_LOVER = "movie_lover"             # 10+ movies watched (MovieWatchState)
BADGE_ANIME_FAN = "anime_fan"                 # watched 3+ shows tagged "Animation"
BADGE_SCI_FI_GURU = "sci_fi_guru"             # watched 3+ shows tagged "Sci-Fi & Fantasy"
BADGE_HORROR_LOVER = "horror_lover"           # watched 3+ shows tagged "Horror"
BADGE_COMEDY_KING = "comedy_king"             # watched 3+ shows tagged "Comedy"
BADGE_DOCUMENTARY_BUFF = "documentary_buff"   # watched 3+ shows tagged "Documentary"

# ─── Show-count milestones ────────────────────────────────────────────────
BADGE_HUNDRED_SHOWS = "hundred_shows"         # 100 distinct shows in watchlist

# ─── Threshold values (used in signals.py and tasks.py) ───────────────────
BINGE_MASTER_THRESHOLD = 10          # episodes of one show
HUNDRED_CLUB_THRESHOLD = 100         # total episodes
FIVE_HUNDRED_EPISODES_THRESHOLD = 500
THOUSAND_EPISODES_THRESHOLD = 1_000
TIME_TITAN_MINUTES = 6_000           # ~100 h
FIVE_HUNDRED_HOURS_MINUTES = 30_000
THOUSAND_HOURS_MINUTES = 60_000
GENRE_COLLECTOR_THRESHOLD = 5        # distinct genres
HUNDRED_SHOWS_THRESHOLD = 100        # distinct shows tracked
SERIES_ADDICT_THRESHOLD = 5          # shows in watchlist
GENRE_FAN_THRESHOLD = 3              # shows in a specific genre to earn genre badge
MOVIE_LOVER_THRESHOLD = 10           # movies watched (MovieWatchState rows)

# Genres matched against CachedShow.genres (TMDB genre strings)
ANIME_GENRES = {"Animation"}
SCI_FI_GENRES = {"Sci-Fi & Fantasy", "Science Fiction"}
HORROR_GENRES = {"Horror"}
COMEDY_GENRES = {"Comedy"}
DOCUMENTARY_GENRES = {"Documentary"}

# ─── Display metadata for the achievements API ─────────────────────────────
# Each entry: label, description, icon_name (lucide icon key used on frontend)
BADGE_DISPLAY: dict[str, dict] = {
    BADGE_FIRST_EPISODE: {
        "label": "First Episode",
        "description": "Watched your very first episode.",
        "icon": "Award",
        "category": "milestone",
    },
    BADGE_HUNDRED_CLUB: {
        "label": "Hundred Club",
        "description": "Watched 100 episodes. Impressive.",
        "icon": "Trophy",
        "category": "milestone",
    },
    BADGE_FIVE_HUNDRED_EPISODES: {
        "label": "Episode Machine",
        "description": "500 episodes watched. Absolute dedication.",
        "icon": "Zap",
        "category": "milestone",
    },
    BADGE_THOUSAND_EPISODES: {
        "label": "Legend",
        "description": "1 000 episodes. You live here.",
        "icon": "Star",
        "category": "milestone",
    },
    BADGE_BINGE_MASTER: {
        "label": "Binge Master",
        "description": "Watched 10+ episodes of one show in a session.",
        "icon": "Flame",
        "category": "binge",
    },
    BADGE_WEEKEND_BINGE: {
        "label": "Weekend Warrior",
        "description": "Watched 5+ episodes in a single weekend day.",
        "icon": "Coffee",
        "category": "binge",
    },
    BADGE_SERIES_ADDICT: {
        "label": "Series Addict",
        "description": "Tracking 5 or more shows simultaneously.",
        "icon": "Layers",
        "category": "binge",
    },
    BADGE_TIME_TITAN: {
        "label": "Time Titan",
        "description": "Over 100 hours of content consumed.",
        "icon": "Clock",
        "category": "time",
    },
    BADGE_HUNDRED_HOURS: {
        "label": "Century Hours",
        "description": "100 hours of watch time logged.",
        "icon": "Clock",
        "category": "time",
    },
    BADGE_FIVE_HUNDRED_HOURS: {
        "label": "Marathon Runner",
        "description": "500 hours of content — basically a full-time job.",
        "icon": "Activity",
        "category": "time",
    },
    BADGE_THOUSAND_HOURS: {
        "label": "Hall of Fame",
        "description": "1 000 hours. You belong in the record books.",
        "icon": "Crown",
        "category": "time",
    },
    BADGE_DAILY_STREAK_7: {
        "label": "Week Streak",
        "description": "Watched something every day for 7 days straight.",
        "icon": "TrendingUp",
        "category": "streak",
    },
    BADGE_WEEKLY_STREAK_4: {
        "label": "Monthly Habit",
        "description": "Watched every week for 4 consecutive weeks.",
        "icon": "Calendar",
        "category": "streak",
    },
    BADGE_MONTHLY_STREAK_3: {
        "label": "Quarterly Viewer",
        "description": "Watched every month for 3 consecutive months.",
        "icon": "CalendarCheck",
        "category": "streak",
    },
    BADGE_GENRE_COLLECTOR: {
        "label": "Genre Collector",
        "description": "Explored 5 or more distinct genres.",
        "icon": "Grid",
        "category": "genre",
    },
    BADGE_ANIME_FAN: {
        "label": "Anime Fan",
        "description": "Watched 3+ animated series.",
        "icon": "Sparkles",
        "category": "genre",
    },
    BADGE_SCI_FI_GURU: {
        "label": "Sci-Fi Guru",
        "description": "Deep in the stars with 3+ sci-fi shows.",
        "icon": "Rocket",
        "category": "genre",
    },
    BADGE_HORROR_LOVER: {
        "label": "Horror Lover",
        "description": "Brave enough for 3+ horror series.",
        "icon": "Ghost",
        "category": "genre",
    },
    BADGE_COMEDY_KING: {
        "label": "Comedy King",
        "description": "Laughed through 3+ comedy shows.",
        "icon": "Smile",
        "category": "genre",
    },
    BADGE_DOCUMENTARY_BUFF: {
        "label": "Documentary Buff",
        "description": "3+ documentaries. Knowledge is power.",
        "icon": "BookOpen",
        "category": "genre",
    },
    BADGE_HUNDRED_SHOWS: {
        "label": "Century Shows",
        "description": "100 shows in your watchlist. Incredible.",
        "icon": "List",
        "category": "milestone",
    },
    BADGE_MOVIE_LOVER: {
        "label": "Movie Lover",
        "description": "Watched 10+ movies. A true fan of the silver screen.",
        "icon": "Film",
        "category": "milestone",
    },
}

# Ordered list used by the achievements endpoint for consistent display order
BADGE_ORDER = [
    BADGE_FIRST_EPISODE,
    BADGE_BINGE_MASTER,
    BADGE_HUNDRED_CLUB,
    BADGE_FIVE_HUNDRED_EPISODES,
    BADGE_THOUSAND_EPISODES,
    BADGE_TIME_TITAN,
    BADGE_HUNDRED_HOURS,
    BADGE_FIVE_HUNDRED_HOURS,
    BADGE_THOUSAND_HOURS,
    BADGE_DAILY_STREAK_7,
    BADGE_WEEKLY_STREAK_4,
    BADGE_MONTHLY_STREAK_3,
    BADGE_WEEKEND_BINGE,
    BADGE_SERIES_ADDICT,
    BADGE_GENRE_COLLECTOR,
    BADGE_ANIME_FAN,
    BADGE_SCI_FI_GURU,
    BADGE_HORROR_LOVER,
    BADGE_COMEDY_KING,
    BADGE_DOCUMENTARY_BUFF,
    BADGE_HUNDRED_SHOWS,
    BADGE_MOVIE_LOVER,
]
