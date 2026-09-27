Act as a senior internationalization (i18n) engineer (Node.js + TypeScript + React Web/PWA application).

Your task is **only to implement production-grade localization** for the TapTalk.

Do NOT redesign the application, rewrite existing architecture, refactor unrelated code, or change existing functionality.

## Target languages

The application must support:

* English — `en`
* German — `de`
* Spanish — `es`

English should be the default/fallback locale unless the TapTalk already has an explicit default that should be preserved.

---

# 1. First inspect the TapTalk

Before making changes:

* identify the React entry point
* identify the build system
* identify routing
* identify whether SSR/SSG is used
* identify existing state management
* identify the PWA implementation
* identify the service worker
* identify the web manifest
* determine whether an i18n library already exists
* locate all user-facing strings
* identify how the application currently determines user/browser language

Do not replace existing infrastructure unnecessarily.

If an i18n library is already installed, use it where practical.

If no i18n solution exists, use a mature production-ready solution appropriate for React/TypeScript, such as `i18next/react-i18next` or an equivalent established library.

Do not build a custom i18n framework.

---

# 2. Localize the existing UI

Find and replace all user-facing hard-coded strings, including but not limited to:

* navigation
* menus
* buttons
* headings
* labels
* placeholders
* tooltips
* dialogs
* confirmations
* validation messages
* error messages
* empty states
* loading states
* notifications/toasts
* settings
* onboarding
* authentication screens
* forms
* accessibility labels
* screen-reader-only text
* page titles
* relevant metadata

The visual design, layout, component hierarchy, and functionality must remain unchanged.

Do not translate source-code identifiers, variable names, API fields, database values, routes, or internal technical strings unless explicitly required.

---

# 3. Translation architecture

Use semantic translation keys.

Prefer:

```ts
t("navigation.settings")
t("common.cancel")
t("learning.checkAnswer")
t("errors.networkUnavailable")
```

Do NOT use English sentences as translation keys:

```ts
t("Click here")
t("The answer is correct")
```

Organize translations logically by feature/domain.

For example:

```text
locales/
  en/
    common.json
    navigation.json
    learning.json
    errors.json
    settings.json
  de/
    common.json
    navigation.json
    learning.json
    errors.json
    settings.json
  es/
    common.json
    navigation.json
    learning.json
    errors.json
    settings.json
```

Adapt this structure to the existing project rather than forcing this exact directory structure.

Keep translation keys consistent across all three languages.

---

# 4. Translation quality

Produce actual professional translations for all three languages.

Do not perform mechanical word-for-word translation.

### English

Use concise, natural English appropriate for a modern application.

### German

Use natural contemporary German suitable for a professional application.

Choose a consistent form of address (`du` or `Sie`) based on the application's existing tone. If there is no established tone, use a consistent modern product style.

### Spanish

Use neutral/international Spanish unless the application already clearly targets a specific Spanish-speaking region.

Maintain consistent terminology across the application.

Do not translate the same product concept differently in different screens unless context genuinely requires it.

---

# 5. Interpolation and pluralization

Do not concatenate translated fragments.

Bad:

```ts
`${count} lessons completed`
```

Use the i18n system:

```ts
t("learning.lessonsCompleted", { count })
```

Use proper pluralization rules supported by the selected i18n framework.

Do not implement English-only pluralization logic.

Handle variables such as:

* counts
* names
* dates
* percentages
* dynamic values
* user-generated values

safely through interpolation.

---

# 6. Locale selection

Implement a predictable locale-selection strategy.

Use this general priority:

1. Explicit user-selected application language
2. Persisted application language
3. Existing user/account language preference, if one already exists
4. Browser language as an initial default
5. English fallback

The browser language must NOT continuously override the user's explicit application selection.

For example, if a user selects German, subsequently changing or detecting an English browser preference must not silently switch the application back to English.

Persist the selected locale using the application's existing persistence architecture where appropriate.

Do not introduce unnecessary backend/database changes if local persistence is sufficient.

---

# 7. Runtime language switching

If the TapTalk has a language selector, connect it to the new i18n system.

If there is no language selector but adding one fits naturally into the existing settings/UI architecture, add a minimal language selector without changing the application's design.

When the language changes:

* update the UI immediately where supported
* update `<html lang>`
* persist the selection
* ensure navigation remains functional
* ensure current application state is preserved
* ensure the PWA continues working

Do not reload the entire application unless the existing architecture requires it.

---

# 8. CRITICAL: prevent automatic browser translation

This application is a **language-learning application**.

Browser automatic page translation is a known usability problem for this application because it can modify the DOM and translate language-learning material that the application intentionally displays.

The application must therefore use its own localization system and explicitly discourage/prevent automatic browser page translation.

Investigate and implement appropriate mechanisms, including where applicable:

```html
<meta name="google" content="notranslate">
```

and:

```html
<html translate="no">
```

and/or:

```html
class="notranslate"
```

Use the appropriate mechanisms for the project's architecture.

Do not assume that one browser/vendor-specific mechanism is sufficient.

The goal is:

> The application owns UI localization. The browser must not unexpectedly translate or rewrite the application's UI or learning experience.

Do not rely on browser translation prevention as the localization mechanism.

The application must still fully support English, German, and Spanish through its own i18n implementation.

---

# 9. IMPORTANT: distinguish UI language from learning content language

This is a language-learning application.

The application's UI language and the language being learned are independent concepts.

For example:

```ts
{
  uiLocale: "de",
  learningLanguage: "es"
}
```

is completely valid.

The German UI must remain German while Spanish learning content remains Spanish.

Do NOT globally translate all text based on the active UI locale.

Differentiate between:

### Application UI

Examples:

* "Check answer"
* "Next"
* "Settings"
* "Your progress"
* "Correct!"
* "Try again"

These must be localized through the i18n system and protected against automatic browser translation.

### Learning content

Examples:

* vocabulary
* example sentences
* target-language phrases
* source-language phrases
* exercises
* passages
* pronunciation
* user-generated content

These are content and should NOT automatically be translated simply because the UI locale changes.

---

# 10. Use HTML language metadata correctly

The root HTML element must reflect the active application UI language:

```html
<html lang="en">
```

or:

```html
<html lang="de">
```

or:

```html
<html lang="es">
```

Update it whenever the UI locale changes.

For language-learning content, use the appropriate `lang` attribute when the content language is known.

For example:

```tsx
<span lang="es">Buenos días</span>
```

or dynamically:

```tsx
<span lang={contentLanguage}>{content}</span>
```

This distinction is important for accessibility and language-learning functionality.

Do not assume that:

```ts
learningLanguage === uiLocale
```

---

# 11. Do not accidentally block legitimate language metadata

Browser translation protection must not be implemented in a way that destroys the semantic language information of learning content.

For example, it is correct for:

```html
<html lang="de" translate="no">
```

to contain:

```html
<span lang="es">¿Cómo estás?</span>
```

The application UI is German, while the learning content is Spanish.

Preserve this distinction throughout the application.

---

# 12. Locale-aware formatting

Audit existing formatting and replace locale-dependent assumptions where necessary.

Handle correctly:

* dates
* times
* numbers
* decimal separators
* thousands separators
* percentages
* currencies
* durations
* relative dates/times
* pluralization
* lists

Use JavaScript `Intl` APIs or the selected i18n framework.

Examples:

English:

```text
1,234.56
```

German:

```text
1.234,56
```

Do not hard-code English formatting.

---

# 13. Accessibility

Localize all user-facing accessibility information, including:

* `aria-label`
* `aria-describedby`
* `aria-live` messages
* form validation
* screen-reader-only content
* dialog labels
* button descriptions
* tooltips
* document title

Ensure the document's `lang` attribute is always correct.

Do not sacrifice accessibility in order to implement localization.

---

# 14. PWA compatibility

Localization must work correctly in the installed PWA as well as the normal browser.

Check:

* service-worker caching
* translation-resource caching
* application startup
* language persistence
* manifest metadata
* offline behavior
* application reload
* navigation
* deep links

Do not break existing PWA behavior.

Do not introduce a new service worker architecture unless absolutely necessary.

If translation files are cached, ensure deployments can invalidate/update stale translation resources appropriately.

---

# 15. Do not translate dynamic/user-generated content

Do not pass arbitrary user-generated or learning content through the UI translation system.

For example, do not do:

```ts
t(userProvidedText)
```

unless the architecture explicitly requires that behavior.

Translation resources are for application-controlled strings.

Dynamic content should remain dynamic content and should have language metadata where appropriate.

---

# 16. Do not use unsafe HTML for translations

Avoid:

```tsx
dangerouslySetInnerHTML
```

for translations unless there is an existing, justified requirement.

Prefer normal React rendering and interpolation.

Do not introduce XSS risks while implementing localization.

---

# 17. Missing translations and fallbacks

Configure a clear fallback strategy.

If a German translation is missing, the system should fall back predictably, preferably to English.

Do not display translation keys to end users in production unless that is the existing intended behavior.

Example:

```text
learning.checkAnswer
```

must never accidentally appear as visible production UI.

Where practical, add development/CI validation that detects:

* missing translation keys
* unused keys
* inconsistent keys between locales
* malformed translation files

---

# 18. Testing

Add or update tests for the localization implementation.

At minimum verify:

### English

* all major screens render correctly
* no translation keys appear in the UI

### German

* all major screens render correctly
* German translations are loaded correctly

### Spanish

* all major screens render correctly
* Spanish translations are loaded correctly

### Language switching

Verify:

* English → German
* German → Spanish
* Spanish → English

### Persistence

Verify that the selected language survives:

* page reload
* navigation
* PWA restart where applicable

### Document language

Verify:

```text
en → <html lang="en">
de → <html lang="de">
es → <html lang="es">
```

### Learning content

Verify that learning content can have a language different from the UI.

Example:

```text
UI: German
Learning language: Spanish
```

must render correctly.

### Browser translation protection

Verify that the application includes the chosen mechanisms for discouraging/preventing automatic page translation.

Do not claim that browser behavior is universally guaranteed; document browser-specific limitations where relevant.

---

# 19. Repository-wide localization audit

After implementation, search the entire application for remaining user-visible hard-coded strings.

Check:

* JSX
* TS/TSX
* HTML
* configuration that generates UI
* forms
* error handlers
* toast/notification code
* modal/dialog code
* accessibility attributes
* document titles
* empty states
* loading states

Classify remaining strings as:

1. intentionally not localized
2. technical/internal
3. dynamic content
4. missed localization

Fix category 4.

---

# 20. Preserve the TapTalk

This is an implementation task, not a rewrite.

Do NOT:

* redesign UI
* change colors
* change typography
* change layout
* change navigation behavior
* rewrite components unnecessarily
* replace state management
* replace routing
* rewrite the backend
* change APIs unnecessarily
* change authentication
* change database schemas unless absolutely required
* modify unrelated functionality
* introduce unnecessary dependencies

Make the smallest clean architectural changes required to implement localization correctly.

---

# 21. Final validation

Before considering the task complete:

1. Run the existing test suite.
2. Run localization-specific tests.
3. Run TypeScript/type checking.
4. Run linting.
5. Run the production build.
6. Verify the PWA still builds.
7. Verify all three locales.
8. Search for untranslated user-facing strings.
9. Verify `<html lang>` behavior.
10. Verify browser automatic-translation protection.
11. Verify UI language and learning-content language remain independent.

Fix any issues introduced by the localization implementation.

---

# 22. Final report

At the end, provide a concise implementation report containing:

### Localization architecture

* i18n library used
* translation-resource structure
* locale-selection strategy

### Languages

* English
* German
* Spanish

### Browser translation protection

* mechanisms implemented
* where they are applied
* known browser-specific limitations

### Learning content

* how UI locale differs from learning-content language
* how `lang` is assigned to learning content

### Files changed

* files added
* files modified
* files removed

### Validation

* tests run
* type checking
* linting
* production build
* remaining issues, if any

Do not report the task as complete until the TapTalk still functions normally and all three locales have been integrated.

## Most important requirements

Keep these requirements in mind throughout the implementation:

1. **The TapTalk is already finished. Do not redesign or rewrite it.**
2. **Localization must be application-controlled, not browser-controlled.**
3. **Support English, German, and Spanish.**
4. **Prevent automatic browser translation from interfering with the application.**
5. **Do not confuse UI language with language-learning content.**
6. **Preserve the existing PWA and application functionality.**
7. **Use professional, natural translations rather than literal machine-style translations.**
8. **Do not leave user-visible hard-coded strings behind.**
