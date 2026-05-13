export const BADGES = [
  // ── Sessions ───────────────────────────────────────────────────────────────
  {
    id: 'first_session',
    title: 'First Words',
    desc: 'Complete your first training session',
    icon: 'mic',
    color: '#60A5FA',
    check: ({ sessions }) => sessions.length >= 1,
  },
  {
    id: 'sessions_5',
    title: 'Warming Up',
    desc: 'Complete 5 training sessions',
    icon: 'mic',
    color: '#3B82F6',
    check: ({ sessions }) => sessions.length >= 5,
  },
  {
    id: 'sessions_25',
    title: 'Seasoned Speaker',
    desc: 'Complete 25 training sessions',
    icon: 'mic',
    color: '#1D4ED8',
    check: ({ sessions }) => sessions.length >= 25,
  },

  // ── Streaks ────────────────────────────────────────────────────────────────
  {
    id: 'streak_3',
    title: 'Habit Forming',
    desc: 'Reach a 3-day streak',
    icon: 'flame',
    color: '#FB923C',
    check: ({ streak }) => streak >= 3,
  },
  {
    id: 'streak_7',
    title: 'On Fire',
    desc: 'Reach a 7-day streak',
    icon: 'flame',
    color: '#EF4444',
    check: ({ streak }) => streak >= 7,
  },
  {
    id: 'streak_30',
    title: 'Unstoppable',
    desc: 'Reach a 30-day streak',
    icon: 'flame',
    color: '#7F1D1D',
    check: ({ streak }) => streak >= 30,
  },

  // ── Challenges ─────────────────────────────────────────────────────────────
  {
    id: 'first_challenge',
    title: 'Challenge Accepted',
    desc: 'Complete your first challenge',
    icon: 'trophy',
    color: '#F59E0B',
    check: ({ completedCount }) => completedCount >= 1,
  },
  {
    id: 'all_easy',
    title: 'Easy Does It',
    desc: 'Complete all Easy challenges',
    icon: 'checkmark-circle',
    color: '#22C55E',
    check: ({ easyDone, easyTotal }) => easyDone >= easyTotal,
  },
  {
    id: 'all_medium',
    title: 'Rising Up',
    desc: 'Complete all Medium challenges',
    icon: 'shield',
    color: '#F97316',
    check: ({ mediumDone, mediumTotal }) => mediumDone >= mediumTotal,
  },
  {
    id: 'all_hard',
    title: 'The Hard Way',
    desc: 'Complete all Hard challenges',
    icon: 'flash',
    color: '#EF4444',
    check: ({ hardDone, hardTotal }) => hardDone >= hardTotal,
  },
  {
    id: 'all_challenges',
    title: 'Completionist',
    desc: 'Complete every single challenge',
    icon: 'star',
    color: '#F43F5E',
    check: ({ completedCount, totalChallenges }) => completedCount >= totalChallenges,
  },

  // ── Grades ─────────────────────────────────────────────────────────────────
  {
    id: 'grade_a',
    title: 'Top Marks',
    desc: 'Achieve an A grade on a session',
    icon: 'ribbon',
    color: '#10B981',
    check: ({ sessions }) => sessions.some(s => ['A+', 'A', 'A-'].includes(s.grade)),
  },
  {
    id: 'grade_a_3',
    title: 'Consistent Excellence',
    desc: 'Achieve 3 A grades',
    icon: 'ribbon',
    color: '#059669',
    check: ({ sessions }) => sessions.filter(s => ['A+', 'A', 'A-'].includes(s.grade)).length >= 3,
  },

  // ── Levels ─────────────────────────────────────────────────────────────────
  {
    id: 'level_ice_breaker',
    title: 'Ice Breaker',
    desc: 'Reach Ice Breaker level',
    icon: 'snow',
    color: '#7DD3FC',
    check: ({ levelIndex }) => levelIndex >= 1,
  },
  {
    id: 'level_champion',
    title: 'Champion',
    desc: 'Reach Champion level',
    icon: 'medal',
    color: '#F59E0B',
    check: ({ levelIndex }) => levelIndex >= 4,
  },
];
