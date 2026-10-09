# On-device reader models

PaddleOCR text recognition models in ONNX form (Apache-2.0), from the RapidOCR collection (https://modelscope.cn/models/RapidAI/RapidOCR):

- `en_PP-OCRv4_rec_infer.onnx` (English) with `en_dict.txt`
- `latin_PP-OCRv3_rec_infer.onnx` (Latin-script languages: Spanish, French, German, Italian, Portuguese, Dutch, Polish, Turkish and more) with `latin_dict.txt`

The dictionaries have **no trailing newline on purpose**: the reader library adds the space character after the last line, and a final newline would put an empty entry in front of it, so the model's spaces would come out as nothing.

`scripts/copy-ocr.mjs` copies these into `public/ocr/paddle` at build time, next to the text-finding model (from `@gutenye/ocr-models`).
