# Moodle Attendance Helper (Chrome extension)

A small Manifest V3 extension that finds student IDs in Moodle table cells and fills a later cell's input with `1`.

## Install

1. Download and unzip `moodle-attendance-helper.zip`.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the `moodle-attendance-helper` folder (the one containing `manifest.json`).
5. Open the Moodle attendance/gradebook page and click the extension icon.

## Use

1. Paste student IDs into the text box. IDs can be separated by newlines, commas, semicolons, or spaces.
2. Set the week index `i`.
3. Click **Preview** and inspect the target cells and any warnings.
4. Click **Fill with 1** to change the inputs.
5. Check Moodle and use its normal save/submit mechanism if needed.

## Cell indexing

The ID cell itself is not counted. The target is the `(i + 1)`-th following `td` in the **same table row**:

- `i = 0`: next `td`
- `i = 1`: second following `td`
- `i = 2`: third following `td`

Nested elements such as `div`, `span`, and other wrappers inside a `td` do not affect the cell count.

## Safety / behavior

- The extension only runs after you click its popup button, and only on the active HTTP(S) tab.
- It uses the text content of table cells to locate IDs.
- If an ID maps to multiple candidate cells, the target is out of range, or a target cell has zero/multiple editable inputs, it reports the issue rather than guessing.
- It fills visible, enabled, editable inputs, excluding hidden/button/checkbox/radio/file inputs.
- It dispatches `input` and `change` events and blurs the edited input so page-side listeners can react.
- It does **not** click Save, submit a form, or guarantee that Moodle has persisted the changes. Review the page and save using Moodle's normal controls.

If your Moodle page uses a different table layout or a custom grade widget rather than an ordinary input, the selector logic may need a small adjustment.
