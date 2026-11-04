"""Persistent voice and emotion worker for the DSH BigFish emotion plugin.

The Node host starts this process once and sends one JSON request per line:

    {"id": 1, "wav": "C:/temp/voice.wav", "language": "zh"}

The worker keeps SenseVoice and emotion2vec loaded between requests.  This is
important: loading them per utterance costs roughly 20 seconds, while a warm
utterance usually settles in a few seconds.
"""

from __future__ import annotations

import contextlib
import json
import os
import statistics
import sys
import time
import traceback
from pathlib import Path
from typing import Any


def emit(payload: dict[str, Any], stream: Any = None) -> None:
    target = stream or sys.stdout
    target.write(json.dumps(payload, ensure_ascii=False) + "\n")
    target.flush()


def median_feature(segments: list[dict[str, Any]], key: str) -> float | None:
    values: list[float] = []
    for segment in segments:
        features = ((segment.get("emotion") or {}).get("features") or {})
        try:
            value = float(features.get(key))
        except (TypeError, ValueError):
            continue
        if value == value and abs(value) != float("inf"):
            values.append(value)
    if not values:
        return None
    return round(float(statistics.median(values)), 4)


def join_transcript(segments: list[dict[str, Any]]) -> str:
    texts = [str(segment.get("text") or "").strip() for segment in segments]
    texts = [text for text in texts if text]
    if not texts:
        return ""
    has_cjk = any(any("\u3400" <= char <= "\u9fff" for char in text) for text in texts)
    return "".join(texts) if has_cjk else " ".join(texts)


def main() -> int:
    if len(sys.argv) < 2:
        emit({"ready": False, "error": "missing backend project root"})
        return 2

    project_root = Path(sys.argv[1]).expanduser().resolve()
    if not project_root.is_dir():
        emit({"ready": False, "error": f"backend project root not found: {project_root}"})
        return 2

    sys.path.insert(0, str(project_root))
    os.chdir(project_root)
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("MODELSCOPE_LOG_LEVEL", "30")

    started = time.perf_counter()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from emotion_asr.asr import create_asr_model
            from emotion_asr.cli import transcribe_file
            from emotion_asr.config import Settings
            from emotion_asr.emotion import EmotionAnalyzer

            settings = Settings.load()
            asr = create_asr_model(settings)
            emotion = EmotionAnalyzer(settings)
    except Exception as exc:
        emit({"ready": False, "error": f"{type(exc).__name__}: {exc}"})
        sys.stderr.write(traceback.format_exc())
        return 1

    emit({
        "ready": True,
        "engine": getattr(asr, "describe", lambda: type(asr).__name__)(),
        "emotion": "SenseVoice + emotion2vec",
        "load": round(time.perf_counter() - started, 3),
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request: dict[str, Any] = {}
        try:
            request = json.loads(line)
            if request.get("type") == "shutdown":
                break
            request_id = request.get("id")
            wav = str(request.get("wav") or "")
            language = str(request.get("language") or "zh")
            if not wav or not Path(wav).is_file():
                raise FileNotFoundError(f"audio file not found: {wav}")
            request_started = time.perf_counter()
            with contextlib.redirect_stdout(sys.stderr):
                transcript = transcribe_file(
                    wav,
                    asr,
                    emotion,
                    ffmpeg=None,
                    language=language,
                )
            records = list(transcript.records)
            segments = [
                {
                    "index": record.index,
                    "text": record.text,
                    "start": record.start,
                    "end": record.end,
                    "file": record.file,
                    "emotion": record.emotion.to_dict(),
                }
                for record in records
            ]
            text = join_transcript(segments)
            if not text:
                raise RuntimeError("没有识别到清晰的语音")
            aggregate = transcript.aggregate
            if aggregate is None and records:
                aggregate = records[-1].emotion
            aggregate_dict = aggregate.to_dict() if aggregate is not None else {}
            features = {
                "speech_rate": median_feature(segments, "speech_rate"),
                "pause_ratio": median_feature(segments, "pause_ratio"),
                "voiced_ratio": median_feature(segments, "voiced_ratio"),
                "f0_median": median_feature(segments, "f0_median"),
                "f0_range_st": median_feature(segments, "f0_range_st"),
                "f0_std_st": median_feature(segments, "f0_std_st"),
                "db_std_n": median_feature(segments, "db_std_n"),
                "energy_n": median_feature(segments, "energy_n"),
                "pitch_n": median_feature(segments, "pitch_n"),
                "zcr": median_feature(segments, "zcr"),
            }
            features = {key: value for key, value in features.items() if value is not None}
            emit({
                "id": request_id,
                "ok": True,
                "transcript": text,
                "emotion": aggregate_dict.get("dominant") or "neutral",
                "confidence": aggregate_dict.get("confidence", 0),
                "valence": aggregate_dict.get("valence", 0),
                "arousal": aggregate_dict.get("arousal", 0.5),
                "scores": aggregate_dict.get("scores") or {},
                "source": aggregate_dict.get("source") or "fusion",
                "features": features,
                "segments": [
                    {
                        "text": segment.get("text", ""),
                        "start": segment.get("start", 0),
                        "end": segment.get("end", 0),
                        "emotion": ((segment.get("emotion") or {}).get("dominant") or "neutral"),
                        "confidence": ((segment.get("emotion") or {}).get("confidence", 0)),
                    }
                    for segment in segments
                ],
                "duration": round(float(transcript.duration or 0), 3),
                "elapsed": round(time.perf_counter() - request_started, 3),
                "engine": "SenseVoice + emotion2vec",
            })
        except Exception as exc:
            detail = traceback.format_exc()
            sys.stderr.write(detail)
            emit({
                "id": request.get("id"),
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
            })

    try:
        with contextlib.redirect_stdout(sys.stderr):
            emotion.close()
            asr.close()
    except Exception:
        sys.stderr.write(traceback.format_exc())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
