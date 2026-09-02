# Project config JSON shape

This is the object stored (stringified) in `projects.config`. The admin
builder writes it; the public renderer reads it; nothing else needs to
understand a project's structure.

```json
{
  "theme": {
    "primaryColor": "#4B39D6",
    "backgroundColor": "#EEEDFB",
    "font": "Roboto",
    "logoMediaId": null,
    "bannerMediaId": null
  },
  "buttons": {
    "next":   { "enabled": true, "text": "Next" },
    "back":   { "enabled": true, "text": "Back" },
    "submit": { "enabled": true, "text": "Submit" },
    "copy":   { "enabled": false, "text": "Copy" },
    "download": { "enabled": false, "text": "Download" },
    "upload": { "enabled": false, "text": "Upload File" }
  },
  "whatsapp": {
    "enabled": false,
    "number": "",
    "messageTemplate": "New submission from {{name}}: {{summary}}"
  },
  "pages": [
    {
      "id": "page_1",
      "title": "Booking Details",
      "order": 0,
      "elements": [
        {
          "id": "el_1",
          "type": "heading",
          "order": 0,
          "hidden": false,
          "props": { "text": "Book Your Adventure" }
        },
        {
          "id": "el_2",
          "type": "text_input",
          "order": 1,
          "hidden": false,
          "props": {
            "label": "Full Name",
            "placeholder": "",
            "required": true,
            "prefillKey": "name"
          }
        }
      ]
    }
  ]
}
```

## Element `type` values

`heading`, `paragraph`, `image`, `gallery` (props.images: `{mediaId, caption, alt}[]`),
`button`, `text_input`, `textarea`, `dropdown` (props.options: string[]),
`checkbox` (props.options: string[]), `radio` (props.options: string[]),
`date`, `number`, `email`, `file_upload`.

Every input-like type shares: `label`, `required`, `placeholder` (where it
makes sense), and `prefillKey` — the query-param name that
`?name=John&package=Adventure` style prefilled links will populate.

## Prefill links

`https://yourwebsite.com/f/abc123?name=John&package=Adventure` — the
renderer reads `location.search` on load and, for every element whose
`props.prefillKey` matches a query param, sets that element's initial
value.
