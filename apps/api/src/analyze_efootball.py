import json
import sys

from efootball_ocr import EFootballResultReader


def _normalize_digit_text(value):
    digits = "".join(character for character in str(value or "") if character.isdigit())
    if not digits:
        return ""
    if len(digits) > 1 and digits.startswith("0"):
        return ""
    return digits[:2]


def _extract_score_pair_from_text(value):
    import re

    normalized = str(value or "")
    normalized = normalized.replace("—", "-").replace("–", "-").replace("−", "-")
    match = re.search(r"(\d{1,2})\s*-\s*(\d{1,2})", normalized)
    if not match:
        return None

    return int(match.group(1)), int(match.group(2))


def _read_score_crop(image, box):
    try:
        import cv2
        import numpy
        import pytesseract
    except Exception:
        return ""

    height, width = image.shape[:2]
    x1, y1, x2, y2 = box
    crop = image[int(height * y1):int(height * y2), int(width * x1):int(width * x2)]
    if crop.size == 0:
        return ""

    enlarged = cv2.resize(crop, None, fx=10, fy=10, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
    _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(dark_mask)
    cleaned = 255 * numpy.ones_like(dark_mask)

    for index in range(1, component_count):
        x, y, component_width, component_height, area = stats[index]
        touches_edge = (
            x <= 3 or
            y <= 3 or
            x + component_width >= dark_mask.shape[1] - 3 or
            y + component_height >= dark_mask.shape[0] - 3
        )
        if area > 50 and not touches_edge:
            cleaned[labels == index] = 0

    cleaned = cv2.copyMakeBorder(cleaned, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255)
    for page_mode in (7, 8, 10, 13):
        text = pytesseract.image_to_string(
            cleaned,
            config=f"--psm {page_mode} -c tessedit_char_whitelist=0123456789",
        )
        normalized = _normalize_digit_text(text)
        if normalized:
            return normalized

    return ""


def _read_summary_score_crop(image, box):
    try:
        import cv2
        import numpy
        import pytesseract
    except Exception:
        return None

    height, width = image.shape[:2]
    x1, y1, x2, y2 = box
    crop = image[int(height * y1):int(height * y2), int(width * x1):int(width * x2)]
    if crop.size == 0:
        return None

    enlarged = cv2.resize(crop, None, fx=6, fy=6, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(enlarged, cv2.COLOR_BGR2HSV)
    preprocessors = (
        cv2.threshold(gray, 120, 255, cv2.THRESH_BINARY)[1],
        cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1],
        cv2.inRange(hsv, numpy.array([10, 30, 80]), numpy.array([60, 255, 255])),
    )

    for mask in preprocessors:
        for image_variant in (mask, 255 - mask):
            prepared = cv2.copyMakeBorder(
                image_variant,
                30,
                30,
                30,
                30,
                cv2.BORDER_CONSTANT,
                value=255,
            )
            for page_mode in (8, 10, 13):
                text = pytesseract.image_to_string(
                    prepared,
                    config=f"--psm {page_mode} -c tessedit_char_whitelist=0123456789-–",
                )
                score_pair = _extract_score_pair_from_text(text)
                if score_pair:
                    return score_pair

    return None


def _read_fixed_score_boxes(image_path):
    try:
        import cv2
    except Exception:
        return None

    image = cv2.imread(image_path)
    if image is None:
        return None

    left_boxes = (
        (0.448, 0.155, 0.492, 0.222),
        (0.455, 0.160, 0.488, 0.220),
        (0.442, 0.148, 0.494, 0.228),
    )
    right_boxes = (
        (0.522, 0.160, 0.558, 0.220),
        (0.518, 0.155, 0.565, 0.222),
        (0.515, 0.150, 0.568, 0.225),
    )

    left_score = next((score for score in (_read_score_crop(image, box) for box in left_boxes) if score), "")
    right_score = next((score for score in (_read_score_crop(image, box) for box in right_boxes) if score), "")
    if not left_score or not right_score:
        return None

    return int(left_score), int(right_score)


def _read_summary_screen_score(image_path):
    try:
        import cv2
    except Exception:
        return None

    image = cv2.imread(image_path)
    if image is None:
        return None

    score_line_boxes = (
        (0.400, 0.060, 0.620, 0.260),
        (0.420, 0.070, 0.610, 0.250),
        (0.360, 0.040, 0.650, 0.280),
    )

    return next(
        (
            score_pair
            for score_pair in (_read_summary_score_crop(image, box) for box in score_line_boxes)
            if score_pair
        ),
        None,
    )


def _clean_player_name(value):
    cleaned = str(value or "").strip(" \t\r\n-'\"“”‘’`~>|<")
    cleaned = cleaned.replace("[", " ").replace("]", " ").replace("(", " ").replace(")", " ")
    cleaned = " ".join(part for part in cleaned.split() if any(character.isalnum() for character in part))
    return cleaned.strip()


def _is_header_noise_token(value):
    import re

    token = str(value or "").strip()
    normalized = re.sub(r"[^a-z0-9]", "", token.lower())
    if not normalized:
        return True
    if re.search(r"\d|[\[\](){}=+\-–|/\\]", token):
        return True
    if normalized in {"v", "vs", "pk", "pen", "pens", "es", "bw", "em", "e", "i"}:
        return True
    return token.isupper() and len(normalized) <= 3


def _extract_header_names_from_raw_text(raw_text):
    import re

    for line in str(raw_text or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("[") or re.search(r"%|possession|shots|passes|fouls|corners|tackles|saves|full time", stripped, re.I):
            continue

        tokens = stripped.split()
        if len(tokens) < 3:
            continue

        for index in range(1, len(tokens) - 1):
            if not _is_header_noise_token(tokens[index]):
                continue

            end_index = index
            while end_index < len(tokens) - 1 and _is_header_noise_token(tokens[end_index]):
                end_index += 1

            left_name = _clean_player_name(" ".join(tokens[:index]))
            right_name = _clean_player_name(" ".join(tokens[end_index:]))
            if left_name and right_name:
                return left_name, right_name

    return "", ""


def _extract_penalty_score_from_raw_text(raw_text):
    import re

    for line in str(raw_text or "").splitlines():
        compact = re.sub(r"[^a-z0-9]", "", line.lower())
        match = re.search(r"(\d{1,2})p(?:enalties|ens|k)?(\d{1,2})", compact)
        if match:
            return int(match.group(1)), int(match.group(2))

        spaced = re.sub(r"[^a-z0-9]+", " ", line.lower()).strip()
        match = re.search(r"\b(\d{1,2})\s*(?:p\s*k|pk|pens?|penalties)\s*(\d{1,2})\b", spaced)
        if match:
            return int(match.group(1)), int(match.group(2))

    return None


def _extract_names_from_raw_text(raw_text):
    import re

    def looks_like_score_noise(value):
        token = str(value or "").strip()
        if not token:
            return False
        if re.search(r"\d", token):
            return True
        if any(character in token for character in "[](){}=-–|/\\"):
            return True
        return bool(re.fullmatch(r"[A-Z]{1,3}", token))

    def has_player_name_signal(value):
        normalized = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
        letters = re.sub(r"[^a-z]", "", normalized)
        return len(normalized) >= 4 and len(letters) >= 4

    for line in str(raw_text or "").splitlines():
        stripped = line.strip()
        if not stripped or re.search(r"%|possession|shots|passes|fouls|corners|tackles|saves", stripped, re.I):
            continue

        patterns = (
            r"^(.+?)\s+\d{1,2}\s*[-=–]\s*\d{1,2}\s+(.+)$",
            r"^(.+?)\s+[\[\(]?[^\s]{1,4}[\]\)]?\s*[-=–]\s*[\[\(]?[^\s]{1,4}[\]\)]?\s+(.+)$",
        )
        for pattern in patterns:
            match = re.match(pattern, stripped)
            if not match:
                continue
            left_name = _clean_player_name(match.group(1))
            right_name = _clean_player_name(match.group(2))
            if left_name and right_name:
                return left_name, right_name

        tokens = stripped.split()
        if len(tokens) >= 4:
            for index in range(1, len(tokens) - 2):
                if looks_like_score_noise(tokens[index]) and looks_like_score_noise(tokens[index + 1]):
                    left_name = _clean_player_name(" ".join(tokens[:index]))
                    right_name = _clean_player_name(" ".join(tokens[index + 2:]))
                    if has_player_name_signal(left_name) and has_player_name_signal(right_name):
                        return left_name, right_name

    return _extract_header_names_from_raw_text(raw_text)


def _apply_penalty_score_fallback(output):
    penalty_scores = _extract_penalty_score_from_raw_text(output.get("raw_text", ""))
    if not penalty_scores:
        return output

    left_penalties, right_penalties = penalty_scores
    left_name = output.get("home_username") or ""
    right_name = output.get("away_username") or ""
    if not left_name or not right_name:
        raw_left_name, raw_right_name = _extract_names_from_raw_text(output.get("raw_text", ""))
        left_name = left_name or raw_left_name
        right_name = right_name or raw_right_name

    output["home_username"] = left_name
    output["away_username"] = right_name
    output["home_score"] = left_penalties
    output["away_score"] = right_penalties
    output["penalty_score_line"] = f"{left_penalties} PK {right_penalties}"
    output["score_line"] = output.get("score_line") if output.get("score_line") and output.get("score_line") != "? – ?" else f"PK {left_penalties} – {right_penalties}"
    output["phase"] = output.get("phase") or "Penalty Shootout"
    output["raw_text"] = "\n".join(
        part for part in (
            output.get("raw_text", ""),
            f"[penalty-score-fallback]\n{left_name or 'left'} {left_penalties} PK {right_penalties} {right_name or 'right'}",
        ) if part
    )

    if left_penalties != right_penalties:
        winner_name = left_name if left_penalties > right_penalties else right_name
        output["winner"] = output.get("winner") or winner_name
        output["winnerUsername"] = output.get("winnerUsername") or winner_name
        output["confidence"] = max(float(output.get("confidence") or 0), 0.9)

    return output


def _apply_score_box_fallback(image_path, output):
    scores = _read_fixed_score_boxes(image_path)
    if not scores:
        return output

    left_score, right_score = scores
    left_name = output.get("home_username") or ""
    right_name = output.get("away_username") or ""
    if not left_name or not right_name:
        raw_left_name, raw_right_name = _extract_names_from_raw_text(output.get("raw_text", ""))
        left_name = left_name or raw_left_name
        right_name = right_name or raw_right_name

    output["home_username"] = left_name
    output["away_username"] = right_name
    output["score_line"] = f"{left_score} – {right_score}"
    output["raw_text"] = "\n".join(
        part for part in (
            output.get("raw_text", ""),
            f"[score-box-fallback]\n{left_name or 'left'} {left_score} - {right_score} {right_name or 'right'}",
        ) if part
    )

    if left_score != right_score:
        winner_name = left_name if left_score > right_score else right_name
        output["winner"] = output.get("winner") or winner_name
        output["winnerUsername"] = output.get("winnerUsername") or winner_name

    return output


def _apply_summary_score_fallback(image_path, output):
    scores = _read_summary_screen_score(image_path)
    if not scores:
        return output

    left_score, right_score = scores
    left_name = output.get("home_username") or ""
    right_name = output.get("away_username") or ""
    if not left_name or not right_name:
        raw_left_name, raw_right_name = _extract_names_from_raw_text(output.get("raw_text", ""))
        left_name = left_name or raw_left_name
        right_name = right_name or raw_right_name

    output["home_username"] = left_name
    output["away_username"] = right_name
    output["home_score"] = left_score
    output["away_score"] = right_score
    output["score_line"] = f"{left_score} – {right_score}"
    output["phase"] = output.get("phase") or "Full Time"
    output["raw_text"] = "\n".join(
        part for part in (
            output.get("raw_text", ""),
            f"[summary-score-fallback]\n{left_name or 'left'} {left_score} - {right_score} {right_name or 'right'}",
        ) if part
    )

    if left_score != right_score:
        winner_name = left_name if left_score > right_score else right_name
        output["winner"] = winner_name
        output["winnerUsername"] = winner_name
        output["confidence"] = max(float(output.get("confidence") or 0), 0.9)

    return output


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Image path required"}))
        sys.exit(1)

    image_path = sys.argv[1]

    try:
        reader = EFootballResultReader()
        result = reader.read(image_path)
        output = {
            "winner": getattr(result, "winner", ""),
            "winnerUsername": getattr(result, "winner", ""),
            "home_username": getattr(result, "home_username", ""),
            "away_username": getattr(result, "away_username", ""),
            "score_line": getattr(result, "score_line", ""),
            "phase": getattr(result, "phase", ""),
            "confidence": float(getattr(result, "confidence", 0) or 0),
            "raw_text": getattr(result, "raw_text", ""),
        }
        if not output["winner"] or not output["score_line"] or output["score_line"] == "? – ?":
            output = _apply_score_box_fallback(image_path, output)
        if not output["winner"] or not output["score_line"] or output["score_line"] == "? – ?":
            output = _apply_summary_score_fallback(image_path, output)
        if not output["winner"]:
            output = _apply_penalty_score_fallback(output)
        print(json.dumps(output))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
