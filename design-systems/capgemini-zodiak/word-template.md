# Word template

Capgemini's 2025 Word template is the print and document counterpart to this system. Its theme carries the same palette and the same typeface, so a document built from it and a screen built from these tokens match without any translation.

The template file itself is not stored here — the artifact store does not take `.docx`. Attach `Word Template.docx` to the session, open it as the base document, and write into it. Never rebuild the cover, header or footer by hand.

## Theme

| Word theme slot | Value | Token here |
| --- | --- | --- |
| Major font (headings) | Ubuntu Medium | `sans` at weight 500 |
| Minor font (body) | Ubuntu | `sans` at weight 300/400 |
| accent1 | #121A38 | `brand-dark-blue` |
| accent2 | #0058AB | `brand-capgemini-blue` |
| accent3 | #1DB8F2 | `brand-light-blue` |
| accent4 | #00D5D0 | `brand-turquoise` |
| accent5 | #FEB100 | `brand-yellow` |
| accent6 | #FF816E | `brand-orange` |
| hlink | #D4D3F1 | `brand-lilac` |
| folHlink | #00828E | `brand-teal` |

Ubuntu and Ubuntu Medium are embedded in the file, so the document renders correctly on machines without the font installed.

## Page

A4, 210 × 297 mm. Margins: top 36.1, right 15.0, bottom 27.9, left 24.1 mm. Header 10.2 mm, footer 11.9 mm. Two sections: the cover, then the body.

## Styles to write against

Use the named styles. Do not apply direct formatting — the table of contents, the figure and table indexes, and the PDF accessibility tags all read the styles.

| Style | Size | Colour | Use |
| --- | --- | --- | --- |
| `Title` | 44pt | #FFFFFF | Cover title, over the key visual |
| `Subtitle` | 11pt | #FFFFFF | Cover subtitle |
| `Over Title` | 11pt | — | Cover eyebrow |
| `Content Title` | 16pt | — | The "Content" heading above the TOC |
| `Heading 1` | 16pt | #0058AB | Chapter |
| `Heading 2` | 12pt bold | #1DB8F2 | Section |
| `Heading 3` | 11pt bold | #00828E | Subsection |
| `Heading 4`–`Heading 7` | — | #0D1329 / #090C1B | Deeper levels |
| `Body Text` | — | — | Paragraphs. Line 276 twips, 120 after |
| `List Paragraph` | — | — | Bulleted lists |
| `Numbered List` | — | — | Numbered lists |
| `Subhead` | 11pt bold | #000000 | Run-in heading inside a section |
| `Quote Text` | 28pt Ubuntu Light | #FFFFFF | Pull quote on a coloured panel |
| `Quote Mark` | 90pt | — | The opening quote glyph |
| `Author Name` | 20pt | — | Quote attribution |
| `caption` | 9pt | auto | Figure and table captions. Feeds the indexes |
| `Source Pictures` | 7pt | #00D5D0 | Image credit under a figure |
| `Table Title` | — | #1DB8F2 bold | Heading above a table |
| `Diagram Title Blue` | — | #0058AB | Diagram label |
| `Diagram Title Sky` | — | #1DB8F2 | Diagram label, alternate |
| `Disclaimer About` | — | — | Legal block on the disclaimer page |
| `footnote text` | 7pt | — | Footnotes |

Table styles: `Capgemini Tabelle` and `Capgemini 2021`. Use one of those two, never `Table Grid`.

## Footer classification

The footer carries a dropdown content control named **Classification**. Set it on every document. Options:

- Public.
- Company Confidential.
- Company Restricted.
- Customer Restricted.
- Company Sensitive.

Leaving it on "Please choose!" ships a document that says nothing about its own handling. Pick one.

## How a document gets built

1. Open the attached template as the base document.
2. Keep sections, headers, footers and the cover. Replace the cover title, subtitle and key visual.
3. Delete the instructional body content — everything from the "Some important tips" chapter through the sample chapters.
4. Write the new content using the named styles above.
5. Set the Classification dropdown.
6. Update the table of contents and the figure and table indexes.

## Charts inside a document

The template ships four chart placeholders with embedded worksheets and its own chart colour set. Recolour any chart to the theme accents in order: accent2 (#0058AB), accent3 (#1DB8F2), accent4 (#00D5D0), accent5 (#FEB100), accent6 (#FF816E), accent1 (#121A38). Label every series directly where the chart allows it, rather than relying on a legend and colour alone.
