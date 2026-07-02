# =============================================================================
# statements.py — Budget module: PDF statement text extraction (#84)
#
# One job: turn an uploaded bank-statement PDF into per-page TEXT the frontend
# can hand to the local AI (POST /lmstudio/extract) for row extraction. The
# cross-module tie lives in the FRONTEND per convention (like vehicles/MPG →
# /lmstudio/vision) — this backend never calls the lmstudio module, so budget
# keeps working when lmstudio is absent (the UI just hides PDF import).
#
# Layout-aware extraction (pdfplumber) matters: keeping the date / description /
# amount columns visually aligned is what lets the model read the table.
# =============================================================================
from fastapi import APIRouter, UploadFile, File, HTTPException
import io

# Soft import — before the API image is rebuilt with the new dep, the router
# still loads and reports a clear error instead of failing module discovery.
try:
    import pdfplumber
except Exception:
    pdfplumber = None

router = APIRouter(prefix="/statements", tags=["statements"])

MAX_PDF_BYTES = 15 * 1024 * 1024   # a monthly statement is well under this


@router.post("/text")
async def statement_text(file: UploadFile = File(...)):
    """Extract the text layer of an uploaded statement PDF, page by page.

    Returns {filename, pages:[{page, text, has_text}]}. Pages with no text
    layer (scanned images) come back has_text=false — the UI surfaces them as
    unparseable for now (vision fallback is a follow-up)."""
    if pdfplumber is None:
        raise HTTPException(status_code=503,
                            detail="PDF support not installed — rebuild the API image (pdfplumber)")
    if file.content_type not in ("application/pdf", "application/octet-stream", None):
        raise HTTPException(status_code=400, detail="Upload a PDF file")

    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF too large")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Not a PDF file")

    pages = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                # layout=True preserves column alignment (amounts stay in their
                # column), which is what makes the text model-readable
                text = page.extract_text(layout=True) or ""
                pages.append({"page": i, "text": text, "has_text": bool(text.strip())})
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Couldn't read PDF: {e}")

    return {"filename": file.filename, "pages": pages}
