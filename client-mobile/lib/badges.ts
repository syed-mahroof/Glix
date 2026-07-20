// client-mobile/lib/badges.ts
// Shared badge metadata for the frontend. Maps icon name strings
// (returned by the backend achievements API) to lucide-react-native
// icon components. Imported by AchievementCard.tsx, achievements.tsx,
// and profile.tsx so the badge display is defined exactly once.

import {
  Activity,
  Award,
  BookOpen,
  Calendar,
  CheckSquare,
  Clock,
  Coffee,
  Crown,
  Film,
  Flame,
  Ghost,
  Grid,
  Layers,
  List,
  Rocket,
  Smile,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

/**
 * Maps icon name strings (from badge_constants.py BADGE_DISPLAY["icon"])
 * to the actual lucide-react-native icon component.
 * Any unmapped name falls back to Award in AchievementCard.
 */
export const BADGE_ICON_MAP: Record<string, LucideIcon> = {
  Award,
  Activity,
  BookOpen,
  Calendar,
  CalendarCheck: CheckSquare,   // lucide-rn doesn't have CalendarCheck; use CheckSquare
  Clock,
  Coffee,
  Crown,
  Film,
  Flame,
  Ghost,
  Grid,
  Layers,
  List,
  Rocket,
  Smile,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Zap,
};

/**
 * Minimal badge metadata for profile.tsx's existing badge grid.
 * Superseded by AchievementCard for the full achievements screen,
 * but kept here so profile.tsx can display known badges without
 * an API call.
 */
export interface BadgeMeta {
  label: string;
  icon: LucideIcon;
  /** Kept in sync with backend/core/badge_constants.py's BADGE_DISPLAY text
   *  so profile.tsx's badge grid and the BadgeUnlockModal (_layout.tsx) can
   *  show the real label/description instead of a raw slug. */
  description: string;
}

export const BADGE_META: Record<string, BadgeMeta> = {
  first_episode:        { label: 'First Episode',      icon: Award,      description: 'Watched your very first episode.' },
  binge_master:         { label: 'Binge Master',        icon: Flame,      description: 'Watched 10+ episodes of one show in a session.' },
  hundred_club:         { label: 'Hundred Club',        icon: Trophy,     description: 'Watched 100 episodes. Impressive.' },
  time_titan:           { label: 'Time Titan',          icon: Clock,      description: 'Over 100 hours of content consumed.' },
  five_hundred_episodes:{ label: 'Episode Machine',     icon: Zap,        description: '500 episodes watched. Absolute dedication.' },
  thousand_episodes:    { label: 'Legend',              icon: Star,       description: '1 000 episodes. You live here.' },
  weekend_binge:        { label: 'Weekend Warrior',     icon: Coffee,     description: 'Watched 5+ episodes in a single weekend day.' },
  series_addict:        { label: 'Series Addict',       icon: Layers,     description: 'Tracking 5 or more shows simultaneously.' },
  hundred_hours:        { label: 'Century Hours',       icon: Clock,      description: '100 hours of watch time logged.' },
  five_hundred_hours:   { label: 'Marathon Runner',     icon: Activity,   description: '500 hours of content — basically a full-time job.' },
  thousand_hours:       { label: 'Hall of Fame',        icon: Crown,      description: '1 000 hours. You belong in the record books.' },
  daily_streak_7:       { label: 'Week Streak',         icon: TrendingUp, description: 'Watched something every day for 7 days straight.' },
  weekly_streak_4:      { label: 'Monthly Habit',       icon: Calendar,   description: 'Watched every week for 4 consecutive weeks.' },
  monthly_streak_3:     { label: 'Quarterly Viewer',    icon: CheckSquare,description: 'Watched every month for 3 consecutive months.' },
  genre_collector:      { label: 'Genre Collector',     icon: Grid,       description: 'Explored 5 or more distinct genres.' },
  anime_fan:            { label: 'Anime Fan',           icon: Sparkles,   description: 'Watched 3+ animated series.' },
  sci_fi_guru:          { label: 'Sci-Fi Guru',         icon: Rocket,     description: 'Deep in the stars with 3+ sci-fi shows.' },
  horror_lover:         { label: 'Horror Lover',        icon: Ghost,      description: 'Brave enough for 3+ horror series.' },
  comedy_king:          { label: 'Comedy King',         icon: Smile,      description: 'Laughed through 3+ comedy shows.' },
  documentary_buff:     { label: 'Documentary Buff',    icon: BookOpen,   description: '3+ documentaries. Knowledge is power.' },
  hundred_shows:        { label: 'Century Shows',       icon: List,       description: '100 shows in your watchlist. Incredible.' },
  movie_lover:          { label: 'Movie Lover',         icon: Film,       description: 'Watched 10+ movies. A true fan of the silver screen.' },
};
