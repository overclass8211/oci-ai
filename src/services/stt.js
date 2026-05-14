const fs = require('fs');
require('dotenv').config({ override: true });
const { genAI, MODEL_FAST, SAFETY_SETTINGS } = require('./gemini');

// 지원 오디오 MIME 타입 → Gemini inlineData mimeType 매핑
const MIME_MAP = {
  'audio/webm':       'audio/webm',
  'audio/ogg':        'audio/ogg',
  'audio/mpeg':       'audio/mp3',
  'audio/mp3':        'audio/mp3',
  'audio/wav':        'audio/wav',
  'audio/x-wav':      'audio/wav',
  'audio/flac':       'audio/flac',
  'audio/x-flac':     'audio/flac',
  'audio/mp4':        'audio/mp4',
  'audio/x-m4a':      'audio/mp4',
  'audio/aac':        'audio/aac',
};

/**
 * Gemini 멀티모달 오디오 → 텍스트 변환 + 화자 분리
 * Google Cloud STT API 대신 Gemini의 기본 오디오 이해 기능을 사용합니다.
 */
async function transcribeAudio(filePath, mimetype, fileSize) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 미설정');

  const audioData = fs.readFileSync(filePath).toString('base64');
  const mime = MIME_MAP[(mimetype || '').toLowerCase()] || 'audio/webm';

  const model = genAI.getGenerativeModel({
    model: MODEL_FAST,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 }
    }
  });

  const prompt = `이 오디오 파일을 한국어로 전사(transcription)해주세요.

요구사항:
1. 모든 발화 내용을 정확하게 전사
2. 서로 다른 화자를 구분 (화자1, 화자2, 화자3 등으로 표시)
3. 응답은 반드시 다음 JSON 형식으로만 반환:

{
  "transcript": "전체 전사 텍스트 (화자 구분 없이 연속된 텍스트)",
  "speakers": [
    { "speaker": 1, "text": "화자1의 발화 내용" },
    { "speaker": 2, "text": "화자2의 발화 내용" },
    { "speaker": 1, "text": "화자1의 다음 발화" }
  ]
}

JSON 외 다른 텍스트는 절대 포함하지 마세요.`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: mime, data: audioData } }
  ]);

  const raw = result.response.text().trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch (__) { /* fallback parse also failed, return raw text */ }
    }
  }

  if (!parsed) {
    // JSON 파싱 실패 시 원본 텍스트를 단일 화자로 처리
    return {
      transcript: raw,
      speakers: [{ speaker: 1, text: raw }],
      durationSec: Math.round((fileSize * 8) / (128 * 1000)),
      sizeKB: Math.round(fileSize / 1024)
    };
  }

  return {
    transcript: parsed.transcript || raw,
    speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [{ speaker: 1, text: parsed.transcript || raw }],
    durationSec: Math.round((fileSize * 8) / (128 * 1000)),
    sizeKB: Math.round(fileSize / 1024)
  };
}

module.exports = { transcribeAudio };
