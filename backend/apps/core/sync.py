"""Which tables sync to phones, and whose they are (docs/EXPO_MIGRATION.md, "Change
tracking"). Sub-project 3's change-log triggers read the owner column of each row, so every
synced table carries one: `athlete` for training data, `gym` for the library. A new model
must be added to one of these lists; tests/unit/test_schema.py fails until it is, and checks
each synced table has its column.
"""

# Training data: the owning athlete's phone gets these rows.
BY_ATHLETE = [
    "accounts.BodyweightEntry",
    "accounts.MaxEntry",
    "accounts.Coaching",
    "programs.Program",
    "programs.ProgramWeek",
    "programs.ProgramDay",
    "programs.ProgramSession",
    "programs.Prescription",
    "programs.PrescribedSet",
    "programs.PrescriptionTag",
    "programs.Habit",
    "programs.HabitLog",
    "workouts.SessionLog",
    "workouts.SessionExercise",
    "workouts.SetLog",
    "workouts.CheckinAnswer",
    "workouts.IssueReport",
    "workouts.FormVideo",
    "messaging.Thread",
    "messaging.Message",
]

# Library data, shared by a gym. Templates aren't synced yet (coaching is online-only at
# first) but carry the column already, for offline coach editing later.
BY_GYM = [
    "exercises.Category",
    "exercises.Tag",
    "exercises.Exercise",
    "exercises.ExerciseTag",
    "exercises.TrackedLift",
    "programs.WeekType",
    "library.Template",
    "library.TemplateWeek",
    "library.TemplateSession",
    "library.TemplateSlot",
    "library.TemplateSlotSet",
    "library.TemplateSlotTag",
    "library.TemplateHabit",
]

# A gym's default question (gym) or an athlete's own copy (athlete): exactly one is set.
BY_GYM_OR_ATHLETE = ["workouts.CheckinQuestion"]

# The owners themselves, and server-side or coach-only tables.
NOT_SYNCED = [
    "accounts.User",
    "accounts.Gym",
    "accounts.Coach",
    "accounts.Athlete",
    "accounts.GymMembership",
    "accounts.Invite",
    "programs.EditHistory",
    "library.TemplateApplication",
    "dashboard.Notification",
    "dashboard.BugReport",
    "ratelimit.Counter",
    "signin.LinkedIdentity",
    "signin.EmailCode",
    "signin.DeviceSession",
    "signin.RefreshToken",
    "billing.Plan",
    "billing.Subscription",
    "billing.StripeEvent",
    "sync.Change",
    "sync.SyncAction",
]
