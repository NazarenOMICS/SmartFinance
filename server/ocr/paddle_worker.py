import argparse
import json
import os
import sys
import tempfile


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def normalize_ocr_rows(rows):
    blocks = []
    for row in rows or []:
        if not row:
            continue
        # PaddleOCR may return either [bbox, (text, score)] or nested page rows.
        if isinstance(row, list) and len(row) == 1 and isinstance(row[0], list):
            blocks.extend(normalize_ocr_rows(row))
            continue
        if not (isinstance(row, list) and len(row) >= 2):
            continue
        bbox = row[0]
        payload = row[1]
        text = ""
        confidence = 0.0
        if isinstance(payload, (list, tuple)) and len(payload) >= 2:
            text = str(payload[0] or "").strip()
            try:
                confidence = float(payload[1] or 0)
            except Exception:
                confidence = 0.0
        if text:
            blocks.append({"text": text, "bbox": bbox, "confidence": confidence})
    return blocks


def image_paths_for_input(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    if ext != ".pdf":
        return [file_path], []

    try:
        import fitz
    except Exception as exc:
        raise RuntimeError("pdf_render_unavailable: install PyMuPDF to OCR scanned PDFs") from exc

    temp_paths = []
    doc = fitz.open(file_path)
    try:
        for page_index in range(min(len(doc), 3)):
            page = doc.load_page(page_index)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            handle = tempfile.NamedTemporaryFile(delete=False, suffix=f"-page-{page_index + 1}.png")
            handle.close()
            pixmap.save(handle.name)
            temp_paths.append(handle.name)
    finally:
        doc.close()

    return temp_paths, temp_paths


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--lang", default="es")
    args = parser.parse_args()

    try:
        from paddleocr import PaddleOCR
    except Exception as exc:
        emit({
            "ok": False,
            "code": "ocr_engine_unavailable",
            "error": f"PaddleOCR is not installed or failed to load: {exc}",
        })
        return 0

    if not os.path.exists(args.file):
        emit({"ok": False, "code": "ocr_file_missing", "error": "Input file does not exist"})
        return 0

    temp_paths = []
    try:
        image_paths, temp_paths = image_paths_for_input(args.file)
        ocr = PaddleOCR(use_angle_cls=True, lang=args.lang, show_log=False)
        blocks = []
        for image_path in image_paths:
            blocks.extend(normalize_ocr_rows(ocr.ocr(image_path, cls=True)))

        raw_text = "\n".join(block["text"] for block in blocks)
        confidence_values = [block["confidence"] for block in blocks if block.get("confidence")]
        average_confidence = (
            sum(confidence_values) / len(confidence_values)
            if confidence_values else 0
        )
        emit({
            "ok": True,
            "provider": "paddleocr",
            "language": args.lang,
            "raw_text": raw_text,
            "blocks": blocks,
            "confidence": round(average_confidence, 4),
        })
    except Exception as exc:
        emit({"ok": False, "code": "ocr_engine_unavailable", "error": str(exc)})
    finally:
        for path in temp_paths:
            try:
                os.unlink(path)
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
