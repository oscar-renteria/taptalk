Yes. For this kind of language-practice interaction, I’d make the mobile experience **much more task-focused** than the desktop version. The user is essentially doing one thing repeatedly:

> **See → think → answer → get feedback → continue**

Everything that doesn't support that loop should become secondary.

### 1. Make the question the entire mobile experience

On mobile, I would remove the large hero area (“Ready when you are”) once the session starts. It consumes valuable vertical space without helping with the current task.

A better structure:

```text
┌─────────────────────────┐
│ ←  1 / 45          ⋮    │
│                         │
│ ━━━━━━━━━░░░░░░░░       │
│                         │
│ 🔊                       │
│ Das war knapp!          │
│ [det vas klɑp]          │
│                         │
│ Your answer             │
│ ┌─────────────────────┐ │
│ │ That was close!     │ │
│ └─────────────────────┘ │
│                         │
│ ✓ Correct! +10 points   │
│                         │
│                         │
│ ┌─────────────────────┐ │
│ │    Next question →  │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

The user's attention should be almost entirely on the **current exercise**.

---

## 2. Use a sticky bottom action

This is probably the biggest interaction improvement.

On mobile, the primary action should live near the thumb:

**Before answering**

> `Check answer`

**After answering**

> `Next question →`

The button can remain fixed at the bottom while the exercise content scrolls behind it.

This follows a very common mobile pattern: **one persistent primary CTA**, with secondary actions visually subordinate.

I would avoid having both:

* Next question
* End session

at equal visual weight.

Instead:

```text
┌─────────────────────────┐
│                         │
│                         │
│                         │
│                         │
├─────────────────────────┤
│       Next question →   │  ← primary
│                         │
│        End session      │  ← text link
└─────────────────────────┘
```

"End session" is important, but it shouldn't compete with the action that advances the exercise.

---

## 3. Turn progress into a compact session indicator

The current desktop design gives progress a lot of space.

On mobile I'd use:

**1 of 45 · 2%**

plus a thin progress bar.

Or even:

```text
1 / 45
━━━━░░░░░░░░░░
```

I'd also consider showing **session progress rather than a percentage**. “2% complete” doesn't mean much when the user has just started.

For example:

> **Question 1 of 45**

is immediately understandable.

---

## 4. Optimize the keyboard interaction

This is especially important for a language-learning app.

When the user taps the answer field:

1. Keyboard opens.
2. Input receives focus.
3. The answer area remains visible.
4. The primary action moves above the keyboard or is otherwise reachable.
5. Pressing **Return/Done** can submit the answer.

Ideally the user shouldn't have to:

> type → dismiss keyboard → scroll → find button → tap

Instead:

> **type → Done → immediate feedback**

That's a much better mobile loop.

I'd also make the input fairly large—around **48–52px tall**—rather than the relatively small desktop field in the original.

---

## 5. Make feedback a state transition, not just a message

The current:

> ✓ Correct. +10 points.

is good, but mobile gives you an opportunity to make the interaction feel much more responsive.

### Before answer

```text
Das war knapp!

Your answer
[ That was close!       ]

       Check answer
```

### Correct

```text
✓ Correct!

That was close!

+10 points

       Next question →
```

### Incorrect

```text
✕ Not quite

Your answer:
I was close

Expected:
That was close.

       Try again
```

The important pattern is **stateful UI**: the card changes based on what happened rather than simply appending another notification below it.

---

## 6. Consider making the translation secondary

The German phrase should dominate visually.

Something like:

```text
🔊

Das war knapp!

[det vaːs knap]

──────────────

Your answer
[ That was close! ]
```

The pronunciation is useful, but shouldn't compete with the phrase.

I'd also make the speaker button a generous touch target:

**44–48px minimum**, preferably larger.

And give it a subtle active state so the user knows audio playback happened.

---

# 7. Use a “one exercise = one screen” pattern

This is probably the most appropriate overall interaction model.

Rather than treating the app as a webpage, treat it more like a **flashcard / quiz flow**.

Common interaction patterns include:

### Flashcard

```text
      phrase

       ↓

     answer

       ↓

    feedback

       ↓

      next
```

### Quiz

```text
Question 1 / 45

       ↓

Answer

       ↓

Check

       ↓

Correct / incorrect

       ↓

Next
```

### Conversational learning

You could go even further and make the experience feel like a conversation:

```text
          TAPTALK

     Das war knapp!

        🔊  Listen

  What does this mean?

  ┌───────────────────┐
  │ That was close!   │
  └───────────────────┘

      ✓ Correct!

   +10 points

  ┌───────────────────┐
  │ Next question →   │
  └───────────────────┘
```

For a language-learning product, I think this is particularly natural.

---

# 8. Don't put the desktop navigation on the mobile screen

The current:

> Practice | Progress | Settings | Import vocabulary

is appropriate as desktop navigation, but I wouldn't simply shrink it.

On mobile I'd use something like:

```text
┌─────────────────────────┐
│ TAPTALK        ⋮        │
└─────────────────────────┘
```

and potentially a bottom navigation for persistent sections:

```text
┌─────────────────────────┐
│  Practice  Progress  Me │
└─────────────────────────┘
```

But **during an active exercise**, I'd actually hide most navigation.

The user is in a focused mode.

---

# 9. Add an explicit “session mode”

One of the strongest changes I'd make is separating:

### Dashboard mode

```text
Welcome back, Oscar

Today's practice
45 questions

[ Start practice ]

Progress
Vocabulary
Settings
```

from:

### Practice mode

```text
← Exit             1 / 45

Das war knapp!

[answer]

✓ Correct! +10

[ Next question → ]
```

This is a common and useful product pattern: **focused mode**.

Once the user starts practicing, the interface gets out of their way.

---

# 10. Use gestures carefully

There is an opportunity for swipe interaction, but I wouldn't make it the only way to progress.

For example:

**Swipe left → next question**

could be a nice accelerator for experienced users.

But the visible button should remain.

Similarly, tapping the card could reveal a translation or hint, but don't make essential functionality discoverable only through gestures.

A good rule is:

> **Gestures accelerate the interaction; buttons explain it.**

---

# 11. Give the user a sense of momentum

For repeated exercises, tiny bits of progress feedback can be surprisingly effective:

```text
Question 7 / 20

━━━━━━━░░░░░░░

🔥 7 day streak
+10 XP
```

But I'd keep this subordinate to the exercise.

The most important feedback is:

> **I answered correctly → I'm making progress → here's the next thing.**

You could even animate the progress bar very subtly after a successful answer.

---

# 12. Consider a bottom sheet for secondary information

Things like:

* vocabulary details
* grammatical explanation
* alternative translations
* conjugation
* "Why was my answer wrong?"
* report an issue

don't need to clutter the main exercise.

Use a small link:

> **Why?**

which opens a bottom sheet:

```text
┌─────────────────────────┐
│        Why?             │
│                         │
│ "knapp" means "close"   │
│ in the sense of being   │
│ narrowly avoided.       │
│                         │
│ "Das war knapp!"        │
│ literally: "That was    │
│ close!"                 │
│                         │
│          Done           │
└─────────────────────────┘
```

That's a very mobile-friendly way of handling educational depth without interrupting the exercise.

---

# My recommended mobile hierarchy

I'd boil the entire interface down to this:

```text
        ←        7 / 45       ⋮

        ━━━━━━━━━━━░░░░

             🔊

       Das war knapp!

       [det vaːs knap]

       What does this mean?

       ┌───────────────────┐
       │ That was close!   │
       └───────────────────┘


       ✓ Correct!
       +10 points


┌─────────────────────────────┐
│       Next question →       │
└─────────────────────────────┘

             End session
```

### The underlying interaction pattern

**Focused task → single input → immediate feedback → single next action**

That's the pattern I'd optimize around.

The current design is already visually pleasant, but it still thinks like a **desktop webpage**. For mobile, I'd make it behave more like a **dedicated learning instrument**: minimal navigation, large touch targets, keyboard-first input, persistent primary action, immediate feedback, and one exercise occupying the user's attention at a time.

---

# Designs

The two designs below apply the principles above. Both are on one design canvas:
**https://claude.ai/artifact/8EeHCLcT3wx4qP4LnrgBFH**. The canvas is private: share it from its Share menu before linking it elsewhere. The desktop practice screen is a clickable prototype (press Play on the canvas); the phone screens are static, one per state.

The sketches here are simplified. For exact colours, sizes and spacing, go by the canvas.

## Shared foundations

| Token | Value | Use |
|---|---|---|
| Ground | `#FBF8F1` | Page background |
| Ink | `#1F2A24` | Text, "Check answer" button, score pill |
| Accent | `#B4533A` | Primary action, progress bar, active tab |
| Success | `#2F6B4F` on `#E7F1EA` | Correct state |
| Miss | `#9A4A15` / `#6E330C` on `#FBEEE2` | Incorrect state (differs from success in lightness too, not only hue) |
| Muted text | `#5E665F` | Secondary text (≥ 4.5:1 on ground) |
| Display font | Newsreader | Phrase, answer input, headings |
| Body font | Instrument Sans | UI text |
| IPA font | Noto Sans | Pronunciation (full IPA glyph coverage) |

Rules used on every screen: touch targets ≥ 44 px, the primary button 52–56 px tall, a visible focus ring, real `<button>`/`<input>`/`<label>` elements, and `lang="de"` on German text so screen readers pronounce it correctly.

## Design 1 — Desktop

### 1a. Dashboard mode

Tabs belong here and only here. The hero headline from the old screen moves here as well: it welcomes you *before* a session, not during one. You pick the direction before starting.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆ TapTalk   Practice  Progress  Vocabulary  Settings              (O) oscar ▾│
│             ═══════                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│  TODAY'S PRACTICE                                                            │
│  Welcome back, oscar.                          ┌───────────────────────────┐ │
│                                                │ ▣ Progress              › │ │
│  45 phrases are ready. …                       └───────────────────────────┘ │
│                                                ┌───────────────────────────┐ │
│  Direction                                     │ ▣ Vocabulary            › │ │
│  [ German → English | English → German ]       └───────────────────────────┘ │
│                                                ┌───────────────────────────┐ │
│  [  Start practice →  ]   45 questions         │ ▣ Settings              › │ │
│                                                └───────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

- "Import vocabulary" becomes **Vocabulary**; importing is one action inside it.
- "Log out" moves into the account menu (`oscar ▾`).

### 1b. Practice mode (focused)

No tabs. The only ways out are **Exit** and **End session**.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [‹ Exit]              Question 7 of 45                  🔥 3 in a row  60 pts ⋮│
│                    ━━━━━━━━░░░░░░░░░░░░░░░░                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│              ┌──────────────────────────────────────────────┐                │
│              │ (🔊) Listen                                  │                │
│              │ Das war knapp!                               │                │
│              │ [das vaːɐ̯ ˈknap]                             │                │
│              ├──────────────────────────────────────────────┤                │
│              │ What does this mean?                         │                │
│              │ Your answer                                  │                │
│              │ ┌──────────────────────────────────────────┐ │                │
│              │ │ That was close!                          │ │                │
│              │ └──────────────────────────────────────────┘ │                │
│              ├──────────────────────────────────────────────┤                │
│              │ ✓ Correct!  +10 points · 3 in a row    Why?  │  ← state band  │
│              ├──────────────────────────────────────────────┤                │
│              │ [        Next question →        Enter      ] │  ← one primary │
│              └──────────────────────────────────────────────┘                │
│                                  End session                  ← text link    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Design 2 — Phone (390 × 844)

Five screens, one per step of the loop. There is no bottom navigation during practice.

```text
 1 Home                2 Answering           3 Correct             4 Not quite           5 Why? sheet
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ ◆ TAPTALK      ⋮ │  │ ‹    1 / 45    ⋮ │  │ ‹    1 / 45    ⋮ │  │ ‹    1 / 45    ⋮ │  │░░░░░░░░░░░░░░░░░░│
│                  │  │ ━░░░░░░░░░░░░░░░ │  │ ━░░░░░░░░░░░░░░░ │  │ ━░░░░░░░░░░░░░░░ │  │░░ (dimmed      ░░│
│ TODAY'S PRACTICE │  │ (🔊)             │  │ (🔊)             │  │ (🔊)             │  │░░  exercise)   ░░│
│ Welcome back,    │  │ Das war knapp!   │  │ Das war knapp!   │  │ Das war knapp!   │  │┌────────────────┐│
│ oscar.           │  │ [das vaːɐ̯ ˈknap] │  │ [das vaːɐ̯ ˈknap] │  │ [das vaːɐ̯ ˈknap] ││      ───       ││
│ ┌──────────────┐ │  │ ──────────────── │  │ ──────────────── │  │ ──────────────── │  ││ Why?           ││
│ │ 45           │ │  │ What does this   │  │ What does this   │  │ ✕ Not quite Why? │  ││ Das war knapp! ││
│ │ questions    │ │  │ mean?            │  │ mean?            │  │ Your answer      │  ││ → That was     ││
│ │ [DE → EN ▾]  │ │  │ Your answer      │  │ [That was close✓]│  │  I was close     │  ││   close!       ││
│ │[Start pract.]│ │  │ [That was close!]│  │ ✓ Correct!  Why? │  │ Expected         │  ││ "Knapp" means… ││
│ └──────────────┘ │  ├──────────────────┤  │   +10 points     │  │  That was close! │  ││ Literally: …   ││
│                  │  │ [ Check answer ] │  │                  │  │                  │  ││ Also accepted  ││
│                  │  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│  ├──────────────────┤  ├──────────────────┤  ││ [    Done    ] ││
│                  │  │▒ system keyboard▒│  │ [Next question →]│  │ [  Try again   ] │  ││ Report problem ││
│ Practice Prog. Me│  │▒ Return submits ▒│  │   End session    │  │ Skip · End sess. │  │└────────────────┘│
└──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Interaction spec (both designs)

| State | Card / feedback | Primary action | Secondary |
|---|---|---|---|
| Answering | Input editable, focused on entry | **Check answer** (disabled while empty) | "I don't know" (desktop); keyboard Return = check |
| Correct | Green border + band; input locked | **Next question →** | Why?, End session |
| Not quite | Orange band with *Your answer* vs *Expected* | **Try again**: clears the input and hides the answer so you recall it | Why?, Skip question, End session |
| Second try | Hint: "Second try — type it from memory" | **Check answer** | — |
| Summary | Points, first-try accuracy, best streak | **Practise the n I missed** | Start a new session, Back to dashboard |

- **Enter / Return** triggers the primary action in every state (check → next or try again). After a new question appears, focus goes back into the input, so the loop never needs the mouse.
- Answers are matched ignoring case, punctuation and extra spaces. Each card can list alternative accepted answers.
- **Points:** +10 for a correct first try only. A second-try correct earns no points and doesn't count toward accuracy.
- **Speaker** uses the browser's `speechSynthesis` with `de-DE`. The button fills with the accent colour and reads "Playing…" while audio is playing.
- The **progress bar** fills when a question is answered, not when it is shown, and animates briefly (400 ms).
- **Mobile keyboard:** the input sets `enterkeyhint="done"`, and the action bar sits above the keyboard (use `visualViewport` or `interactive-widget=resizes-content`).

## Decisions and deviations from the text above

- **IPA:** the sketches in sections 1, 6 and "My recommended mobile hierarchy" use made-up transcriptions ("[det vas klɑp]"). The designs use `[das vaːɐ̯ ˈknap]`. The current production screen also shows the **English** IPA under the German prompt. This is likely a data bug to fix first.
- **Streaks:** the designs only show streaks *within a session* ("3 in a row"). A "7 day streak" needs stored history, which the practice screen doesn't have yet.
- **Swipe to next** (section 10) is not in the designs. It should only be added as an accelerator, after the button flow works.
- **Direction choice** happens on the dashboard, not in practice mode, which keeps the practice screen focused.

## Open questions

1. Does the backend already store alternative accepted answers and the text for "Why?" (explanation, literal translation), or is that a new content field per phrase?
2. Should "Exit" keep the session so you can resume later? In the designs, Exit goes straight back to the dashboard, while End session shows the summary first. If Exit doesn't keep the session, the two do the same job and one of them should go.
3. Does the score rule (no points on a second try) match how Progress calculates accuracy today?
