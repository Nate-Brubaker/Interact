# Interact - Claude Instructions

## Writing style (enforced everywhere)
- **No em dashes.** Never use — in any output: lesson content, challenge descriptions, UI strings, AI trainer prompts, code comments, or anywhere else. Use a regular hyphen (-) or rewrite the sentence instead.
- No ellipsis abuse. Use periods or restructure instead of trailing off...
- Write short, punchy sentences in content. Active voice. No filler phrases ("It's worth noting that", "Keep in mind that").

## Project overview
React Native / Expo (managed workflow) social skills training app. Four tabs: Learn, Trainer, Challenges, Profile.

## Tech stack
- **Framework:** React Native + Expo SDK 54
- **Navigation:** React Navigation - bottom tabs + nested native stacks per tab
- **State:** React Context (DataContext) for global sessions/XP/streak; local useState for screen-specific UI
- **Backend:** Supabase (auth, training_sessions, completed_challenges tables)
- **Storage:** AsyncStorage for profile name, avatar URI, settings, completed lessons
- **Styling:** StyleSheet.create + inline overrides for theme colors; no external UI library

## Key file locations
- `lib/api.js` - all Supabase calls (getSessions, saveSession, getCompletedChallenges, markChallengeComplete)
- `lib/DataContext.js` - global data provider; wrap mutations with `reload()` after writing
- `lib/theme.js` - LIGHT/DARK color tokens; always use `C.*` not hardcoded hex in screens
- `lib/levels.js` - XP level definitions and getLevel()
- `lib/streaks.js` - calcStreaks(), streakColor()
- `lib/profile.js` - getProfile(), calculateAge()
- `lib/settings.js` - getSettings(), saveSettings()
- `constants/lessons.js` - all lesson units with content cards, quiz, practice, challengeId
- `constants/challenges.js` - all challenge definitions with XP and difficulty
- `constants/badges.js` - badge definitions with check functions
- `components/StreakCard.js` - shared streak display component (calls useTheme() internally)
- `components/ActivityCalendar.js` - shared calendar heatmap (calls useTheme() internally)

## Architecture rules
- Screens import data from DataContext via `useData()`, not directly from Supabase
- After any write to Supabase, call `reload()` from DataContext to sync global state
- All Supabase access goes through `lib/api.js` - never import supabase client directly in screens
- Theme colors come from `const { colors: C, dark } = useTheme()` - never hardcode hex values in screens
- Shared components call `useTheme()` internally - do not pass `C` or `dark` as props to them
- Data files live in `constants/` (lessons, challenges, badges) - not in `data/`

## Lesson screen flow
Each lesson has 4 steps: Learn (content cards) -> Quiz (multiple choice) -> Practice (AI trainer link) -> Challenge (linked real-world challenge). Completing the final step marks the lesson done in AsyncStorage under key `learn_completed`.

## AI trainer
Scenarios: job_interview, networking, small_talk, new_friends, difficult. The AI plays a realistic character and grades sessions on confidence, clarity, energy, specificity, active_listening, and overall grade. Prompts must never use em dashes.

## Design tokens (lib/theme.js)
```
C.bg, C.bgAlt, C.card, C.cardAlt
C.text, C.textSec, C.textMuted
C.accent, C.accentLight
C.border, C.divider
C.success (#22C55E), C.warning (#F59E0B), C.danger (#EF4444)
```
