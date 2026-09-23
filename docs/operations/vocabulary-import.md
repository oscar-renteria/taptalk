# Vocabulary import

Vocabulary is imported by an administrator (see [administrator provisioning](administrator-provisioning.md)) under **Import vocabulary** in the app.

## Steps

1. **Vocabulary JSON file:** choose the file.
2. **Preview import:** shows the valid and invalid records, duplicates, and which records are additions or updates. Nothing is saved yet.
3. **Confirm and import:** saves all records in one transaction. The button stays disabled while any record is invalid or duplicated. The import then appears under **Import history**.

## File format

A JSON array of objects:

```json
[
  { "english": "hello", "phonetics": "həˈləʊ", "german": "hallo; guten Tag" },
  { "english": "to be happy", "german": "(sich) freuen" },
  { "english": "to give ...", "german": "jemandem etwas geben ..." }
]
```

| Field | Required | Meaning |
| --- | --- | --- |
| `english` | yes | English text, which identifies the entry. An existing `english` value (ignoring case) **updates** that entry instead of adding one |
| `german` | yes | German text as displayed. Separate several accepted answers with `;` |
| `phonetics` | no | Pronunciation hint shown under the prompt |

- **Optional words:** text in parentheses may be left out: `(sich) freuen` accepts "sich freuen" and "freuen".
- **Placeholders:** `...` / `…` are shown but ignored when answers are checked.
- **Duplicates:** alternatives that are identical after normalization (`Hallo; hallo!`) are merged, and the preview shows a warning.
- **Matching rules:** learners may type `ae`/`oe`/`ue`/`ss` for `ä`/`ö`/`ü`/`ß`; see [answer matching](../architecture/answer-matching.md).
- **Limits:** at most 1 MB of content per file and 200 characters for the file name.
