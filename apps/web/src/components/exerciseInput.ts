/**
 * Attributes that ask the browser and the operating system not to help with
 * spelling in a language-learning exercise field.
 *
 * A practice answer is deliberately typed from memory in a language the
 * learner may not have enabled on the device. Autocorrect would "fix" a correct
 * answer into a wrong one, predictive text would insert words the learner did
 * not intend, and autocapitalize would rewrite the first letter. That makes the
 * field look broken, so these hints are applied to exercise inputs only.
 *
 * They are hints, not a guarantee. Android and iOS may still show a suggestion
 * strip or autocorrect a word, because only the platform decides that. The
 * answer check already ignores case and punctuation (see `normalizeAnswer`), so
 * nothing here changes scoring.
 *
 * Defined once here so every exercise field, present or future, inherits the
 * same behaviour. Unrelated fields (username, password, chat, profile notes)
 * must keep the browser's normal assistance.
 */
export const exerciseInputAttrs = {
  // Stops the browser offering previously typed values for this field.
  autocomplete: 'off',
  // WebKit (Safari, and therefore iOS browsers and installed PWAs) autocorrects
  // text inputs by default. This is the attribute that actually matters there.
  autocorrect: 'off',
  // The valid values are none | sentences | words | characters.
  autocapitalize: 'none',
  // A real boolean, not the string "false": spellcheck is a DOM property, and
  // assigning the string would coerce to true and switch checking on.
  spellcheck: false,
  // An explicit text keyboard; the default for type="text", stated for clarity.
  inputmode: 'text',
} as const;
